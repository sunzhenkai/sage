import { Fragment, type ReactNode } from 'react';

/** Minimal CommonMark/GFM subset renderer for assistant text: builds React nodes directly, so raw HTML in model output stays inert text. */

interface MdListItem { text: string; children: MdBlock[] }
type MdBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'quote'; blocks: MdBlock[] }
  | { kind: 'rule' }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'list'; ordered: boolean; items: MdListItem[] };

const FENCE_OPEN_RE = /^ {0,3}`{3,}\s*(\S*)/;
const FENCE_CLOSE_RE = /^ {0,3}`{3,}\s*$/;
const HEADING_RE = /^(#{1,6}) +(.*?)\s*#*\s*$/;
const RULE_RE = /^ {0,3}(?:(?:- *){3,}|(?:\* *){3,}|(?:_ *){3,})$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)]) +(.*)$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;
const indentOf = (line: string) => (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '  ').length;
const isTableSeparator = (line: string) => /^[\s|:-]+$/.test(line) && line.includes('-') && line.includes('|');

const splitTableRow = (line: string): string[] => {
  let cells = line.trim();
  if (cells.startsWith('|')) cells = cells.slice(1);
  if (cells.endsWith('|')) cells = cells.slice(0, -1);
  return cells.split('|').map((cell) => cell.trim());
};

export function parseBlocks(source: string): MdBlock[] {
  const lines = source.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; continue; }
    const fence = FENCE_OPEN_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      blocks.push({ kind: 'code', language: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! }); i++; continue; }
    if (RULE_RE.test(line)) { blocks.push({ kind: 'rule' }); i++; continue; }
    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const body = [quote[1]!];
      i++;
      for (let next = QUOTE_RE.exec(lines[i] ?? ''); next !== null; next = QUOTE_RE.exec(lines[i] ?? '')) { body.push(next[1]!); i++; }
      blocks.push({ kind: 'quote', blocks: parseBlocks(body.join('\n')) });
      continue;
    }
    if (line.includes('|') && isTableSeparator(lines[i + 1] ?? '')) {
      const head = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) rows.push(splitTableRow(lines[i++]!));
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() !== '' && !FENCE_OPEN_RE.test(lines[i]!) && !HEADING_RE.test(lines[i]!) && !RULE_RE.test(lines[i]!) && !QUOTE_RE.test(lines[i]!) && !LIST_ITEM_RE.test(lines[i]!) && !(lines[i]!.includes('|') && isTableSeparator(lines[i + 1] ?? ''))) paragraph.push(lines[i++]!);
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

/** Nested lists are built with an indent stack: an item deeper than the frame below it becomes a child list of the previous sibling item. */
function parseList(lines: readonly string[], start: number): readonly [MdBlock, number] {
  interface Frame { indent: number; ordered: boolean; items: MdListItem[] }
  const first = LIST_ITEM_RE.exec(lines[start]!)!;
  const root: Frame = { indent: indentOf(first[1]!), ordered: /\d/.test(first[2]!), items: [] };
  const stack: Frame[] = [root];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      const indent = indentOf(item[1]!);
      while (stack.length > 1 && stack[stack.length - 1]!.indent > indent) stack.pop();
      const frame = stack[stack.length - 1]!;
      if (frame.indent < indent) {
        const nested: Frame = { indent, ordered: /\d/.test(item[2]!), items: [] };
        frame.items[frame.items.length - 1]!.children.push({ kind: 'list', ordered: nested.ordered, items: nested.items });
        stack.push(nested);
      }
      stack[stack.length - 1]!.items.push({ text: item[3]!, children: [] });
      i++;
      continue;
    }
    const current = stack[stack.length - 1]!.items.at(-1);
    if (line.trim() !== '' && current !== undefined && indentOf(line) > stack[stack.length - 1]!.indent) { current.text += `\n${line.trim()}`; i++; continue; }
    break;
  }
  return [{ kind: 'list', ordered: root.ordered, items: root.items }, i];
}

const INLINE_RE = /(`+)([\s\S]+?)\1(?!`)|\[([^\]]*)\]\(([^)\s]+)\)|\*\*\*([\s\S]+?)\*\*\*|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*(?![\s*])([^*\n]*?[^\s*])\*|~~([\s\S]+?)~~|<((?:https?|mailto):[^\s<>]+)>|(https?:\/\/[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]+)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?。，；：！？…]+$/;
const safeHref = (href: string): string | undefined => /^(https?:|mailto:)/i.test(href) || href.startsWith('/') || href.startsWith('#') ? href : undefined;
const externalLink = (href: string, key: string, children: ReactNode) => <a key={key} href={href} target="_blank" rel="noreferrer noopener">{children}</a>;

export function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const key = `${keyBase}-${n++}`;
    const [, ticks, code, linkText, href, boldItalic, bold, underscoreBold, italic, strike, autolink, bare] = match;
    if (ticks !== undefined) nodes.push(<code key={key}>{code}</code>);
    else if (href !== undefined) {
      const safe = safeHref(href);
      nodes.push(safe === undefined ? match[0] : externalLink(safe, key, linkText === '' ? safe : <Fragment key={`${key}-t`}>{renderInline(linkText!, `${key}-t`)}</Fragment>));
    } else if (boldItalic !== undefined) nodes.push(<strong key={key}><em>{renderInline(boldItalic, key)}</em></strong>);
    else if (bold !== undefined) nodes.push(<strong key={key}>{renderInline(bold, key)}</strong>);
    else if (underscoreBold !== undefined) nodes.push(<strong key={key}>{renderInline(underscoreBold, key)}</strong>);
    else if (italic !== undefined) nodes.push(<em key={key}>{renderInline(italic, key)}</em>);
    else if (strike !== undefined) nodes.push(<del key={key}>{renderInline(strike, key)}</del>);
    else if (autolink !== undefined) nodes.push(externalLink(autolink, key, autolink));
    else if (bare !== undefined) {
      // Greedy URLs swallow sentence-ending punctuation; hand it back as plain text.
      const url = bare.replace(TRAILING_PUNCTUATION_RE, '');
      nodes.push(externalLink(url, key, url));
      if (url.length < bare.length) nodes.push(bare.slice(url.length));
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderMarkdownBlocks(blocks: readonly MdBlock[], keyBase: string): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyBase}-${index}`;
    switch (block.kind) {
      case 'paragraph': return <p key={key}>{block.text.split('\n').map((segment, line) => <Fragment key={`${key}-l${line}`}>{line > 0 && <br />}{renderInline(segment, `${key}-l${line}`)}</Fragment>)}</p>;
      case 'heading': {
        const Tag = `h${Math.min(block.level, 4)}` as 'h1';
        return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
      }
      case 'code': return <pre key={key}><code className={block.language === '' ? undefined : `language-${block.language}`}>{block.text}</code></pre>;
      case 'quote': return <blockquote key={key}>{renderMarkdownBlocks(block.blocks, key)}</blockquote>;
      case 'rule': return <hr key={key} />;
      case 'table': return <table key={key}><thead><tr>{block.head.map((cell, column) => <th key={`${key}-h${column}`}>{renderInline(cell, `${key}-h${column}`)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowNumber) => <tr key={`${key}-r${rowNumber}`}>{row.map((cell, column) => <td key={`${key}-r${rowNumber}c${column}`}>{renderInline(cell, `${key}-r${rowNumber}c${column}`)}</td>)}</tr>)}</tbody></table>;
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return <Tag key={key}>{block.items.map((item, itemNumber) => <li key={`${key}-i${itemNumber}`}>{renderInline(item.text, `${key}-i${itemNumber}`)}{item.children.length > 0 && renderMarkdownBlocks(item.children, `${key}-i${itemNumber}`)}</li>)}</Tag>;
      }
    }
  });
}

export function Markdown({ text }: { readonly text: string }) {
  return <div className="md">{renderMarkdownBlocks(parseBlocks(text), 'md')}</div>;
}
