// Common validated patterns and limits shared across Edge Functions and (where importable) the worker.

/** UUID v4-ish validation (accepts common variants). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** SHA-256 hex (64 chars). */
export const HASH_RE = /^[a-f0-9]{64}$/i

/** Safe degree slug for catalog. */
export const DEGREE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Default historic degree for pre-registry documents. */
export const DEFAULT_DEGREE_SLUG = 'scienze-biologiche'

/** Maximum number of draft uploads per user per hour (anti-abuse before worker validates bytes). */
export const MAX_UPLOADS_PER_HOUR = 20

/** Default pipeline stages executed by the PDF worker after upload finalize. */
export const INITIAL_PIPELINE_STAGES = ['compress', 'extract', 'ocr', 'layout', 'figures', 'outline', 'quality_review'] as const

/** Post-processing stages triggered after primary PDF work. */
export const POST_PROCESSING_STAGES = ['rag_index'] as const

/** Safe filename sanitization helper. */
export const safeName = (value: unknown, fallback = 'documento.pdf') =>
  String(value ?? fallback)
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120)

/** Tag sanitizer. */
export function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((tag) => String(tag ?? '').trim().slice(0, 40)).filter(Boolean).slice(0, 12)
}
