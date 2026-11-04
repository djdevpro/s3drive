import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type ConflictPolicy,
  type ObjectListPage,
  type ObjectOperationResult,
  isFolderKey,
  parentPrefix,
} from '@ud/contracts';
import type { UploadItemView } from '@ud/sdk/upload';
import { useEffect, useRef } from 'react';
import { useDriveClient } from '../client';

/*
 * Requêtes de l'explorateur du mode instance : espaces, listes paginées par
 * `nextCursor` (requête infinie), détails d'un objet, mutations avec invalidation des listes
 * touchées. La suppression est optimiste ; le reste invalide puis relit.
 */

/** Taille d'une page de liste (`UI_PAGE_SIZE`). */
export const LIST_PAGE_SIZE = 500;
/** Fraîcheur des listes. */
export const LIST_STALE_MS = 60_000;

export const objectKeys = {
  all: (conn: string) => ['ud', conn] as const,
  spaces: (conn: string) => ['ud', conn, 'spaces'] as const,
  bucket: (conn: string, bucket: string) => ['ud', conn, 'b', bucket] as const,
  lists: (conn: string, bucket: string) => ['ud', conn, 'b', bucket, 'list'] as const,
  list: (conn: string, bucket: string, prefix: string) => ['ud', conn, 'b', bucket, 'list', prefix] as const,
  object: (conn: string, bucket: string, key: string) => ['ud', conn, 'b', bucket, 'object', key] as const,
  url: (conn: string, bucket: string, key: string, disposition: 'inline' | 'attachment') =>
    ['ud', conn, 'b', bucket, 'url', key, disposition] as const,
};

export type ObjectPages = InfiniteData<ObjectListPage, string | null>;

export function useSpaces(conn: string) {
  const client = useDriveClient();
  return useQuery({
    queryKey: objectKeys.spaces(conn),
    queryFn: () => client.buckets(conn),
    staleTime: LIST_STALE_MS,
  });
}

export function useObjects(conn: string, bucket: string, prefix: string, options: { enabled?: boolean } = {}) {
  const client = useDriveClient();
  return useInfiniteQuery({
    queryKey: objectKeys.list(conn, bucket, prefix),
    queryFn: ({ pageParam }) =>
      client.list(conn, bucket, { prefix, limit: LIST_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ObjectListPage) => last.nextCursor,
    staleTime: LIST_STALE_MS,
    enabled: options.enabled ?? true,
  });
}

export function useObject(conn: string, bucket: string, key: string, options: { enabled?: boolean } = {}) {
  const client = useDriveClient();
  return useQuery({
    queryKey: objectKeys.object(conn, bucket, key),
    queryFn: () => client.object(conn, bucket, key),
    enabled: (options.enabled ?? true) && key !== '' && !isFolderKey(key),
    retry: false,
  });
}

/** URL présignée d'aperçu (15 min) ou de téléchargement ; renouvelée avant expiration. */
export function useObjectUrl(conn: string, bucket: string, key: string, options: { enabled?: boolean; disposition?: 'inline' | 'attachment' } = {}) {
  const client = useDriveClient();
  const disposition = options.disposition ?? 'inline';
  return useQuery({
    queryKey: objectKeys.url(conn, bucket, key, disposition),
    queryFn: () => client.downloadUrl(conn, bucket, key, { disposition }),
    enabled: (options.enabled ?? true) && key !== '' && !isFolderKey(key),
    staleTime: 10 * 60_000,
    gcTime: 12 * 60_000,
    retry: false,
  });
}

/** Invalide la liste d'un dossier et, pour un dossier touché, toutes ses sous-listes. */
export function invalidateFolder(qc: QueryClient, conn: string, bucket: string, prefix: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: objectKeys.list(conn, bucket, prefix) });
}

function forgetSubtree(qc: QueryClient, conn: string, bucket: string, folderKey: string): void {
  qc.removeQueries({
    queryKey: objectKeys.lists(conn, bucket),
    predicate: (query) => {
      const prefix = query.queryKey[5];
      return typeof prefix === 'string' && prefix.startsWith(folderKey);
    },
  });
}

/** Retire des éléments des listes en cache (suppression ou déplacement optimistes). */
export function removeFromLists(qc: QueryClient, conn: string, bucket: string, keys: readonly string[]) {
  const gone = new Set(keys);
  const byParent = new Map<string, string[]>();
  for (const key of keys) {
    const parent = parentPrefix(key);
    byParent.set(parent, [...(byParent.get(parent) ?? []), key]);
  }
  const snapshots: Array<[readonly unknown[], ObjectPages | undefined]> = [];
  for (const parent of byParent.keys()) {
    const queryKey = objectKeys.list(conn, bucket, parent);
    const previous = qc.getQueryData<ObjectPages>(queryKey);
    snapshots.push([queryKey, previous]);
    if (!previous) continue;
    qc.setQueryData<ObjectPages>(queryKey, {
      ...previous,
      pages: previous.pages.map((page) => ({ ...page, items: page.items.filter((item) => !gone.has(item.key)) })),
    });
  }
  return () => {
    for (const [queryKey, data] of snapshots) qc.setQueryData(queryKey, data);
  };
}

export function useCreateFolder(conn: string, bucket: string) {
  const client = useDriveClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => client.createFolder(conn, bucket, key),
    // Dossiers imbriqués (`a/b/`) : plusieurs niveaux peuvent apparaître, toutes les listes de l'espace sont relues.
    onSettled: () => qc.invalidateQueries({ queryKey: objectKeys.lists(conn, bucket) }),
  });
}

export interface RenameVariables {
  key: string;
  newName: string;
  conflict?: ConflictPolicy;
}

export function useRename(conn: string, bucket: string) {
  const client = useDriveClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, newName, conflict = 'fail' }: RenameVariables) => client.rename(conn, bucket, key, { newName, conflict }),
    onSuccess: (_result, { key }) => {
      if (isFolderKey(key)) forgetSubtree(qc, conn, bucket, key);
      qc.removeQueries({ queryKey: objectKeys.object(conn, bucket, key) });
    },
    onSettled: (_result, _error, { key }) => invalidateFolder(qc, conn, bucket, parentPrefix(key)),
  });
}

export interface TransferVariables {
  key: string;
  destination: { bucket: string; key: string };
  conflict?: ConflictPolicy;
}

function useTransfer(conn: string, bucket: string, op: 'move' | 'copy') {
  const client = useDriveClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, destination, conflict = 'fail' }: TransferVariables): Promise<ObjectOperationResult> => {
      const body = { destination: destination.bucket === bucket ? { key: destination.key } : destination, conflict };
      return op === 'move' ? client.move(conn, bucket, key, body) : client.copy(conn, bucket, key, body);
    },
    onSuccess: (_result, { key }) => {
      if (op === 'move' && isFolderKey(key)) forgetSubtree(qc, conn, bucket, key);
    },
    onSettled: (_result, _error, { key, destination }) =>
      Promise.all([
        invalidateFolder(qc, conn, bucket, parentPrefix(key)),
        invalidateFolder(qc, conn, destination.bucket, parentPrefix(destination.key)),
        // L'usage des espaces change (quota).
        qc.invalidateQueries({ queryKey: objectKeys.spaces(conn) }),
      ]),
  });
}

export const useMove = (conn: string, bucket: string) => useTransfer(conn, bucket, 'move');
export const useCopy = (conn: string, bucket: string) => useTransfer(conn, bucket, 'copy');

export function useDelete(conn: string, bucket: string) {
  const client = useDriveClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => client.remove(conn, bucket, key),
    onMutate: async (key) => {
      await qc.cancelQueries({ queryKey: objectKeys.list(conn, bucket, parentPrefix(key)) });
      return { rollback: removeFromLists(qc, conn, bucket, [key]) };
    },
    onError: (_error, _key, context) => context?.rollback(),
    onSuccess: (_result, key) => {
      if (isFolderKey(key)) forgetSubtree(qc, conn, bucket, key);
      qc.removeQueries({ queryKey: objectKeys.object(conn, bucket, key) });
    },
    onSettled: (_result, _error, key) =>
      Promise.all([invalidateFolder(qc, conn, bucket, parentPrefix(key)), qc.invalidateQueries({ queryKey: objectKeys.spaces(conn) })]),
  });
}

/**
 * Invalidation après chaque envoi terminé (08) : liste du dossier de destination,
 * et toutes les listes de l'espace pour un dossier envoyé (sous-dossiers créés). Une seule
 * invalidation par espace et par rendu.
 */
export function useInvalidateOnUploads(conn: string, items: readonly UploadItemView[]): void {
  const qc = useQueryClient();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const buckets = new Map<string, Set<string>>();
    for (const item of items) {
      if (item.state !== 'done' || seen.current.has(item.id)) continue;
      seen.current.add(item.id);
      const set = buckets.get(item.bucket) ?? new Set<string>();
      set.add(item.relPath && item.relPath.includes('/') ? '*' : parentPrefix(item.key));
      buckets.set(item.bucket, set);
    }
    for (const [bucket, prefixes] of buckets) {
      if (prefixes.has('*')) void qc.invalidateQueries({ queryKey: objectKeys.lists(conn, bucket) });
      else for (const prefix of prefixes) void invalidateFolder(qc, conn, bucket, prefix);
    }
    if (buckets.size > 0) void qc.invalidateQueries({ queryKey: objectKeys.spaces(conn) });
  }, [conn, items, qc]);
}
