import type { ReactNode } from "react";

/**
 * Safe-subset Markdown renderer (spec §6.6). A lightweight hand-written parser
 * producing React nodes only — raw HTML is always rendered as plain text and
 * `dangerouslySetInnerHTML` is never used.
 */

export interface ThinkingSegment {
  thinking: boolean;
  text: string;
}

/**
 * Split literal `<think>` / `</think>` segments (case-insensitive) before
 * Markdown rendering (spec §6.6). An unclosed `<think>` makes the remainder a
 * thinking segment.
 */
export function splitThinking(text: string): ThinkingSegment[] {
  const pattern = /<\/?think>/gi;
  const segments: ThinkingSegment[] = [];
  let lastIndex = 0;
  let depth = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > lastIndex) {
      segments.push({ thinking: depth > 0, text: text.slice(lastIndex, index) });
    }
    if (match[0].toLowerCase() === "<think>") depth += 1;
    else depth = Math.max(0, depth - 1);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ thinking: depth > 0, text: text.slice(lastIndex) });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

// ===== Block parsing =====

type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "rule" }
  | { type: "list"; ordered: boolean; items: Block[][] }
  | { type: "table"; header: string[]; rows: string[][] };

interface ListMarker {
  indent: number;
  ordered: boolean;
  rest: string;
}

function listMarker(line: string): ListMarker | null {
  const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (!match) return null;
  const indent = (match[1] ?? "").replace(/\t/g, "    ").length;
  const marker = match[2] ?? "";
  return { indent, ordered: /\d/.test(marker.charAt(0)), rest: match[3] ?? "" };
}

function isFenceStart(line: string): boolean {
  return /^```/.test(line);
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isRule(line: string): boolean {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isQuote(line: string): boolean {
  return /^\s*>/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const line = lines[index];
  const next = lines[index + 1];
  if (line === undefined || next === undefined) return false;
  return line.includes("|") && isTableSeparator(next);
}

function isBlockStart(lines: readonly string[], index: number): boolean {
  const line = lines[index];
  if (line === undefined) return false;
  return (
    isFenceStart(line) ||
    isHeading(line) ||
    isRule(line) ||
    isQuote(line) ||
    listMarker(line) !== null ||
    isTableStart(lines, index)
  );
}

function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((cell) => cell.trim());
}

function dedent(lines: readonly string[], count: number): string[] {
  return lines.map((line) => {
    let index = 0;
    let removed = 0;
    while (index < line.length && removed < count && line.charAt(index) === " ") {
      index += 1;
      removed += 1;
    }
    return line.slice(index);
  });
}

function parseBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const at = (index: number): string => lines[index] ?? "";

  while (i < lines.length) {
    const line = at(i);
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(at(i))) {
        buffer.push(at(i));
        i += 1;
      }
      i += 1; // closing fence or EOF
      blocks.push({ type: "code", lang, code: buffer.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: (heading[1] ?? "#").length, text: (heading[2] ?? "").trim() });
      i += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (isQuote(line)) {
      const buffer: string[] = [];
      while (i < lines.length && isQuote(at(i))) {
        buffer.push(at(i).replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(buffer) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitTableRow(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && at(i).trim() !== "" && at(i).includes("|")) {
        rows.push(splitTableRow(at(i)));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const baseIndent = marker.indent;
      const ordered = marker.ordered;
      const items: Block[][] = [];
      while (i < lines.length) {
        const current = listMarker(at(i));
        if (!current || current.indent !== baseIndent || current.ordered !== ordered || at(i).trim() === "") break;
        const itemLines: string[] = [current.rest];
        i += 1;
        while (i < lines.length && at(i).trim() !== "") {
          const nested = listMarker(at(i));
          if (nested && nested.indent <= baseIndent) break;
          itemLines.push(at(i));
          i += 1;
        }
        items.push(parseBlocks(dedent(itemLines, baseIndent + 2)));
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // paragraph: run until a blank line or the next block starter
    const buffer: string[] = [line];
    i += 1;
    while (i < lines.length && at(i).trim() !== "" && !isBlockStart(lines, i)) {
      buffer.push(at(i));
      i += 1;
    }
    blocks.push({ type: "paragraph", text: buffer.join("\n") });
  }
  return blocks;
}

// ===== Inline rendering =====

function isAllowedHref(href: string): boolean {
  const lower = href.trim().toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("/") ||
    lower.startsWith("#")
  );
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count += 1;
  return count;
}

/** Strip sentence-final punctuation (and unbalanced closing parens) from a bare URL. */
function splitBareUrl(raw: string): [string, string] {
  let url = raw;
  let trailing = "";
  while (url.length > 0 && /[.,;:!?]/.test(url.charAt(url.length - 1))) {
    trailing = url.charAt(url.length - 1) + trailing;
    url = url.slice(0, -1);
  }
  while (url.endsWith(")") && countChar(url, ")") > countChar(url, "(")) {
    trailing = `)${trailing}`;
    url = url.slice(0, -1);
  }
  return [url, trailing];
}

interface InlineMatch {
  index: number;
  length: number;
  render: (key: string) => ReactNode;
}

function findInlineMatch(rest: string, keyPrefix: string): InlineMatch | null {
  const candidates: InlineMatch[] = [];

  const consider = (regex: RegExp, build: (match: RegExpExecArray) => InlineMatch["render"] | null) => {
    const match = regex.exec(rest);
    if (!match) return;
    const render = build(match);
    if (render) candidates.push({ index: match.index, length: match[0].length, render });
  };

  consider(/`([^`]+)`/, (match) => (key: string) => <code key={key}>{match[1]}</code>);

  consider(/<(https?:\/\/[^>\s]+)>/i, (match) => {
    const href = match[1] ?? "";
    return (key: string) => (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer">
        {href}
      </a>
    );
  });

  consider(/\[([^\]]*)\]\(([^)\s]+)\)/, (match) => {
    const label = match[1] ?? "";
    const href = match[2] ?? "";
    if (!isAllowedHref(href)) return null; // disallowed protocol renders as plain text
    const external = isExternalHref(href);
    return (key: string) => (
      <a key={key} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {renderInline(label, `${keyPrefix}l`)}
      </a>
    );
  });

  consider(/\*\*\*([^*]+)\*\*\*/, (match) => (key: string) => (
    <strong key={key}>
      <em>{renderInline(match[1] ?? "", `${keyPrefix}bi`)}</em>
    </strong>
  ));
  consider(/___([^_]+)___/, (match) => (key: string) => (
    <strong key={key}>
      <em>{renderInline(match[1] ?? "", `${keyPrefix}bi`)}</em>
    </strong>
  ));
  consider(/\*\*([^*]+)\*\*/, (match) => (key: string) => <strong key={key}>{renderInline(match[1] ?? "", `${keyPrefix}b`)}</strong>);
  consider(/__([^_]+)__/, (match) => (key: string) => <strong key={key}>{renderInline(match[1] ?? "", `${keyPrefix}b`)}</strong>);
  consider(/\*([^*]+)\*/, (match) => (key: string) => <em key={key}>{renderInline(match[1] ?? "", `${keyPrefix}i`)}</em>);
  consider(/(?<!\w)_([^_]+)_(?!\w)/, (match) => (key: string) => <em key={key}>{renderInline(match[1] ?? "", `${keyPrefix}i`)}</em>);
  consider(/~~([^~]+)~~/, (match) => (key: string) => <del key={key}>{renderInline(match[1] ?? "", `${keyPrefix}s`)}</del>);

  consider(/https?:\/\/[^\s<>()"']+/i, (match) => {
    const [url, trailing] = splitBareUrl(match[0]);
    if (url.length === 0) return null;
    return (key: string) => (
      <span key={key}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
        {trailing}
      </span>
    );
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index || b.length - a.length);
  return candidates[0] ?? null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let counter = 0;
  while (rest.length > 0) {
    const match = findInlineMatch(rest, `${keyPrefix}.${counter}`);
    if (!match) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    nodes.push(match.render(`${keyPrefix}.${counter}`));
    rest = rest.slice(match.index + match.length);
    counter += 1;
  }
  return nodes;
}

/** Paragraph text keeps soft line breaks as real line breaks (spec §6.6). */
function renderInlineWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(<br key={`${keyPrefix}.br${index}`} />);
    nodes.push(...renderInline(line, `${keyPrefix}.l${index}`));
  });
  return nodes;
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4"] as const;

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p key={key}>{renderInlineWithBreaks(block.text, key)}</p>;
    case "heading": {
      const Tag = HEADING_TAGS[Math.min(block.level, 4) - 1] ?? "h4";
      return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
    }
    case "code":
      return (
        <pre key={key} {...(block.lang ? { "data-language": block.lang } : {})}>
          <code>{block.code}</code>
        </pre>
      );
    case "quote":
      return <blockquote key={key}>{block.blocks.map((child, index) => renderBlock(child, `${key}.q${index}`))}</blockquote>;
    case "rule":
      return <hr key={key} />;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key}>
          {block.items.map((itemBlocks, index) => (
            <li key={`${key}.i${index}`}>{itemBlocks.map((child, childIndex) => renderBlock(child, `${key}.i${index}.${childIndex}`))}</li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <table key={key}>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={`${key}.h${index}`}>{renderInline(cell, `${key}.h${index}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${key}.r${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${key}.r${rowIndex}.${cellIndex}`}>{renderInline(cell, `${key}.r${rowIndex}.${cellIndex}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

/** Render a Markdown safe-subset document as React nodes (spec §6.6). */
export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text.split("\n"));
  return <>{blocks.map((block, index) => renderBlock(block, `b${index}`))}</>;
}
