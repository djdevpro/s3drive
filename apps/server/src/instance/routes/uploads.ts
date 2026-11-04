import {
  type CreateUploadResponse,
  type PresignedPart,
  UPLOAD_PURPOSES,
  type UploadResult,
  completeUploadRequestSchema,
  confirmUploadsRequestSchema,
  createUploadRequestSchema,
  isFolderKey,
  presignPartsRequestSchema,
} from '@ud/contracts';
import type { UdS3 } from '@ud/s3';
import type { Context, Hono } from 'hono';
import { deriveKey, hmac, safeEqual } from '../../crypto.js';
import { ApiError, apiError, errorBody, fromEngineError } from '../../errors.js';
import { clientIp, userAgent } from '../../request.js';
import { requireUser } from '../auth.js';
import { type ResolvedSpace, toRealKey } from '../keys.js';
import { type InstanceEnv, type InstanceRuntime, actorOf } from '../runtime.js';
import { spaceLimit } from '../spaces.js';
import type { ReservationRow } from '../usage.js';
import { audit, sizeOf, spaceRef } from './objects.js';
import { parseJson, requireKeyParam } from './util.js';

// Envois avec contrôle du quota avant tout octet et journal des envois.

/** Seuil du PUT simple. */
export const SINGLE_PUT_THRESHOLD = 16 * 1024 * 1024;
/** Taille maximale d'un PUT simple (S3). */
export const SINGLE_PUT_MAX = 5 * 1024 ** 3;
const PUT_URL_TTL_S = 3600;
const PART_URL_TTL_S = 3600;
const RECEIPT_TTL_S = 24 * 3600;
/** Une réservation de PUT simple survit à son URL ; au-delà, l'envoi est réputé abandonné. */
const SINGLE_RESERVATION_TTL_MS = 2 * 3600 * 1000;
const MULTIPART_RESERVATION_TTL_MS = 7 * 24 * 3600 * 1000;
const FIRST_PART_BATCH = 20;

function receiptMac(rt: InstanceRuntime, fields: { space: string; key: string; size: number; purpose: string; principal: string; exp: number }): string {
  const data = ['v1', rt.config.connection, fields.space, fields.key, fields.size, fields.purpose, fields.principal, fields.exp].join('|');
  return hmac(deriveKey(rt.key, 'ud-upload-receipt'), data).toString('base64url');
}

/** Reçu d'envoi `<exp>.<mac>` ; le serveur reste sans état d'envoi pour le reçu. */
export function makeReceipt(rt: InstanceRuntime, space: string, key: string, size: number, purpose: string, principal: string): string {
  const exp = Math.floor(rt.clock() / 1000) + RECEIPT_TTL_S;
  return `${exp}.${receiptMac(rt, { space, key, size, purpose, principal, exp })}`;
}

function checkReceipt(rt: InstanceRuntime, receipt: string, space: string, key: string, size: number, principal: string): string | null {
  const [expText, mac] = receipt.split('.');
  const exp = Number(expText);
  if (!mac || !Number.isInteger(exp) || exp < Math.floor(rt.clock() / 1000)) return null;
  for (const purpose of UPLOAD_PURPOSES) {
    if (safeEqual(mac, receiptMac(rt, { space, key, size, purpose, principal, exp }))) return purpose;
  }
  return null;
}

function partSizeFor(index: number, reservation: ReservationRow): number {
  const partSize = reservation.part_size!;
  const count = reservation.part_count!;
  return index < count ? partSize : reservation.size - partSize * (count - 1);
}

async function presignParts(s3: UdS3, rs: ResolvedSpace, real: string, reservation: ReservationRow, now: number, parts: Array<{ partNumber: number; size: number }>): Promise<PresignedPart[]> {
  const out: PresignedPart[] = [];
  for (const part of parts) {
    if (part.partNumber > reservation.part_count! || part.size !== partSizeFor(part.partNumber, reservation)) {
      throw apiError('validation', 'Invalid part size', { reason: 'part_size', partNumber: part.partNumber });
    }
    const signed = await s3.presignPart({
      bucket: rs.bucket,
      key: real,
      uploadId: reservation.upload_id!,
      partNumber: part.partNumber,
      contentLength: part.size,
      expiresIn: PART_URL_TTL_S,
    });
    out.push({ partNumber: part.partNumber, url: signed.url, headers: signed.headers, expiresAt: new Date(now + PART_URL_TTL_S * 1000).toISOString() });
  }
  return out;
}

function logUpload(c: Context<InstanceEnv>, rt: InstanceRuntime, rs: ResolvedSpace, key: string, size: number, contentType: string | null, etag: string | null): void {
  rt.db
    .prepare(
      `INSERT INTO upload_log (at, user_id, ip, user_agent, space_id, key, size, content_type, etag, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'web')`,
    )
    .run(rt.clock(), c.var.principal.userId, clientIp(c, rt.requestEnv), userAgent(c), rs.space.id, key, size, contentType, etag);
}

/** Réservation d'un envoi multipart de cette personne, pour cette clé ; sinon `upload_gone`. */
function multipartReservation(rt: InstanceRuntime, c: Context<InstanceEnv>, rs: ResolvedSpace, key: string): ReservationRow {
  const reservation = rt.usage.byUpload(c.req.param('uploadId') ?? '');
  if (!reservation || reservation.space_id !== rs.space.id || reservation.owner_id !== rs.ownerId || reservation.key !== key || reservation.user_id !== c.var.principal.userId) {
    throw apiError('not_found', 'Upload not found', { reason: 'upload_gone' });
  }
  return reservation;
}

export function registerUploadRoutes(app: Hono<InstanceEnv>, rt: InstanceRuntime): void {
  const auth = requireUser(rt);
  const B = '/api/v1/c/:conn/b/:bucket';

  app.post(`${B}/uploads`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['write']);
    const key = requireKeyParam(c);
    if (isFolderKey(key)) throw apiError('validation', 'A file key must not end with "/"', { reason: 'folder_key' });
    const real = toRealKey(rs, key);
    const body = await parseJson(c, createUploadRequestSchema);
    const principal = c.var.principal;
    const multipart = rt.storages.multipart;

    let mode: 'single' | 'multipart' = body.mode === 'auto' ? (body.size > SINGLE_PUT_THRESHOLD ? 'multipart' : 'single') : body.mode;
    if (body.size === 0) mode = 'single';
    if (mode === 'single' && body.size > SINGLE_PUT_MAX) throw apiError('entity_too_large', 'Too large for a single PUT', { reason: 'single_put_max' });
    let partSize = 0;
    let partCount = 0;
    if (mode === 'multipart') {
      partSize = multipart.choosePartSize(body.size);
      partCount = Math.max(1, Math.ceil(body.size / partSize));
      if (partCount > multipart.maxParts) throw apiError('entity_too_large', 'Too large', { reason: 'provider_max' });
    }

    const replaced = await sizeOf(s3, rs.bucket, real);
    if (replaced !== null && body.conflict === 'fail') throw apiError('already_exists', 'Object exists', { reason: 'key_exists' });

    // Contrôle du quota et réservation avant tout appel d'écriture vers S3.
    const { limit, kind } = spaceLimit(principal, rs);
    const reservation = rt.usage.reserve({
      spaceId: rs.space.id,
      ownerId: rs.ownerId,
      userId: principal.userId,
      key,
      size: body.size,
      replacedSize: replaced,
      limit,
      limitKind: kind,
      ttlMs: mode === 'single' ? SINGLE_RESERVATION_TTL_MS : MULTIPART_RESERVATION_TTL_MS,
      partSize: mode === 'multipart' ? partSize : null,
      partCount: mode === 'multipart' ? partCount : null,
      contentType: body.contentType ?? null,
    });
    const now = rt.clock();
    const common = { key, transport: 'direct' as const, corsOk: null, weakGuard: body.conflict === 'fail' };

    try {
      if (mode === 'single') {
        const signed = await s3.presignPut({
          bucket: rs.bucket,
          key: real,
          expiresIn: PUT_URL_TTL_S,
          contentLength: body.size,
          ...(body.contentType ? { contentType: body.contentType } : {}),
        });
        const response: CreateUploadResponse = {
          ...common,
          mode: 'single',
          expiresAt: new Date(now + PUT_URL_TTL_S * 1000).toISOString(),
          url: signed.url,
          headers: signed.headers,
          receipt: makeReceipt(rt, rs.space.id, key, body.size, body.purpose, actorOf(principal.userId)),
        };
        return c.json(response, 201);
      }
      const { uploadId } = await s3.createMultipart({ bucket: rs.bucket, key: real, ...(body.contentType ? { contentType: body.contentType } : {}) });
      rt.usage.setUploadId(reservation.id, uploadId);
      const withUpload = { ...reservation, upload_id: uploadId };
      const first = Array.from({ length: Math.min(FIRST_PART_BATCH, partCount) }, (_, i) => ({ partNumber: i + 1, size: partSizeFor(i + 1, withUpload) }));
      const parts = await presignParts(s3, rs, real, withUpload, now, first);
      audit(c, rt, 'upload.initiate', rs.space.id, key, { size: body.size, partCount });
      const response: CreateUploadResponse = {
        ...common,
        mode: 'multipart',
        expiresAt: new Date(now + PART_URL_TTL_S * 1000).toISOString(),
        uploadId,
        partSize,
        partCount,
        checksum: null,
        contentMd5Required: false,
        parts,
      };
      return c.json(response, 201);
    } catch (err) {
      const current = rt.usage.reservation(reservation.id);
      if (current) {
        if (current.upload_id) await s3.abortMultipart({ bucket: rs.bucket, key: real, uploadId: current.upload_id }).catch(() => {});
        rt.usage.release(current);
      }
      throw err;
    }
  });

  app.post(`${B}/uploads/confirm`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['write']);
    const { items } = await parseJson(c, confirmUploadsRequestSchema);
    const principal = actorOf(c.var.principal.userId);
    const results: Array<{ key: string; ok: boolean; verified: boolean; error?: Record<string, unknown> }> = [];
    const confirmed: string[] = [];
    for (const item of items) {
      try {
        const real = toRealKey(rs, item.key);
        if (!checkReceipt(rt, item.receipt, rs.space.id, item.key, item.size, principal)) {
          throw apiError('validation', 'Invalid receipt', { reason: 'invalid_receipt' });
        }
        const head = await s3.headObject({ bucket: rs.bucket, key: real });
        const reservation = rt.usage.singleFor(rs.space.id, rs.ownerId, item.key, item.size);
        // Une confirmation rejouée ne compte pas deux fois.
        if (reservation) {
          rt.usage.release(reservation, head.size);
          logUpload(c, rt, rs, item.key, head.size, head.contentType ?? reservation.content_type, head.etag);
          confirmed.push(item.key);
        }
        results.push({ key: item.key, ok: true, verified: true });
      } catch (err) {
        const known = fromEngineError(err) ?? new ApiError('internal', 'Internal error');
        results.push({ key: item.key, ok: false, verified: false, error: errorBody(known) });
      }
    }
    if (confirmed.length > 0) audit(c, rt, 'object.upload', rs.space.id, null, { count: confirmed.length, keys: confirmed.slice(0, 20) });
    return c.json({ results });
  });

  app.post(`${B}/uploads/:uploadId/parts`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['write']);
    const key = requireKeyParam(c);
    const real = toRealKey(rs, key);
    const reservation = multipartReservation(rt, c, rs, key);
    const { parts } = await parseJson(c, presignPartsRequestSchema);
    return c.json({ parts: await presignParts(s3, rs, real, reservation, rt.clock(), parts) });
  });

  app.get(`${B}/uploads/:uploadId/parts`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['read']);
    const key = requireKeyParam(c);
    const reservation = multipartReservation(rt, c, rs, key);
    const parts = await s3.listParts({ bucket: rs.bucket, key: toRealKey(rs, key), uploadId: reservation.upload_id! });
    return c.json({ items: parts, nextCursor: null });
  });

  app.post(`${B}/uploads/:uploadId/complete`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['write']);
    const key = requireKeyParam(c);
    const real = toRealKey(rs, key);
    const reservation = multipartReservation(rt, c, rs, key);
    const body = await parseJson(c, completeUploadRequestSchema);
    if (body.size !== reservation.size) throw apiError('invalid_request', 'Size differs from the declared size', { reason: 'size_mismatch' });
    const listed = (await s3.listParts({ bucket: rs.bucket, key: real, uploadId: reservation.upload_id! })).sort((a, b) => a.partNumber - b.partNumber);
    const total = listed.reduce((sum, p) => sum + p.size, 0);
    // La somme des parties ne dépasse jamais la taille déclarée et réservée.
    if (total > reservation.size) throw apiError('invalid_request', 'Parts exceed the declared size', { reason: 'size_mismatch' });
    const numbers = listed.map((p) => p.partNumber);
    const complete = listed.length === reservation.part_count && numbers.every((n, i) => n === i + 1);
    if (!complete || total !== reservation.size) throw apiError('invalid_request', 'Parts do not match the upload', { reason: 'parts_mismatch', parts: listed });
    if (body.parts) {
      const byNumber = new Map(listed.map((p) => [p.partNumber, p.etag]));
      const mismatch = body.parts.some((p) => p.etag !== undefined && byNumber.get(p.partNumber)?.replace(/"/g, '') !== p.etag.replace(/"/g, ''));
      if (mismatch || body.parts.length !== listed.length) throw apiError('invalid_request', 'Parts do not match the upload', { reason: 'parts_mismatch', parts: listed });
    }
    const done = await s3.completeMultipart({ bucket: rs.bucket, key: real, uploadId: reservation.upload_id!, parts: listed.map((p) => ({ partNumber: p.partNumber, etag: p.etag })) });
    const head = await s3.headObject({ bucket: rs.bucket, key: real });
    rt.usage.release(reservation, head.size);
    logUpload(c, rt, rs, key, head.size, head.contentType ?? reservation.content_type, done.etag);
    audit(c, rt, 'object.upload', rs.space.id, key, { size: head.size, multipart: true });
    const result: UploadResult = { key, etag: done.etag, size: head.size, ...(done.versionId ? { versionId: done.versionId } : {}) };
    return c.json(result);
  });

  app.delete(`${B}/uploads/:uploadId`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['write']);
    const key = requireKeyParam(c);
    const reservation = multipartReservation(rt, c, rs, key);
    try {
      await s3.abortMultipart({ bucket: rs.bucket, key: toRealKey(rs, key), uploadId: reservation.upload_id! });
    } catch (err) {
      // NoSuchUpload vaut succès.
      const code = (err as { code?: string }).code;
      if (code !== 'not_found' && code !== 'key_not_found') throw err;
    }
    rt.usage.release(reservation);
    audit(c, rt, 'upload.abort', rs.space.id, key);
    return c.body(null, 204);
  });
}
