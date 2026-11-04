import { createS3, MULTIPART, type CreateS3Options, type UdS3 } from '@ud/s3';
import type { InstanceConfig } from './config.js';

// Adaptateur des stockages du fichier vers le moteur @ud/s3 : un client par stockage.
// Les identifiants ne quittent jamais ce module autrement que vers le moteur.

export interface MultipartLimits {
  minPartSize: number;
  maxPartSize: number;
  maxParts: number;
  choosePartSize(totalSize: number): number;
}

/** Fabrique injectable (le faux S3 des tests la remplace). */
export interface S3Factory {
  create(options: CreateS3Options): UdS3;
  multipart: MultipartLimits;
}

export const defaultS3Factory: S3Factory = {
  create: (options) => createS3(options),
  get multipart() {
    return MULTIPART;
  },
};

export interface StorageOptions {
  timeoutMs?: number;
  maxSockets?: number;
  allowPrivate?: boolean;
  allowedEndpoints?: string[];
}

export class InstanceStorages {
  private readonly clients = new Map<string, UdS3>();

  constructor(
    config: InstanceConfig,
    readonly factory: S3Factory,
    options: StorageOptions = {},
  ) {
    for (const storage of config.storages.values()) {
      this.clients.set(
        storage.slug,
        factory.create({
          endpoint: storage.endpoint,
          region: storage.region,
          addressing: storage.addressing,
          credentials: {
            accessKeyId: storage.accessKeyId,
            secretAccessKey: storage.secretAccessKey,
            ...(storage.sessionToken ? { sessionToken: storage.sessionToken } : {}),
          },
          ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.maxSockets ? { maxSockets: options.maxSockets } : {}),
          ...(options.allowPrivate !== undefined ? { allowPrivate: options.allowPrivate } : {}),
          ...(options.allowedEndpoints?.length ? { allowedEndpoints: options.allowedEndpoints } : {}),
        }),
      );
    }
  }

  get(slug: string): UdS3 {
    const client = this.clients.get(slug);
    if (!client) throw new Error(`Unknown storage ${slug}`);
    return client;
  }

  get multipart(): MultipartLimits {
    return this.factory.multipart;
  }

  destroy(): void {
    for (const client of this.clients.values()) client.destroy();
    this.clients.clear();
  }
}
