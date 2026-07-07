// POST /functions/v1/srs-review
// Records a review outcome and recomputes the next due date authoritatively on
// the server. Available to all authenticated users (SRS is a free feature).
// Persists per-user, per-card SRS state + an answer-telemetry row.

import { preflight, jsonResponse, errorResponse, errors } from '../_shared/http.ts'
import { requireUser } from '../_shared/supabase.ts'
import { calculateNextReview, type SrsRating, type AnswerStatus, type SrsState } from '../_shared/srs.ts'

const RATINGS: SrsRating[] = ['impossible', 'hard', 'ok', 'easy']
const STATUSES: AnswerStatus[] = ['correct', 'incorrect', 'partial', 'unknown', 'skipped']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Clamp an optional numeric telemetry field to a sane non-negative range. */
function clampInt(value: unknown, max: number, fallback: number | null): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(max, Math.round(n)))
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre

  try {
    const { id: userId, supabase } = await requireUser(req)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const flashcardId = String(body.flashcardId ?? '')
    const rating = body.rating as SrsRating
    const answerStatus = (body.answerStatus ?? 'skipped') as AnswerStatus
    if (!UUID_RE.test(flashcardId)) throw errors.badRequest('flashcardId non valido.')
    if (!RATINGS.includes(rating)) throw errors.badRequest('rating non valido.')
    if (!STATUSES.includes(answerStatus)) throw errors.badRequest('answerStatus non valido.')

    // Load current SRS state (RLS restricts to this user).
    const { data: existing } = await supabase
      .from('srs_state')
      .select('due_at, last_reviewed_at, review_count, lapse_count, ease_factor, interval_minutes, last_rating, stage')
      .eq('owner_id', userId)
      .eq('flashcard_id', flashcardId)
      .maybeSingle()

    const currentState: SrsState | null = existing
      ? {
          dueAt: existing.due_at,
          lastReviewedAt: existing.last_reviewed_at,
          reviewCount: existing.review_count,
          lapseCount: existing.lapse_count,
          easeFactor: existing.ease_factor,
          intervalMinutes: existing.interval_minutes,
          lastRating: existing.last_rating,
          stage: existing.stage,
        }
      : null

    const next = calculateNextReview({ currentState, rating, answerStatus })

    const { error: upsertError } = await supabase.from('srs_state').upsert(
      {
        owner_id: userId,
        flashcard_id: flashcardId,
        due_at: next.dueAt,
        last_reviewed_at: next.lastReviewedAt,
        review_count: next.reviewCount,
        lapse_count: next.lapseCount,
        ease_factor: next.easeFactor,
        interval_minutes: next.intervalMinutes,
        last_rating: next.lastRating,
        stage: next.stage,
      },
      { onConflict: 'owner_id,flashcard_id' },
    )
    if (upsertError) {
      console.error('srs_state upsert failed:', upsertError.message)
      throw errors.badRequest('Impossibile salvare la revisione. Riprova.')
    }

    // Answer telemetry (best-effort — non-fatal).
    if (body.recordAnswer !== false) {
      await supabase.from('user_answers').insert({
        owner_id: userId,
        quiz_session_id: body.quizSessionId ?? null,
        flashcard_id: flashcardId,
        question_type: String(body.questionType ?? 'qa'),
        user_answer: body.userAnswer ? String(body.userAnswer).slice(0, 2000) : null,
        correct_answer: body.correctAnswer ? String(body.correctAnswer).slice(0, 2000) : null,
        answer_status: answerStatus,
        time_spent_ms: clampInt(body.timeSpentMs, 3_600_000, null),
        attempt_number: clampInt(body.attemptNumber, 1000, 1) ?? 1,
      })
    }

    // Dashboard mastery rollup (best-effort). Newer clients can record the
    // answer immediately and let this endpoint update only SRS scheduling.
    if (body.recordProgress !== false) {
      const { error: progressError } = await supabase.rpc('record_flashcard_study_event', {
        p_flashcard_id: flashcardId,
        p_answer_status: answerStatus,
        p_next_due_at: next.dueAt,
        p_last_reviewed_at: next.lastReviewedAt,
      })
      if (progressError) console.error('flashcard progress rollup failed:', progressError.message)
    }

    return jsonResponse({ srs: next }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
