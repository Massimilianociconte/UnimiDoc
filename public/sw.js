// Service worker prudente:
// - precache minimo (offline page + icone);
// - cache-first SOLO per asset statici fingerprinted (/assets, /pdfjs,
//   /tesseract, icone) che sono immutabili per URL;
// - navigazioni: network-first con fallback a offline.html;
// - MAI cache per API Supabase, documenti acquistati o dati riservati.
const VERSION = 'v1'
const STATIC_CACHE = `unimidoc-static-${VERSION}`
const PRECACHE = ['/offline.html', '/manifest.webmanifest', '/unimidoc-logo.webp', '/apple-touch-icon.png']

const STATIC_PREFIXES = ['/assets/', '/pdfjs/', '/tesseract/', '/course-icons/', '/degree-icons/']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Solo stessa origine: le chiamate a Supabase non passano mai dalla cache.
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html')),
    )
    return
  }

  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(STATIC_CACHE).then((cache) => void cache.put(request, copy))
          }
          return response
        })
      }),
    )
  }
})
