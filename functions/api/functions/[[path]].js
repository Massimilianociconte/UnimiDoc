const SUPABASE_FUNCTIONS_ORIGIN = 'https://pmpzfkikwfylesehfezv.supabase.co/functions/v1'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function stripHopByHopHeaders(headers) {
  const cleaned = new Headers(headers)
  for (const header of HOP_BY_HOP_HEADERS) cleaned.delete(header)
  return cleaned
}

function routePath(params) {
  const value = params.path
  if (Array.isArray(value)) return value.join('/')
  if (typeof value === 'string') return value
  return ''
}

export async function onRequest({ request, params }) {
  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${SUPABASE_FUNCTIONS_ORIGIN}/${routePath(params)}`)
  targetUrl.search = incomingUrl.search

  const method = request.method.toUpperCase()
  const response = await fetch(targetUrl, {
    method,
    headers: stripHopByHopHeaders(request.headers),
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: stripHopByHopHeaders(response.headers),
  })
}
