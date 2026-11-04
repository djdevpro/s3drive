import { useThrottledValue } from '@tanstack/react-pacer';
import type { ConflictChoice, UploadItemView, UploadSnapshot } from '@ud/sdk/upload';
import type { UploadPanelItem, UploadPanelProps } from '@ud/ui';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getUploadQueue, type AddOptions, type FolderResult, type ReselectResult, type UploadQueue, type UploadTarget } from './queue';

// Hooks React de la file d'envoi : état lu par `useSyncExternalStore`, rendu au plus 4 fois par
// seconde (TanStack Pacer), actions liées à la file de la connexion.

export interface UseUploadQueue {
  queue: UploadQueue;
  items: UploadItemView[];
  totals: UploadSnapshot['totals'];
  addFiles: (files: FileList | readonly File[], target: UploadTarget, options?: AddOptions) => string[];
  addFolderInput: (list: FileList | readonly File[], target: UploadTarget, options?: AddOptions) => Promise<FolderResult>;
  /** À appeler dans le gestionnaire `drop`, sans `await` avant. */
  addDataTransfer: (dataTransfer: DataTransfer, target: UploadTarget, options?: AddOptions) => Promise<FolderResult>;
  reselect: (files: FileList | readonly File[]) => ReselectResult;
  pause: (id: string) => void;
  resume: (id: string) => void;
  retry: (id: string) => void;
  cancel: (id: string) => Promise<void>;
  resolveConflict: (id: string, choice: Exclude<ConflictChoice, 'ask'>, all?: boolean) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  retryAll: () => void;
  cancelAll: () => Promise<void>;
  clearFinished: () => Promise<void>;
}

/** File d'envoi de la connexion `connection` (une par onglet), état limité à 4 rendus par seconde. */
export function useUploadQueue(connection: string, queue?: UploadQueue): UseUploadQueue {
  const q = useMemo(() => queue ?? getUploadQueue(connection), [connection, queue]);
  const live = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  const [snapshot] = useThrottledValue(live, { wait: 250, leading: true, trailing: true });
  return useMemo(
    () => ({
      queue: q,
      items: snapshot.items,
      totals: snapshot.totals,
      addFiles: (files, target, options) => q.addFiles(files, target, options),
      addFolderInput: (list, target, options) => q.addFolderInput(list, target, options),
      addDataTransfer: (dataTransfer, target, options) => q.addDataTransfer(dataTransfer, target, options),
      reselect: (files) => q.reselect(files),
      pause: q.pause,
      resume: q.resume,
      retry: q.retry,
      cancel: q.cancel,
      resolveConflict: q.resolveConflict,
      pauseAll: q.pauseAll,
      resumeAll: q.resumeAll,
      retryAll: q.retryAll,
      cancelAll: q.cancelAll,
      clearFinished: q.clearFinished,
    }),
    [q, snapshot],
  );
}

/** Lignes du panneau à partir de l'état du moteur ; `folderLabel` : dossier affiché (« Mon drive / Docs »). */
export function toPanelItems(items: readonly UploadItemView[], folderLabel?: (item: UploadItemView) => string | undefined): UploadPanelItem[] {
  return items.map((item) => {
    const row: UploadPanelItem = { id: item.id, name: item.name, size: item.size, sent: item.sent, state: item.state, speed: item.speed, remainingMs: item.remainingMs };
    const folder = folderLabel?.(item);
    if (folder) row.folder = folder;
    if (item.contentType) row.contentType = item.contentType;
    if (item.error) row.error = item.error;
    return row;
  });
}

export interface UseUploadPanelOptions {
  folderLabel?: (item: UploadItemView) => string | undefined;
  /** « Afficher dans le dossier » : l'hôte navigue vers le dossier avec `?focus=<nom>`. */
  onShowInFolder?: (item: UploadItemView) => void;
  /** Fichier à resélectionner (`needs_file`) : l'hôte ouvre un sélecteur puis appelle `reselect`. */
  onReselect?: (item: UploadItemView) => void;
}

/** Props prêtes pour `<UploadPanel {...props} />` (callbacks branchés sur la file). */
export function useUploadPanel(connection: string, options: UseUploadPanelOptions = {}, queue?: UploadQueue): Pick<
  UploadPanelProps,
  'items' | 'onPause' | 'onResume' | 'onCancel' | 'onRetry' | 'onResolveConflict' | 'onPauseAll' | 'onResumeAll' | 'onCancelAll' | 'onClearFinished' | 'onShowInFolder' | 'onReselect'
> {
  const api = useUploadQueue(connection, queue);
  const { folderLabel, onShowInFolder, onReselect } = options;
  const byId = useCallback((id: string) => api.items.find((i) => i.id === id), [api.items]);
  const items = useMemo(() => toPanelItems(api.items, folderLabel), [api.items, folderLabel]);
  return {
    items,
    onPause: api.pause,
    onResume: api.resume,
    onCancel: (id) => void api.cancel(id),
    onRetry: api.retry,
    onResolveConflict: (id, choice) => api.resolveConflict(id, choice),
    onPauseAll: api.pauseAll,
    onResumeAll: api.resumeAll,
    onCancelAll: () => void api.cancelAll(),
    onClearFinished: () => void api.clearFinished(),
    ...(onShowInFolder
      ? {
          onShowInFolder: (id: string) => {
            const item = byId(id);
            if (item) onShowInFolder(item);
          },
        }
      : {}),
    ...(onReselect
      ? {
          onReselect: (id: string) => {
            const item = byId(id);
            if (item) onReselect(item);
          },
        }
      : {}),
  };
}
