export type AnswerStatus = 'unanswered' | 'correct' | 'incorrect' | 'partial' | 'unknown' | 'skipped'
export type SrsRating = 'impossible' | 'hard' | 'ok' | 'easy'
export type SrsStage = 'learning' | 'review'

export type SrsState = {
  dueAt: string
  lastReviewedAt: string | null
  reviewCount: number
  lapseCount: number
  easeFactor: number
  intervalMinutes: number
  lastRating: SrsRating | null
  stage: SrsStage
}

export type SrsReviewInput = {
  currentState?: SrsState | null
  rating: SrsRating
  answerStatus: AnswerStatus
  now?: Date
}

// --------------------------------------------------------------------------
// Spaced repetition — SM-2 derived scheduler with learning steps.
//
// New cards start in a short "learning" loop (minute-scale steps) so the user
// can lock in a struggling card in the same session. Once graduated they enter
// the "review" stage where OK/Easy grow the interval multiplicatively via the
// ease factor (true spacing across days), while Impossible/Hard shorten it and
// erode the ease. The state is intentionally serialisable (all primitives) so
// it can be persisted per-user/per-card in the database or in localStorage.
//
// Isolated + pure so it can be unit-tested and later swapped for FSRS without
// touching the callers.
// --------------------------------------------------------------------------

const DAY = 24 * 60
const DEFAULT_EASE = 2.5
const MIN_EASE = 1.3
const MAX_EASE = 3.0
const MAX_INTERVAL = 365 * DAY

// First-touch, minute-scale steps (match the UI rating cues).
const LEARNING_STEP: Record<Exclude<SrsRating, 'easy'>, number> = {
  impossible: 1,
  hard: 6,
  ok: 10,
}
const GRADUATION_MINUTES = DAY // first "review" interval when graduating with OK
const EASY_GRADUATION_MINUTES = 4 * DAY // graduating straight with Easy

export function calculateNextReview({ currentState, rating, answerStatus, now = new Date() }: SrsReviewInput): SrsState {
  const prevEase = currentState?.easeFactor ?? DEFAULT_EASE
  const prevInterval = currentState?.intervalMinutes ?? 0
  const prevStage: SrsStage = currentState?.stage ?? (prevInterval >= DAY ? 'review' : 'learning')
  const poorAnswer = answerStatus === 'incorrect' || answerStatus === 'unknown'

  let ease = prevEase
  let interval = prevInterval
  let stage: SrsStage = prevStage
  let lapsed = false

  switch (rating) {
    case 'impossible': {
      ease = clamp(prevEase - 0.3, MIN_EASE, MAX_EASE)
      interval = LEARNING_STEP.impossible
      lapsed = prevStage === 'review' // only a real lapse if it had graduated
      stage = 'learning'
      break
    }
    case 'hard': {
      ease = clamp(prevEase - 0.15, MIN_EASE, MAX_EASE)
      if (prevStage === 'review') {
        interval = Math.max(LEARNING_STEP.hard, Math.round(prevInterval * 1.2))
        stage = 'review'
      } else {
        interval = LEARNING_STEP.hard
        stage = 'learning'
      }
      break
    }
    case 'ok': {
      if (prevStage === 'review') {
        interval = Math.round(prevInterval * ease)
        stage = 'review'
      } else if (prevInterval >= LEARNING_STEP.ok) {
        interval = GRADUATION_MINUTES // graduate: learning step cleared
        stage = 'review'
      } else {
        interval = LEARNING_STEP.ok
        stage = 'learning'
      }
      break
    }
    case 'easy': {
      ease = clamp(prevEase + 0.15, MIN_EASE, MAX_EASE)
      interval = prevStage === 'review' ? Math.round(prevInterval * ease * 1.3) : EASY_GRADUATION_MINUTES
      stage = 'review'
      break
    }
  }

  // Didactic safety net: if the user actually answered wrong / "I don't know"
  // but self-rated OK/Easy, don't fling the card days away — keep it in reach.
  if (poorAnswer && (rating === 'ok' || rating === 'easy')) {
    interval = Math.min(interval, LEARNING_STEP.ok)
    stage = 'learning'
  }

  interval = clamp(Math.round(interval), 1, MAX_INTERVAL)
  const dueAt = new Date(now.getTime() + interval * 60_000)

  return {
    dueAt: dueAt.toISOString(),
    lastReviewedAt: now.toISOString(),
    reviewCount: (currentState?.reviewCount ?? 0) + 1,
    lapseCount: (currentState?.lapseCount ?? 0) + (lapsed || rating === 'impossible' ? 1 : 0),
    easeFactor: Math.round(ease * 100) / 100,
    intervalMinutes: interval,
    lastRating: rating,
    stage,
  }
}

export function isDue(state: SrsState | null | undefined, now: Date = new Date()): boolean {
  if (!state) return true
  return new Date(state.dueAt).getTime() <= now.getTime()
}

/** Human label for the current interval, used by the study UI. */
export function formatInterval(minutes: number, lang: 'it' | 'en' = 'it'): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`
  if (minutes < DAY) {
    const hours = Math.round(minutes / 60)
    return lang === 'en' ? `${hours} h` : `${hours} ore`
  }
  const days = Math.round(minutes / DAY)
  if (days < 30) return lang === 'en' ? `${days} day${days === 1 ? '' : 's'}` : `${days} giorn${days === 1 ? 'o' : 'i'}`
  const months = Math.round(days / 30)
  return lang === 'en' ? `${months} mo` : `${months} mesi`
}

// --------------------------------------------------------------------------
// Deterministic answer evaluation (free tier — no LLM).
// Handles casing/accents, exact + containment + token-overlap fuzzy matching,
// and accepted-answer/synonym lists.
// --------------------------------------------------------------------------

export function normalizeStudyAnswer(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function evaluateTextAnswer(userAnswer: string, correctAnswer: string, acceptedAnswers: string[] = []): AnswerStatus {
  const user = normalizeStudyAnswer(userAnswer)
  const accepted = [correctAnswer, ...acceptedAnswers]
    .map(normalizeStudyAnswer)
    .filter((answer) => answer.length > 0)

  if (!user) return 'unanswered'
  if (accepted.some((answer) => user === answer)) return 'correct'
  if (accepted.some((answer) => answer.includes(user) && user.length >= Math.min(8, answer.length))) return 'partial'

  const best = accepted.reduce((max, answer) => Math.max(max, tokenOverlap(user, answer)), 0)
  if (best >= 0.76) return 'correct'
  if (best >= 0.48) return 'partial'
  return 'incorrect'
}

function tokenOverlap(a: string, b: string): number {
  const aTerms = new Set(a.split(' ').filter((term) => term.length > 2))
  const bTerms = new Set(b.split(' ').filter((term) => term.length > 2))
  if (aTerms.size === 0 || bTerms.size === 0) return 0

  let shared = 0
  aTerms.forEach((term) => {
    if (bTerms.has(term)) shared += 1
  })

  return shared / Math.max(aTerms.size, bTerms.size)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
