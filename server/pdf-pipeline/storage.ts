import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ProcessingError } from './errors.js'
import type { ClaimedPdfJob } from './types.js'

const HASH_RE = /^[0-9a-f]{64}$/

export function expectedIncomingPrefix(job: ClaimedPdfJob): string {
  return `${job.ownerId}/incoming/${job.documentId}/`
}

export function validateInputStorageReference(job: ClaimedPdfJob): void {
  if (job.jobType === 'compress') {
    const incoming = job.storageBucket === 'processing-temp' && job.storagePath.startsWith(expectedIncomingPrefix(job))
    const canonicalPrefix = `${job.ownerId}/documents/${job.documentId}/source/`
    const verifiedCanonical = job.storageBucket === 'private-documents'
      && job.storagePath.startsWith(canonicalPrefix)
      && job.metadata.upload_state === 'verified_submitted'
    if (!incoming && !verifiedCanonical) {
      throw new ProcessingError({
        code: 'INVALID_STORAGE_PATH',
        message: `Unexpected incoming path ${job.storageBucket}/${job.storagePath}`,
        publicMessage: 'Riferimento del file caricato non valido.',
        retryable: false,
      })
    }
  } else {
    const expected = `${job.ownerId}/documents/${job.documentId}/source/`
    if (job.storageBucket !== 'private-documents' || !job.storagePath.startsWith(expected)) {
      throw new ProcessingError({
        code: 'INVALID_STORAGE_PATH',
        message: `Unexpected canonical path ${job.storageBucket}/${job.storagePath}`,
        publicMessage: 'Riferimento del documento elaborato non valido.',
        retryable: false,
      })
    }
  }
  if (job.storagePath.includes('..') || job.storagePath.startsWith('/')) {
    throw new ProcessingError({
      code: 'INVALID_STORAGE_PATH',
      message: 'Storage path traversal detected.',
      publicMessage: 'Riferimento Storage non valido.',
      retryable: false,
    })
  }
}

export function canonicalDocumentPath(job: ClaimedPdfJob, sha256: string): string {
  if (!HASH_RE.test(sha256)) throw new Error('INVALID_CANONICAL_HASH')
  return `${job.ownerId}/documents/${job.documentId}/source/${sha256}.pdf`
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export async function downloadStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
  destination: string,
): Promise<number> {
  await mkdir(path.dirname(destination), { recursive: true })
  const { data, error } = await supabase.storage.from(bucket).download(objectPath)
  if (error || !data) {
    throw new ProcessingError({
      code: 'STORAGE_DOWNLOAD_FAILED',
      message: error?.message ?? 'Storage download returned no data.',
      publicMessage: 'Il file non è temporaneamente disponibile per l’elaborazione.',
      retryable: true,
      details: { bucket },
    })
  }
  const readable = Readable.fromWeb(data.stream() as never)
  const { createWriteStream } = await import('node:fs')
  await pipeline(readable, createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
  return (await stat(destination)).size
}

export async function uploadStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const bytes = await readFile(filePath)
  const { error } = await supabase.storage.from(bucket).upload(objectPath, bytes, {
    contentType,
    cacheControl: '31536000',
    upsert: false,
  })
  if (!error) return
  if (/already exists|duplicate/i.test(error.message)) return
  throw new ProcessingError({
    code: 'STORAGE_UPLOAD_FAILED',
    message: error.message,
    publicMessage: 'Salvataggio del documento temporaneamente non riuscito.',
    retryable: true,
    details: { bucket },
  })
}

export async function removeStorageObjectBestEffort(
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([objectPath])
  if (error) {
    console.warn(JSON.stringify({ event: 'storage_cleanup_failed', bucket, objectPath, message: error.message }))
  }
}
