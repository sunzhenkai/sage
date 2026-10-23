#!/usr/bin/env node
// Design-language guard (see DESIGN.md): pages must use layout primitives, not ad-hoc widths/backgrounds/gutters.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../src/pages/', import.meta.url).pathname;
let failures = 0;
const rules = [
  [/\bmax-w-[\w[\]().%-]+/, 'centered/max-width container — content is full width (use `readable` for long text only)'],
  [/\bmx-auto\b/, 'centered container — content is full width'],
  [/\b(?:bg|text|border|fill|stroke)-\[#/, 'raw hex color — use tokens'],
  [/["'`\s]#[0-9a-fA-F]{3,8}\b/, 'raw hex color — use tokens'],
  [/\bbg-(?:frame|panel|sunken|raised|tile|canvas|page|inset|surface|white|black|(?:[a-z]+)-\d{2,3})\b/, 'surface background in a page — surfaces come from primitives (PageShell/Card/…)'],
  [/\b(?:px|pl|pr)-(?:4|5|6|8|10)\b|\bpt-(?:8|10|12)\b|\bpb-(?:12|16)\b|-mx-[56]\b/, 'ad-hoc page gutter/padding — use PageContent/Section/Bleed (gutter token)'],
  [/\boverflow-(?:y-)?auto\b/, 'ad-hoc scroll container — use PageContent'],
  [/<PanelBar\s+left=\{<><[A-Z]\w*\s|<PanelBar\s*$/, 'hand-built page header — use PageHeader (route icon is added automatically)'],
  [/<h1\b/, 'ad-hoc page title — use PageHeader / PageDescription'],
  [/<header\b[^>]*\bh-\[\d+px\]/, 'hard-coded header height — use h-[var(--header-h)]'],
  [/\bbg-transparent\b/, 'transparent input/control — inputs & pickers are white content surfaces (Input / ViewTabs / SegmentedTabs)'],
  [/\bfirst:m[tby]?-/, 'sibling-dependent spacing (first:mt-0) — hidden/conditional siblings break it; PageContent is a stack (gap = --stack-gap)'],
  [/<(?:Section|SettingsGroup|SettingsCard|SettingsTitle|PageDescription|Quiet|ApprovalCard|ChartCard|Card|details)\b[^>]*\bclassName="[^"]*(?<![\w:-])-?m[tby]-/, 'ad-hoc vertical margin on a page block — spacing between blocks comes only from the PageContent stack (--stack-gap)'],
  [/<PageContent\b[^>]*\bclassName="[^"]*\b(?:p[ty]?|m[ty])-/, 'ad-hoc PageContent top/bottom spacing — content inset is --page-pt']
];
// Page spacing rule (DESIGN.md §4): the shared primitives must own the content inset and the block stack.
{
  const page = readFileSync(new URL('../src/components/layout/page.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/components/layout/settings-shell.tsx', import.meta.url), 'utf8');
  const need = [
    [page, /function PageContent[\s\S]*?page-pt page-stack/, 'page.tsx  PageContent body must use `page-pt page-stack`'],
    [page, /function CardPane[\s\S]*?page-pt/, 'page.tsx  CardPane must start at `page-pt`'],
    [page, /<aside[^\n]*page-pt/, 'page.tsx  DetailLayout aside must start at `page-pt`'],
    [settings, /page-pt page-stack/, 'settings-shell.tsx  settings body must use `page-pt page-stack`']
  ];
  for (const [src, re, msg] of need) if (!re.test(src)) { failures++; console.log(msg); }
  for (const [name, src] of [['page.tsx', page], ['settings-shell.tsx', settings]]) {
    const m = src.match(/\bfirst:m[tby]?-\S+|<section className="[^"]*\bm[tby]-\S+|function PageDescription[^\n]*\n[^\n]*\bp[by]-\d/);
    if (m) { failures++; console.log(`${name}  ${m[0].split('\n').pop()}  → page blocks must not carry outer spacing (use the stack gap)`); }
  }
}
// Sidebar search trigger is the single exception to the input-surface rule: nav-item style only.
{
  const shell = readFileSync(new URL('../src/components/layout/app-shell.tsx', import.meta.url), 'utf8').split('\n').find((l) => l.includes('data-nav-search')) ?? '';
  if (!shell) { failures++; console.log('app-shell.tsx  sidebar search trigger missing data-nav-search'); }
  else if (/\bbg-surface\b|\bborder\b|shadow-btn/.test(shell)) { failures++; console.log('app-shell.tsx  sidebar search trigger must be nav-item style (no bg-surface/border/shadow)'); }
}
for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
  readFileSync(join(dir, file), 'utf8').split('\n').forEach((line, i) => {
    if (line.includes('design-ok')) return;
    for (const [re, msg] of rules) {
      const m = line.match(re);
      if (m) { failures++; console.log(`src/pages/${file}:${i + 1}  ${m[0]}  → ${msg}`); }
    }
  });
}
if (failures) { console.log(`\n✖ ${failures} design-language violation(s)`); process.exit(1); }
console.log('Design language check: OK');
