import { describe, it, expect } from 'vitest'
import { calculateNextReview, evaluateTextAnswer, isDue, formatInterval, type SrsState } from './studyEngine'

const at = (iso = '2026-01-01T00:00:00.000Z') => new Date(iso)
const DAY = 24 * 60

describe('SRS · calculateNextReview', () => {
  it('new card + OK stays in learning (10 min)', () => {
    const s = calculateNextReview({ currentState: null, rating: 'ok', answerStatus: 'correct', now: at() })
    expect(s.intervalMinutes).toBe(10)
    expect(s.stage).toBe('learning')
    expect(s.reviewCount).toBe(1)
  })

  it('graduates to 1 day once the learning step is cleared (second OK)', () => {
    const first = calculateNextReview({ currentState: null, rating: 'ok', answerStatus: 'correct', now: at() })
    const second = calculateNextReview({ currentState: first, rating: 'ok', answerStatus: 'correct', now: at() })
    expect(second.stage).toBe('review')
    expect(second.intervalMinutes).toBe(DAY)
  })

  it('review + OK grows the interval by the ease factor', () => {
    let s: SrsState = calculateNextReview({ currentState: null, rating: 'ok', answerStatus: 'correct', now: at() })
    s = calculateNextReview({ currentState: s, rating: 'ok', answerStatus: 'correct', now: at() }) // 1 day, review
    const grown = calculateNextReview({ currentState: s, rating: 'ok', answerStatus: 'correct', now: at() })
    expect(grown.intervalMinutes).toBe(Math.round(s.intervalMinutes * s.easeFactor))
    expect(grown.intervalMinutes).toBeGreaterThan(s.intervalMinutes)
  })

  it('Easy on a new card graduates straight to ~4 days', () => {
    const s = calculateNextReview({ currentState: null, rating: 'easy', answerStatus: 'correct', now: at() })
    expect(s.intervalMinutes).toBe(4 * DAY)
    expect(s.stage).toBe('review')
  })

  it('Impossible resets to 1 min and counts a lapse when already graduated', () => {
    const graduated = calculateNextReview({ currentState: null, rating: 'easy', answerStatus: 'correct', now: at() })
    const lapsed = calculateNextReview({ currentState: graduated, rating: 'impossible', answerStatus: 'incorrect', now: at() })
    expect(lapsed.intervalMinutes).toBe(1)
    expect(lapsed.stage).toBe('learning')
    expect(lapsed.lapseCount).toBe(1)
  })

  it('Hard erodes ease, Easy raises it, both clamped', () => {
    const hard = calculateNextReview({ currentState: null, rating: 'hard', answerStatus: 'partial', now: at() })
    expect(hard.easeFactor).toBeLessThan(2.5)
    const easy = calculateNextReview({ currentState: null, rating: 'easy', answerStatus: 'correct', now: at() })
    expect(easy.easeFactor).toBeGreaterThan(2.5)
    expect(easy.easeFactor).toBeLessThanOrEqual(3.0)
  })

  it('a wrong/"I don\'t know" answer rated Easy is pulled back to learning', () => {
    const graduated = calculateNextReview({ currentState: null, rating: 'easy', answerStatus: 'correct', now: at() })
    const pulled = calculateNextReview({ currentState: graduated, rating: 'easy', answerStatus: 'unknown', now: at() })
    expect(pulled.stage).toBe('learning')
    expect(pulled.intervalMinutes).toBeLessThanOrEqual(10)
  })

  it('dueAt reflects the computed interval', () => {
    const s = calculateNextReview({ currentState: null, rating: 'ok', answerStatus: 'correct', now: at('2026-01-01T00:00:00.000Z') })
    expect(new Date(s.dueAt).getTime()).toBe(at('2026-01-01T00:10:00.000Z').getTime())
  })
})

describe('SRS · isDue / formatInterval', () => {
  it('a null state is due immediately', () => expect(isDue(null)).toBe(true))
  it('a future dueAt is not due', () => {
    const future: SrsState = {
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      lastReviewedAt: null,
      reviewCount: 1,
      lapseCount: 0,
      easeFactor: 2.5,
      intervalMinutes: 60,
      lastRating: 'ok',
      stage: 'review',
    }
    expect(isDue(future)).toBe(false)
  })
  it('formats minutes and days', () => {
    expect(formatInterval(6)).toMatch(/min/)
    expect(formatInterval(DAY)).toMatch(/giorn/)
  })
})

describe('evaluateTextAnswer', () => {
  it('exact match is correct', () => expect(evaluateTextAnswer('The diaphragm', 'the diaphragm')).toBe('correct'))
  it('accent/case-insensitive', () => expect(evaluateTextAnswer('Fotosíntesi', 'fotosintesi')).toBe('correct'))
  it('token-overlap gives at least partial credit', () =>
    expect(
      evaluateTextAnswer(
        'vessels transporting blood from the heart',
        'the vessels which transport blood from the heart to the body',
      ),
    ).not.toBe('incorrect'))
  it('"non lo so" is incorrect', () => expect(evaluateTextAnswer('non lo so bro', 'the diaphragm')).toBe('incorrect'))
  it('empty input is unanswered', () => expect(evaluateTextAnswer('   ', 'x')).toBe('unanswered'))
  it('accepts a synonym list', () => expect(evaluateTextAnswer('cuore', 'heart', ['cuore'])).toBe('correct'))
})
