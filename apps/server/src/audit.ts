import { isIP } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { AUDIT_DETAILS_MAX_BYTES } from '@ud/contracts';
import { hmac, type SecretKey, deriveKey } from './crypto.js';

// Journal d'audit : toute action modifiante ; jamais de secret dans `details`.

export type AuditSource = 'web' | 'mcp' | 'api' | 'share' | 'system';
export type IpMode = 'full' | 'truncate' | 'hash';

export interface AuditEntry {
  connectionId: string | null;
  source: AuditSource;
  actor: string;
  action: string;
  outcome?: 'ok' | 'error';
  bucket?: string | null;
  key?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Adresse IP traitée selon `UD_IP_MODE` : /24 en IPv4, /48 en IPv6, ou HMAC. */
export function processIp(ip: string | null | undefined, mode: IpMode, key?: SecretKey): string | null {
  if (!ip) return null;
  if (mode === 'full') return ip;
  if (mode === 'hash') {
    if (!key) return null;
    return hmac(deriveKey(key, 'ud-ip'), ip).toString('hex').slice(0, 32);
  }
  const kind = isIP(ip);
  if (kind === 4) return ip.split('.').slice(0, 3).concat('0').join('.');
  if (kind === 6) {
    const groups = ip.split(':').slice(0, 3);
    return `${groups.join(':')}::`;
  }
  return null;
}

export class AuditLog {
  private readonly insert;

  constructor(
    private readonly db: DatabaseSync,
    private readonly ipMode: IpMode,
    private readonly key?: SecretKey,
    private readonly clock: () => number = Date.now,
  ) {
    this.insert = db.prepare(
      `INSERT INTO audit_log (at, connection_id, source, actor, action, outcome, bucket, key, details, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  write(entry: AuditEntry): void {
    let details = entry.details ? JSON.stringify(entry.details) : null;
    if (details && Buffer.byteLength(details) > AUDIT_DETAILS_MAX_BYTES) {
      details = JSON.stringify({ truncated: true });
    }
    try {
      this.insert.run(
        this.clock(),
        entry.connectionId,
        entry.source,
        entry.actor,
        entry.action,
        entry.outcome ?? 'ok',
        entry.bucket ?? null,
        entry.key ?? null,
        details,
        processIp(entry.ip, this.ipMode, this.key),
      );
    } catch {
      // un échec du journal ne défait pas l'action déjà faite.
      console.error('audit log write failed', { action: entry.action });
    }
  }

  /** Purge selon `UD_AUDIT_RETENTION_DAYS`. */
  purge(retentionDays: number): void {
    this.db.prepare('DELETE FROM audit_log WHERE at < ?').run(this.clock() - retentionDays * 86_400_000);
  }

  get database(): DatabaseSync {
    return this.db;
  }
}
