import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://127.0.0.1:9612'
const OUT = resolve('evidence/screenshots')
const VIEWPORTS = [375, 860, 1280] as const

const CASES = [
  { name: 'chat', url: '/', locale: 'zh-CN' as const },
  { name: 'tasks', url: '/?view=tasks', locale: 'zh-CN' as const },
  { name: 'packages', url: '/?view=packages', locale: 'zh-CN' as const },
  { name: 'schedules', url: '/?view=schedules', locale: 'zh-CN' as const },
  { name: 'settings', url: '/?view=settings', locale: 'zh-CN' as const },
  { name: 'chat-selected', url: '/?session=ses-trending-report', locale: 'zh-CN' as const },
  { name: 'tasks-selected', url: '/?view=tasks&task=task-watch-1', locale: 'zh-CN' as const },
  { name: 'packages-selected', url: '/?view=packages&package=github-trending', locale: 'zh-CN' as const },
  { name: 'schedules-selected', url: '/?view=schedules&schedule=sched-nightly-report', locale: 'zh-CN' as const },
  { name: 'settings-selected', url: '/?view=settings&tab=connections&connection=conn-anthropic', locale: 'zh-CN' as const },
  { name: 'settings-model', url: '/?view=settings&tab=connections&panel=model', locale: 'zh-CN' as const },
  { name: 'tasks-error', url: '/?view=tasks&task=missing-task', locale: 'zh-CN' as const },
  { name: 'packages-error', url: '/?view=packages&package=missing-app', locale: 'zh-CN' as const },
  { name: 'schedules-error', url: '/?view=schedules', locale: 'zh-CN' as const },
  { name: 'chat-en', url: '/', locale: 'en' as const },
  { name: 'tasks-en', url: '/?view=tasks', locale: 'en' as const },
  { name: 'packages-en', url: '/?view=packages', locale: 'en' as const },
  { name: 'schedules-en', url: '/?view=schedules', locale: 'en' as const },
  { name: 'settings-en', url: '/?view=settings', locale: 'en' as const },
]

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const manifest: Array<Record<string, unknown>> = []

  for (const width of VIEWPORTS) {
    const dir = resolve(OUT, String(width))
    await mkdir(dir, { recursive: true })
    for (const c of CASES) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        locale: c.locale,
        colorScheme: 'light',
      })
      const page = await ctx.newPage()
      const errors: string[] = []
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
      await page.goto(`${BASE}${c.url}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      const file = resolve(dir, `${c.name}.png`)
      await page.screenshot({ path: file })
      const dom = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        ariaCurrent: [...document.querySelectorAll('[aria-current]')].map((e) => ({
          cls: e.className, aria: e.getAttribute('aria-current'), text: e.textContent?.trim().slice(0, 60),
        })),
        status: [...document.querySelectorAll('[role=status]')].map((e) => e.textContent?.trim().slice(0, 80)),
        alerts: [...document.querySelectorAll('[role=alert]')].map((e) => e.textContent?.trim().slice(0, 120)),
        empty: [...document.querySelectorAll('.empty-state')].map((e) => e.textContent?.trim().slice(0, 80)),
        loading: document.querySelectorAll('.loading-block,.spinner-wrap').length > 0,
      }))
      manifest.push({
        name: c.name, viewport: width, locale: c.locale, url: c.url,
        screenshot: `evidence/screenshots/${width}/${c.name}.png`,
        consoleErrors: errors, ...dom,
      })
      await ctx.close()
    }
  }

  await writeFile(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await browser.close()
  console.log(`saved ${manifest.length} screenshots to ${OUT}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
