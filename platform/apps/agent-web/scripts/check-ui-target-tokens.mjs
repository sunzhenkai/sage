import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '../../..')
const targetMapPath = resolve(repoRoot, 'docs/design/ui/target-token-map.md')
const globalCssPath = resolve(appRoot, 'src/styles/global.css')
const sourceRoots = ['src/styles/global.css', 'src/components', 'src/views']
const forbiddenLegacyTokens = ['--sage', '--clay', '--amber', '--steel', '--faint-text', '--dur-fast', '--dur-slow']
const forbiddenGardenValues = ['#f7f5ef', '#fffefb', '#efede4', '#1e251e', '#5d665a', '#8b927f', '#676e5f', '#e3e0d2', '#cbc7b4', '#3e6b4a', '#2a4a33', '#e7efe4', '#f2f6ef', '#a3492b', '#f5e7df', '#7a5d16', '#f4edd8', '#3d5a73', '#e4ebf1', '#c4d6c2', '#ddd0a4', '#e0bcab', '#6d3a24', '#d8b3a4', '#242b24', '#e8ede4']
const allowedAnimations = ['view-in', 'notice-in', 'spin']

function push(failures, message) { failures.push(message) }

function parseTargetTokens(markdown, failures) {
  const tokens = new Map()
  for (const match of markdown.matchAll(/^\| `(--target-[a-z0-9-]+)` \| `([^`]+)`/gm)) {
    const [, name, value] = match
    if (tokens.has(name)) push(failures, `duplicate target token in map: ${name}`)
    tokens.set(name, value)
  }
  return tokens
}

function parseRootTokens(css, failures) {
  const start = css.indexOf(':root')
  const end = css.indexOf('\n}\n', start)
  const block = start >= 0 && end > start ? css.slice(start, end) : ''
  const tokens = new Map()
  for (const match of block.matchAll(/^\s*(--[a-z0-9-]+):\s*(.+);/gm)) {
    const [, name, value] = match
    if (tokens.has(name)) push(failures, `duplicate root token in css: ${name}`)
    tokens.set(name, value.trim())
  }
  return tokens
}

async function collectCssFiles() {
  const files = [globalCssPath]
  for (const relativePath of sourceRoots.slice(1)) {
    const directory = resolve(appRoot, relativePath)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.css')) files.push(resolve(directory, entry.name))
    }
  }
  return files.sort()
}

async function check() {
  const failures = []
  const targetMarkdown = await readFile(targetMapPath, 'utf8')
  const globalCss = await readFile(globalCssPath, 'utf8')
  const targetTokens = parseTargetTokens(targetMarkdown, failures)
  const rootTokens = parseRootTokens(globalCss, failures)
  const cssFiles = await collectCssFiles()

  for (const [name, expected] of targetTokens) {
    const actual = rootTokens.get(name)
    if (actual !== expected) push(failures, `${name}: expected ${expected}, got ${actual ?? '<missing>'}`)
  }
  for (const name of rootTokens.keys()) {
    if (name.startsWith('--target-') && !targetTokens.has(name)) push(failures, `unknown target token in global.css: ${name}`)
  }

  const rootEnd = globalCss.indexOf('\n}\n', globalCss.indexOf(':root'))
  for (const file of cssFiles) {
    const text = await readFile(file, 'utf8')
    const body = file === globalCssPath ? text.slice(rootEnd) : text
    for (const legacy of forbiddenLegacyTokens) {
      if (new RegExp(`\\${legacy}\\b`).test(body)) push(failures, `${file}: legacy token remains ${legacy}`)
    }
    for (const value of forbiddenGardenValues) {
      if (body.toLowerCase().includes(value.toLowerCase())) push(failures, `${file}: garden value remains ${value}`)
    }
    for (const animation of [...body.matchAll(/animation:\s*([a-z0-9-]+)/g)].map((match) => match[1])) {
      if (!allowedAnimations.includes(animation)) push(failures, `${file}: unexpected animation token ${animation}`)
    }
    for (const keyframe of [...body.matchAll(/@keyframes\s+([a-z0-9-]+)/g)].map((match) => match[1])) {
      if (!allowedAnimations.includes(keyframe)) push(failures, `${file}: unexpected keyframe ${keyframe}`)
    }
    const allowedShadows = new Set(['none', 'var(--target-shadow-flat)', 'var(--target-shadow-pop)', 'inset 2px 0 0 var(--target-info)', '0 0 0 3px var(--target-info-wash)', '0 0 0 1px var(--target-line-strong)', '0 8px 24px rgb(0 0 0 / 8%)'])
    for (const shadow of [...body.matchAll(/box-shadow:\s*([^;]+);/g)].map((match) => match[1].trim())) {
      if (!allowedShadows.has(shadow)) push(failures, `${file}: unexpected shadow ${shadow}`)
    }
  }

  if (!globalCss.includes('@media (prefers-reduced-motion: reduce)')) push(failures, 'prefers-reduced-motion block is missing')
  if (!globalCss.includes('.pane-item.is-current')) push(failures, '.pane-item.is-current is missing')
  if (!globalCss.includes('.rail-link.is-active')) push(failures, '.rail-link.is-active is missing')

  if (failures.length > 0) {
    console.error('UI target token check failed:')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`UI target token check: OK (${targetTokens.size} target tokens, ${cssFiles.length} CSS files)`)
}

check().catch((error) => {
  console.error(`UI target token check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
