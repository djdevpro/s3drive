import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Primitives cryptographiques du serveur.
// Format des chiffrés : v1.<kid>.<iv>.<tag>.<ct>, base64url, AES-256-GCM, IV 12 octets, étiquette 16 octets.

export interface SecretKey {
  /** IKM de 32 octets (UD_SECRET_KEY décodée). */
  readonly ikm: Buffer;
  /** 8 premiers caractères base64url de HMAC-SHA256(clé, "ud-kid"). */
  readonly kid: string;
}

export function makeSecretKey(ikm: Buffer): SecretKey {
  if (ikm.length !== 32) throw new Error('UD_SECRET_KEY must decode to exactly 32 bytes');
  const kid = createHmac('sha256', ikm).update('ud-kid').digest('base64url').slice(0, 8);
  return { ikm, kid };
}

/**
 * Charge `UD_SECRET_KEY` (base64, 32 octets) ; en développement, sans variable, la génère dans
 * `<dataDir>/secret.key` (mode 600). En production, absente ou mal formée : erreur (refus de démarrer).
 */
export function loadSecretKey(options: { value: string | undefined; production: boolean; dataDir: string }): SecretKey {
  if (options.value) {
    const ikm = Buffer.from(options.value, 'base64');
    if (ikm.length !== 32) throw new Error('UD_SECRET_KEY must be 32 bytes encoded in base64 (44 characters)');
    return makeSecretKey(ikm);
  }
  if (options.production) throw new Error('UD_SECRET_KEY is required in production (32 bytes in base64)');
  const file = join(options.dataDir, 'secret.key');
  if (existsSync(file)) {
    const ikm = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (ikm.length !== 32) throw new Error(`${file} does not contain a valid key`);
    return makeSecretKey(ikm);
  }
  mkdirSync(dirname(file), { recursive: true });
  const ikm = randomBytes(32);
  writeFileSync(file, ikm.toString('base64'), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows : les modes POSIX ne s'appliquent pas.
  }
  return makeSecretKey(ikm);
}

/** HKDF-SHA256 (sel et info en UTF-8, sel vide par défaut), clé de 32 octets. */
export function deriveKey(key: SecretKey, info: string, salt = ''): Buffer {
  return Buffer.from(hkdfSync('sha256', key.ikm, Buffer.from(salt, 'utf8'), Buffer.from(info, 'utf8'), 32));
}

export function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Comparaison à temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Chiffre `plaintext` avec une clé dérivée ; `aad` lie le chiffré à son contexte. */
export function seal(dataKey: Buffer, kid: string, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', kid, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/** Déchiffre un chiffré de `seal` ; `null` s'il est altéré, mal formé ou d'une autre clé. */
export function open(dataKey: Buffer, kid: string, sealed: string, aad: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1' || parts[1] !== kid) return null;
  try {
    const iv = Buffer.from(parts[2]!, 'base64url');
    const tag = Buffer.from(parts[3]!, 'base64url');
    const ct = Buffer.from(parts[4]!, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', dataKey, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Identifiant aléatoire base62 (tirage uniforme). */
export function randomBase62(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[randomInt(62)];
  return out;
}

/** 32 octets aléatoires en base64url sans remplissage (43 caractères). */
export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Identifiant de session : 32 caractères hexadécimaux. */
export function randomSessionId(): string {
  return randomBytes(16).toString('hex');
}
