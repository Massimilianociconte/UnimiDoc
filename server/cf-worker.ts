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

function stripHopByHopHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers)
  for (const header of HOP_BY_HOP_HEADERS) {
    cleaned.delete(header)
  }
  return cleaned
}

interface Env {
  ASSETS: {
    fetch: (request: Request | string) => Promise<Response>
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Proxy /api/functions/* to Supabase Edge Functions
    if (url.pathname.startsWith('/api/functions/')) {
      const functionPath = url.pathname.replace(/^\/api\/functions\//, '')
      const targetUrl = new URL(`${SUPABASE_FUNCTIONS_ORIGIN}/${functionPath}`)
      targetUrl.search = url.search

      const method = request.method.toUpperCase()
      const response = await fetch(targetUrl.toString(), {
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

    // Fallback to serving static SPA assets
    return env.ASSETS.fetch(request)
  },
}
