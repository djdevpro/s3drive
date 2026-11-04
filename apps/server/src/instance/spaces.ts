import { HOME_SPACE, type QuotaLimit, type SpaceBucket, type SpaceScope, type UserPrincipal } from '@ud/contracts';
import { apiError } from '../errors.js';
import { spaceById } from './config.js';
import { spaceScopes } from './grants.js';
import { type ResolvedSpace, resolveSpace } from './keys.js';
import type { InstanceRuntime } from './runtime.js';

// Espaces présentés comme des buckets et autorisation par espace.

/** Espaces visibles (permission `read`) : `home` d'abord, puis l'ordre du fichier. */
export function visibleSpaces(rt: InstanceRuntime, principal: UserPrincipal): string[] {
  const ids = rt.config.spaces.map((s) => s.id).filter((id) => spaceScopes(principal.grants, id).includes('read'));
  return [...ids.filter((id) => id === HOME_SPACE), ...ids.filter((id) => id !== HOME_SPACE)];
}

/** Espace autorisé pour ces permissions ; invisible → 404 `bucket_not_found`, permission absente → 403 `scope_denied`. */
export function authorizeSpace(rt: InstanceRuntime, principal: UserPrincipal, spaceId: string, needed: SpaceScope[]): ResolvedSpace {
  const space = spaceById(rt.config, spaceId);
  const scopes = spaceScopes(principal.grants, spaceId);
  if (!space || !scopes.includes('read')) throw apiError('bucket_not_found', 'Bucket not found');
  for (const scope of needed) {
    if (!scopes.includes(scope)) throw apiError('scope_denied', `Missing permission: ${scope}`, { reason: 'space_scope', scope });
  }
  return resolveSpace(space, principal.userId);
}

/** Plafond applicable aux envois dans cet espace. */
export function spaceLimit(principal: UserPrincipal, rs: ResolvedSpace): { limit: number | null; kind: QuotaLimit } {
  if (rs.space.id === HOME_SPACE) return { limit: principal.grants.quota, kind: 'user_quota' };
  return { limit: rs.space.quota, kind: 'space_quota' };
}

export function spaceBucket(rt: InstanceRuntime, principal: UserPrincipal, spaceId: string): SpaceBucket {
  const rs = resolveSpace(spaceById(rt.config, spaceId)!, principal.userId);
  const usage = rt.usage.get(spaceId, rs.ownerId);
  return {
    name: spaceId,
    kind: 'space',
    label: rs.space.name,
    scopes: spaceScopes(principal.grants, spaceId),
    quota: spaceLimit(principal, rs).limit,
    usage: { bytes: usage.bytes, objects: usage.objects },
  };
}
