
export async function checkCanonicalPublicSurfaces({ workspaceRoot = root } = {}) {
  const policy = JSON.parse(await readFile(join(workspaceRoot, 'package-ownership.json'), 'utf8'));
  const failures = [];
  for (const packageName of ['agent-contracts', 'platform-ports']) {
    const surfaceRoot = join(workspaceRoot, 'packages', packageName, 'dist');
    for (const file of await walk(surfaceRoot)) {
      if (!/\.(?:d\.ts|js)$/.test(file) || /(?:\.test|\.spec)\.js$/.test(file)) continue;
      const normalized = relative(workspaceRoot, file).replaceAll('\\\\', '/');
      const text = await readFile(file, 'utf8');
      failures.push(...findDependencyBoundaryViolations({ normalized, packageName, text, policy }));
    }
  }
  return failures;
}
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const sourceRoots = ['packages', 'apps', 'examples'];

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-types') continue;
      files.push(...await walk(path));
    }
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

function importedSpecifiers(text) {
  return [...text.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

function serializedKeys(text) {
  const keys = new Set();
  const patterns = [
    /(?:^|[,{;\n])\s*([A-Za-z_$][\w$]*)\s*[?:]?\s*:/g,
    /(?:^|[,{;\n])\s*['"]([^'"]+)['"]\s*:/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) keys.add(match[1]);
  }
  return keys;
}

function sourceTokenPattern(token) {
  if (token.includes(' ')) return new RegExp(token.replaceAll(' ', '\\s+'), 'iu');
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'u');
}

export function findDependencyBoundaryViolations({ normalized, packageName, text, policy }) {
  const failures = [];
  const rule = policy.rules[packageName];
  const hard = policy.hardConstraints[packageName];
  if (!rule && normalized.includes('/src/')) failures.push(`${normalized}: package ownership is not declared`);

  for (const specifier of importedSpecifiers(text)) {
    if (specifier.startsWith('@sage/')) {
      const dependency = specifier.slice('@sage/'.length).split('/')[0];
      if (rule && dependency !== packageName && !rule.mayDependOn.includes(dependency)) {
        failures.push(`${normalized}: @sage/${packageName} may not depend on @sage/${dependency}`);
      }
    }
    for (const forbidden of hard?.forbiddenExternalPrefixes ?? []) {
      const namespacePrefix = forbidden.endsWith('/') || forbidden.endsWith('-');
      if (specifier === forbidden || (namespacePrefix && specifier.startsWith(forbidden))) failures.push(`${normalized}: forbidden import ${specifier}`);
    }
    for (const forbidden of hard?.forbiddenPackages ?? []) {
      if (specifier === `@sage/${forbidden}` || specifier.startsWith(`@sage/${forbidden}/`)) failures.push(`${normalized}: forbidden import ${specifier}`);
    }
  }

  const scanImplementationSurface = !/(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(normalized);
  const forbiddenSourceTokens = scanImplementationSurface ? (hard?.forbiddenSourceTokens ?? []) : [];
  for (const token of forbiddenSourceTokens) {
    if (sourceTokenPattern(token).test(text)) failures.push(`${normalized}: forbidden framework source token ${token}`);
  }

  const forbiddenKeys = new Set((hard?.forbiddenSerializedKeys ?? []).map((key) => key.toLowerCase()));
  if (!scanImplementationSurface) return failures;
  for (const key of serializedKeys(text)) {
    if (forbiddenKeys.has(key.toLowerCase())) failures.push(`${normalized}: forbidden serialized framework field ${key}`);
  }
  return failures;
}

export async function checkDependencyBoundaries({ workspaceRoot = root } = {}) {
  const policy = JSON.parse(await readFile(join(workspaceRoot, 'package-ownership.json'), 'utf8'));
  const failures = [];
  for (const sourceRoot of sourceRoots) {
    for (const file of await walk(join(workspaceRoot, sourceRoot))) {
      const normalized = relative(workspaceRoot, file).replaceAll('\\', '/');
      const match = normalized.match(/^(?:packages|apps|examples)\/([^/]+)\//);
      if (!match) continue;
      const text = await readFile(file, 'utf8');
      failures.push(...findDependencyBoundaryViolations({ normalized, packageName: match[1], text, policy }));
    }
  }
  return failures;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const failures = [...await checkDependencyBoundaries(), ...await checkCanonicalPublicSurfaces()];
  if (failures.length > 0) {
    console.error(`Dependency boundary violations:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Dependency boundaries: OK');
}
