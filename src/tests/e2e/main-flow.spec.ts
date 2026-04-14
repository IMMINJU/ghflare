import { test, expect } from '@playwright/test'

test.describe('main flow', () => {
  test('main feed loads with header and input', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'ghflare' })).toBeVisible()
    await expect(page.getByTestId('repo-input')).toBeVisible()
  })

  test('main feed shows repo cards when data is present', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('repo-card').first()).toBeVisible()
  })

  test('clicking repo card navigates to detail page', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('repo-card').first().click()
    await expect(page).toHaveURL(/\/repo\/.+\/.+/)
  })

  test('repo input navigates to detail page', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('repo-input').fill('vercel/next.js')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL('/repo/vercel/next.js')
  })
})
