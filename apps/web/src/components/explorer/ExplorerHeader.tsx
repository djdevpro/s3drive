import type { ListItem } from '@ud/contracts';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  cn,
  formatBytes,
} from '@ud/ui';
import { ArrowDownUp, Download, FileUp, FolderInput, FolderPlus, FolderUp, LayoutGrid, Link2, List, Lock, MoreVertical, Plus, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelectionStore } from '../../stores/selection';
import { useExplorer } from './context';
import { BackgroundMenuEntries, DROPDOWN_KIT, SelectionMenuEntries } from './ItemMenu';
import { SORT_FIELDS, type SortDir, type SortField, type SortSpec } from './sort';

/*
 * En-tête de contenu : rangée 1 = fil d'Ariane, « Nouveau », vue et tri ;
 * rangée 2 = barre de sélection dès qu'un élément est sélectionné (role="toolbar").
 * En mobile, vue, tri et actions du dossier passent dans un menu « ⋮ ».
 */

export interface ExplorerHeaderProps {
  breadcrumb: ReactNode;
  view: 'list' | 'grid';
  sort: SortSpec;
  onView: (view: 'list' | 'grid') => void;
  onSort: (sort: SortSpec) => void;
}

export function ExplorerHeader({ breadcrumb, view, sort, onView, onSort }: ExplorerHeaderProps) {
  const { t } = useTranslation('explorer');
  const { can, actions, mobile } = useExplorer();
  const count = useSelectionStore((s) => s.selected.size);

  const sortMenu = (
    <>
      <DropdownMenuLabel>{t('sort.label')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={sort.field} onValueChange={(field) => onSort({ field: field as SortField, dir: sort.dir })}>
        {SORT_FIELDS.map((field) => (
          <DropdownMenuRadioItem key={field} value={field}>
            {t(`columns.${field}`)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup value={sort.dir} onValueChange={(dir) => onSort({ field: sort.field, dir: dir as SortDir })}>
        <DropdownMenuRadioItem value="asc">{t('sort.asc')}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="desc">{t('sort.desc')}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );

  const newMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!can.write}>
        {mobile ? (
          <IconButton aria-label={t('new.label')} variant="tonal" tooltip={false}>
            <Plus className="size-5" />
          </IconButton>
        ) : (
          <Button variant="tonal" size="lg" icon={<Plus className="size-5" />} className="rounded-2xl ps-3 pe-5 shadow-soft">
            {t('new.label')}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem onSelect={actions.newFolder}>
          <FolderPlus className="size-4" />
          {t('new.folder')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={actions.uploadFiles}>
          <FileUp className="size-4" />
          {t('new.uploadFiles')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.uploadFolder}>
          <FolderUp className="size-4" />
          {t('new.uploadFolder')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="shrink-0">
      <div className={cn('flex items-center gap-2', mobile ? 'h-14 px-2' : 'h-16 px-4')}>
        <div className="min-w-0 flex-1">{breadcrumb}</div>
        {!can.write && can.read && (
          <Badge tone="neutral" className="hidden sm:inline-flex">
            <Lock className="size-3" aria-hidden />
            {t('permissions.readOnly')}
          </Badge>
        )}
        {mobile ? (
          <>
            {newMenu}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={t('menu.more')} tooltip={false}>
                  <MoreVertical className="size-5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuRadioGroup value={view} onValueChange={(v) => onView(v as 'list' | 'grid')}>
                  <DropdownMenuRadioItem value="list">{t('view.list')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="grid">{t('view.grid')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {sortMenu}
                <DropdownMenuSeparator />
                <BackgroundMenuEntries kit={DROPDOWN_KIT} />
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <>
            <div role="group" aria-label={t('view.label')} className="flex items-center rounded-full border border-line p-0.5">
              <ViewToggle active={view === 'list'} label={t('view.list')} onClick={() => onView('list')}>
                <List className="size-4" />
              </ViewToggle>
              <ViewToggle active={view === 'grid'} label={t('view.grid')} onClick={() => onView('grid')}>
                <LayoutGrid className="size-4" />
              </ViewToggle>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={t('sort.label')}>
                  <ArrowDownUp className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {sortMenu}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      <div className={cn('flex items-center', mobile ? 'px-2' : 'px-4', count > 0 ? 'h-12' : mobile ? 'h-0' : 'h-12')}>
        {count > 0 ? <SelectionBar /> : !mobile && newMenu}
      </div>
    </div>
  );
}

function ViewToggle({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-9 items-center justify-center rounded-full transition-colors duration-150',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        active ? 'bg-ud-accent-soft text-text-1' : 'text-text-2 hover:bg-row-hover hover:text-text-1',
      )}
    >
      {children}
    </button>
  );
}

/** Barre de sélection. */
function SelectionBar() {
  const { t } = useTranslation('explorer');
  const { can, actions, order, byKey, locale, mobile } = useExplorer();
  const selected = useSelectionStore((s) => s.selected);
  const clear = useSelectionStore((s) => s.clear);
  const items: ListItem[] = order.filter((k) => selected.has(k)).map((k) => byKey.get(k)!).filter(Boolean);
  const bytes = items.reduce((sum, i) => sum + (i.kind === 'file' ? i.size : 0), 0);
  const hasFolder = items.some((i) => i.kind === 'folder');

  return (
    <div
      role="toolbar"
      aria-label={t('selection.toolbar')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') clear();
      }}
      className="flex h-10 w-full items-center gap-1 rounded-full bg-row-selected/60 pe-1.5 ps-1 animate-in fade-in duration-150"
    >
      <IconButton aria-label={t('selection.clear')} size="sm" onClick={clear} className="rounded-full">
        <X className="size-4" />
      </IconButton>
      <span className="px-1 text-row font-medium text-text-1 tabular-nums" aria-live="polite">
        {t('selection.count', { count: items.length })}
      </span>
      {bytes > 0 && !mobile && <span className="text-row text-text-2 tabular-nums">· {formatBytes(bytes, locale)}</span>}
      <div className="ms-auto flex items-center gap-0.5">
        {!mobile && (
          <>
            <IconButton aria-label={t('menu.download')} size="sm" onClick={() => actions.download(items)} disabled={hasFolder}>
              <Download className="size-4" />
            </IconButton>
            <IconButton aria-label={t('menu.moveTo')} size="sm" onClick={() => actions.moveTo(items)} disabled={!can.move}>
              <FolderInput className="size-4" />
            </IconButton>
            <IconButton aria-label={t('menu.copyLink')} size="sm" onClick={() => actions.copyLink(items)}>
              <Link2 className="size-4" />
            </IconButton>
            <IconButton aria-label={t('menu.deletePermanently')} size="sm" onClick={() => actions.remove(items)} disabled={!can.delete}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={t('menu.more')} size="sm">
              <MoreVertical className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <SelectionMenuEntries kit={DROPDOWN_KIT} items={items} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
