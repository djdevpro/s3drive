import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// Les .sql restent dans src/migrations, en dev comme en prod : ce chemin est le même depuis src/db.ts
// et dist/db.js, sans étape de copie. L'image Docker doit donc copier apps/server/src/migrations.
export const MIGRATIONS_DIR = fileURLToPath(new URL('../src/migrations/', import.meta.url));

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

export function listMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: MigrationFile[] = [];
  for (const name of entries) {
    const match = MIGRATION_FILE.exec(name);
    if (match?.[1]) files.push({ version: Number(match[1]), name, path: join(dir, name) });
  }
  files.sort((a, b) => a.version - b.version);
  for (let i = 1; i < files.length; i++) {
    if (files[i]!.version === files[i - 1]!.version) {
      throw new Error(`Duplicate migration version ${files[i]!.version}`);
    }
  }
  return files;
}

/** Applique dans l'ordre les migrations absentes de schema_migrations ; renvoie les noms appliqués. */
export function migrate(db: DatabaseSync, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT;`);
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => Number(row['version'])),
  );
  const insert = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const done: string[] = [];
  for (const m of listMigrations(dir)) {
    if (applied.has(m.version)) continue;
    const sql = readFileSync(m.path, 'utf8');
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(sql);
      insert.run(m.version, m.name, Date.now());
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw new Error(`Migration ${m.name} failed`, { cause: err });
    }
    done.push(m.name);
  }
  return done;
}
