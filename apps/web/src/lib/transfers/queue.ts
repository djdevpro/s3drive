import {
  InstanceUploadTransport,
  MemoryUploadStore,
  UploadEngine,
  joinKey,
  type ConflictChoice,
  type UploadEngineOptions,
  type UploadItemView,
  type UploadRecord,
  type UploadSnapshot,
  type UploadStore,
  type UploadTransport,
} from '@ud/sdk/upload';
import { DexieUploadStore, connectionDatabase, hasIndexedDb } from './db';
import { entriesOfDataTransfer, fromEntries, fromFileList, yieldToBrowser, type Enumeration, type SourceFile } from './sources';

// File d'envoi d'une connexion : moteur `@ud/sdk/upload`, persistance
// Dexie, reprise au rechargement, dossiers avec leur arborescence, avertissement avant de quitter.

/** Destination d'un envoi : espace (bucket) et dossier (`''` = racine, sinon `/` final). */
export interface UploadTarget {
  bucket: string;
  prefix: string;
}

export interface AddOptions {
  /** Conduite en cas de nom pris ; défaut `ask` (état `conflict`, choix dans le panneau). */
  conflict?: ConflictChoice;
}

export interface FolderResult {
  ids: string[];
  /** Un groupe par dossier de premier niveau. */
  groups: string[];
  ignored: number;
  unreadable: string[];
  emptyFolders: string[];
}

export interface ReselectResult {
  matched: string[];
  unmatched: File[];
}

export interface UploadQueueOptions {
  connection: string;
  transport?: UploadTransport & { createFolder?: (bucket: string, key: string) => Promise<void> };
  store?: UploadStore;
  /** Options du moteur (tests : `sender`, `sleep`, `network`…). */
  engine?: Omit<UploadEngineOptions, 'transport' | 'store'>;
  /** Avertissement `beforeunload` pendant un envoi ; défaut : oui dans un navigateur. */
  guardUnload?: boolean;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Poignée File System Access déjà autorisée → fichier, sans geste. */
async function fileFromHandle(record: UploadRecord): Promise<Blob | null> {
  if (record.source.kind !== 'handle') return null;
  const handle = record.source.handle as {
    queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
    getFile?: () => Promise<File>;
  };
  try {
    if (!handle.getFile) return null;
    if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) !== 'granted') return null;
    const file = await handle.getFile();
    return file.size === record.size && file.lastModified === record.lastModified ? file : null;
  } catch {
    return null;
  }
}

const RUNNING = new Set(['queued', 'uploading', 'completing', 'waiting_network']);

export class UploadQueue {
  readonly connection: string;
  readonly engine: UploadEngine;
  readonly transport: UploadQueueOptions['transport'] & UploadTransport;
  /** Résolu quand la file persistée est relue. */
  readonly ready: Promise<void>;
  readonly #unsubscribe: Array<() => void> = [];

  constructor(options: UploadQueueOptions) {
    this.connection = options.connection;
    this.transport = options.transport ?? new InstanceUploadTransport({ connection: options.connection });
    const store = options.store ?? (hasIndexedDb() ? new DexieUploadStore(connectionDatabase(options.connection)) : new MemoryUploadStore());
    this.engine = new UploadEngine({ resolveFile: fileFromHandle, ...options.engine, transport: this.transport, store });
    this.ready = this.engine.restore().catch(() => {});
    if (options.guardUnload ?? typeof window !== 'undefined') this.#guardUnload();
  }

  subscribe = (listener: () => void): (() => void) => this.engine.subscribe(listener);
  getSnapshot = (): UploadSnapshot => this.engine.getSnapshot();

  /** Fichiers isolés vers un dossier. */
  addFiles(files: FileList | readonly File[], target: UploadTarget, options: AddOptions = {}): string[] {
    return this.engine.add(
      Array.from(files).map((file) => ({
        file,
        bucket: target.bucket,
        key: joinKey(target.prefix, file.name),
        name: file.name.normalize('NFC'),
        lastModified: file.lastModified,
        ...(options.conflict ? { conflict: options.conflict } : {}),
      })),
    );
  }

  /** Dossier choisi par `<input webkitdirectory>` : l'arborescence devient des clés relatives. */
  async addFolderInput(list: FileList | readonly File[], target: UploadTarget, options: AddOptions = {}): Promise<FolderResult> {
    return this.#addEnumeration(await fromFileList(list), target, options);
  }

  /**
   * Dépôt : appeler **dans** le gestionnaire `drop` (lecture synchrone des entrées), sans `await` avant.
   * Fichiers et dossiers mêlés ; les dossiers vides reçoivent un marqueur.
   */
  addDataTransfer(dataTransfer: DataTransfer, target: UploadTarget, options: AddOptions = {}): Promise<FolderResult> {
    const { entries, files } = entriesOfDataTransfer(dataTransfer);
    return this.addEntries(entries, target, options, files);
  }

  /** Entrées déjà lues (`webkitGetAsEntry`) et fichiers sans entrée. */
  async addEntries(entries: readonly FileSystemEntry[], target: UploadTarget, options: AddOptions = {}, looseFiles: readonly File[] = []): Promise<FolderResult> {
    const enumeration = await fromEntries(entries);
    for (const file of looseFiles) enumeration.files.push({ file, relPath: file.name });
    return this.#addEnumeration(enumeration, target, options);
  }

  async #addEnumeration(enumeration: Enumeration, target: UploadTarget, options: AddOptions): Promise<FolderResult> {
    const groups = new Map<string, string>();
    for (const root of enumeration.roots) groups.set(root, newId());
    const ids: string[] = [];
    // Création des enregistrements par lots de 200.
    for (let i = 0; i < enumeration.files.length; i += 200) {
      const batch = enumeration.files.slice(i, i + 200);
      ids.push(...this.engine.add(batch.map((source) => this.#input(source, target, groups, options))));
      if (i + 200 < enumeration.files.length) await yieldToBrowser();
    }
    if (this.transport.createFolder) {
      for (const folder of enumeration.emptyFolders) {
        await this.transport.createFolder(target.bucket, joinKey(target.prefix, folder) + '/').catch(() => {});
      }
    }
    return { ids, groups: [...groups.values()], ignored: enumeration.ignored, unreadable: enumeration.unreadable, emptyFolders: enumeration.emptyFolders };
  }

  #input(source: SourceFile, target: UploadTarget, groups: Map<string, string>, options: AddOptions) {
    const root = source.relPath.includes('/') ? source.relPath.slice(0, source.relPath.indexOf('/')) : null;
    const groupId = root ? groups.get(root) : undefined;
    const key = joinKey(target.prefix, source.relPath);
    return {
      file: source.file,
      bucket: target.bucket,
      key,
      relPath: source.relPath.normalize('NFC'),
      lastModified: source.file.lastModified,
      ...(groupId ? { groupId } : {}),
      ...(options.conflict ? { conflict: options.conflict } : {}),
    };
  }

  /**
   * Nouvelle sélection après rechargement : appariement par chemin relatif, sinon par
   * nom, puis taille et date. Les fichiers sans correspondance sont rendus à l'appelant.
   */
  reselect(files: FileList | readonly File[]): ReselectResult {
    const waiting = this.getSnapshot().items.filter((i) => i.state === 'needs_file');
    const matched: string[] = [];
    const unmatched: File[] = [];
    for (const file of Array.from(files)) {
      const rel = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || '').normalize('NFC');
      const name = file.name.normalize('NFC');
      const candidates = waiting.filter((i) => !matched.includes(i.id));
      const byPath = rel ? candidates.find((i) => i.relPath === rel || (i.relPath && rel.endsWith(`/${i.relPath}`))) : undefined;
      const byName = candidates.filter((i) => (i.relPath ? i.relPath.split('/').pop() : i.name) === name || i.name === name);
      const ordered = [...(byPath ? [byPath] : []), ...byName];
      const hit = ordered.find((i) => this.engine.attachFile(i.id, file));
      if (hit) matched.push(hit.id);
      else unmatched.push(file);
    }
    return { matched, unmatched };
  }

  attachFile(id: string, file: File): boolean {
    return this.engine.attachFile(id, file);
  }

  pause = (id: string) => this.engine.pause(id);
  resume = (id: string) => this.engine.resume(id);
  retry = (id: string) => this.engine.retry(id);
  cancel = (id: string) => this.engine.cancel(id);
  resolveConflict = (id: string, choice: Exclude<ConflictChoice, 'ask'>, all = false) => this.engine.resolveConflict(id, choice, all);
  pauseAll = () => this.engine.pauseAll();
  resumeAll = () => this.engine.resumeAll();
  retryAll = () => this.engine.retryAll();
  cancelAll = () => this.engine.cancelAll();
  clearFinished = () => this.engine.clearFinished();
  item = (id: string): UploadItemView | undefined => this.engine.get(id);

  /** Vrai tant qu'un envoi part ou attend de partir dans cet onglet. */
  busy(): boolean {
    return this.getSnapshot().items.some((i) => RUNNING.has(i.state));
  }

  #guardUnload(): void {
    if (typeof window === 'undefined') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!this.busy()) return;
      event.preventDefault();
      // Texte fourni par le navigateur.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    this.#unsubscribe.push(() => window.removeEventListener('beforeunload', onBeforeUnload));
  }

  /** Arrête la file de cet onglet sans rien abandonner côté stockage. */
  dispose(): void {
    for (const off of this.#unsubscribe.splice(0)) off();
    this.engine.destroy();
  }
}

const queues = new Map<string, UploadQueue>();

/** File unique d'une connexion pour l'onglet (créée au premier appel, relue depuis Dexie). */
export function getUploadQueue(connection: string, options: Omit<UploadQueueOptions, 'connection'> = {}): UploadQueue {
  let queue = queues.get(connection);
  if (!queue) {
    queue = new UploadQueue({ connection, ...options });
    queues.set(connection, queue);
  }
  return queue;
}

/** Remplace (tests) ou retire la file d'une connexion. */
export function setUploadQueue(connection: string, queue: UploadQueue | null): void {
  const previous = queues.get(connection);
  if (previous && previous !== queue) previous.dispose();
  if (queue) queues.set(connection, queue);
  else queues.delete(connection);
}
