import type { UploadRecord, UploadStore } from './types.js';

// Persistance des envois : mémoire (Node, tests) et IndexedDB brut (navigateur, sans dépendance).
// L'appli peut fournir la sienne (Dexie, table `uploads` d'08).

/** Copie profonde d'un enregistrement, la poignée de fichier restant partagée (objet clonable). */
function copy(record: UploadRecord): UploadRecord {
  const { source, ...rest } = record;
  return { ...(JSON.parse(JSON.stringify(rest)) as Omit<UploadRecord, 'source'>), source };
}

export class MemoryUploadStore implements UploadStore {
  readonly #records = new Map<string, UploadRecord>();

  async list(): Promise<UploadRecord[]> {
    return [...this.#records.values()].map(copy);
  }

  async put(record: UploadRecord): Promise<void> {
    this.#records.set(record.id, copy(record));
  }

  async delete(id: string): Promise<void> {
    this.#records.delete(id);
  }

  /** Nombre d'enregistrements (tests). */
  get size(): number {
    return this.#records.size;
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persistance IndexedDB : base `name`, magasin `uploads` (clé `id`, index `state` et `updatedAt`,
 * comme la table `uploads` d'08). À n'utiliser que si l'appli ne fournit pas sa propre base.
 */
export class IndexedDbUploadStore implements UploadStore {
  readonly #name: string;
  #db: Promise<IDBDatabase> | null = null;

  constructor(name = 'ud-uploads', private readonly factory: IDBFactory = globalThis.indexedDB) {
    this.#name = name;
  }

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.#name, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('uploads', { keyPath: 'id' });
        store.createIndex('state', 'state');
        store.createIndex('updatedAt', 'updatedAt');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.#db;
  }

  async #store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.#open();
    return db.transaction('uploads', mode).objectStore('uploads');
  }

  async list(): Promise<UploadRecord[]> {
    return promisify((await this.#store('readonly')).getAll() as IDBRequest<UploadRecord[]>);
  }

  async put(record: UploadRecord): Promise<void> {
    await promisify((await this.#store('readwrite')).put(record));
  }

  async delete(id: string): Promise<void> {
    await promisify((await this.#store('readwrite')).delete(id));
  }
}
