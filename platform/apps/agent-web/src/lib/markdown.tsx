import { Fragment, type ReactNode } from 'react'

// Markdown 安全子集渲染（规格 6.6）：段落软换行、#–######、fenced code、递归
// blockquote、rule、嵌套列表、GFM 表格、inline code、受控 scheme 链接、autolink /
// bare URL、bold / italic / bold-italic / strikethrough。Raw HTML 一律作为普通文本，
// 不注入 DOM（React 文本节点天然转义）。

export interface ThinkingSegment {
  thinking: boolean
  text: string
}

const THINK_TAG = /<\/?think\s*>/gi

export function splitThinking(text: string): ThinkingSegment[] {
  const segments: ThinkingSegment[] = []
  let thinking = false
  let cursor = 0
  THINK_TAG.lastIndex = 0
  for (let match = THINK_TAG.exec(text); match; match = THINK_TAG.exec(text)) {
    const before = text.slice(cursor, match.index)
    if (before) segments.push({ thinking, text: before })
    thinking = !thinking
    cursor = match.index + match[0].length
  }
  const rest = text.slice(cursor)
  if (rest) segments.push({ thinking, text: rest })
  return segments
}

const SAFE_LINK_SCHEME = /^(?:https?:|mailto:)/i

function linkProps(url: string): { href: string; external: boolean } | null {
  if (url.startsWith('/') || url.startsWith('#')) return { href: url, external: false }
  if (SAFE_LINK_SCHEME.test(url)) return { href: url, external: true }
  return null
}

function stripTrailingPunctuation(url: string): string {
  let result = url
  while (/[.,!?;:'"]$/.test(result)) result = result.slice(0, -1)
  // 去掉不配对的右括号 / 右方括号。
  while (result.endsWith(')') && (result.match(/\(/g)?.length ?? 0) < (result.match(/\)/g)?.length ?? 0)) {
    result = result.slice(0, -1)
  }
  while (result.endsWith(']') && (result.match(/\[/g)?.length ?? 0) < (result.match(/\]/g)?.length ?? 0)) {
    result = result.slice(0, -1)
  }
  return result
}

function renderLink(url: string, label: ReactNode, key: number): ReactNode {
  const props = linkProps(url)
  if (!props) return <Fragment key={key}>{label}</Fragment>
  if (props.external) {
    return (
      <a key={key} href={props.href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    )
  }
  return (
    <a key={key} href={props.href}>
      {label}
    </a>
  )
}

const BARE_URL = /https?:\/\/[^\s<>()]+/g

function findBareUrl(text: string, from: number): { start: number; url: string } | null {
  BARE_URL.lastIndex = from
  const match = BARE_URL.exec(text)
  if (!match) return null
  const url = stripTrailingPunctuation(match[0])
  if (!url) return null
  return { start: match.index, url }
}

const INLINE_PATTERNS: Array<{ re: RegExp; render: (m: RegExpExecArray, inner: ReactNode[], key: number) => ReactNode }> = [
  {
    re: /(`+)([\s\S]*?)\1(?!`)/,
    render: (m, _inner, key) => <code key={key}>{m[2] ?? ''}</code>,
  },
  {
    re: /\[([^\]]*)\]\(([^)\s]+)\)/,
    render: (m, _inner, key) => renderLink(m[2] ?? '', m[1] ?? '', key),
  },
  {
    re: /<((?:https?:\/\/|mailto:)[^>\s]+)>/,
    render: (m, _inner, key) => renderLink(m[1] ?? '', m[1] ?? '', key),
  },
  {
    re: /\*\*([\s\S]+?)\*\*/,
    render: (_m, inner, key) => <strong key={key}>{inner}</strong>,
  },
  {
    re: /(?<!\*)\*([^*\n]+?)\*(?!\*)/,
    render: (_m, inner, key) => <em key={key}>{inner}</em>,
  },
  {
    re: /~~([\s\S]+?)~~/,
    render: (_m, inner, key) => <del key={key}>{inner}</del>,
  },
]

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0
  while (cursor < text.length) {
    let earliest: { start: number; length: number; render: (key: number) => ReactNode } | null = null
    for (const pattern of INLINE_PATTERNS) {
      pattern.re.lastIndex = 0
      const rest = text.slice(cursor)
      const match = pattern.re.exec(rest)
      if (!match || match.index === undefined) continue
      const absoluteStart = cursor + match.index
      if (earliest && absoluteStart >= earliest.start) continue
      const captured = match.slice(1)
      const inner = captured.length === 1 ? parseInline(captured[0] ?? '') : []
      const node = pattern.render(match, inner, key)
      earliest = { start: absoluteStart, length: match[0].length, render: (k) => (k === key ? node : node) }
    }
    const bare = findBareUrl(text, cursor)
    if (bare && (!earliest || bare.start < earliest.start)) {
      earliest = {
        start: bare.start,
        length: findBareUrlLength(text, bare),
        render: (k) => renderLink(bare.url, bare.url, k),
      }
    }
    if (!earliest) {
      nodes.push(text.slice(cursor))
      break
    }
    if (earliest.start > cursor) nodes.push(text.slice(cursor, earliest.start))
    nodes.push(earliest.render(key))
    key += 1
    cursor = earliest.start + earliest.length
  }
  if (nodes.length === 0) nodes.push('')
  return nodes
}

function findBareUrlLength(text: string, found: { start: number; url: string }): number {
  // bare URL 匹配到的原始长度（含句尾标点），用于推进游标。
  const tail = text.slice(found.start)
  const match = /^[^\s<>()]+/.exec(tail)
  return match ? match[0].length : found.url.length
}

// ---------- 块级解析 ----------

function isBlank(line: string): boolean {
  return /^\s*$/.test(line)
}

function headingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+/.exec(line)
  return match ? match[1].length : null
}

function isFenceStart(line: string): boolean {
  return /^```/.test(line)
}

function isHr(line: string): boolean {
  return /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
}

function isBlockquote(line: string): boolean {
  return /^\s{0,3}>\s?/.test(line)
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/

function isListItem(line: string): boolean {
  return LIST_ITEM.test(line)
}

function tableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|')
}

function looksLikeTable(lines: string[], index: number): boolean {
  return lines[index] !== undefined && lines[index].includes('|') && tableSeparator(lines[index + 1] ?? '')
}

interface BlockParser {
  (lines: string[]): ReactNode[]
}

function parseBlocks(lines: string[]): ReactNode[] {
  const nodes: ReactNode[] = []
  let key = 0
  let i = 0
  const push = (node: ReactNode) => {
    nodes.push(<Fragment key={key}>{node}</Fragment>)
    key += 1
  }

  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (isBlank(line)) {
      i += 1
      continue
    }

    const level = headingLevel(line)
    if (level) {
      const content = line.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '')
      push(
        level === 1 ? <h1>{parseInline(content)}</h1>
          : level === 2 ? <h2>{parseInline(content)}</h2>
            : level === 3 ? <h3>{parseInline(content)}</h3>
              : level === 4 ? <h4>{parseInline(content)}</h4>
                : level === 5 ? <h5>{parseInline(content)}</h5>
                  : <h6>{parseInline(content)}</h6>,
      )
      i += 1
      continue
    }

    if (isFenceStart(line)) {
      const info = line.replace(/^```/, '').trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1 // 跳过收尾 fence（或 EOF）
      push(
        <pre>
          <code className={info ? `language-${info}` : undefined} data-language={info || undefined}>
            {body.join('\n')}
          </code>
        </pre>,
      )
      continue
    }

    if (isHr(line)) {
      push(<hr />)
      i += 1
      continue
    }

    if (isBlockquote(line)) {
      const quote: string[] = []
      while (i < lines.length && isBlockquote(lines[i] ?? '')) {
        quote.push((lines[i] ?? '').replace(/^\s{0,3}>\s?/, ''))
        i += 1
      }
      push(<blockquote>{parseBlocks(quote)}</blockquote>)
      continue
    }

    if (isListItem(line)) {
      const { node, next } = parseList(lines, i)
      push(node)
      i = next
      continue
    }

    if (looksLikeTable(lines, i)) {
      const { node, next } = parseTable(lines, i)
      push(node)
      i = next
      continue
    }

    // 段落：吞到空行或下一个块级起点；软换行保留为 <br/>。
    const paragraph: string[] = []
    while (i < lines.length) {
      const current = lines[i] ?? ''
      if (isBlank(current)) break
      if (paragraph.length > 0 && (
        headingLevel(current) !== null ||
        isFenceStart(current) ||
        isHr(current) ||
        isBlockquote(current) ||
        isListItem(current) ||
        looksLikeTable(lines, i)
      )) break
      paragraph.push(current)
      i += 1
    }
    push(
      <p>
        {paragraph.map((text, index) => (
          <Fragment key={index}>
            {index > 0 && <br />}
            {parseInline(text)}
          </Fragment>
        ))}
      </p>,
    )
  }
  return nodes
}

function parseList(lines: string[], start: number): { node: ReactNode; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? '')
  if (!first) return { node: null, next: start + 1 }
  const baseIndent = first[1].length
  const ordered = /\d/.test(first[2] ?? '')
  const startNumber = ordered ? parseInt(first[2] ?? '1', 10) : undefined
  const items: string[][] = []
  let i = start

  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (isBlank(line)) {
      // 空行后若仍有缩进的续行，视为同一 item 的延续；否则列表结束。
      const ahead = lines[i + 1]
      if (ahead !== undefined && !isBlank(ahead) && !LIST_ITEM.exec(ahead) && indentOf(ahead) > baseIndent) {
        i += 1
        continue
      }
      break
    }
    const match = LIST_ITEM.exec(line)
    if (match && match[1].length === baseIndent) {
      const contentIndent = baseIndent + (match[2]?.length ?? 1) + (match[3]?.length ?? 1)
      const itemLines = [match[4] ?? '']
      i += 1
      while (i < lines.length) {
        const continuation = lines[i] ?? ''
        if (isBlank(continuation)) {
          const ahead = lines[i + 1]
          if (ahead !== undefined && indentOf(ahead) >= contentIndent) {
            i += 1
            continue
          }
          break
        }
        const continuationItem = LIST_ITEM.exec(continuation)
        if (continuationItem && continuationItem[1].length <= baseIndent) break
        if (indentOf(continuation) < contentIndent && !continuationItem) break
        itemLines.push(continuation.slice(Math.min(indentOf(continuation), contentIndent)))
        i += 1
      }
      items.push(itemLines)
      continue
    }
    if (match && match[1].length < baseIndent) break
    if (!match && indentOf(line) > baseIndent && items.length > 0) {
      // 归属于上一个 item 的松散续行。
      items[items.length - 1]?.push(line.trim())
      i += 1
      continue
    }
    break
  }

  const children = items.map((itemLines, index) => <li key={index}>{parseBlocks(itemLines)}</li>)
  const node = ordered ? <ol start={startNumber}>{children}</ol> : <ul>{children}</ul>
  return { node, next: i }
}

function indentOf(line: string): number {
  const match = /^(\s*)/.exec(line)
  return match ? match[1].length : 0
}

function parseTable(lines: string[], start: number): { node: ReactNode; next: number } {
  const header = splitTableRow(lines[start] ?? '').map((cell) => cell.trim())
  const separator = splitTableRow(lines[start + 1] ?? '')
  const aligns = separator.map((cell) => {
    const trimmed = cell.trim()
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
    if (trimmed.endsWith(':')) return 'right'
    return undefined
  })
  const rows: string[][] = []
  let i = start + 2
  while (i < lines.length && (lines[i] ?? '').includes('|') && !isBlank(lines[i] ?? '')) {
    if (isListItem(lines[i] ?? '') || isBlockquote(lines[i] ?? '')) break
    const cells = splitTableRow(lines[i] ?? '')
    rows.push(cells.map((cell) => cell.trim()))
    i += 1
  }
  return {
    node: (
      <table>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index} style={aligns[index] ? { textAlign: aligns[index] as 'center' | 'right' } : undefined}>
                {parseInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {header.map((_h, colIndex) => (
                <td key={colIndex} style={aligns[colIndex] ? { textAlign: aligns[colIndex] as 'center' | 'right' } : undefined}>
                  {parseInline(cells[colIndex] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
    next: i,
  }
}

const BLOCK_PARSER: BlockParser = parseBlocks

export function renderMarkdown(text: string): ReactNode {
  if (!text.trim()) return null
  return <>{BLOCK_PARSER(text.split('\n'))}</>
}
