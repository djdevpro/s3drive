import { HOME_SPACE, type MeSpace } from '@ud/contracts';
import { useSyncExternalStore } from 'react';

// Petits outils de la coquille : connexion de l'instance, liens d'espaces, libellés, préférences.

/** Id de la connexion de l'instance ; distinct des ids de 00 (10 caractères base62). */
export const INSTANCE_CONNECTION = /^[a-z][a-z0-9-]{1,31}$/;
const PERSONAL_CONNECTION = /^[0-9A-Za-z]{10}$/;

export function isInstanceConnection(conn: string): boolean {
  return INSTANCE_CONNECTION.test(conn) && !PERSONAL_CONNECTION.test(conn) && conn !== 'me';
}

/** Racine d'un espace dans l'explorateur : `/d/<connexion>/b/<espace>/` (le `/` final = dossier). */
export function spaceHref(conn: string, space: string): string {
  return `/d/${encodeURIComponent(conn)}/b/${encodeURIComponent(space)}/`;
}

export function homeHref(conn: string): string {
  return spaceHref(conn, HOME_SPACE);
}

/** Libellé d'un espace partagé : langue courante, puis anglais, puis l'id. */
export function spaceLabel(space: Pick<MeSpace, 'id' | 'label'>, lng: string): string {
  const table = space.label;
  if (!table) return space.id;
  const base = lng.split('-')[0] ?? lng;
  return table[lng] ?? table[base] ?? table['en'] ?? Object.values(table)[0] ?? space.id;
}

/** Libellé d'un rôle Drive : traduit pour les rôles connus, son nom sinon. */
export function roleLabel(t: (key: string, options?: Record<string, unknown>) => string, role: string): string {
  return t(`instance:roles.${role}`, { defaultValue: role });
}

// ---------------------------------------------------------------------------
// Préférences de disposition : `ud.layout.v1`, lecture protégée, valeurs bornées.

const LAYOUT_KEY = 'ud.layout.v1';
const LAYOUT_EVENT = 'ud:layout';

export interface LayoutPrefs {
  sidebarCollapsed: boolean;
}

const DEFAULT_LAYOUT: LayoutPrefs = { sidebarCollapsed: false };
let cachedRaw: string | null | undefined;
let cachedPrefs: LayoutPrefs = DEFAULT_LAYOUT;

function readLayout(): LayoutPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LAYOUT_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedPrefs;
  cachedRaw = raw;
  try {
    const value = raw ? (JSON.parse(raw) as Partial<LayoutPrefs>) : {};
    cachedPrefs = { sidebarCollapsed: value.sidebarCollapsed === true };
  } catch {
    cachedPrefs = DEFAULT_LAYOUT;
  }
  return cachedPrefs;
}

export function writeLayout(patch: Partial<LayoutPrefs>): void {
  const next = { ...readLayout(), ...patch };
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
  } catch {
    cachedRaw = undefined;
    cachedPrefs = next;
  }
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

function subscribeLayout(cb: () => void): () => void {
  window.addEventListener(LAYOUT_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(LAYOUT_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useLayoutPrefs(): LayoutPrefs {
  return useSyncExternalStore(subscribeLayout, readLayout, () => DEFAULT_LAYOUT);
}

/** Requête média suivie en direct ; `fallback` quand `matchMedia` manque (rendu hors navigateur). */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== 'function') return () => {};
      const mql = matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : fallback),
    () => fallback,
  );
}
