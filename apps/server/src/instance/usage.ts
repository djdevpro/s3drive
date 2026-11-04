import type { DatabaseSync } from 'node:sqlite';
import type { QuotaLimit } from '@ud/contracts';
import { randomBase62 } from '../crypto.js';
import { apiError } from '../errors.js';

// Usage et quotas : contrôle avant tout octet, taille réservée jusqu'à la fin de l'envoi.

export interface UsageRow {
  space_id: string;
  owner_id: string;
  bytes: number;
  objects: number;
  reserved_bytes: number;
  updated_at: number;
  recounted_at: number | null;
}

export interface UsageView {
  bytes: number;
  objects: number;
  reserved: number;
}

export interface ReservationRow {
  id: string;
  space_id: string;
  owner_id: string;
  user_id: string;
  key: string;
  size: number;
  replaced_size: number | null;
  upload_id: string | null;
  part_size: number | null;
  part_count: number | null;
  content_type: string | null;
  created_at: number;
  expires_at: number;
}

export interface ReserveInput {
  spaceId: string;
  ownerId: string;
  userId: string;
  key: string;
  size: number;
  replacedSize: number | null;
  /** Octets ; `null` = illimité. */
  limit: number | null;
  limitKind: QuotaLimit;
  ttlMs: number;
  uploadId?: string | null;
  partSize?: number | null;
  partCount?: number | null;
  contentType?: string | null;
}

export class UsageStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: () => number,
  ) {}

  private ensure(spaceId: string, ownerId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO space_usage (space_id, owner_id, bytes, objects, reserved_bytes, updated_at) VALUES (?, ?, 0, 0, 0, ?)')
      .run(spaceId, ownerId, this.clock());
  }

  get(spaceId: string, ownerId: string): UsageView {
    const row = this.db.prepare('SELECT * FROM space_usage WHERE space_id = ? AND owner_id = ?').get(spaceId, ownerId) as UsageRow | undefined;
    return row ? { bytes: row.bytes, objects: row.objects, reserved: row.reserved_bytes } : { bytes: 0, objects: 0, reserved: 0 };
  }

  /** Ajoute (ou retire) des octets et des objets, jamais en dessous de zéro. */
  add(spaceId: string, ownerId: string, bytes: number, objects: number): void {
    this.ensure(spaceId, ownerId);
    this.db
      .prepare(
        `UPDATE space_usage SET bytes = MAX(0, bytes + ?), objects = MAX(0, objects + ?), updated_at = ?
         WHERE space_id = ? AND owner_id = ?`,
      )
      .run(bytes, objects, this.clock(), spaceId, ownerId);
  }

  set(spaceId: string, ownerId: string, bytes: number, objects: number): void {
    this.ensure(spaceId, ownerId);
    const now = this.clock();
    this.db
      .prepare('UPDATE space_usage SET bytes = ?, objects = ?, updated_at = ?, recounted_at = ? WHERE space_id = ? AND owner_id = ?')
      .run(bytes, objects, now, now, spaceId, ownerId);
  }

  /** Refus `quota_exceeded` si `bytes + reserved + size > limit`. */
  check(spaceId: string, ownerId: string, size: number, limit: number | null, limitKind: QuotaLimit): void {
    if (limit === null) return;
    const usage = this.get(spaceId, ownerId);
    const remaining = Math.max(0, limit - usage.bytes - usage.reserved);
    if (size > remaining) {
      throw apiError('quota_exceeded', 'Quota exceeded', { limit: limitKind, remaining, quota: limit });
    }
  }

  /** Contrôle et réserve en une transaction ; renvoie l'id de la réservation. */
  reserve(input: ReserveInput, extraChecks: () => void = () => {}): ReservationRow {
    const id = randomBase62(16);
    const now = this.clock();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      // Un remplacement libère la taille de l'objet remplacé : seule la différence compte.
      const delta = Math.max(0, input.size - (input.replacedSize ?? 0));
      this.check(input.spaceId, input.ownerId, delta, input.limit, input.limitKind);
      extraChecks();
      this.ensure(input.spaceId, input.ownerId);
      this.db
        .prepare(
          `INSERT INTO upload_reservation (id, space_id, owner_id, user_id, key, size, replaced_size, upload_id, part_size,
             part_count, content_type, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.spaceId,
          input.ownerId,
          input.userId,
          input.key,
          input.size,
          input.replacedSize,
          input.uploadId ?? null,
          input.partSize ?? null,
          input.partCount ?? null,
          input.contentType ?? null,
          now,
          now + input.ttlMs,
        );
      this.db
        .prepare('UPDATE space_usage SET reserved_bytes = reserved_bytes + ?, updated_at = ? WHERE space_id = ? AND owner_id = ?')
        .run(delta, now, input.spaceId, input.ownerId);
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
    return this.reservation(id)!;
  }

  setUploadId(id: string, uploadId: string): void {
    this.db.prepare('UPDATE upload_reservation SET upload_id = ? WHERE id = ?').run(uploadId, id);
  }

  reservation(id: string): ReservationRow | null {
    return (this.db.prepare('SELECT * FROM upload_reservation WHERE id = ?').get(id) as ReservationRow | undefined) ?? null;
  }

  byUpload(uploadId: string): ReservationRow | null {
    return (this.db.prepare('SELECT * FROM upload_reservation WHERE upload_id = ?').get(uploadId) as ReservationRow | undefined) ?? null;
  }

  /** Réservation d'un PUT simple pour cette clé (la plus récente). */
  singleFor(spaceId: string, ownerId: string, key: string, size: number): ReservationRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM upload_reservation WHERE space_id = ? AND owner_id = ? AND key = ? AND size = ? AND upload_id IS NULL
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(spaceId, ownerId, key, size) as ReservationRow | undefined) ?? null
    );
  }

  /** Libère une réservation ; `finalSize` non nul : l'envoi a abouti et l'usage est mis à jour. */
  release(reservation: ReservationRow, finalSize: number | null = null): void {
    const delta = Math.max(0, reservation.size - (reservation.replaced_size ?? 0));
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const deleted = this.db.prepare('DELETE FROM upload_reservation WHERE id = ?').run(reservation.id).changes;
      if (Number(deleted) > 0) {
        this.db
          .prepare(
            'UPDATE space_usage SET reserved_bytes = MAX(0, reserved_bytes - ?), updated_at = ? WHERE space_id = ? AND owner_id = ?',
          )
          .run(delta, this.clock(), reservation.space_id, reservation.owner_id);
        if (finalSize !== null) {
          const replaced = reservation.replaced_size;
          this.add(reservation.space_id, reservation.owner_id, finalSize - (replaced ?? 0), replaced === null ? 1 : 0);
        }
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  /** Réservations échues (envois abandonnés) : libérées ; renvoie celles qui ont un multipart à annuler. */
  expired(): ReservationRow[] {
    return this.db.prepare('SELECT * FROM upload_reservation WHERE expires_at <= ?').all(this.clock()) as unknown as ReservationRow[];
  }

  /** Recalcule `reserved_bytes` depuis les réservations (cohérence après un arrêt brutal). */
  resyncReserved(): void {
    this.db.exec(`UPDATE space_usage SET reserved_bytes = COALESCE((
      SELECT SUM(MAX(0, r.size - COALESCE(r.replaced_size, 0))) FROM upload_reservation r
      WHERE r.space_id = space_usage.space_id AND r.owner_id = space_usage.owner_id), 0)`);
  }
}
