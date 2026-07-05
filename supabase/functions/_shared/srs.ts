// Server-side spaced-repetition scheduler. Kept in sync with
// src/lib/studyEngine.ts (same algorithm) so scheduling can be recomputed and
// persisted authoritatively on the backend, independent of the client.

export type SrsRating = 'impossible' | 'hard' | 'ok' | 'easy'
export type AnswerStatus = 'correct' | 'incorrect' | 'partial' | 'unknown' | 'skipped'
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

const DAY = 24 * 60
const DEFAULT_EASE = 2.5
const MIN_EASE = 1.3
const MAX_EASE = 3.0
const MAX_INTERVAL = 365 * DAY
const LEARNING_STEP = { impossible: 1, hard: 6, ok: 10 } as const
const GRADUATION_MINUTES = DAY
const EASY_GRADUATION_MINUTES = 4 * DAY

export function calculateNextReview(input: {
  currentState?: SrsState | null
  rating: SrsRating
  answerStatus: AnswerStatus
  now?: Date
}): SrsState {
  const { currentState, rating, answerStatus, now = new Date() } = input
  const prevEase = currentState?.easeFactor ?? DEFAULT_EASE
  const prevInterval = currentState?.intervalMinutes ?? 0
  const prevStage: SrsStage = currentState?.stage ?? (prevInterval >= DAY ? 'review' : 'learning')
  const poorAnswer = answerStatus === 'incorrect' || answerStatus === 'unknown'

  let ease = prevEase
  let interval = prevInterval
  let stage: SrsStage = prevStage
  let lapsed = false

  switch (rating) {
    case 'impossible':
      ease = clamp(prevEase - 0.3, MIN_EASE, MAX_EASE)
      interval = LEARNING_STEP.impossible
      lapsed = prevStage === 'review'
      stage = 'learning'
      break
    case 'hard':
      ease = clamp(prevEase - 0.15, MIN_EASE, MAX_EASE)
      interval = prevStage === 'review' ? Math.max(LEARNING_STEP.hard, Math.round(prevInterval * 1.2)) : LEARNING_STEP.hard
      stage = prevStage === 'review' ? 'review' : 'learning'
      break
    case 'ok':
      if (prevStage === 'review') {
        interval = Math.round(prevInterval * ease)
        stage = 'review'
      } else if (prevInterval >= LEARNING_STEP.ok) {
        interval = GRADUATION_MINUTES
        stage = 'review'
      } else {
        interval = LEARNING_STEP.ok
        stage = 'learning'
      }
      break
    case 'easy':
      ease = clamp(prevEase + 0.15, MIN_EASE, MAX_EASE)
      interval = prevStage === 'review' ? Math.round(prevInterval * ease * 1.3) : EASY_GRADUATION_MINUTES
      stage = 'review'
      break
  }

  if (poorAnswer && (rating === 'ok' || rating === 'easy')) {
    interval = Math.min(interval, LEARNING_STEP.ok)
    stage = 'learning'
  }

  interval = clamp(Math.round(interval), 1, MAX_INTERVAL)
  return {
    dueAt: new Date(now.getTime() + interval * 60_000).toISOString(),
    lastReviewedAt: now.toISOString(),
    reviewCount: (currentState?.reviewCount ?? 0) + 1,
    lapseCount: (currentState?.lapseCount ?? 0) + (lapsed || rating === 'impossible' ? 1 : 0),
    easeFactor: Math.round(ease * 100) / 100,
    intervalMinutes: interval,
    lastRating: rating,
    stage,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
