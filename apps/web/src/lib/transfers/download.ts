import { keyName, type DownloadResponse } from '@ud/contracts';
import { InstanceUploadTransport } from '@ud/sdk/upload';

// Téléchargement d'un fichier : `GET …/download` renvoie une URL présignée d'une heure
// avec `Content-Disposition: attachment`, ouverte par navigation (lien caché) : aucun CORS requis.
// L'URL n'est jamais journalisée ni conservée.

export interface DownloadOptions {
  filename?: string;
  versionId?: string;
  /** Transport à utiliser (tests) ; défaut : même origine. */
  transport?: Pick<InstanceUploadTransport, 'download'>;
  /** Déclencheur (tests) ; défaut : lien `<a download>` caché. */
  open?: (url: string, filename: string) => void;
}

function clickHidden(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
}

/** Télécharge `key` de l'espace `bucket` de la connexion `connection`. */
export async function downloadFile(connection: string, bucket: string, key: string, options: DownloadOptions = {}): Promise<DownloadResponse> {
  const transport = options.transport ?? new InstanceUploadTransport({ connection });
  const filename = options.filename ?? keyName(key);
  const response = await transport.download(bucket, key, { filename, ...(options.versionId ? { versionId: options.versionId } : {}) });
  (options.open ?? clickHidden)(response.url, filename);
  return response;
}

/** Lien direct (`?redirect=1`) : pour « Copier le lien de téléchargement » ou un `<a href>` simple. */
export function downloadHref(connection: string, bucket: string, key: string, filename?: string): string {
  return new InstanceUploadTransport({ connection }).downloadHref(bucket, key, { filename: filename ?? keyName(key) });
}
