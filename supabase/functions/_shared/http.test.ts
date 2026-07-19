// Unit test dei helper HTTP condivisi dalle Edge Functions.
// Eseguiti in CI con: deno test supabase/functions/_shared/
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { AppError, corsHeadersFor, errorResponse, errors, jsonResponse, parseJsonBody, preflight, requireObjectBody } from './http.ts'

Deno.test('parseJsonBody: JSON valido', async () => {
  const req = new Request('http://x/', { method: 'POST', body: JSON.stringify({ a: 1 }) })
  assertEquals(await parseJsonBody(req), { a: 1 })
})

Deno.test('parseJsonBody: body vuoto o malformato → null (mai throw)', async () => {
  assertEquals(await parseJsonBody(new Request('http://x/', { method: 'POST' })), null)
  assertEquals(await parseJsonBody(new Request('http://x/', { method: 'POST', body: '{nope' })), null)
})

Deno.test('requireObjectBody: rifiuta non-oggetti con bad_request', () => {
  let thrown: unknown
  try {
    requireObjectBody(null)
  } catch (error) {
    thrown = error
  }
  assertEquals((thrown as AppError).code, 'bad_request')
  assertEquals((thrown as AppError).status, 400)
})

Deno.test('errorResponse: AppError → status e codice originali', async () => {
  const res = errorResponse(errors.paywall())
  assertEquals(res.status, 402)
  const body = await res.json()
  assertEquals(body.error.code, 'premium_required')
})

Deno.test('errorResponse: errore sconosciuto → 500 senza dettagli interni', async () => {
  const res = errorResponse(new Error('segreto: connection string xyz'))
  assertEquals(res.status, 500)
  const body = await res.json()
  assertEquals(body.error.code, 'internal_error')
  assertEquals(JSON.stringify(body).includes('segreto'), false)
})

Deno.test('CORS: origin non in allowlist non viene riflesso', () => {
  const evil = new Request('http://x/', { headers: { Origin: 'https://evil.example' } })
  const headers = corsHeadersFor(evil)
  assertEquals(headers['Access-Control-Allow-Origin'] === 'https://evil.example', false)
})

Deno.test('CORS: origin in allowlist riflesso nel preflight', () => {
  const req = new Request('http://x/', { method: 'OPTIONS', headers: { Origin: 'https://unimidoc.netlify.app' } })
  const res = preflight(req)
  assertEquals(res?.status, 200)
  assertEquals(res?.headers.get('Access-Control-Allow-Origin'), 'https://unimidoc.netlify.app')
})

Deno.test('jsonResponse: content-type JSON', () => {
  const res = jsonResponse({ ok: true }, 201)
  assertEquals(res.status, 201)
  assertStringIncludes(res.headers.get('Content-Type') ?? '', 'application/json')
})
