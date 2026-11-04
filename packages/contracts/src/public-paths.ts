import { ACCESS_TOKEN_PREFIX, readBearerToken } from './auth.js';
import { API_PREFIX } from './http.js';

/**
 * Chemins hors passerelle d'accès : ils gardent leurs propres contrôles.
 * Motif `/x/*` = tout chemin sous `/x/` ; sinon correspondance exacte.
 * `/oauth/authorize` et `/oauth/consent/*` restent derrière la passerelle.
 * S'y ajoute toute requête `/api/v1/*` portant `Authorization: Bearer ud_at_…` (voir `isPublicPath`).
 */
export const PUBLIC_PATHS = [
  '/s/*',
  '/receive/*',
  '/api/v1/public/*',
  // Mode instance : description publique de l'instance et connexion OIDC.
  '/api/v1/instance',
  '/api/v1/auth/oidc/*',
  '/mcp',
  '/mcp/stdio.mjs',
  '/.well-known/*',
  '/oauth/token',
  '/oauth/revoke',
  '/healthz',
  '/robots.txt',
  '/assets/*',
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icons/*',
] as const;

export type HeaderSource =
  | { get(name: string): string | null }
  | Record<string, string | readonly string[] | undefined>;

function readHeader(headers: HeaderSource, name: string): string | null {
  if (typeof headers.get === 'function') {
    return (headers as { get(name: string): string | null }).get(name);
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string | readonly string[] | undefined>)) {
    if (key.toLowerCase() !== lower || value === undefined) continue;
    // Plusieurs en-têtes Authorization : refus.
    if (typeof value === 'string') return value;
    return value.length === 1 ? (value[0] ?? null) : null;
  }
  return null;
}

// Refus par défaut des chemins ambigus (segments `.`/`..`, `//`, encodages de `.`, `/` ou `\`).
const AMBIGUOUS_PATH = /(^|\/)\.{1,2}(\/|$)|\/\/|\\|%2e|%2f|%5c/i;

function matchesPattern(pathname: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -1);
    return pathname.startsWith(base) && pathname.length > base.length;
  }
  return pathname === pattern;
}

/**
 * Vrai si la requête doit passer sans la passerelle d'accès. `pathname` peut contenir une requête
 * (`?…`), ignorée. Un chemin ambigu n'est jamais public.
 */
export function isPublicPath(pathname: string, headers?: HeaderSource): boolean {
  const path = pathname.split(/[?#]/, 1)[0] ?? '';
  if (!path.startsWith('/') || AMBIGUOUS_PATH.test(path)) return false;
  if (PUBLIC_PATHS.some((pattern) => matchesPattern(path, pattern))) return true;
  if (headers && path.startsWith(`${API_PREFIX}/`)) {
    const token = readBearerToken(readHeader(headers, 'Authorization'));
    return token !== null && token.startsWith(ACCESS_TOKEN_PREFIX);
  }
  return false;
}
