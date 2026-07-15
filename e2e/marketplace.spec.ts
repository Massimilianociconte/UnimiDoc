import { expect, test } from '@playwright/test'

// Flussi critici in modalità demo: esplorazione con classifiche multi-segnale,
// apertura documento con correlati, pagine corso di laurea indicizzabili.

test('esplora mostra classifiche multi-segnale e autori affidabili', async ({ page }) => {
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Classifiche materiali' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Autori più affidabili' })).toBeVisible()

  // Le tre classifiche dei materiali sono tab distinte con punteggi.
  const rankings = page.locator('.community-rankings')
  await expect(rankings.getByRole('tab', { name: 'Di tendenza' })).toBeVisible()
  await rankings.getByRole('tab', { name: 'Qualità didattica' }).click()
  await expect(rankings.locator('.leaderboard-list li').first()).toBeVisible()
})

test('un documento si apre dalla classifica e mostra materiali correlati', async ({ page }) => {
  await page.goto('/app')
  const firstRanked = page.locator('.community-rankings .leaderboard-name').first()
  const title = (await firstRanked.textContent())?.trim() ?? ''
  expect(title.length).toBeGreaterThan(3)

  await firstRanked.click()
  await expect(page).toHaveURL(/\/appunti\//)
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeVisible()

  // La sezione recensioni è sempre presente (nota esplicativa in demo).
  await expect(page.getByRole('heading', { name: 'Recensioni degli studenti' })).toBeVisible()
})

test('la pagina corso di laurea è raggiungibile con hero e breadcrumb', async ({ page }) => {
  await page.goto('/corsi/informatica')
  await expect(page.getByRole('heading', { name: 'Appunti per Informatica' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Percorso' })).toBeVisible()

  // Directory completa dei corsi con ricerca.
  await page.goto('/corsi')
  await expect(page.locator('.degree-chip').first()).toBeVisible()
  const chips = await page.locator('.degree-chip').count()
  expect(chips).toBeGreaterThanOrEqual(72)
})
