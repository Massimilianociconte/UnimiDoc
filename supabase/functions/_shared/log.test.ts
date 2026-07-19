// Unit test del logger strutturato condiviso (correlation ID inclusi).
import { assertEquals, assertExists, assertMatch } from 'jsr:@std/assert@1'
import { createRequestLogger } from './log.ts'

Deno.test('createRequestLogger: riusa x-request-id quando presente', () => {
  const req = new Request('http://x/', { headers: { 'x-request-id': 'req-123' } })
  assertEquals(createRequestLogger(req).getRequestId(), 'req-123')
})

Deno.test('createRequestLogger: genera un UUID se manca l\'header', () => {
  const logger = createRequestLogger(new Request('http://x/'))
  assertMatch(logger.getRequestId(), /^[0-9a-f-]{36}$/)
})

Deno.test('log JSON: eventi info includono requestId e timestamp', () => {
  const captured: string[] = []
  const original = console.log
  console.log = (line: string) => void captured.push(line)
  try {
    const logger = createRequestLogger(new Request('http://x/', { headers: { 'x-request-id': 'req-777' } }))
    logger.info('unit_test_event', { foo: 'bar' })
  } finally {
    console.log = original
  }
  const parsed = JSON.parse(captured[0])
  assertEquals(parsed.event, 'unit_test_event')
  assertEquals(parsed.requestId, 'req-777')
  assertEquals(parsed.foo, 'bar')
  assertExists(parsed.ts)
})

Deno.test('logger.error non lancia con input non-Error', () => {
  const original = console.error
  console.error = () => undefined
  try {
    createRequestLogger(new Request('http://x/')).error('boom', 'stringa qualunque')
  } finally {
    console.error = original
  }
})
