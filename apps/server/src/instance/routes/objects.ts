import {
  API_VERSION,
  type ConflictPolicy,
  type ListItem,
  type ObjectDetails,
  type ObjectListPage,
  type ObjectOperationResult,
  type SpaceScope,
  type UserPrincipal,
  isFolderKey,
  keyName,
  parentPrefix,
  renameRequestSchema,
  transferRequestSchema,
} from '@ud/contracts';
import type { UdS3 } from '@ud/s3';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { apiError } from '../../errors.js';
import { clientIp } from '../../request.js';
import { requireUser } from '../auth.js';
import { openCursor, sealCursor } from '../cursor.js';
import { type ResolvedSpace, isHiddenRelative, toRealKey, toRelativeKey } from '../keys.js';
import { type InstanceEnv, type InstanceRuntime, actorOf } from '../runtime.js';
import { authorizeSpace, spaceBucket, spaceLimit, visibleSpaces } from '../spaces.js';
import { parseJson, parseQuery, requireKeyParam } from './util.js';

// Objets d'un espace : clés relatives, autorisation avant S3.

/** Nombre maximal d'objets traités en une requête pour un dossier (pas encore de moteur de jobs). */
export const FOLDER_OPERATION_MAX_OBJECTS = 1000;
const PREVIEW_TTL_S = 15 * 60;
const DOWNLOAD_TTL_S = 60 * 60;

export interface SpaceRef {
  rs: ResolvedSpace;
  s3: UdS3;
}

export function storageFor(rt: InstanceRuntime, rs: ResolvedSpace): UdS3 {
  return rt.storages.get(rs.space.storage);
}

/** Espace autorisé de `:bucket` pour ces permissions, `:conn` vérifié. */
export function spaceRef(c: Context<InstanceEnv>, rt: InstanceRuntime, needed: SpaceScope[]): SpaceRef {
  const rs = authorizeSpace(rt, c.var.principal, c.req.param('bucket') ?? '', needed);
  return { rs, s3: storageFor(rt, rs) };
}

export function audit(c: Context<InstanceEnv>, rt: InstanceRuntime, action: string, bucket: string, key: string | null, details?: Record<string, unknown>): void {
  rt.audit.write({
    connectionId: rt.config.connection,
    source: 'web',
    actor: actorOf(c.var.principal.userId),
    action,
    bucket,
    key,
    ...(details ? { details } : {}),
    ip: clientIp(c, rt.requestEnv),
  });
}

/** Taille d'un objet, ou `null` s'il n'existe pas. */
export async function sizeOf(s3: UdS3, bucket: string, key: string): Promise<number | null> {
  try {
    return (await s3.headObject({ bucket, key })).size;
  } catch (err) {
    if ((err as { code?: string }).code === 'key_not_found') return null;
    throw err;
  }
}

/** Tous les objets sous un préfixe réel (liste récursive), bornée. */
async function listAll(s3: UdS3, bucket: string, prefix: string, max: number): Promise<Array<{ key: string; size: number }>> {
  const out: Array<{ key: string; size: number }> = [];
  let cursor: string | null = null;
  do {
    const page = await s3.listObjects({ bucket, prefix, delimiter: null, cursor, limit: 1000 });
    for (const item of page.items) {
      out.push({ key: item.key, size: item.type === 'file' ? item.size : 0 });
      if (out.length > max) throw apiError('validation', 'Too many objects for a single request', { reason: 'batch_too_large', max });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** Premier nom libre « nom (n).ext », pour un fichier ou un dossier. */
async function nextFreeKey(s3: UdS3, rs: ResolvedSpace, key: string): Promise<string> {
  const folder = isFolderKey(key);
  const parent = parentPrefix(key);
  const name = keyName(key);
  const dot = folder ? -1 : name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n <= 100; n++) {
    const candidate = `${parent}${base} (${n})${ext}${folder ? '/' : ''}`;
    const real = toRealKey(rs, candidate);
    const taken = folder ? (await s3.listObjects({ bucket: rs.bucket, prefix: real, delimiter: null, limit: 1 })).items.length > 0 : (await sizeOf(s3, rs.bucket, real)) !== null;
    if (!taken) return candidate;
  }
  throw apiError('already_exists', 'No free name found', { reason: 'no_free_name' });
}

function validateNewName(name: string): void {
  if (name === '' || name.includes('/') || name === '.' || name === '..' || /[\u0000-\u001f\u007f]/.test(name)) {
    throw apiError('validation', 'Invalid name', { reason: 'invalid_name' });
  }
}

interface TransferInput {
  principal: UserPrincipal;
  source: SpaceRef;
  sourceKey: string;
  target: SpaceRef;
  targetKey: string;
  op: 'copy' | 'move';
  conflict: ConflictPolicy;
}

/** Copier, déplacer ou renommer un fichier ou un dossier. */
export async function transfer(rt: InstanceRuntime, input: TransferInput): Promise<ObjectOperationResult> {
  const { source, target, op } = input;
  const folder = isFolderKey(input.sourceKey);
  if (folder !== isFolderKey(input.targetKey)) throw apiError('validation', 'Source and destination kinds differ', { reason: 'kind_mismatch' });
  if (source.rs.space.storage !== target.rs.space.storage) {
    throw apiError('not_implemented', 'Cross-storage transfers are not supported', { reason: 'cross_storage' });
  }
  const srcReal = toRealKey(source.rs, input.sourceKey);
  let dstKey = input.targetKey;
  let dstReal = toRealKey(target.rs, dstKey);
  const sameBucket = source.rs.bucket === target.rs.bucket;
  if (sameBucket && srcReal === dstReal) throw apiError('validation', 'Source and destination are the same', { reason: 'same_key' });
  if (folder && sameBucket && dstReal.startsWith(srcReal)) throw apiError('validation', 'Cannot move a folder into itself', { reason: 'move_into_self' });
  const sameUsage = source.rs.space.id === target.rs.space.id && source.rs.ownerId === target.rs.ownerId;
  const s3 = source.s3;

  // Objets à traiter : (clé réelle source, taille).
  const items = folder ? await listAll(s3, source.rs.bucket, srcReal, FOLDER_OPERATION_MAX_OBJECTS) : [];
  if (!folder) {
    const size = await sizeOf(s3, source.rs.bucket, srcReal);
    if (size === null) throw apiError('key_not_found', 'Object not found');
    items.push({ key: srcReal, size });
  } else if (items.length === 0) {
    throw apiError('key_not_found', 'Folder not found');
  }

  // Conflit à la destination.
  const existing = new Map<string, number>();
  if (folder) {
    const found = await listAll(target.s3, target.rs.bucket, dstReal, FOLDER_OPERATION_MAX_OBJECTS);
    for (const f of found) existing.set(f.key, f.size);
  } else {
    const size = await sizeOf(target.s3, target.rs.bucket, dstReal);
    if (size !== null) existing.set(dstReal, size);
  }
  if (existing.size > 0) {
    if (input.conflict === 'fail') throw apiError('already_exists', 'Destination exists', { reason: folder ? 'folder_exists' : 'key_exists' });
    if (input.conflict === 'skip') return { bucket: target.rs.space.id, key: dstKey, objects: 0, skipped: true };
    if (input.conflict === 'rename') {
      dstKey = await nextFreeKey(target.s3, target.rs, dstKey);
      dstReal = toRealKey(target.rs, dstKey);
      existing.clear();
    }
  }

  const plan = items.map((item) => {
    const realTarget = dstReal + item.key.slice(srcReal.length);
    // Contrôle de longueur et d'enfermement sur chaque clé finale.
    const relTarget = toRelativeKey(target.rs, realTarget);
    if (relTarget === null) throw apiError('validation', 'Invalid key', { reason: 'key_outside_space' });
    toRealKey(target.rs, relTarget);
    return { from: item.key, to: realTarget, size: item.size, replaced: existing.get(realTarget) ?? null };
  });
  const added = plan.reduce((sum, p) => sum + p.size - (p.replaced ?? 0), 0);
  if (!sameUsage || op === 'copy') {
    const { limit, kind } = spaceLimit(input.principal, target.rs);
    rt.usage.check(target.rs.space.id, target.rs.ownerId, Math.max(0, added), limit, kind);
  }

  for (const p of plan) {
    await s3.copyObject({ bucket: target.rs.bucket, key: p.to, sourceBucket: source.rs.bucket, sourceKey: p.from });
  }
  if (op === 'move') {
    for (let i = 0; i < plan.length; i += 1000) {
      const batch = plan.slice(i, i + 1000).map((p) => ({ key: p.from }));
      if (batch.length === 1) await s3.deleteObject({ bucket: source.rs.bucket, key: batch[0]!.key });
      else await s3.deleteObjects({ bucket: source.rs.bucket, keys: batch });
    }
  }

  // Usage.
  const replacedCount = plan.filter((p) => p.replaced !== null).length;
  const totalSize = plan.reduce((s, p) => s + p.size, 0);
  const replacedSize = plan.reduce((s, p) => s + (p.replaced ?? 0), 0);
  if (op === 'copy' || !sameUsage) {
    rt.usage.add(target.rs.space.id, target.rs.ownerId, totalSize - replacedSize, plan.length - replacedCount);
  } else {
    rt.usage.add(target.rs.space.id, target.rs.ownerId, -replacedSize, -replacedCount);
  }
  if (op === 'move' && !sameUsage) rt.usage.add(source.rs.space.id, source.rs.ownerId, -totalSize, -plan.length);

  return { bucket: target.rs.space.id, key: dstKey, objects: plan.length };
}

const listQuerySchema = z.object({
  prefix: z.string().default(''),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
  recursive: z.enum(['0', '1']).default('0'),
});

const downloadQuerySchema = z.object({
  key: z.string(),
  disposition: z.enum(['inline', 'attachment']).default('attachment'),
  filename: z.string().min(1).max(255).optional(),
  versionId: z.string().min(1).max(1024).optional(),
  redirect: z.enum(['0', '1']).default('0'),
});

export function registerObjectRoutes(app: Hono<InstanceEnv>, rt: InstanceRuntime): void {
  const auth = requireUser(rt);
  const C = '/api/v1/c/:conn';
  const B = `${C}/b/:bucket`;

  // `:conn` étranger : même réponse qu'une connexion inexistante.
  app.use(`${C}/*`, async (c, next) => {
    if (c.req.param('conn') !== rt.config.connection) throw apiError('not_found', 'Not found');
    await next();
  });
  app.use(C, async (c, next) => {
    if (c.req.param('conn') !== rt.config.connection) throw apiError('not_found', 'Not found');
    await next();
  });

  app.get(C, auth, (c) => c.json({ id: rt.config.connection, kind: 'instance' as const, name: rt.config.name, apiVersion: API_VERSION }));

  app.get(`${C}/buckets`, auth, (c) => {
    const principal = c.var.principal;
    return c.json({ items: visibleSpaces(rt, principal).map((id) => spaceBucket(rt, principal, id)), nextCursor: null });
  });

  app.get(`${B}/objects`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['read']);
    const q = parseQuery(c, listQuerySchema);
    const recursive = q.recursive === '1';
    const realPrefix = toRealKey(rs, q.prefix, { allowEmpty: true });
    const binding = { u: c.var.principal.userId, b: rs.space.id, p: q.prefix, r: recursive };
    const s3Cursor = openCursor(rt.key, rt.clock(), binding, q.cursor);
    const page = await s3.listObjects({ bucket: rs.bucket, prefix: realPrefix, delimiter: recursive ? null : '/', cursor: s3Cursor, limit: q.limit });
    const items: ListItem[] = [];
    for (const item of page.items) {
      const rel = toRelativeKey(rs, item.key);
      if (rel === null || rel === '' || rel === q.prefix || isHiddenRelative(rel)) continue;
      if (item.type === 'folder') items.push({ kind: 'folder', key: rel, name: keyName(rel) });
      else {
        items.push({
          kind: 'file',
          key: rel,
          name: keyName(rel),
          size: item.size,
          lastModified: item.lastModified,
          etag: item.etag,
          storageClass: item.storageClass ?? 'STANDARD',
        });
      }
    }
    const nextCursor = sealCursor(rt.key, rt.clock(), binding, page.nextCursor);
    const body: ObjectListPage = { items, nextCursor, prefix: q.prefix, partial: nextCursor !== null };
    c.header('Cache-Control', 'private, no-cache');
    return c.json(body);
  });

  app.get(`${B}/object`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['read']);
    const key = requireKeyParam(c);
    const versionId = c.req.query('versionId');
    const head = await s3.headObject({ bucket: rs.bucket, key: toRealKey(rs, key), ...(versionId ? { versionId } : {}) });
    const body: ObjectDetails = {
      kind: 'file',
      bucket: rs.space.id,
      key,
      name: keyName(key),
      size: head.size,
      lastModified: head.lastModified,
      etag: head.etag,
      ...(head.contentType ? { contentType: head.contentType } : {}),
      ...(head.versionId ? { versionId: head.versionId } : {}),
      metadata: head.metadata,
    };
    return c.json(body);
  });

  // Création d'un dossier : marqueur vide. Le contenu ponctuel de 09 n'est pas servi ici.
  app.put(`${B}/object`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['write']);
    const key = requireKeyParam(c);
    const length = Number(c.req.header('content-length') ?? '0');
    if (!isFolderKey(key)) throw apiError('not_implemented', 'Use the upload routes to write a file', { reason: 'use_uploads' });
    if (length > 0) throw apiError('validation', 'A folder marker has no body', { reason: 'folder_body' });
    const real = toRealKey(rs, key);
    const existing = await s3.listObjects({ bucket: rs.bucket, prefix: real, delimiter: null, limit: 1 });
    if (existing.items.length > 0) throw apiError('already_exists', 'Folder exists', { reason: 'folder_exists' });
    await s3.putEmpty({ bucket: rs.bucket, key: real });
    audit(c, rt, 'object.create_folder', rs.space.id, key);
    return c.json({ bucket: rs.space.id, key, objects: 1 } satisfies ObjectOperationResult, 201);
  });

  // Suppression définitive (la corbeille de 06 arrive avec son lot).
  app.delete(`${B}/object`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['delete']);
    const key = requireKeyParam(c);
    const real = toRealKey(rs, key);
    let items: Array<{ key: string; size: number }>;
    if (isFolderKey(key)) {
      items = await listAll(s3, rs.bucket, real, FOLDER_OPERATION_MAX_OBJECTS);
      if (items.length === 0) throw apiError('key_not_found', 'Folder not found');
    } else {
      const size = await sizeOf(s3, rs.bucket, real);
      if (size === null) throw apiError('key_not_found', 'Object not found');
      items = [{ key: real, size }];
    }
    let deleted = 0;
    let freed = 0;
    for (let i = 0; i < items.length; i += 1000) {
      const batch = items.slice(i, i + 1000);
      if (batch.length === 1 && !isFolderKey(key)) {
        await s3.deleteObject({ bucket: rs.bucket, key: batch[0]!.key });
        deleted += 1;
        freed += batch[0]!.size;
      } else {
        const result = await s3.deleteObjects({ bucket: rs.bucket, keys: batch.map((b) => ({ key: b.key })) });
        const done = new Set(result.deleted);
        for (const b of batch) {
          if (done.has(b.key)) {
            deleted += 1;
            freed += b.size;
          }
        }
      }
    }
    rt.usage.add(rs.space.id, rs.ownerId, -freed, -deleted);
    audit(c, rt, 'object.delete', rs.space.id, key, { objects: deleted, permanent: true });
    if (deleted < items.length) throw apiError('upstream_error', 'Some objects could not be deleted', { deleted, failed: items.length - deleted });
    return c.json({ deleted });
  });

  app.post(`${B}/object/rename`, auth, async (c) => {
    const source = spaceRef(c, rt, ['read', 'write', 'delete']);
    const key = requireKeyParam(c);
    const body = await parseJson(c, renameRequestSchema);
    validateNewName(body.newName);
    const targetKey = `${parentPrefix(key)}${body.newName}${isFolderKey(key) ? '/' : ''}`;
    const result = await transfer(rt, { principal: c.var.principal, source, sourceKey: key, target: source, targetKey, op: 'move', conflict: body.conflict });
    audit(c, rt, 'object.rename', source.rs.space.id, key, { to: result.key, objects: result.objects });
    return c.json(result);
  });

  for (const op of ['move', 'copy'] as const) {
    app.post(`${B}/object/${op}`, auth, async (c) => {
      const source = spaceRef(c, rt, op === 'move' ? ['read', 'delete'] : ['read']);
      const key = requireKeyParam(c);
      const body = await parseJson(c, transferRequestSchema);
      const targetSpace = body.destination.bucket ?? source.rs.space.id;
      const targetRs = authorizeSpace(rt, c.var.principal, targetSpace, ['write']);
      const target = { rs: targetRs, s3: storageFor(rt, targetRs) };
      const result = await transfer(rt, { principal: c.var.principal, source, sourceKey: key, target, targetKey: body.destination.key, op, conflict: body.conflict });
      audit(c, rt, `object.${op}`, source.rs.space.id, key, { toBucket: result.bucket, to: result.key, objects: result.objects });
      return c.json(result);
    });
  }

  // Téléchargement et aperçu : URL GET présignée après autorisation, pour la clé réelle exacte.
  app.get(`${B}/download`, auth, async (c) => {
    const { rs, s3 } = spaceRef(c, rt, ['read']);
    const q = parseQuery(c, downloadQuerySchema);
    if (isFolderKey(q.key)) throw apiError('validation', 'Folders cannot be downloaded directly', { reason: 'folder_download' });
    const real = toRealKey(rs, q.key);
    await s3.headObject({ bucket: rs.bucket, key: real, ...(q.versionId ? { versionId: q.versionId } : {}) });
    const expiresIn = q.disposition === 'inline' ? PREVIEW_TTL_S : DOWNLOAD_TTL_S;
    const signed = await s3.presignGet({
      bucket: rs.bucket,
      key: real,
      expiresIn,
      disposition: q.disposition,
      filename: q.filename ?? keyName(q.key),
      ...(q.versionId ? { versionId: q.versionId } : {}),
    });
    const expiresAt = new Date(rt.clock() + expiresIn * 1000).toISOString();
    if (q.redirect === '1') {
      c.header('Cache-Control', 'no-store');
      return c.redirect(signed.url, 302);
    }
    return c.json({ url: signed.url, expiresAt, transport: 'direct' as const });
  });
}
