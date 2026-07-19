import { describe, expect, it } from 'vitest'
import { isLegalRoute, nextPathAfterAuth, routeFromPathname, routePaths, routeSeo, type Route } from './routing'

describe('routing', () => {
  it('ogni percorso dichiarato torna alla sua route (URL invariati)', () => {
    // Le route di dettaglio vivono sotto un prefisso condiviso e si risolvono
    // solo con lo slug (senza slug il prefisso è la pagina elenco).
    const detailRoutes: Partial<Record<Route, string>> = {
      degree: '/corsi/biologia',
      document: '/appunti/esempio-dispensa',
      profile: '/autore/esempio-autore',
    }
    for (const [route, path] of Object.entries(routePaths) as Array<[Route, string]>) {
      const detailPath = detailRoutes[route]
      expect(routeFromPathname(detailPath ?? path)).toBe(route)
    }
  })

  it('ogni route ha SEO title e description', () => {
    for (const [route, seo] of Object.entries(routeSeo)) {
      expect(seo.title.length, route).toBeGreaterThan(5)
      expect(seo.description.length, route).toBeGreaterThan(20)
    }
  })

  it('le route legali sono riconosciute, le altre no', () => {
    for (const legal of ['privacy', 'terms', 'cookies', 'sales', 'refunds', 'authors', 'content', 'ai', 'copyright'] as const) {
      expect(isLegalRoute(legal)).toBe(true)
    }
    expect(isLegalRoute('dashboard')).toBe(false)
    expect(isLegalRoute('landing')).toBe(false)
  })

  it('alias e percorsi sconosciuti', () => {
    expect(routeFromPathname('/libreria')).toBe('library')
    expect(routeFromPathname('/rimborsi')).toBe('refunds')
    expect(routeFromPathname('/pagina-inesistente')).toBe('landing')
  })

  it('nextPathAfterAuth preserva deep link e blocca open-redirect', () => {
    const setSearch = (search: string) => {
      // Vitest node env: stub minimal window for query parsing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = {
        location: { search },
      }
    }
    try {
      setSearch('?next=/appunti/genetica/foo')
      expect(nextPathAfterAuth()).toBe('/appunti/genetica/foo')

      setSearch('?next=//evil.example')
      expect(nextPathAfterAuth()).toBe(routePaths.dashboard)

      setSearch('?next=https://evil.example')
      expect(nextPathAfterAuth()).toBe(routePaths.dashboard)

      setSearch('?next=/login')
      expect(nextPathAfterAuth()).toBe(routePaths.dashboard)

      setSearch('')
      expect(nextPathAfterAuth()).toBe(routePaths.dashboard)
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    }
  })
})
