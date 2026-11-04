import { isIgnoredPath } from '@ud/sdk/upload';

// Sources d'un envoi : sélection de fichiers, sélecteur de dossier
// (`webkitdirectory`, chemins par `webkitRelativePath`) et glisser-déposer (`webkitGetAsEntry`,
// parcours récursif). Énumération par lots de 200 avec cession au navigateur.

export interface SourceFile {
  file: File;
  /** Chemin relatif au dépôt (`Photos/2024/a.jpg`), `/` comme séparateur. */
  relPath: string;
}

export interface Enumeration {
  files: SourceFile[];
  /** Dossiers vides (connus par le dépôt seulement), chemins relatifs avec `/` final. */
  emptyFolders: string[];
  /** Fichiers système écartés. */
  ignored: number;
  /** Sous-dossiers ou fichiers illisibles (`local.file_unreadable`). */
  unreadable: string[];
  /** Dossiers de premier niveau du dépôt (un groupe chacun). */
  roots: string[];
}

const BATCH = 200;

/** Cède la main au navigateur entre deux lots. */
export function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function empty(): Enumeration {
  return { files: [], emptyFolders: [], ignored: 0, unreadable: [], roots: [] };
}

function push(out: Enumeration, file: File, relPath: string): void {
  if (isIgnoredPath(relPath)) out.ignored += 1;
  else out.files.push({ file, relPath });
}

function rootOf(relPath: string): string | null {
  const slash = relPath.indexOf('/');
  return slash > 0 ? relPath.slice(0, slash) : null;
}

/**
 * Fichiers d'un `<input type="file">` : avec `webkitdirectory`, `webkitRelativePath` donne le chemin
 * (dossier choisi compris) ; sinon chaque fichier est à la racine.
 */
export async function fromFileList(list: FileList | readonly File[]): Promise<Enumeration> {
  const out = empty();
  const files = Array.from(list);
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!;
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    push(out, file, rel);
    const root = rootOf(rel);
    if (root && !out.roots.includes(root)) out.roots.push(root);
    if ((i + 1) % BATCH === 0) await yieldToBrowser();
  }
  return out;
}

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries renvoie au plus 100 entrées par appel (Chromium) : on boucle jusqu'au tableau vide.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/**
 * Entrées d'un dépôt. Les entrées doivent être lues **de façon synchrone** dans le gestionnaire
 * `drop` (`entriesOfDataTransfer`), avant tout `await` : le `DataTransfer` n'est plus lisible ensuite.
 */
export async function fromEntries(entries: readonly FileSystemEntry[]): Promise<Enumeration> {
  const out = empty();
  let count = 0;
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      try {
        push(out, await fileOf(entry as FileSystemFileEntry), path);
      } catch {
        out.unreadable.push(path);
      }
      count += 1;
      if (count % BATCH === 0) await yieldToBrowser();
      return;
    }
    let children: FileSystemEntry[];
    try {
      children = await readAll((entry as FileSystemDirectoryEntry).createReader());
    } catch {
      out.unreadable.push(`${path}/`);
      return;
    }
    if (children.length === 0) {
      out.emptyFolders.push(`${path}/`);
      return;
    }
    for (const child of children) await walk(child, `${path}/${child.name}`);
  };
  for (const entry of entries) {
    if (entry.isDirectory && !out.roots.includes(entry.name)) out.roots.push(entry.name);
    await walk(entry, entry.name);
  }
  return out;
}

/** Lecture synchrone des entrées d'un `DataTransfer` (à appeler dans `drop`, avant tout `await`). */
export function entriesOfDataTransfer(dataTransfer: DataTransfer): { entries: FileSystemEntry[]; files: File[] } {
  const entries: FileSystemEntry[] = [];
  const files: File[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (entries.length === 0 && files.length === 0) files.push(...Array.from(dataTransfer.files ?? []));
  return { entries, files };
}
