import { ADMIN_PERMISSIONS, type AdminPermission, type Grants, SPACE_SCOPES, SUPER_ADMIN_ROLE, type SpaceScope } from '@ud/contracts';
import type { InstanceConfig } from './config.js';

// Rôles et droits.

/** Lit une valeur à un chemin pointé (`resource_access.drive.roles`). */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Rôles du fournisseur : union des revendications aux chemins de `roleClaims` (tableau de chaînes ou chaîne seule). */
export function extractProviderRoles(sources: unknown[], roleClaims: string[]): string[] {
  const roles = new Set<string>();
  for (const source of sources) {
    for (const path of roleClaims) {
      const value = readPath(source, path);
      if (typeof value === 'string') roles.add(value);
      else if (Array.isArray(value)) for (const v of value) if (typeof v === 'string') roles.add(v);
    }
  }
  return [...roles];
}

/** Rôles Drive (noms de `roles.*`) que donnent les rôles du fournisseur, dans l'ordre du fichier. */
export function mapDriveRoles(config: InstanceConfig, providerRoles: string[]): string[] {
  const given = new Set(providerRoles);
  return config.roles.filter((r) => r.from.some((f) => given.has(f))).map((r) => r.name);
}

/** Union des droits des rôles Drive ; `quotaOverride` remplace le quota des rôles. */
export function computeGrants(config: InstanceConfig, driveRoles: string[], quotaOverride: number | null = null): Grants {
  const roles = config.roles.filter((r) => driveRoles.includes(r.name));
  const allSpaces = config.spaces.map((s) => s.id);

  if (driveRoles.includes(SUPER_ADMIN_ROLE)) {
    return {
      superAdmin: true,
      spaces: Object.fromEntries(allSpaces.map((id) => [id, [...SPACE_SCOPES]])),
      quota: quotaOverride,
      links: { public: true, people: true, maxDays: 0 },
      admin: [...ADMIN_PERMISSIONS],
    };
  }

  const spaces = new Map<string, Set<SpaceScope>>();
  const admin = new Set<AdminPermission>();
  let quota: number | null | undefined;
  const links = { public: false, people: false, maxDays: -1 };

  for (const role of roles) {
    for (const [target, scopes] of Object.entries(role.spaces)) {
      const ids = target === '*' ? allSpaces : [target];
      for (const id of ids) {
        const set = spaces.get(id) ?? new Set<SpaceScope>();
        for (const s of scopes) set.add(s);
        spaces.set(id, set);
      }
    }
    for (const a of role.admin) {
      if (a === '*') for (const p of ADMIN_PERMISSIONS) admin.add(p);
      else admin.add(a);
    }
    // Le plus grand quota ; `null` (illimité) l'emporte.
    if (quota === undefined) quota = role.quota;
    else if (quota !== null) quota = role.quota === null ? null : Math.max(quota, role.quota);
    links.public ||= role.links.public;
    links.people ||= role.links.people;
    // 0 = libre, donc le plus large.
    if (links.maxDays !== 0) links.maxDays = role.links.maxDays === 0 ? 0 : Math.max(links.maxDays, role.links.maxDays);
  }

  return {
    superAdmin: false,
    spaces: Object.fromEntries(
      allSpaces
        .filter((id) => (spaces.get(id)?.size ?? 0) > 0)
        .map((id) => [id, SPACE_SCOPES.filter((s) => spaces.get(id)!.has(s))]),
    ),
    quota: quotaOverride ?? (quota === undefined ? 0 : quota),
    links: { public: links.public, people: links.people, maxDays: Math.max(links.maxDays, 0) },
    admin: ADMIN_PERMISSIONS.filter((p) => admin.has(p)),
  };
}

export function spaceScopes(grants: Grants, spaceId: string): SpaceScope[] {
  return (grants.spaces[spaceId] ?? []) as SpaceScope[];
}

export function hasAdmin(grants: Grants, permission: AdminPermission): boolean {
  return grants.superAdmin || grants.admin.includes(permission);
}
