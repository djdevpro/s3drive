import type { DatabaseSync } from 'node:sqlite';
import { SESSION_ABSOLUTE_TTL_S, SESSION_EXTEND_MIN_INTERVAL_S, parseSessionCookie, sessionCookieName } from '@ud/contracts';
import { deriveKey, open, randomSecret, randomSessionId, safeEqual, seal, sha256Hex, type SecretKey } from '../crypto.js';

// Sessions du mode instance : cookie de session, sha256(secret) en base,
// jetons OIDC chiffrés par HKDF(UD_SECRET_KEY, sel = sessionId, info = "ud-oidc:" + secret).

/** Durée glissante d'une session du mode instance. */
export const INSTANCE_SESSION_TTL_MS = 12 * 3600 * 1000;

export interface SessionRow {
  id: string;
  lineage: string;
  secret_hash: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  absolute_expires_at: number;
  user_id: string | null;
  roles: string | null;
  roles_at: number | null;
  refresh_enc: string | null;
  id_token_enc: string | null;
}

export interface ActiveSession {
  row: SessionRow;
  secret: string;
}

export interface NewSessionInput {
  userId: string;
  roles: string[];
  refreshToken: string | null;
  idToken: string | null;
  userAgent: string | null;
  ip: string | null;
}

function oidcKey(key: SecretKey, sessionId: string, secret: string): Buffer {
  return deriveKey(key, `ud-oidc:${secret}`, sessionId);
}

export function sealToken(key: SecretKey, sessionId: string, secret: string, what: 'refresh' | 'id_token', value: string): string {
  return seal(oidcKey(key, sessionId, secret), key.kid, value, `v1|ud-oidc:${sessionId}:${what}`);
}

export function openToken(key: SecretKey, session: ActiveSession, what: 'refresh' | 'id_token', sealed: string | null): string | null {
  if (!sealed) return null;
  return open(oidcKey(key, session.row.id, session.secret), key.kid, sealed, `v1|ud-oidc:${session.row.id}:${what}`);
}

/**
 * Lit le cookie de session dans l'en-tête brut : plusieurs cookies du même nom → aucun.
 * `secure` : nom `__Host-ud_sid` (HTTPS) ou `ud_sid` (HTTP de développement).
 */
export function readSessionCookie(cookieHeader: string | undefined, secure: boolean): { sessionId: string; secret: string } | null {
  if (!cookieHeader) return null;
  const name = sessionCookieName(secure);
  const values = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length !== 1) return null;
  return parseSessionCookie(values[0]!);
}

export function sessionCookie(secure: boolean, value: string, maxAgeSeconds: number): string {
  const name = sessionCookieName(secure);
  const attrs = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookie(secure, '', 0);
}

export class SessionStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly key: SecretKey,
    private readonly clock: () => number,
  ) {}

  create(input: NewSessionInput): { id: string; cookieValue: string; expiresAt: number } {
    const now = this.clock();
    const id = randomSessionId();
    const secret = randomSecret();
    const expiresAt = now + INSTANCE_SESSION_TTL_MS;
    this.db
      .prepare(
        `INSERT INTO session (id, lineage, secret_hash, kind, created_at, last_seen_at, expires_at, absolute_expires_at,
           user_agent, ip, user_id, roles, roles_at, refresh_enc, id_token_enc)
         VALUES (?, ?, ?, 'standard', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        id,
        sha256Hex(secret),
        now,
        now,
        expiresAt,
        now + SESSION_ABSOLUTE_TTL_S * 1000,
        input.userAgent,
        input.ip,
        input.userId,
        JSON.stringify(input.roles),
        now,
        input.refreshToken ? sealToken(this.key, id, secret, 'refresh', input.refreshToken) : null,
        input.idToken ? sealToken(this.key, id, secret, 'id_token', input.idToken) : null,
      );
    return { id, cookieValue: `${id}.${secret}`, expiresAt };
  }

  /** Session valide pour ce cookie, ou `null` (absente, secret faux, expirée : alors supprimée). */
  find(cookie: { sessionId: string; secret: string }): ActiveSession | null {
    const row = this.db.prepare('SELECT * FROM session WHERE id = ?').get(cookie.sessionId) as SessionRow | undefined;
    if (!row) return null;
    if (!safeEqual(row.secret_hash, sha256Hex(cookie.secret))) return null;
    const now = this.clock();
    if (row.expires_at <= now || row.absolute_expires_at <= now) {
      this.delete(row.id);
      return null;
    }
    return { row, secret: cookie.secret };
  }

  /** Prolongation glissante au plus toutes les 10 min ; renvoie la nouvelle échéance si elle a changé. */
  touch(session: ActiveSession): number | null {
    const now = this.clock();
    if (now - session.row.last_seen_at < SESSION_EXTEND_MIN_INTERVAL_S * 1000) return null;
    const expiresAt = Math.min(now + INSTANCE_SESSION_TTL_MS, session.row.absolute_expires_at);
    this.db.prepare('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, expiresAt, session.row.id);
    session.row.last_seen_at = now;
    session.row.expires_at = expiresAt;
    return expiresAt;
  }

  updateRoles(session: ActiveSession, roles: string[], refreshToken: string | null, idToken: string | null): void {
    const now = this.clock();
    const refreshEnc = refreshToken ? sealToken(this.key, session.row.id, session.secret, 'refresh', refreshToken) : session.row.refresh_enc;
    const idEnc = idToken ? sealToken(this.key, session.row.id, session.secret, 'id_token', idToken) : session.row.id_token_enc;
    this.db
      .prepare('UPDATE session SET roles = ?, roles_at = ?, refresh_enc = ?, id_token_enc = ? WHERE id = ?')
      .run(JSON.stringify(roles), now, refreshEnc, idEnc, session.row.id);
    Object.assign(session.row, { roles: JSON.stringify(roles), roles_at: now, refresh_enc: refreshEnc, id_token_enc: idEnc });
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM session WHERE id = ?').run(id);
  }

  deleteForUser(userId: string): number {
    return Number(this.db.prepare('DELETE FROM session WHERE user_id = ?').run(userId).changes);
  }

  purgeExpired(): void {
    const now = this.clock();
    this.db.prepare('DELETE FROM session WHERE expires_at <= ? OR absolute_expires_at <= ?').run(now, now);
  }
}

export function sessionRoles(row: SessionRow): string[] {
  try {
    const parsed = JSON.parse(row.roles ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}
