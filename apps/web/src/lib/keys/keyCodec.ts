/*
 * keyCodec — seule source de construction et de lecture des URL d'explorateur.
 *
 * Choix d'encodage, prouvé par src/lib/keys/routing.test.tsx : mode (2).
 * L'encodage du splat par TanStack Router (`<Link to params={{ _splat }}>`) ne coïncide pas avec
 * `toPath()` : il ne produit jamais la forme `~k?key=`, n'encode pas le `~`
 * initial (A7, A8) et traite à part plusieurs caractères. Les liens d'explorateur sont donc des
 * `href` produits par `toPath()`, et la navigation passe par `router.navigate({ href })`
 * (ExplorerLink.tsx, seul fichier concerné). La lecture se fait toujours par `parse()` sur
 * `router.history.location` (identique à `window.location` octet pour octet dans le prototype),
 * jamais par `params._splat`.
 * Deux correctifs sont nécessaires pour que le chemin survive au routeur, sans quoi il le
 * réécrit au chargement ou ignore la navigation :
 * - rewrite.input/output du routeur (shieldExplorerPath ci-dessous) : sans eux, `%7Ek` devient
 *   `~k`, `dossier%20` devient `dossier` ;
 * - état d'historique `udHref` à chaque navigation (ExplorerLink.tsx) : sans lui, `a` → `a/`
 *   est vu comme la même URL et ignoré.
 *
 * Module pur, sans dépendance au routeur ni au DOM : il doit migrer vers @ud/contracts
 * (`links/keyCodec`) pour être partagé avec le serveur et le MCP.
 */

export type ExplorerKind = 'root' | 'folder' | 'file';

export interface ExplorerTarget {
  conn: string;
  bucket: string;
  /** Clé S3 exacte ; '' pour la racine ; un dossier finit par '/'. */
  key: string;
  kind: ExplorerKind;
  version?: string;
}

export type ParsedExplorerUrl = ExplorerTarget | { error: 'malformed' };

/** Nom du segment réservé à la forme de repli. */
export const FALLBACK_SEGMENT = '~k';

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/** Base du bucket, toujours terminée par '/'. */
export function bucketBase(conn: string, bucket: string): string {
  return `/d/${encodeSegment(conn)}/b/${encodeSegment(bucket)}/`;
}

/** Vrai si la clé peut s'écrire dans le chemin ; sinon `toPath` produit `~k?key=`. */
export function isRepresentable(key: string, kind: ExplorerKind): boolean {
  if (kind === 'root') return true;
  if (key.startsWith('/') || key.includes('//')) return false;
  // Un objet dont la clé finit par '/' serait lu comme un dossier.
  if (kind === 'file' && key.endsWith('/')) return false;
  const segments = (kind === 'folder' ? key.slice(0, -1) : key).split('/');
  return !segments.some((s) => s === '.' || s === '..');
}

/** Chemin (et, s'il le faut, chaîne de recherche) sans origine. */
export function toPath(target: ExplorerTarget): string {
  const { conn, bucket, key, kind, version } = target;
  const base = bucketBase(conn, bucket);
  if (kind === 'root') return base;
  if (kind === 'folder' && !key.endsWith('/')) throw new Error('keyCodec: folder key must end with "/"');

  if (!isRepresentable(key, kind)) {
    const params = new URLSearchParams({ key });
    if (kind === 'file' && key.endsWith('/')) params.set('object', '1');
    if (kind === 'file' && version !== undefined) params.set('version', version);
    return `${base}${FALLBACK_SEGMENT}?${params.toString()}`;
  }

  const path = key
    .split('/')
    .map((segment, index) => {
      const encoded = encodeSegment(segment);
      // `~` initial encodé : aucune collision avec `~k` (A7, A8).
      return index === 0 && encoded.startsWith('~') ? `%7E${encoded.slice(1)}` : encoded;
    })
    .join('/');
  const query = kind === 'file' && version !== undefined ? `?${new URLSearchParams({ version }).toString()}` : '';
  return `${base}${path}${query}`;
}

function strictDecode(segment: string): string | undefined {
  try {
    // decodeURIComponent rejette `%` nu, `%ZZ` et l'UTF-8 invalide ; `+` reste `+`.
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * Lit une URL d'explorateur depuis le chemin BRUT (non décodé par le routeur).
 * `/d/c/b/bk` sans '/' final est lu comme la racine : la route redirige vers la forme canonique.
 */
export function parse(rawPathname: string, search = ''): ParsedExplorerUrl {
  const malformed = { error: 'malformed' } as const;
  const match = /^\/d\/([^/]+)\/b\/([^/]+)(\/.*)?$/.exec(rawPathname);
  if (!match) return malformed;
  const conn = strictDecode(match[1] ?? '');
  const bucket = strictDecode(match[2] ?? '');
  if (!conn || !bucket) return malformed;
  const rest = (match[3] ?? '/').slice(1);
  const params = new URLSearchParams(search);

  if (rest === '') return { conn, bucket, key: '', kind: 'root' };

  if (rest === FALLBACK_SEGMENT) {
    const key = params.get('key');
    if (!key) return malformed;
    const isObject = key.endsWith('/') && params.get('object') === '1';
    const kind: ExplorerKind = key.endsWith('/') && !isObject ? 'folder' : 'file';
    return withVersion({ conn, bucket, key, kind }, params);
  }

  const segments: string[] = [];
  for (const raw of rest.split('/')) {
    const decoded = strictDecode(raw);
    if (decoded === undefined) return malformed;
    segments.push(decoded);
  }
  const key = segments.join('/');
  const kind: ExplorerKind = rest.endsWith('/') ? 'folder' : 'file';
  return withVersion({ conn, bucket, key, kind }, params);
}

function withVersion(target: ExplorerTarget, params: URLSearchParams): ExplorerTarget {
  const version = params.get('version');
  return target.kind === 'file' && version !== null ? { ...target, version } : target;
}

/** Clé de montage de la liste d'un dossier. */
export function folderIdentity(conn: string, bucket: string, prefix: string): string {
  return JSON.stringify([conn, bucket, prefix]);
}


/*
 * Passage du chemin brut à travers le routeur (options rewrite.input / rewrite.output).
 * Le routeur décode le chemin par decodeURI (%7E → ~, %20 → espace) puis le recompose par
 * new URL(), qui retire les espaces finaux : il réécrirait %7Ek en ~k, dossier%20 en dossier, et
 * mettrait l'hexadécimal en majuscules. En entrée, chaque % d'une URL d'explorateur devient %25,
 * que decodeURI laisse intact : le routeur voit le chemin brut comme du texte. En sortie,
 * l'opération inverse rend le chemin brut octet pour octet.
 */
const EXPLORER_PREFIX = /^\/d\/[^/]+\/b\//;

export function shieldExplorerPath(pathname: string): string {
  return EXPLORER_PREFIX.test(pathname) ? pathname.replaceAll('%', '%25') : pathname;
}

export function unshieldExplorerPath(pathname: string): string {
  return EXPLORER_PREFIX.test(pathname) ? pathname.replaceAll('%25', '%') : pathname;
}
