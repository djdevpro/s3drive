import type { UploadRecord, UploadStore } from '@ud/sdk/upload';
import { Dexie, type EntityTable } from 'dexie';

// Persistance Dexie de la file d'envoi (base `ud-c-<connId>`, table précieuse `uploads`,
// clé `id`, index `state` et `updatedAt`). Les poignées de fichiers (Chromium) sont clonées telles
// quelles dans IndexedDB ; aucune URL signée n'y est écrite (elles ne sont pas dans l'enregistrement).

/** Version du schéma de cette base pour la table `uploads` ; les autres tables d'08 s'ajouteront en montant la version. */
export const UPLOADS_SCHEMA_VERSION = 1;

export type UploadsDatabase = Dexie & { uploads: EntityTable<UploadRecord, 'id'> };

const databases = new Map<string, UploadsDatabase>();

/** Base de la connexion `connId` (une instance par onglet). */
export function connectionDatabase(connId: string): UploadsDatabase {
  let db = databases.get(connId);
  if (!db) {
    db = new Dexie(`ud-c-${connId}`) as UploadsDatabase;
    db.version(UPLOADS_SCHEMA_VERSION).stores({ uploads: 'id, state, updatedAt' });
    databases.set(connId, db);
  }
  return db;
}

/** `UploadStore` du moteur sur la table `uploads`. */
export class DexieUploadStore implements UploadStore {
  constructor(private readonly db: UploadsDatabase) {}

  async list(): Promise<UploadRecord[]> {
    return this.db.uploads.toArray();
  }

  async put(record: UploadRecord): Promise<void> {
    await this.db.uploads.put(record);
  }

  async delete(id: string): Promise<void> {
    await this.db.uploads.delete(id);
  }
}

/** IndexedDB disponible (absente en navigation privée de certains navigateurs et sous jsdom). */
export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}
