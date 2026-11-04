import type { DatabaseSync } from 'node:sqlite';
import type { UserStatus } from '@ud/contracts';
import { randomBase62 } from '../crypto.js';

// Personnes du mode instance : la ligne naît à la première connexion avec un rôle Drive.

export interface UserRow {
  id: string;
  issuer: string;
  subject: string;
  email: string | null;
  name: string | null;
  status: UserStatus;
  quota_override: number | null;
  roles_cache: string;
  terms_version: string | null;
  terms_accepted_at: number | null;
  created_at: number;
  last_login_at: number | null;
}

export function userRoles(row: UserRow): string[] {
  try {
    const parsed = JSON.parse(row.roles_cache) as unknown;
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

export class UserStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: () => number,
  ) {}

  get(id: string): UserRow | null {
    return (this.db.prepare('SELECT * FROM user WHERE id = ?').get(id) as UserRow | undefined) ?? null;
  }

  findBySubject(issuer: string, subject: string): UserRow | null {
    return (this.db.prepare('SELECT * FROM user WHERE issuer = ? AND subject = ?').get(issuer, subject) as UserRow | undefined) ?? null;
  }

  create(input: { issuer: string; subject: string; email: string | null; name: string | null; roles: string[] }): UserRow {
    const now = this.clock();
    // Collision d'id : improbable (62^10), mais on retente plutôt que d'échouer.
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = randomBase62(10);
      try {
        this.db
          .prepare(
            `INSERT INTO user (id, issuer, subject, email, name, status, roles_cache, created_at, last_login_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          )
          .run(id, input.issuer, input.subject, input.email, input.name, JSON.stringify(input.roles), now, now);
        return this.get(id)!;
      } catch (err) {
        if (this.findBySubject(input.issuer, input.subject)) return this.findBySubject(input.issuer, input.subject)!;
        if (attempt === 4) throw err;
      }
    }
    throw new Error('unreachable');
  }

  recordLogin(id: string, input: { email: string | null; name: string | null; roles: string[] }): void {
    this.db
      .prepare('UPDATE user SET email = ?, name = ?, roles_cache = ?, last_login_at = ? WHERE id = ?')
      .run(input.email, input.name, JSON.stringify(input.roles), this.clock(), id);
  }

  updateRolesCache(id: string, roles: string[]): void {
    this.db.prepare('UPDATE user SET roles_cache = ? WHERE id = ?').run(JSON.stringify(roles), id);
  }

  setStatus(id: string, status: UserStatus): void {
    this.db.prepare('UPDATE user SET status = ? WHERE id = ?').run(status, id);
  }

  setQuotaOverride(id: string, quota: number | null): void {
    this.db.prepare('UPDATE user SET quota_override = ? WHERE id = ?').run(quota, id);
  }

  acceptTerms(id: string, version: string): void {
    this.db.prepare('UPDATE user SET terms_version = ?, terms_accepted_at = ? WHERE id = ?').run(version, this.clock(), id);
  }

  all(): UserRow[] {
    return this.db.prepare('SELECT * FROM user').all() as unknown as UserRow[];
  }
}
