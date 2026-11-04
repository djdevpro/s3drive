import { HOME_SPACE, RESERVED_PREFIX, USER_ID_PLACEHOLDER, relativeKeyProblem } from '@ud/contracts';
import { apiError } from '../errors.js';
import type { SpaceConfig } from './config.js';

// Clés relatives et enfermées dans leur espace.

/** Espace résolu pour une personne : racine réelle (préfixe avec `{userId}` remplacé). */
export interface ResolvedSpace {
  space: SpaceConfig;
  /** Propriétaire de l'usage : id de la personne pour `home`, chaîne vide sinon. */
  ownerId: string;
  bucket: string;
  root: string;
}

export function resolveSpace(space: SpaceConfig, userId: string): ResolvedSpace {
  const isHome = space.id === HOME_SPACE;
  return {
    space,
    ownerId: isHome ? userId : '',
    bucket: space.bucket,
    root: isHome ? space.prefix.replace(USER_ID_PLACEHOLDER, userId) : space.prefix,
  };
}

/** Racine réelle de `home` pour une personne donnée (recalcul, administration). */
export function homeRoot(space: SpaceConfig, userId: string): string {
  return space.prefix.replace(USER_ID_PLACEHOLDER, userId);
}

/**
 * Valide une clé relative et renvoie la clé réelle. `allowEmpty` : racine d'une liste.
 * Refus : `validation` avec le motif de `relativeKeyProblem`, ou `reserved_prefix`.
 */
export function toRealKey(rs: ResolvedSpace, key: string, options: { allowEmpty?: boolean } = {}): string {
  const problem = relativeKeyProblem(key, {
    ...(options.allowEmpty ? { allowEmpty: true } : {}),
    rootBytes: Buffer.byteLength(rs.root),
  });
  if (problem) throw apiError('validation', 'Invalid key', { reason: `key_${problem}` });
  if (key.startsWith(RESERVED_PREFIX) || key === RESERVED_PREFIX.slice(0, -1)) {
    throw apiError('validation', 'Reserved prefix', { reason: 'reserved_prefix' });
  }
  const real = rs.root + key;
  // Seconde barrière : la clé réelle commence par la racine de l'espace.
  if (!real.startsWith(rs.root)) throw apiError('validation', 'Invalid key', { reason: 'key_outside_space' });
  return real;
}

/** Clé relative d'une clé réelle renvoyée par S3 ; `null` si elle sort de l'espace (ignorée). */
export function toRelativeKey(rs: ResolvedSpace, realKey: string): string | null {
  if (!realKey.startsWith(rs.root)) return null;
  return realKey.slice(rs.root.length);
}

/** Vrai pour un élément caché à la racine de l'espace (`.universal-drive/`). */
export function isHiddenRelative(relative: string): boolean {
  return relative === RESERVED_PREFIX || relative.startsWith(RESERVED_PREFIX);
}
