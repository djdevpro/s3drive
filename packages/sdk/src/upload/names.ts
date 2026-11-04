// Noms et clés des envois. `nextFreeName` doit rejoindre
// `@ud/contracts` ; il vit ici en attendant, avec la même règle.

const COMPOUND_EXTENSIONS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst'];
/** Plafond d'essais de `nextFreeName` (au-delà : `conflict` motif `no_free_name`). */
export const MAX_FREE_NAME_ATTEMPTS = 1000;

/** Base et extension d'un nom de fichier ; `.env` n'a pas d'extension, `a.tar.gz` garde `.tar.gz`. */
export function splitName(name: string): { base: string; ext: string } {
  const lower = name.toLowerCase();
  for (const ext of COMPOUND_EXTENSIONS) {
    if (lower.endsWith(ext) && name.length > ext.length) return { base: name.slice(0, -ext.length), ext: name.slice(-ext.length) };
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Candidats successifs pour un nom pris : `nom (1).ext`, `nom (2).ext`… ; un nom qui finit déjà
 * par ` (n)` repart de `n + 1`. Un dossier (`/` final) devient `Dossier (1)/`.
 */
export function* freeNameCandidates(name: string): Generator<string> {
  const folder = name.endsWith('/');
  const bare = folder ? name.slice(0, -1) : name;
  const { base, ext } = folder ? { base: bare, ext: '' } : splitName(bare);
  const numbered = /^(.*) \((\d+)\)$/.exec(base);
  const stem = numbered ? numbered[1]! : base;
  let n = numbered ? Number(numbered[2]) + 1 : 1;
  for (let i = 0; i < MAX_FREE_NAME_ATTEMPTS; i += 1, n += 1) {
    yield `${stem} (${n})${ext}${folder ? '/' : ''}`;
  }
}

/** Premier nom libre selon `taken` (comparaison en NFC). */
export function nextFreeName(name: string, taken: Iterable<string>): string | null {
  const set = new Set([...taken].map((t) => t.normalize('NFC')));
  if (!set.has(name.normalize('NFC'))) return name;
  for (const candidate of freeNameCandidates(name)) {
    if (!set.has(candidate.normalize('NFC'))) return candidate;
  }
  return null;
}

/** Remplace le dernier segment d'une clé. */
export function withName(key: string, name: string): string {
  const slash = key.lastIndexOf('/');
  return slash < 0 ? name : `${key.slice(0, slash + 1)}${name}`;
}

/** Dernier segment d'une clé de fichier. */
export function nameOf(key: string): string {
  const slash = key.lastIndexOf('/');
  return slash < 0 ? key : key.slice(slash + 1);
}

/** Fichiers système ignorés par défaut. */
const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const IGNORED_FOLDERS = new Set(['.spotlight-v100', '.trashes']);

export function isIgnoredPath(relPath: string): boolean {
  const segments = relPath.split('/');
  const name = segments[segments.length - 1] ?? '';
  if (IGNORED_NAMES.has(name.toLowerCase()) || name.startsWith('~$') || name.startsWith('._')) return true;
  return segments.slice(0, -1).some((s) => IGNORED_FOLDERS.has(s.toLowerCase()));
}

/**
 * Clé cible d'un fichier : préfixe du dossier de destination + chemin relatif, chaque segment en NFC
 *, séparateur `/`. `prefix` vaut `''` (racine) ou finit par `/`.
 */
export function joinKey(prefix: string, relPath: string): string {
  const normalized = relPath
    .split('/')
    .filter((s) => s !== '')
    .map((s) => s.normalize('NFC'))
    .join('/');
  const base = prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`;
  return `${base}${normalized}`;
}
