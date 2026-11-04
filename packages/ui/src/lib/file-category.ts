/**
 * Catégorie d'un élément (extensions : annexe A).
 * Ordre : bucket, dossier, nom complet connu, extension connue (`.ts` + `video/mp2t` → vidéo),
 * puis Content-Type spécifique, sinon `unknown`. L'extension passe avant le type MIME, car
 * ListObjectsV2 ne renvoie pas de Content-Type : la même icône partout, sans changement après un HEAD.
 */

export const FILE_CATEGORIES = [
  'folder',
  'bucket',
  'image',
  'video',
  'audio',
  'pdf',
  'text',
  'code',
  'sheet',
  'slides',
  'doc',
  'archive',
  'font',
  '3d',
  'exec',
  'unknown',
] as const;

export type FileCategory = (typeof FILE_CATEGORIES)[number];

type FileKind = Exclude<FileCategory, 'folder' | 'bucket' | 'unknown'>;

const EXTENSIONS: Record<FileKind, string> = {
  image: 'png jpg jpeg jpe gif webp avif heic heif bmp tif tiff svg ico jxl dng cr2 cr3 nef arw orf rw2 raf psd xcf',
  video: 'mp4 m4v mov webm mkv avi wmv flv mpg mpeg 3gp m2ts mts m3u8 ogv',
  audio: 'mp3 m4a aac flac wav ogg oga opus wma aiff aif mid midi amr',
  pdf: 'pdf',
  text: 'txt md markdown rtf log ini cfg conf nfo srt vtt',
  code:
    'js mjs cjs ts tsx jsx json jsonc json5 yaml yml toml xml html htm css scss sass less py rb go rs java kt kts c h cpp cc hpp cs php sh bash zsh fish ps1 bat cmd sql graphql gql proto tf tfvars hcl vue svelte lua swift dart r scala pl ex exs erl clj vim gradle ipynb',
  sheet: 'xls xlsx xlsm xlsb ods csv tsv numbers',
  slides: 'ppt pptx pptm odp key',
  doc: 'doc docx docm odt pages epub wpd',
  archive: 'zip rar 7z tar gz tgz bz2 tbz2 xz txz zst lz4 lzma iso dmg cab tar.gz tar.bz2 tar.xz tar.zst',
  font: 'ttf otf woff woff2 eot',
  '3d': 'stl obj fbx gltf glb 3mf step stp iges blend dae usdz ply',
  exec: 'exe msi com apk aab ipa deb rpm appimage jar bin run so dll dylib wasm pkg',
};

/** Noms complets connus, comparés sans tenir compte de la casse. */
const KNOWN_NAMES: Record<string, FileKind> = {
  readme: 'text',
  license: 'text',
  changelog: 'text',
  authors: 'text',
  '.env': 'text',
  '.env.local': 'text',
  '.env.example': 'text',
  '.gitignore': 'text',
  '.gitattributes': 'text',
  '.dockerignore': 'text',
  '.editorconfig': 'text',
  '.npmrc': 'text',
  dockerfile: 'code',
  makefile: 'code',
  jenkinsfile: 'code',
  vagrantfile: 'code',
};

const BY_EXTENSION = new Map<string, FileKind>(
  (Object.entries(EXTENSIONS) as [FileKind, string][]).flatMap(([cat, list]) => list.split(' ').map((ext) => [ext, cat] as const)),
);

/** Doubles suffixes reconnus. */
const DOUBLE_SUFFIXES = ['tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst'];

/** Types MIME exacts, puis préfixes (`image/*`…). */
const MIME_EXACT: Record<string, FileKind> = {
  'application/pdf': 'pdf',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/rtf': 'text',
  'text/html': 'code',
  'text/css': 'code',
  'text/javascript': 'code',
  'application/json': 'code',
  'application/xml': 'code',
  'text/xml': 'code',
  'application/yaml': 'code',
  'application/x-sh': 'code',
  'application/sql': 'code',
  'application/toml': 'code',
  'text/csv': 'sheet',
  'text/tab-separated-values': 'sheet',
  'application/vnd.ms-excel': 'sheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'sheet',
  'application/vnd.ms-powerpoint': 'slides',
  'application/vnd.oasis.opendocument.presentation': 'slides',
  'application/msword': 'doc',
  'application/vnd.oasis.opendocument.text': 'doc',
  'application/epub+zip': 'doc',
  'application/zip': 'archive',
  'application/x-7z-compressed': 'archive',
  'application/x-tar': 'archive',
  'application/gzip': 'archive',
  'application/vnd.rar': 'archive',
  'application/zstd': 'archive',
  'application/x-bzip2': 'archive',
  'application/x-xz': 'archive',
  'application/x-iso9660-image': 'archive',
  'application/x-apple-diskimage': 'archive',
  'application/vnd.ms-fontobject': 'font',
  'application/vnd.microsoft.portable-executable': 'exec',
  'application/x-msdownload': 'exec',
  'application/x-msi': 'exec',
  'application/vnd.android.package-archive': 'exec',
  'application/x-executable': 'exec',
  'application/wasm': 'exec',
  'application/java-archive': 'exec',
};

const MIME_PREFIX: [string, FileKind][] = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['font/', 'font'],
  ['model/', '3d'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.', 'sheet'],
  ['application/vnd.openxmlformats-officedocument.presentationml.', 'slides'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.', 'doc'],
];

/** Types sans valeur informative : ignorés (étape 4). */
const GENERIC_MIME = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/x-www-form-urlencoded',
  'application/download',
  'application/force-download',
]);

/** Dernier segment d'une clé S3 (le `/` final d'un dossier est retiré). */
export function baseName(key: string): string {
  const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/**
 * Extension en minuscules, double suffixe compris (« tar.gz ») ; vide pour « .env », « README »
 * ou une clé terminée par un point.
 */
export function fileExtension(name: string): string {
  const base = baseName(name).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  for (const ds of DOUBLE_SUFFIXES) {
    if (base.endsWith(`.${ds}`) && base.length > ds.length + 1) return ds;
  }
  return base.slice(dot + 1);
}

function categoryFromMime(contentType: string): FileKind | null {
  const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  if (!mime || GENERIC_MIME.has(mime)) return null;
  const exact = MIME_EXACT[mime];
  if (exact) return exact;
  for (const [prefix, cat] of MIME_PREFIX) if (mime.startsWith(prefix)) return cat;
  return null;
}

export interface FileCategoryOptions {
  isFolder?: boolean;
  isBucket?: boolean;
}

/**
 * Catégorie d'un élément d'après son nom (ou sa clé) et, à défaut d'extension connue, son Content-Type.
 * Une clé terminée par `/` est un dossier.
 */
export function fileCategory(name: string, contentType?: string | null, options: FileCategoryOptions = {}): FileCategory {
  if (options.isBucket) return 'bucket';
  if (options.isFolder || name.endsWith('/')) return 'folder';
  const base = baseName(name);
  const known = KNOWN_NAMES[base.toLowerCase()];
  if (known) return known;
  const ext = fileExtension(base);
  const mimeCat = contentType ? categoryFromMime(contentType) : null;
  if (ext) {
    // Seule exception à « l'extension d'abord » : flux de transport MPEG.
    if (ext === 'ts' && mimeCat === 'video') return 'video';
    const byExt = BY_EXTENSION.get(ext);
    if (byExt) return byExt;
  }
  return mimeCat ?? 'unknown';
}

/** Couleurs de dossiers : l'id est stocké, jamais la valeur ; id inconnu → `neutral`. */
export const FOLDER_COLORS = ['neutral', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

export function folderColorOf(id: string | null | undefined): FolderColor {
  return (FOLDER_COLORS as readonly string[]).includes(id ?? '') ? (id as FolderColor) : 'neutral';
}
