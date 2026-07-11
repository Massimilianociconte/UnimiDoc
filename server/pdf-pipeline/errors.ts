export class ProcessingError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly publicMessage: string
  readonly details: Record<string, unknown>

  constructor(input: {
    code: string
    message: string
    publicMessage: string
    retryable: boolean
    details?: Record<string, unknown>
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'ProcessingError'
    this.code = input.code
    this.retryable = input.retryable
    this.publicMessage = input.publicMessage
    this.details = input.details ?? {}
  }
}

const PERMANENT_CODES = new Set([
  'INVALID_PDF_MAGIC_BYTES',
  'PDF_TOO_LARGE',
  'PDF_PASSWORD_REQUIRED',
  'PDF_CORRUPT',
  'PDF_PAGE_LIMIT_EXCEEDED',
  'UPLOAD_HASH_MISMATCH',
  'UPLOAD_SIZE_MISMATCH',
  'INVALID_STORAGE_PATH',
])

export function normalizeProcessingError(error: unknown): ProcessingError {
  if (error instanceof ProcessingError) return error
  const source = error instanceof Error ? error : new Error(String(error))
  const rawCode = String((source as Error & { code?: string | number }).code ?? source.message ?? 'PROCESSING_FAILED')
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').slice(0, 120) || 'PROCESSING_FAILED'
  const permanent = PERMANENT_CODES.has(code)
    || /PASSWORD|ENCRYPTED|DAMAGED|CORRUPT|INVALID_PDF|PAGE_LIMIT|HASH_MISMATCH|SIZE_MISMATCH/i.test(source.message)
  return new ProcessingError({
    code: permanent ? code : 'PROCESSING_TRANSIENT_FAILURE',
    message: source.message,
    publicMessage: permanent
      ? 'Il PDF non può essere elaborato: verifica integrità, protezione e formato del file.'
      : 'Elaborazione temporaneamente interrotta: il sistema riproverà automaticamente.',
    retryable: !permanent,
    details: {
      name: source.name,
      nativeCode: (source as Error & { code?: string | number }).code ?? null,
    },
    cause: error,
  })
}

export function lostLeaseError(): ProcessingError {
  return new ProcessingError({
    code: 'LOST_LEASE',
    message: 'The processing lease is no longer owned by this worker.',
    publicMessage: 'Elaborazione ripresa da un altro worker.',
    retryable: false,
  })
}
