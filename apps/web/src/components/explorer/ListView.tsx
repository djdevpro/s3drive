import { createColumnHelper, columnVisibilityFeature, tableFeatures, useTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ListItem } from '@ud/contracts';
import { FileIcon, Skeleton, cn, useDirection } from '@ud/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { type CSSProperties, type DragEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsCut } from '../../stores/clipboard';
import { useIsFocused, useIsSelected, useSelectionStore } from '../../stores/selection';
import { useExplorer } from './context';
import { useElementWidth } from './hooks';
import { useItemInteractions } from './interactions';
import { ItemMoreMenu, NameLink, SelectBox, categoryOf, useItemMeta } from './ItemParts';
import type { SortField, SortSpec } from './sort';

/*
 * Vue liste : TanStack Table pour les colonnes et les en-têtes, TanStack Virtual
 * pour les lignes (hauteur uniforme, overscan 10, clé = clé S3). Les lignes arrivent déjà triées
 *. Colonnes selon la largeur du conteneur : < 600 px sans Type, < 480 px
 * Nom seul avec une seconde ligne « modifié · taille ».
 */

const features = tableFeatures({ columnVisibilityFeature });
const helper = createColumnHelper<typeof features, ListItem>();

export interface ListViewProps {
  sort: SortSpec;
  onSort: (field: SortField) => void;
  loadingMore: boolean;
  onNearEnd: () => void;
  /** Hauteur de ligne en pixels (densité). */
  rowHeight?: number;
}

const COLUMN_WIDTHS: Record<string, string> = { modified: '11rem', size: '7rem', type: '9rem', actions: '2.75rem' };

export function ListView({ sort, onSort, loadingMore, onNearEnd, rowHeight: rowHeightProp }: ListViewProps) {
  const { t } = useTranslation('explorer');
  const { items, mobile } = useExplorer();
  const direction = useDirection();
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scrollRef);
  const compact = mobile || width < 480;
  const rowHeight = rowHeightProp ?? (compact ? 56 : 40);

  const columnVisibility = useMemo(
    () => ({ modified: !compact, size: !compact, type: !compact && width >= 600, actions: true }),
    [compact, width],
  );

  const columns = useMemo(
    () => [
      helper.display({ id: 'name', header: () => t('columns.name') }),
      helper.display({ id: 'modified', header: () => t('columns.modified') }),
      helper.display({ id: 'size', header: () => t('columns.size') }),
      helper.display({ id: 'type', header: () => t('columns.type') }),
      helper.display({ id: 'actions', header: () => <span className="sr-only">{t('columns.actions')}</span> }),
    ],
    [t],
  );

  const table = useTable({ features, columns, data: items as ListItem[], getRowId: (row) => row.key, state: { columnVisibility } }, () => null);
  const visibleColumns = table.getVisibleLeafColumns().map((c) => c.id);
  const template = visibleColumns.map((id) => (id === 'name' ? 'minmax(0,1fr)' : COLUMN_WIDTHS[id])).join(' ');

  const count = items.length + (loadingMore ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    getItemKey: (index) => items[index]?.key ?? `__loading-${index}`,
    initialRect: { width: 1024, height: 768 },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= items.length * 0.8 - 1) onNearEnd();
  }, [items.length, lastIndex, onNearEnd]);

  const scrollToIndex = useCallback((index: number) => virtualizer.scrollToIndex(index, { align: 'auto' }), [virtualizer]);
  const interactions = useItemInteractions({ columns: 1, containerRef: scrollRef, scrollToIndex, rtl: direction === 'rtl' });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const gridStyle = { gridTemplateColumns: template } satisfies CSSProperties;

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={t('list.label')}
      aria-rowcount={items.length + 1}
      aria-multiselectable
      data-view="list"
      onKeyDown={interactions.onKeyDown}
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain outline-none"
    >
      <div role="rowgroup" className="sticky top-0 z-(--ud-z-sticky) bg-panel">
        <div
          role="row"
          aria-rowindex={1}
          className={cn('grid items-center border-b border-line px-3 text-2xs text-text-2', compact ? 'h-9' : 'h-10')}
          style={gridStyle}
        >
          {headers.map((header) => {
            const id = header.column.id;
            const sortable = id !== 'actions';
            const active = sortable && sort.field === id;
            const content = <table.FlexRender header={header} />;
            return (
              <div
                key={header.id}
                role="columnheader"
                aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined}
                className={cn('min-w-0', id === 'size' && 'text-end', id === 'name' && 'ps-10')}
              >
                {sortable ? (
                  <button
                    type="button"
                    onClick={() => onSort(id as SortField)}
                    className={cn(
                      'inline-flex h-7 max-w-full items-center gap-1 rounded-md px-1.5 font-medium ud-transition hover:bg-row-hover hover:text-text-1',
                      'outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
                      active && 'text-text-1',
                      id === 'size' && 'flex-row-reverse',
                    )}
                  >
                    <span className="truncate">{content}</span>
                    {active && (sort.dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />)}
                  </button>
                ) : (
                  content
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtual) => {
          const item = items[virtual.index];
          const style: CSSProperties = { position: 'absolute', insetInline: 0, top: 0, height: virtual.size, transform: `translateY(${virtual.start}px)` };
          if (!item) {
            return (
              <div key={virtual.key} role="row" aria-rowindex={virtual.index + 2} style={style} className="flex items-center gap-3 px-3">
                <Skeleton className="size-5 rounded-md" />
                <Skeleton className="h-3 w-48" />
              </div>
            );
          }
          return (
            <ListRow
              key={virtual.key}
              item={item}
              rowIndex={virtual.index + 2}
              style={style}
              gridStyle={gridStyle}
              columns={visibleColumns}
              compact={compact}
              interactions={interactions}
            />
          );
        })}
      </div>
    </div>
  );
}

type Interactions = ReturnType<typeof useItemInteractions>;

interface ListRowProps {
  item: ListItem;
  rowIndex: number;
  style: CSSProperties;
  gridStyle: CSSProperties;
  columns: string[];
  compact: boolean;
  interactions: Interactions;
}

const ListRow = memo(function ListRow({ item, rowIndex, style, gridStyle, columns, compact, interactions }: ListRowProps) {
  const { conn, bucket } = useExplorer();
  const meta = useItemMeta();
  const selected = useIsSelected(item.key);
  const focused = useIsFocused(item.key);
  const cut = useIsCut(conn, bucket, item.key);
  const anySelected = useSelectionStore((s) => s.selected.size > 0);
  const [dropTarget, setDropTarget] = useState(false);
  const isFolder = item.kind === 'folder';

  const onDragOver = (event: DragEvent) => {
    if (!interactions.canDropOn(event, item)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.ctrlKey || event.altKey ? 'copy' : 'move';
    if (!dropTarget) setDropTarget(true);
  };

  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      data-item-key={item.key}
      data-kind={item.kind}
      draggable={!compact}
      onClick={(event) => interactions.onItemClick(event, item)}
      onDoubleClick={(event) => interactions.onItemDoubleClick(event, item)}
      onAuxClick={(event) => interactions.onItemAuxClick(event, item)}
      onContextMenu={() => interactions.onItemContextMenu(item)}
      onFocus={() => {
        if (!focused) useSelectionStore.getState().setFocus(item.key);
      }}
      onDragStart={(event) => interactions.onItemDragStart(event, item)}
      {...(isFolder
        ? {
            onDragOver,
            onDragLeave: () => setDropTarget(false),
            onDrop: (event: DragEvent) => {
              setDropTarget(false);
              interactions.onFolderDrop(event, item);
            },
          }
        : {})}
      style={{ ...style, ...gridStyle }}
      className={cn(
        'group/item grid cursor-default select-none items-center px-3 text-row',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
        'before:pointer-events-none before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-focus before:opacity-0',
        selected ? 'bg-row-selected before:opacity-100' : 'hover:bg-row-hover',
        dropTarget && 'bg-drop-target shadow-[inset_0_0_0_2px_var(--ud-drop-target-border)]',
      )}
    >
      {columns.map((id) => {
        switch (id) {
          case 'name':
            return (
              <div key={id} role="gridcell" className="flex min-w-0 items-center gap-2">
                <SelectBox selected={selected} visible={anySelected} onToggle={() => useSelectionStore.getState().toggle(item.key)} className="-ms-1" />
                <FileIcon name={item.key} category={categoryOf(item)} size={compact ? 24 : 20} state={cut ? 'cut' : 'normal'} />
                <div className="flex min-w-0 flex-col">
                  <NameLink item={item} className={cn(cut && 'text-text-2')} />
                  {compact && (
                    <span className="truncate text-2xs font-normal text-text-2">
                      {isFolder ? meta.type(item) : `${meta.modified(item)} · ${meta.size(item)}`}
                    </span>
                  )}
                </div>
              </div>
            );
          case 'modified':
            return (
              <div key={id} role="gridcell" className="truncate px-1.5 text-text-2" title={meta.modifiedExact(item)}>
                {meta.modified(item)}
              </div>
            );
          case 'size':
            return (
              <div key={id} role="gridcell" className="truncate px-1.5 text-end text-text-2 tabular-nums">
                {meta.size(item)}
              </div>
            );
          case 'type':
            return (
              <div key={id} role="gridcell" className="truncate px-1.5 text-text-2">
                {meta.type(item)}
              </div>
            );
          case 'actions':
            return (
              <div key={id} role="gridcell" className="flex justify-end">
                <ItemMoreMenu
                  item={item}
                  className={cn(!compact && 'opacity-0 group-hover/item:opacity-100 group-focus-visible/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100', selected && 'opacity-100')}
                />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
});
