// POST /functions/v1/srs-review
// Records a review outcome and recomputes the next due date authoritatively on
// the server. Available to all authenticated users (SRS is a free feature).
// Persists per-user, per-card SRS state + an answer-telemetry row.

import { preflight, jsonResponse, errorResponse, errors, parseJsonBody, requireMethod, dbFailure} from '../_shared/http.ts'
import { requireUser } from '../_shared/supabase.ts'
import { calculateNextReview, type SrsRating, type AnswerStatus, type SrsState } from '../_shared/srs.ts'
import { createRequestLogger } from '../_shared/log.ts'

const RATINGS: SrsRating[] = ['impossible', 'hard', 'ok', 'easy']
const STATUSES: AnswerStatus[] = ['correct', 'incorrect', 'partial', 'unknown', 'skipped']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Clamp an optional numeric telemetry field to a sane non-negative range. */
function clampInt(value: unknown, max: number, fallback: number | null): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(max, Math.round(n)))
}

;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  const methodDenied = requireMethod(req, ['POST'])
  if (methodDenied) return methodDenied

  const logger = createRequestLogger(req)
  logger.info('srs_review_started')

  try {
    const { id: userId, supabase } = await requireUser(req)

    const body = await parseJsonBody(req)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const flashcardId = String(body.flashcardId ?? '')
    const rating = body.rating as SrsRating
    const answerStatus = (body.answerStatus ?? 'skipped') as AnswerStatus
    if (!UUID_RE.test(flashcardId)) throw errors.badRequest('flashcardId non valido.')
    if (!RATINGS.includes(rating)) throw errors.badRequest('rating non valido.')
    if (!STATUSES.includes(answerStatus)) throw errors.badRequest('answerStatus non valido.')

    // Load current SRS state (RLS restricts to this user).
    const { data: existing, error: existingError } = await supabase
      .from('srs_state')
      .select('due_at, last_reviewed_at, review_count, lapse_count, ease_factor, interval_minutes, last_rating, stage')
      .eq('owner_id', userId)
      .eq('flashcard_id', flashcardId)
      .maybeSingle()
    if (existingError) throw dbFailure('db_error', existingError, 'Stato SRS non disponibile')

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

    // SRS state, answer telemetry and dashboard progress commit in one DB
    // transaction. expected_review_count plus the DB advisory lock prevents two
    // concurrent ratings from silently overwriting one another.
    const { error: reviewError } = await supabase.rpc('record_srs_review_atomic', {
      p_flashcard_id: flashcardId,
      p_expected_review_count: currentState?.reviewCount ?? 0,
      p_answer_status: answerStatus,
      p_due_at: next.dueAt,
      p_last_reviewed_at: next.lastReviewedAt,
      p_review_count: next.reviewCount,
      p_lapse_count: next.lapseCount,
      p_ease_factor: next.easeFactor,
      p_interval_minutes: next.intervalMinutes,
      p_last_rating: next.lastRating,
      p_stage: next.stage,
      p_record_progress: body.recordProgress !== false,
      p_record_answer: body.recordAnswer !== false,
      p_quiz_session_id: body.quizSessionId ?? null,
      p_question_type: String(body.questionType ?? 'qa'),
      p_user_answer: body.userAnswer ? String(body.userAnswer).slice(0, 2000) : null,
      p_correct_answer: body.correctAnswer ? String(body.correctAnswer).slice(0, 2000) : null,
      p_time_spent_ms: clampInt(body.timeSpentMs, 3_600_000, null),
      p_attempt_number: clampInt(body.attemptNumber, 1000, 1) ?? 1,
    })
    if (reviewError) {
      if (reviewError.code === '40001') throw errors.badRequest('La flashcard è stata aggiornata su un altro dispositivo. Riprova.')
      throw dbFailure('db_error', reviewError, 'Impossibile salvare la revisione')
    }

    return jsonResponse({ srs: next }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
