import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const piSdkPrefixes = ['@mariozechner/pi-'];
const forbiddenExternalPrefixes = [
  '@modelcontextprotocol/',
  '@aws-sdk/',
  '@anthropic-ai/',
  'openai',
  'fastify',
  'pg',
  'postgres',
  'mysql2',
  'prisma',
  '@prisma/',
  'typeorm',
  'drizzle-orm'
];
const forbiddenPackages = new Set([
  'agent-state-postgres',
  'context-resolver',
  'local-fakes',
  'model-broker',
  'provider-catalog',
  'tool-runtime',
  'temporal-routing',
  'temporal-workflows'
]);
const forbiddenSerializedKeys = [
  'providerClient',
  'mcpClient',
  'mcpConnection',
  'toolRuntime',
  'artifactFinalizer',
  'checkpointSealer',
  'ledgerWriter',
  'receiptWriter',
  'grantAuthority',
  'budgetAuthority'
];

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

function importedSpecifiers(text) {
  return [...text.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function manifestDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})
  ]);
}

function startsWithAny(value, prefixes) {
  return prefixes.some((prefix) => value === prefix || value.startsWith(prefix));
}

function serializedKeys(text) {
  const keys = new Set();
  for (const match of text.matchAll(/(?:^|[,{;\n])\s*([A-Za-z_$][\w$]*)\s*[?:]?\s*:/g)) keys.add(match[1]);
  for (const match of text.matchAll(/(?:^|[,{;\n])\s*['"]([^'"]+)['"]\s*:/g)) keys.add(match[1]);
  return keys;
}

export function findPiBoundaryViolations({ packageName, normalized, text, manifest, isManifest = false }) {
  const failures = [];
  const dependencies = manifestDependencies(manifest);

  if (isManifest) {
    const piDependencies = [...dependencies].filter((dependency) => startsWithAny(dependency, piSdkPrefixes));
    if (packageName !== 'harness-pi') {
      for (const dependency of piDependencies) failures.push(`${normalized}: Pi SDK dependency is restricted to @sage/harness-pi: ${dependency}`);
    }
    return failures;
  }

  const specifiers = importedSpecifiers(text);
  for (const specifier of specifiers) {
    if (startsWithAny(specifier, piSdkPrefixes) && packageName !== 'harness-pi') {
      failures.push(`${normalized}: Pi SDK import is restricted to packages/harness-pi: ${specifier}`);
    }
    if (packageName === 'harness-pi') {
      if (startsWithAny(specifier, forbiddenExternalPrefixes)) failures.push(`${normalized}: forbidden Pi adapter import ${specifier}`);
      if (specifier.startsWith('@sage/')) {
        const dependency = specifier.slice('@sage/'.length).split('/')[0];
        if (forbiddenPackages.has(dependency)) failures.push(`${normalized}: Pi adapter may not depend on @sage/${dependency}`);
      }
    }
  }

  if (packageName === 'harness-pi') {
    for (const key of serializedKeys(text)) {
      if (forbiddenSerializedKeys.includes(key)) failures.push(`${normalized}: Pi adapter exposes forbidden authority field ${key}`);
    }
  }
  return failures;
}

export async function checkPiBoundaries({ workspaceRoot = root } = {}) {
  const failures = [];
  const packageEntries = await readdir(join(workspaceRoot, 'packages'), { withFileTypes: true });
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue;
    const packageName = entry.name;
    const packageDirectory = join(workspaceRoot, 'packages', packageName);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    failures.push(...findPiBoundaryViolations({
      packageName,
      normalized: relative(workspaceRoot, join(packageDirectory, 'package.json')).replaceAll('\\', '/'),
      text: JSON.stringify(manifest),
      manifest,
      isManifest: true
    }));
    for (const file of await walk(join(packageDirectory, 'src'))) {
      const normalized = relative(workspaceRoot, file).replaceAll('\\', '/');
      failures.push(...findPiBoundaryViolations({
        packageName,
        normalized,
        text: await readFile(file, 'utf8'),
        manifest
      }));
    }
  }
  return failures;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const failures = await checkPiBoundaries();
  if (failures.length > 0) {
    console.error(`Pi dependency/import boundary violations:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Pi dependency/import boundaries: OK');
}
