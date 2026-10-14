#!/usr/bin/env node
// Design-language guard (see DESIGN.md): pages must use layout primitives, not ad-hoc widths/backgrounds/gutters.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../src/pages/', import.meta.url).pathname;
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
  [/\bbg-transparent\b/, 'transparent input/control — inputs & pickers are white content surfaces (Input / ViewTabs / SegmentedTabs)']
];
let failures = 0;
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
