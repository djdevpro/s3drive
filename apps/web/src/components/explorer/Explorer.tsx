import { useRouter } from '@tanstack/react-router';
import { type ListItem, isFolderKey, keyName, parentPrefix } from '@ud/contracts';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, UploadPanel, cn, formatBytes, toast, useUdTranslation } from '@ud/ui';
import { Upload } from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCopy,
  useCreateFolder,
  useDelete,
  useInvalidateOnUploads,
  useMove,
  useObjects,
  useRename,
  useSpaces,
} from '../../lib/api/queries/objects';
import { navigateHref } from '../../lib/keys/ExplorerLink';
import { folderIdentity } from '../../lib/keys/keyCodec';
import { downloadFile, useUploadPanel, useUploadQueue } from '../../lib/transfers';
import { useClipboardStore } from '../../stores/clipboard';
import { useExplorerPrefs } from '../../stores/explorerPrefs';
import { useSelectionStore } from '../../stores/selection';
import { PreviewOverlay } from '../preview/PreviewOverlay';
import { type ExplorerActions, ExplorerContext, type ExplorerContextValue, permissionsOf } from './context';
import { DeleteDialog, NewFolderDialog, RenameDialog } from './dialogs';
import { apiError, errorCode, errorMessageKey } from './errors';
import { ExplorerBreadcrumb } from './ExplorerBreadcrumb';
import { ExplorerHeader } from './ExplorerHeader';
import { EmptyFolder, ErrorView, LoadingRows } from './ExplorerStates';
import { FolderPickerDialog, type PickTarget } from './FolderPickerDialog';
import { GridView } from './GridView';
import { useMediaQuery, useOnline } from './hooks';
import { hasFiles, hasItems } from './interactions';
import { BackgroundMenuEntries, CONTEXT_KIT, SelectionMenuEntries } from './ItemMenu';
import { categoryOf } from './ItemParts';
import { ListView } from './ListView';
import { DEFAULT_SORT, type SortField, type SortSpec, nextSort, sortFromSearch, sortItems } from './sort';
import { useSpaceLabel } from './spaceLabel';
import { absoluteLink, copyText, explorerHref, withSearch, type SearchValues } from './urls';

/*
 * Explorateur du mode instance : dossier `prefix` de l'espace
 * `bucket`, aperçu de `previewKey` en surimpression. Tient les données, la sélection, les
 * boîtes de dialogue et les actions ; la liste et la grille ne font que les afficher.
 */

/** Chargement automatique des pages suivantes jusqu'à ce nombre d'éléments (`UI_AUTOLOAD_MAX`). */
const AUTOLOAD_MAX = 5000;

export interface ExplorerProps {
  conn: string;
  bucket: string;
  /** Dossier affiché (`''` = racine, sinon `/` final). */
  prefix: string;
  /** Fichier ouvert en aperçu, ou `null`. */
  previewKey: string | null;
  view?: 'list' | 'grid';
  sort?: SortField;
  dir?: 'asc' | 'desc';
  /** `?focus=<nom>` : élément à sélectionner une fois chargé (« Afficher dans le dossier »). */
  focus?: string;
}

export function Explorer({ conn, bucket, prefix, previewKey, view: viewParam, sort: sortParam, dir: dirParam, focus }: ExplorerProps) {
  const { t } = useTranslation('explorer');
  const { locale } = useUdTranslation();
  const router = useRouter();
  const mobile = useMediaQuery('(max-width: 767px)');
  const online = useOnline();
  const spaceLabelOf = useSpaceLabel();

  // Données ---------------------------------------------------------------------------------
  const spaces = useSpaces(conn);
  const space = spaces.data?.find((s) => s.name === bucket);
  const spaceMissing = spaces.isSuccess && !space;
  const list = useObjects(conn, bucket, prefix, { enabled: !spaceMissing });
  const can = useMemo(() => permissionsOf(space ?? (spaces.isPending ? { scopes: ['read'] } : undefined)), [space, spaces.isPending]);
  const spaceLabel = space ? spaceLabelOf(space) : bucket;

  // Vue et tri : URL, sinon préférence d'appareil.
  const prefs = useExplorerPrefs();
  const view = viewParam ?? prefs.view;
  const sort = sortFromSearch(sortParam, dirParam, sortParam ? DEFAULT_SORT : prefs.sort);

  const loaded = useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  const typeLabel = useCallback((item: ListItem) => t(`types.${categoryOf(item)}`), [t]);
  const items = useMemo(() => sortItems(loaded, { ...sort, locale, typeLabel }), [loaded, sort, locale, typeLabel]);
  const order = useMemo(() => items.map((i) => i.key), [items]);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const fileKeys = useMemo(() => items.filter((i) => i.kind === 'file').map((i) => i.key), [items]);

  // Pages suivantes en arrière-plan jusqu'à AUTOLOAD_MAX, puis au défilement.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && loaded.length < AUTOLOAD_MAX) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loaded.length]);
  const onNearEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Sélection propre au dossier.
  const context = folderIdentity(conn, bucket, prefix);
  useLayoutEffect(() => useSelectionStore.getState().setContext(context), [context]);
  useEffect(() => {
    if (list.data) useSelectionStore.getState().prune(new Set(order));
  }, [list.data, order]);

  // URL ---------------------------------------------------------------------------------------
  const listSearch: SearchValues = useMemo(() => ({ view: viewParam, sort: sortParam, dir: dirParam }), [dirParam, sortParam, viewParam]);
  const folderTarget = useMemo(() => (prefix === '' ? { conn, bucket, key: '', kind: 'root' as const } : { conn, bucket, key: prefix, kind: 'folder' as const }), [bucket, conn, prefix]);
  const folderHref = explorerHref(folderTarget, listSearch);
  const hrefOf = useCallback(
    (item: ListItem) => explorerHref({ conn, bucket, key: item.key, kind: item.kind === 'folder' ? 'folder' : 'file' }, listSearch),
    [bucket, conn, listSearch],
  );
  const fileHref = useCallback((key: string) => explorerHref({ conn, bucket, key, kind: 'file' }, listSearch), [bucket, conn, listSearch]);

  /** Met à jour des paramètres de l'URL courante (`replace`) ; une valeur égale au défaut est retirée. */
  const replaceSearch = useCallback(
    (values: SearchValues) => {
      const loc = router.history.location;
      void navigateHref(router, withSearch(loc.pathname + loc.search, values), { replace: true, state: { udPreview: loc.state.udPreview } });
    },
    [router],
  );

  const setView = (next: 'list' | 'grid') => {
    prefs.setView(next);
    replaceSearch({ view: next === 'list' ? undefined : next });
  };
  const setSort = (next: SortSpec) => {
    prefs.setSort(next);
    const isDefault = next.field === DEFAULT_SORT.field && next.dir === DEFAULT_SORT.dir;
    const dirIsDefault = next.dir === sortFromSearch(next.field, undefined).dir;
    replaceSearch({ sort: isDefault ? undefined : next.field, dir: isDefault || dirIsDefault ? undefined : next.dir });
  };

  // `?focus=` : sélection et défilement, puis retrait du paramètre.
  useEffect(() => {
    if (!focus || !list.data) return;
    const key = items.find((i) => i.name === focus.replace(/\/$/, '') && (focus.endsWith('/') ? i.kind === 'folder' : true))?.key;
    if (key) useSelectionStore.getState().selectOnly(key);
    replaceSearch({ focus: undefined });
  }, [focus, items, list.data, replaceSearch]);

  // Envois ---------------------------------------------------------------------------------
  const uploads = useUploadQueue(conn);
  useInvalidateOnUploads(conn, uploads.items);
  const quotaSeen = useRef(new Set<string>());
  useEffect(() => {
    for (const item of uploads.items) {
      if (item.state !== 'error' || item.error?.code !== 'quota_exceeded' || quotaSeen.current.has(item.id)) continue;
      quotaSeen.current.add(item.id);
      const remaining = item.error.details?.['remaining'];
      toast.error(t(item.error.details?.['limit'] === 'space_quota' ? 'upload.spaceQuota' : 'upload.quota'), {
        id: `quota-${conn}`,
        description: typeof remaining === 'number' ? t('upload.remaining', { size: formatBytes(remaining, locale) }) : t('upload.freeUp'),
      });
    }
  }, [conn, locale, t, uploads.items]);
  const [panelHidden, setPanelHidden] = useState(false);
  const uploadCount = uploads.items.length;
  useEffect(() => {
    if (uploadCount > 0) setPanelHidden(false);
  }, [uploadCount]);
  const panel = useUploadPanel(conn, {
    folderLabel: (item) => {
      const parent = parentPrefix(item.key);
      const base = item.bucket === bucket ? spaceLabel : item.bucket;
      return parent ? `${base} / ${parent.slice(0, -1)}` : base;
    },
    onShowInFolder: (item) => {
      const parent = parentPrefix(item.key);
      const target = parent === '' ? { conn, bucket: item.bucket, key: '', kind: 'root' as const } : { conn, bucket: item.bucket, key: parent, kind: 'folder' as const };
      void navigateHref(router, explorerHref(target, { focus: keyName(item.key) }));
    },
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // Mutations -------------------------------------------------------------------------------
  const createFolder = useCreateFolder(conn, bucket);
  const rename = useRename(conn, bucket);
  const move = useMove(conn, bucket);
  const copy = useCopy(conn, bucket);
  const del = useDelete(conn, bucket);

  const [renameItem, setRenameItem] = useState<ListItem | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [deleteItems, setDeleteItems] = useState<readonly ListItem[] | null>(null);
  const [picker, setPicker] = useState<{ mode: 'move' | 'copy'; items: readonly ListItem[] } | null>(null);
  const clipboard = useClipboardStore((s) => s.entry);

  const reportError = useCallback((cause: unknown) => toast.error(t(errorMessageKey(cause))), [t]);

  /** Copie ou déplace des éléments vers un dossier ; résumé en une notification. */
  const transfer = useCallback(
    async (op: 'move' | 'copy', sources: readonly { key: string; kind: 'folder' | 'file'; name: string }[], target: PickTarget, sourceBucket = bucket) => {
      const mutation = op === 'move' ? move : copy;
      let done = 0;
      let conflicts = 0;
      let failure: unknown = null;
      for (const source of sources) {
        const destination = { bucket: target.bucket, key: `${target.prefix}${source.name}${source.kind === 'folder' ? '/' : ''}` };
        if (sourceBucket === target.bucket && destination.key === source.key) continue;
        try {
          const result = await mutation.mutateAsync({ key: source.key, destination, conflict: target.conflict });
          if (!result.skipped) done++;
        } catch (cause) {
          if (apiError(cause)?.code === 'already_exists') conflicts++;
          else failure = cause;
        }
      }
      if (done > 0) toast.success(t(op === 'move' ? 'toast.moved' : 'toast.copied', { count: done }));
      if (conflicts > 0) toast.warning(t('toast.conflicts', { count: conflicts }), { description: t('toast.conflictsHint') });
      if (failure) reportError(failure);
    },
    [bucket, copy, move, reportError, t],
  );

  const selectedItems = useCallback((): ListItem[] => {
    const { selected } = useSelectionStore.getState();
    return order.filter((k) => selected.has(k)).map((k) => byKey.get(k)!).filter(Boolean);
  }, [byKey, order]);

  const openItem = useCallback(
    (item: ListItem) => {
      if (item.kind === 'folder') void navigateHref(router, hrefOf(item));
      else void navigateHref(router, hrefOf(item), { state: { udPreview: true } });
    },
    [hrefOf, router],
  );

  const actions: ExplorerActions = {
    open: openItem,
    openInNewTab: (item) => window.open(hrefOf(item), '_blank', 'noopener'),
    download: (targets) => {
      for (const item of targets) {
        if (item.kind !== 'file') continue;
        downloadFile(conn, bucket, item.key).catch(reportError);
      }
    },
    rename: (item) => setRenameItem(item),
    moveTo: (targets) => setPicker({ mode: 'move', items: targets }),
    copyTo: (targets) => setPicker({ mode: 'copy', items: targets }),
    copyLink: (targets) => {
      const text = targets.map((item) => absoluteLink(hrefOf(item))).join('\n');
      copyText(text).then(
        () => toast.success(t('toast.linkCopied', { count: targets.length })),
        () => toast.error(t('toast.copyFailed')),
      );
    },
    remove: (targets) => setDeleteItems(targets),
    cut: (targets) => {
      useClipboardStore.getState().set({ op: 'cut', conn, bucket, items: targets.map(({ key, kind, name }) => ({ key, kind, name })) });
      toast(t('toast.cut', { count: targets.length }));
    },
    copy: (targets) => {
      useClipboardStore.getState().set({ op: 'copy', conn, bucket, items: targets.map(({ key, kind, name }) => ({ key, kind, name })) });
      toast(t('toast.copiedToClipboard', { count: targets.length }));
    },
    paste: () => {
      const entry = useClipboardStore.getState().entry;
      if (!entry || entry.conn !== conn) return;
      if (entry.op === 'cut') useClipboardStore.getState().clear();
      void transfer(entry.op === 'cut' ? 'move' : 'copy', entry.items, { bucket, prefix, conflict: 'rename' }, entry.bucket);
    },
    newFolder: () => setNewFolderOpen(true),
    uploadFiles: () => fileInput.current?.click(),
    uploadFolder: () => folderInput.current?.click(),
    refresh: () => void list.refetch(),
    copyFolderLink: () => {
      copyText(absoluteLink(folderHref)).then(
        () => toast.success(t('toast.linkCopied', { count: 1 })),
        () => toast.error(t('toast.copyFailed')),
      );
    },
    selectAll: () => useSelectionStore.getState().selectAll(order),
    dropFiles: (dataTransfer, targetPrefix) => {
      if (!can.write) {
        toast.error(t('permissions.denied'));
        return;
      }
      void uploads.addDataTransfer(dataTransfer, { bucket, prefix: targetPrefix });
    },
    dropItems: (keys, targetPrefix, asCopy) => {
      const sources = keys.map((k) => byKey.get(k)).filter((i): i is ListItem => !!i);
      void transfer(asCopy ? 'copy' : 'move', sources, { bucket, prefix: targetPrefix, conflict: 'fail' });
    },
  };

  const ctx: ExplorerContextValue = {
    conn,
    bucket,
    prefix,
    space,
    spaceLabel,
    can,
    items,
    order,
    byKey,
    hrefOf,
    actions,
    locale,
    mobile,
    hasClipboard: clipboard !== null && clipboard.conn === conn,
  };

  // Glisser-déposer depuis l'ordinateur sur le dossier affiché.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;
  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDragDepth((d) => d + 1);
  };
  const onDragLeave = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    setDragDepth((d) => Math.max(0, d - 1));
  };
  const onDragOver = (event: DragEvent) => {
    if (hasFiles(event.dataTransfer) || hasItems(event.dataTransfer)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = hasFiles(event.dataTransfer) && can.write ? 'copy' : 'none';
    }
  };
  const onDrop = (event: DragEvent) => {
    setDragDepth(0);
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    // Appel synchrone : les entrées du DataTransfer ne survivent pas à un `await`.
    actions.dropFiles(event.dataTransfer, prefix);
  };

  // Menu contextuel unique : élément (sélection) ou zone vide.
  const [menuTarget, setMenuTarget] = useState<'selection' | 'background'>('background');
  const onContextMenuCapture = (event: React.MouseEvent) => {
    const row = (event.target as HTMLElement).closest('[data-item-key]');
    if (row) setMenuTarget('selection');
    else {
      useSelectionStore.getState().clear();
      setMenuTarget('background');
    }
  };

  // Aperçu ------------------------------------------------------------------------------
  const closePreview = useCallback(() => {
    const loc = router.history.location;
    if (loc.state.udPreview && router.history.canGoBack()) router.history.back();
    else void navigateHref(router, folderHref, { replace: true });
  }, [folderHref, router]);

  // Contenu -------------------------------------------------------------------------------
  const listError = list.error;
  const code = listError ? errorCode(listError) : null;
  let content: React.ReactNode;
  if (spaceMissing || code === 'bucket_not_found') {
    content = (
      <ErrorView
        kind="notFound"
        actions={
          <a
            href={explorerHref({ conn, bucket: 'home', key: '', kind: 'root' })}
            onClick={(event) => {
              event.preventDefault();
              void navigateHref(router, explorerHref({ conn, bucket: 'home', key: '', kind: 'root' }));
            }}
            className="ud-btn-secondary inline-flex h-8 items-center rounded-md px-3 text-row font-medium"
          >
            {t('actions.goHome')}
          </a>
        }
      />
    );
  } else if (!online && !list.data) {
    content = <ErrorView kind="offline" />;
  } else if (listError && !list.data) {
    content = (
      <ErrorView
        kind={code === 'scope_denied' || code === 'access_denied' || code === 'forbidden' ? 'denied' : code === 'network' ? 'offline' : 'error'}
        detail={code === 'network' || code === 'scope_denied' || code === 'access_denied' ? undefined : t(errorMessageKey(listError))}
        actions={
          <button type="button" onClick={() => void list.refetch()} className="ud-btn-secondary inline-flex h-8 items-center rounded-md px-3 text-row font-medium">
            {t('actions.retry')}
          </button>
        }
      />
    );
  } else if (list.isPending || spaces.isPending) {
    content = <LoadingRows view={view} />;
  } else if (items.length === 0) {
    content = (
      <EmptyFolder
        root={prefix === ''}
        canWrite={can.write}
        onUpload={actions.uploadFiles}
        onNewFolder={actions.newFolder}
        {...(prefix !== '' ? { onUp: () => void navigateHref(router, explorerHref(parentPrefix(prefix) === '' ? { conn, bucket, key: '', kind: 'root' } : { conn, bucket, key: parentPrefix(prefix), kind: 'folder' }, listSearch)) } : {})}
      />
    );
  } else if (view === 'grid') {
    content = <GridView loadingMore={isFetchingNextPage} onNearEnd={onNearEnd} />;
  } else {
    content = <ListView sort={sort} onSort={(field) => setSort(nextSort(sort, field))} loadingMore={isFetchingNextPage} onNearEnd={onNearEnd} />;
  }

  const totalBytes = useMemo(() => loaded.reduce((sum, i) => sum + (i.kind === 'file' ? i.size : 0), 0), [loaded]);

  return (
    <ExplorerContext.Provider value={ctx}>
      <section
        aria-label={spaceLabel}
        data-explorer={bucket}
        data-prefix={prefix}
        className="relative flex h-full min-h-0 flex-col bg-panel text-text-1"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <ExplorerHeader
          breadcrumb={<ExplorerBreadcrumb conn={conn} bucket={bucket} prefix={prefix} rootLabel={spaceLabel} search={listSearch} mobile={mobile} />}
          view={view}
          sort={sort}
          onView={setView}
          onSort={setSort}
        />
        {!online && list.data && (
          <p role="status" className="mx-4 mb-2 rounded-md border border-tone-warning-border bg-tone-warning-bg px-3 py-1.5 text-row text-text-1">
            {t('states.offlineBanner')}
          </p>
        )}
        <ContextMenu modal={false}>
          <ContextMenuTrigger asChild>
            <div className="relative flex min-h-0 flex-1 flex-col border-t border-line" onContextMenu={onContextMenuCapture} data-drop-zone>
              {content}
              {dragging && (
                <div
                  aria-live="polite"
                  className={cn(
                    'pointer-events-none absolute inset-2 z-(--ud-z-drop) flex items-center justify-center rounded-xl border-2 border-dashed',
                    'animate-in fade-in duration-150',
                    can.write ? 'border-drop-border bg-drop' : 'border-(--ud-drop-denied) bg-panel/80',
                  )}
                >
                  <div className="flex items-center gap-2 rounded-full bg-panel px-4 py-2 text-row font-medium shadow-float">
                    <Upload className="size-4" aria-hidden />
                    {can.write ? t('drop.here', { folder: prefix === '' ? spaceLabel : keyName(prefix) }) : t('drop.denied')}
                  </div>
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-60">
            {menuTarget === 'selection' ? <SelectionMenu selectedItems={selectedItems} /> : <BackgroundMenuEntries kit={CONTEXT_KIT} />}
          </ContextMenuContent>
        </ContextMenu>
        {list.data && items.length > 0 && (
          <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-line px-4 text-2xs font-normal text-text-2 tabular-nums" aria-live="polite">
            <span>{t(hasNextPage ? 'status.atLeast' : 'status.items', { count: items.length })}</span>
            {totalBytes > 0 && <span>· {formatBytes(totalBytes, locale)}</span>}
            {isFetchingNextPage && <span>· {t('status.loadingMore')}</span>}
          </footer>
        )}

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          data-testid="upload-files-input"
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) uploads.addFiles(files, { bucket, prefix });
            event.target.value = '';
          }}
        />
        <input
          ref={(node) => {
            folderInput.current = node;
            node?.setAttribute('webkitdirectory', '');
          }}
          type="file"
          multiple
          hidden
          data-testid="upload-folder-input"
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void uploads.addFolderInput(files, { bucket, prefix });
            event.target.value = '';
          }}
        />

        {panel.items.length > 0 && !panelHidden && (
          <div className="fixed bottom-4 end-4 z-(--ud-z-panel) max-w-[calc(100vw-2rem)]">
            <UploadPanel {...panel} onClose={() => setPanelHidden(true)} />
          </div>
        )}

        <RenameDialog
          item={renameItem}
          onClose={() => setRenameItem(null)}
          onRename={async (item, newName, conflict) => {
            const result = await rename.mutateAsync({ key: item.key, newName, conflict });
            useSelectionStore.getState().selectOnly(result.key);
            toast.success(t('toast.renamed'));
          }}
        />
        <NewFolderDialog
          open={newFolderOpen}
          prefix={prefix}
          onClose={() => setNewFolderOpen(false)}
          onCreate={async (name) => {
            await createFolder.mutateAsync(`${prefix}${name}/`);
            useSelectionStore.getState().selectOnly(`${prefix}${name.split('/')[0]}/`);
          }}
          onOpenExisting={(name) => {
            setNewFolderOpen(false);
            void navigateHref(router, explorerHref({ conn, bucket, key: `${prefix}${name.replace(/\/+$/, '')}/`, kind: 'folder' }, listSearch));
          }}
        />
        <DeleteDialog
          items={deleteItems}
          locale={locale}
          onClose={() => setDeleteItems(null)}
          onConfirm={async (targets) => {
            let deleted = 0;
            let failure: unknown = null;
            for (const item of targets) {
              try {
                await del.mutateAsync(item.key);
                deleted++;
              } catch (cause) {
                failure = cause;
              }
            }
            useSelectionStore.getState().clear();
            if (deleted > 0) toast.success(t('toast.deleted', { count: deleted }));
            if (failure) reportError(failure);
          }}
        />
        <FolderPickerDialog
          mode={picker?.mode ?? null}
          conn={conn}
          sourceBucket={bucket}
          items={picker?.items ?? []}
          initialPrefix={prefix}
          onClose={() => setPicker(null)}
          onPick={(target) => transfer(picker?.mode ?? 'copy', picker?.items ?? [], target)}
        />

        {previewKey !== null && !isFolderKey(previewKey) && (
          <PreviewOverlay
            conn={conn}
            bucket={bucket}
            fileKey={previewKey}
            siblings={fileKeys}
            onNavigate={(key) => void navigateHref(router, fileHref(key), { replace: true, state: { udPreview: router.history.location.state.udPreview } })}
            onClose={closePreview}
            onDownload={(key) => void downloadFile(conn, bucket, key).catch(reportError)}
            onCopyLink={(key) =>
              void copyText(absoluteLink(fileHref(key))).then(
                () => toast.success(t('toast.linkCopied', { count: 1 })),
                () => toast.error(t('toast.copyFailed')),
              )
            }
          />
        )}
      </section>
    </ExplorerContext.Provider>
  );
}

function SelectionMenu({ selectedItems }: { selectedItems: () => ListItem[] }) {
  // Relu à chaque rendu : la sélection change juste avant l'ouverture du menu.
  useSelectionStore((s) => s.selected);
  return <SelectionMenuEntries kit={CONTEXT_KIT} items={selectedItems()} />;
}
