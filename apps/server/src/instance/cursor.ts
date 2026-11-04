import { CURSOR_TTL_S } from '@ud/contracts';
import { deriveKey, open, seal, type SecretKey } from '../crypto.js';
import { apiError } from '../errors.js';

// Curseurs de liste opaques : chiffrés, liés au principal, à l'espace, au préfixe et au mode de liste.
// Le jeton de continuation S3 peut contenir une clé réelle : il ne sort jamais en clair.

interface CursorPayload {
  c: string;
  u: string;
  b: string;
  p: string;
  r: boolean;
  e: number;
}

const AAD = 'v1|ud-cursor';

export function sealCursor(key: SecretKey, now: number, binding: Omit<CursorPayload, 'c' | 'e'>, s3Cursor: string | null): string | null {
  if (s3Cursor === null) return null;
  const payload: CursorPayload = { ...binding, c: s3Cursor, e: now + CURSOR_TTL_S * 1000 };
  return seal(deriveKey(key, 'ud-cursor'), key.kid, JSON.stringify(payload), AAD);
}

export function openCursor(key: SecretKey, now: number, binding: Omit<CursorPayload, 'c' | 'e'>, cursor: string | undefined): string | null {
  if (!cursor) return null;
  const invalid = () => apiError('validation', 'Invalid cursor', { reason: 'invalid_cursor' });
  const plain = open(deriveKey(key, 'ud-cursor'), key.kid, cursor, AAD);
  if (!plain) throw invalid();
  let payload: CursorPayload;
  try {
    payload = JSON.parse(plain) as CursorPayload;
  } catch {
    throw invalid();
  }
  if (payload.e < now || payload.u !== binding.u || payload.b !== binding.b || payload.p !== binding.p || payload.r !== binding.r) {
    throw invalid();
  }
  return payload.c;
}
