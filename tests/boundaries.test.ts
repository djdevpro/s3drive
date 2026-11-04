// Règles de dépendances entre paquets et applis : toute autre importation est refusée.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
// Les fichiers de test (vitest, node:fs…) ne sont pas du code livré : ils échappent aux règles.
const TEST = /\.test(?:-utils)?\.[cm]?[jt]sx?$/;

function walk(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path);
    return SOURCE.test(name) && !TEST.test(name) ? [path] : [];
  });
}

// import/export … from '…', import('…'), import '…', require('…').
const SPECIFIER =
  /(?:^|[^\w$.])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*['"]([^'"]+)['"]|(?:^|[^\w$.])require\s*\(\s*['"]([^'"]+)['"]/g;

function importsOf(code: string): string[] {
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of clean.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (spec) out.push(spec);
  }
  return out;
}

/** Nom du paquet d'un spécificateur ; null pour un import relatif. */
function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  if (spec.startsWith('node:')) return 'node:';
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] ?? spec);
}

function ownDependencies(dir: string): Set<string> {
  const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
  return new Set([...Object.keys(pkg['dependencies'] ?? {}), ...Object.keys(pkg['peerDependencies'] ?? {})]);
}

type Rule = (pkg: string) => boolean;

const APPS = new Set(['@ud/web', '@ud/server']);
const isAws = (p: string) => p.startsWith('@aws-sdk/');

const rules: Record<string, Rule> = {
  'packages/contracts': (p) => p === 'zod',
  'packages/s3': (p) => p === '@ud/contracts' || isAws(p) || p.startsWith('@smithy/') || p === 'node:',
  'packages/sdk': (p) => p === '@ud/contracts',
  'packages/ui': (p) => {
    if (p === '@ud/sdk' || p === '@ud/contracts') return true;
    if (p.startsWith('@ud/') || isAws(p) || p === 'node:') return false;
    return ownDependencies('packages/ui').has(p);
  },
  'apps/web': (p) => !isAws(p) && !APPS.has(p),
  'apps/server': (p) => p !== '@ud/web' && p !== '@ud/ui',
};

function collect(dir: string): { file: string; pkg: string }[] {
  return walk(join(root, dir, 'src')).flatMap((file) =>
    importsOf(readFileSync(file, 'utf8'))
      .map(packageOf)
      .filter((p): p is string => p !== null)
      .map((pkg) => ({ file: relative(root, file), pkg })),
  );
}

describe('import parser', () => {
  it('finds static, dynamic, side-effect and type imports', () => {
    const code = [
      "import { a } from 'zod';",
      "import type { B } from '@ud/contracts';",
      "export * from './x.js';",
      "import './side.css';",
      "const m = await import('@aws-sdk/client-s3');",
      "// import 'commented';",
    ].join('\n');
    expect(importsOf(code)).toEqual(['zod', '@ud/contracts', './x.js', './side.css', '@aws-sdk/client-s3']);
  });
});

describe('package boundaries', () => {
  for (const [dir, allowed] of Object.entries(rules)) {
    it(`${dir} imports only what it may`, () => {
      const violations = collect(dir).filter(({ pkg }) => !allowed(pkg));
      expect(violations).toEqual([]);
    });
  }

  it('no package imports an app', () => {
    const dirs = ['packages/contracts', 'packages/s3', 'packages/sdk', 'packages/ui'];
    const violations = dirs.flatMap(collect).filter(({ pkg }) => APPS.has(pkg));
    expect(violations).toEqual([]);
  });

  it('@aws-sdk is used only in packages/s3 and apps/server', () => {
    const dirs = ['packages/contracts', 'packages/sdk', 'packages/ui', 'apps/web'];
    const violations = dirs.flatMap(collect).filter(({ pkg }) => isAws(pkg));
    expect(violations).toEqual([]);
  });
});
