import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { listMigrations, migrate, openDatabase } from '../src/db.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ud-test-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('GET /healthz', () => {
  it('returns exactly { ok: true }, no-store', async () => {
    const db = openDatabase(':memory:');
    const res = await createApp({ db }).request('/healthz');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    db.close();
  });

  it('returns 503 { ok: false } when SQLite is unavailable', async () => {
    const db = openDatabase(':memory:');
    db.close();
    const res = await createApp({ db }).request('/healthz');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe('static web dist', () => {
  it('serves files and falls back to index.html, never for /api', async () => {
    const dist = tempDir();
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>x</title>');
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'a.js'), 'export {}');
    const db = openDatabase(':memory:');
    const app = createApp({ db, webDist: dist });
    const asset = await app.request('/assets/a.js');
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    const spa = await app.request('/b/my-bucket/f/docs');
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('<title>x</title>');
    expect((await app.request('/api/v1/nothing')).status).toBe(404);
    expect((await app.request('/..%2f..%2fpackage.json')).headers.get('content-type')).toMatch(/text\/html/);
    db.close();
  });
});

describe('migrations', () => {
  it('applies files in numeric order, each once, and is idempotent', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '0002_second.sql'), 'INSERT INTO trail (step) VALUES (2);');
    writeFileSync(join(dir, '0001_first.sql'), 'CREATE TABLE trail (step INTEGER NOT NULL) STRICT;\nINSERT INTO trail (step) VALUES (1);');
    writeFileSync(join(dir, 'README.md'), 'ignored');
    const db = openDatabase(join(tempDir(), 'ud.sqlite'));

    expect(migrate(db, dir)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(migrate(db, dir)).toEqual([]);
    expect(db.prepare('SELECT step FROM trail ORDER BY rowid').all().map((r) => r['step'])).toEqual([1, 2]);

    writeFileSync(join(dir, '0003_third.sql'), 'INSERT INTO trail (step) VALUES (3);');
    expect(migrate(db, dir)).toEqual(['0003_third.sql']);
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r['version'])).toEqual([1, 2, 3]);
    expect(db.prepare('PRAGMA journal_mode').get()?.['journal_mode']).toBe('wal');
    expect(db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys']).toBe(1);
    db.close();
  });

  it('rolls back a failing migration entirely', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '0001_ok.sql'), 'CREATE TABLE a (x INTEGER) STRICT;');
    writeFileSync(join(dir, '0002_bad.sql'), 'CREATE TABLE b (x INTEGER) STRICT;\nINSERT INTO missing VALUES (1);');
    const db = openDatabase(':memory:');
    expect(() => migrate(db, dir)).toThrow(/0002_bad\.sql/);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r['name']);
    expect(tables).toEqual(['a', 'schema_migrations']);
    db.close();
  });

  it('finds the repository migrations directory', () => {
    expect(() => listMigrations()).not.toThrow();
  });
});
