import { expect, test } from '@playwright/test'

// Login demo + form di upload: corso di laurea, materia dal catalogo L-13 e
// checklist dei campi obbligatori.

async function loginDemo(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('studente.demo@unimidoc.it')
  await page.locator('input[type="password"]').fill('demo-password-1')
  await page.getByRole('button', { name: 'Entra con account demo' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('il login demo porta alla dashboard', async ({ page }) => {
  await loginDemo(page)
})

test('il form di upload espone corso di laurea e materie del catalogo', async ({ page }) => {
  await loginDemo(page)
  await page.goto('/upload')

  // Selettore corso di laurea con tutte le aree della Statale.
  const degreeSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Scienze biologiche' }) }).first()
  await expect(degreeSelect).toBeVisible()

  // Default L-13: la materia è una select dal catalogo curato.
  await expect(page.getByText('Materia', { exact: false }).first()).toBeVisible()
  const subjectOptions = await page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: 'Citologia e istologia' }) })
    .first()
    .locator('option')
    .count()
  expect(subjectOptions).toBeGreaterThan(10)

  // Cambio corso: senza backend il catalogo DB è vuoto ⇒ materia a testo libero.
  await degreeSelect.selectOption({ label: 'Fisica (L-30)' })
  await expect(page.locator('input[placeholder*="Anatomia umana"]')).toBeVisible()
})
