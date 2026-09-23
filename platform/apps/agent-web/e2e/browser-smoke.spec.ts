import { test, expect } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem('sage.web.locale', 'zh-CN') } catch {}
  })
})

test('five views route correctly and show nav active state', async ({ page }) => {
  for (const [url, navText] of [
    ['/', '会话'],
    ['/?view=tasks', 'Task 工作区'],
    ['/?view=packages', '应用'],
    ['/?view=schedules', '计划任务'],
    ['/?view=settings', '设置'],
  ] as const) {
    await page.goto(url)
    await expect(page.locator('.rail-link.is-active').first()).toHaveText(navText)
  }
})

test('selected states show aria-current', async ({ page }) => {
  await page.goto('/?view=packages&package=github-trending')
  await page.waitForTimeout(1500)
  await expect(page.locator('[aria-current]').first()).toBeAttached()
})

test('no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 })
  for (const url of ['/', '/?view=tasks', '/?view=packages', '/?view=settings']) {
    await page.goto(url)
    await page.waitForTimeout(800)
    const [sw, cw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ])
    expect(sw).toBeLessThanOrEqual(cw)
  }
})

test('status and alert roles present where expected', async ({ page }) => {
  await page.goto('/?view=schedules')
  await page.waitForTimeout(1500)
  await expect(page.locator('[role=alert]').first()).toBeVisible()
})

test('console has no errors on main views', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  for (const url of ['/', '/?view=tasks', '/?view=packages', '/?view=settings']) {
    await page.goto(url)
    await page.waitForTimeout(1000)
  }
  expect(errors).toEqual([])
})

test('locale en switches html lang', async ({ page }) => {
  await page.goto('/?view=settings')
  await page.getByRole('button', { name: 'English' }).first().click()
  await page.waitForTimeout(500)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})
