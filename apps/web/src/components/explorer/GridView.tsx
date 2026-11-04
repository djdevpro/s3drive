import { useVirtualizer } from '@tanstack/react-virtual';
import type { ListItem } from '@ud/contracts';
import { FileIcon, Skeleton, cn, useDirection } from '@ud/ui';
import { type CSSProperties, type DragEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useObjectUrl } from '../../lib/api/queries/objects';
import { useIsCut } from '../../stores/clipboard';
import { useIsFocused, useIsSelected, useSelectionStore } from '../../stores/selection';
import { useExplorer } from './context';
import { useElementWidth } from './hooks';
import { useItemInteractions } from './interactions';
import { ItemMoreMenu, NameLink, SelectBox, categoryOf, useItemMeta } from './ItemParts';

/*
 * Vue grille : section « Dossiers » (tuiles compactes) puis « Fichiers »
 * (vignette 4/3 + nom), virtualisées par rangée. Colonnes = floor((largeur + gouttière) /
 * (--ud-tile-min + gouttière)), au moins 2. Vignettes d'images paresseuses : seules les tuiles
 * montées demandent leur URL présignée d'aperçu.
 */

const TILE_MIN = 184;
const GAP = 12;
const PAD = 16;
const HEADER_H = 40;
const FOLDER_H = 52;

type VirtualRow =
  | { type: 'header'; label: string }
  | { type: 'folders' | 'files'; start: number; end: number }
  | { type: 'loading' };

export interface GridViewProps {
  loadingMore: boolean;
  onNearEnd: () => void;
}

export function GridView({ loadingMore, onNearEnd }: GridViewProps) {
  const { t } = useTranslation('explorer');
  const { items } = useExplorer();
  const direction = useDirection();
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scrollRef);
  const inner = Math.max(0, width - PAD * 2);
  const cols = Math.max(2, Math.floor((inner + GAP) / (TILE_MIN + GAP)));
  const tileWidth = (inner - GAP * (cols - 1)) / cols;
  const fileTileH = Math.round(tileWidth * 0.75 + 48);

  const folderCount = useMemo(() => items.findIndex((i) => i.kind !== 'folder'), [items]);
  const nFolders = folderCount < 0 ? items.length : folderCount;

  const rows = useMemo(() => {
    const result: VirtualRow[] = [];
    if (nFolders > 0) {
      result.push({ type: 'header', label: t('grid.folders') });
      for (let i = 0; i < nFolders; i += cols) result.push({ type: 'folders', start: i, end: Math.min(nFolders, i + cols) });
    }
    if (items.length > nFolders) {
      result.push({ type: 'header', label: t('grid.files') });
      for (let i = nFolders; i < items.length; i += cols) result.push({ type: 'files', start: i, end: Math.min(items.length, i + cols) });
    }
    if (loadingMore) result.push({ type: 'loading' });
    return result;
  }, [cols, items.length, loadingMore, nFolders, t]);

  const sizeOf = (row: VirtualRow | undefined) =>
    !row ? 0 : row.type === 'header' ? HEADER_H : row.type === 'folders' ? FOLDER_H + GAP : row.type === 'files' ? fileTileH + GAP : 48;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => sizeOf(rows[index]),
    overscan: 3,
    initialRect: { width: 1024, height: 768 },
  });
  useEffect(() => virtualizer.measure(), [fileTileH, cols, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const lastRow = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (lastRow >= rows.length * 0.8 - 1) onNearEnd();
  }, [lastRow, onNearEnd, rows.length]);

  const rowOfItem = useCallback(
    (index: number) => rows.findIndex((r) => (r.type === 'folders' || r.type === 'files') && index >= r.start && index < r.end),
    [rows],
  );
  const scrollToIndex = useCallback(
    (index: number) => {
      const row = rowOfItem(index);
      if (row >= 0) virtualizer.scrollToIndex(row, { align: 'auto' });
    },
    [rowOfItem, virtualizer],
  );
  const interactions = useItemInteractions({ columns: cols, containerRef: scrollRef, scrollToIndex, rtl: direction === 'rtl' });

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={t('grid.label')}
      aria-rowcount={rows.length}
      aria-colcount={cols}
      aria-multiselectable
      data-view="grid"
      onKeyDown={interactions.onKeyDown}
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain outline-none"
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() + PAD }}>
        {virtualItems.map((virtual) => {
          const row = rows[virtual.index]!;
          const style: CSSProperties = { position: 'absolute', insetInline: PAD, top: 0, height: virtual.size, transform: `translateY(${virtual.start}px)` };
          if (row.type === 'header') {
            return (
              <div key={virtual.key} style={style} className="flex items-end pb-2 text-row font-medium text-text-2" role="presentation">
                {row.label}
              </div>
            );
          }
          if (row.type === 'loading') {
            return (
              <div key={virtual.key} style={style} className="flex items-center gap-3" role="presentation">
                <Skeleton className="h-10 w-40 rounded-lg" />
                <Skeleton className="h-10 w-40 rounded-lg" />
              </div>
            );
          }
          const cells = items.slice(row.start, row.end);
          return (
            <div
              key={virtual.key}
              role="row"
              aria-rowindex={virtual.index + 1}
              style={{ ...style, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: GAP, alignContent: 'start' }}
            >
              {cells.map((item) =>
                row.type === 'folders' ? (
                  <FolderTile key={item.key} item={item} interactions={interactions} />
                ) : (
                  <FileTile key={item.key} item={item} height={fileTileH} interactions={interactions} />
                ),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Interactions = ReturnType<typeof useItemInteractions>;

function useTileState(item: ListItem) {
  const { conn, bucket } = useExplorer();
  return {
    selected: useIsSelected(item.key),
    focused: useIsFocused(item.key),
    cut: useIsCut(conn, bucket, item.key),
    anySelected: useSelectionStore((s) => s.selected.size > 0),
  };
}

function tileProps(item: ListItem, interactions: Interactions, focused: boolean) {
  return {
    role: 'gridcell',
    tabIndex: focused ? 0 : -1,
    'data-item-key': item.key,
    'data-kind': item.kind,
    draggable: true,
    onClick: (event: React.MouseEvent) => interactions.onItemClick(event, item),
    onDoubleClick: (event: React.MouseEvent) => interactions.onItemDoubleClick(event, item),
    onAuxClick: (event: React.MouseEvent) => interactions.onItemAuxClick(event, item),
    onContextMenu: () => interactions.onItemContextMenu(item),
    onFocus: () => {
      if (!focused) useSelectionStore.getState().setFocus(item.key);
    },
    onDragStart: (event: DragEvent) => interactions.onItemDragStart(event, item),
  } as const;
}

const tileClass = (selected: boolean, cut: boolean) =>
  cn(
    'group/item relative min-w-0 cursor-default select-none rounded-xl border bg-panel text-row',
    'transition-[background-color,box-shadow] duration-150',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    selected ? 'border-transparent bg-tile-selected shadow-[inset_0_0_0_1px_var(--ud-tile-selected-ring)]' : 'border-line hover:bg-row-hover hover:shadow-soft',
    cut && 'border-dashed border-line-strong',
  );

const FolderTile = memo(function FolderTile({ item, interactions }: { item: ListItem; interactions: Interactions }) {
  const { selected, focused, cut, anySelected } = useTileState(item);
  const [dropTarget, setDropTarget] = useState(false);
  return (
    <div
      {...tileProps(item, interactions, focused)}
      aria-selected={selected}
      onDragOver={(event) => {
        if (!interactions.canDropOn(event, item)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!dropTarget) setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        setDropTarget(false);
        interactions.onFolderDrop(event, item);
      }}
      style={{ height: FOLDER_H }}
      className={cn(tileClass(selected, cut), 'flex items-center gap-2 ps-2 pe-1', dropTarget && 'bg-drop-target shadow-[inset_0_0_0_2px_var(--ud-drop-target-border)]')}
    >
      <SelectBox selected={selected} visible={anySelected} onToggle={() => useSelectionStore.getState().toggle(item.key)} className="absolute -top-2 -start-2 bg-panel shadow-soft" />
      <FileIcon category="folder" size={24} state={cut ? 'cut' : 'normal'} />
      <NameLink item={item} className={cn('flex-1 font-medium', cut && 'text-text-2')} />
      <ItemMoreMenu item={item} className="opacity-0 group-hover/item:opacity-100 group-focus-visible/item:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100" />
    </div>
  );
});

const FileTile = memo(function FileTile({ item, height, interactions }: { item: ListItem; height: number; interactions: Interactions }) {
  const { selected, focused, cut, anySelected } = useTileState(item);
  const meta = useItemMeta();
  const category = categoryOf(item);
  return (
    <div {...tileProps(item, interactions, focused)} aria-selected={selected} style={{ height }} className={cn(tileClass(selected, cut), 'flex flex-col overflow-hidden p-1.5')}>
      <SelectBox selected={selected} visible={anySelected} onToggle={() => useSelectionStore.getState().toggle(item.key)} className="absolute top-2 start-2 z-1 rounded-md bg-panel/90" />
      <div className={cn('relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-thumb', cut && 'opacity-(--ud-cut-opacity)')}>
        {category === 'image' ? <Thumbnail item={item} /> : <FileIcon name={item.name} category={category} size={48} />}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 ps-1">
        <FileIcon name={item.name} category={category} size={16} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <NameLink item={item} className={cn('font-medium', cut && 'text-text-2')} />
          <span className="truncate text-2xs font-normal text-text-2 tabular-nums">{meta.size(item)}</span>
        </div>
        <ItemMoreMenu item={item} className="opacity-0 group-hover/item:opacity-100 group-focus-visible/item:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100" />
      </div>
    </div>
  );
});

/** Vignette d'image : URL présignée d'aperçu, `<img>` (SVG compris : jamais interprété dans l'appli). */
function Thumbnail({ item }: { item: ListItem }) {
  const { conn, bucket } = useExplorer();
  const url = useObjectUrl(conn, bucket, item.key);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed || url.isError) return <FileIcon name={item.name} category="image" size={48} />;
  return (
    <>
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      {url.data && (
        <img
          src={url.data.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('size-full object-cover transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </>
  );
}
