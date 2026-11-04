import type { ListItem } from '@ud/contracts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, IconButton, cn, fileCategory, formatBytes, formatDate } from '@ud/ui';
import { Check, MoreVertical } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelectionStore } from '../../stores/selection';
import { useExplorer } from './context';
import { DROPDOWN_KIT, SelectionMenuEntries } from './ItemMenu';

// Pièces communes d'une ligne et d'une tuile : case, nom-lien, méta, menu « ⋮ ».

export function categoryOf(item: ListItem) {
  return fileCategory(item.name, null, { isFolder: item.kind === 'folder' });
}

export function useItemMeta() {
  const { t } = useTranslation('explorer');
  const { locale } = useExplorer();
  return {
    modified: (item: ListItem) => (item.kind === 'file' ? formatDate(item.lastModified, locale, { style: 'list' }) : '—'),
    modifiedExact: (item: ListItem) => (item.kind === 'file' ? formatDate(item.lastModified, locale, { style: 'exact' }) : undefined),
    size: (item: ListItem) => (item.kind === 'file' ? formatBytes(item.size, locale) : '—'),
    type: (item: ListItem) => t(`types.${categoryOf(item)}`),
  };
}

/** Case de sélection : décorative pour l'accessibilité, la sélection passe par `aria-selected`. */
export function SelectBox({ selected, visible, onToggle, className }: { selected: boolean; visible: boolean; onToggle: (event: MouseEvent) => void; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="select-box"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(event);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md',
        'opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 group-focus-visible/item:opacity-100 pointer-coarse:opacity-100',
        (visible || selected) && 'opacity-100',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex size-4 items-center justify-center rounded-[4px] border transition-colors duration-150',
          selected ? 'border-check-border bg-check text-check-fg' : 'border-input-border bg-transparent',
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
    </span>
  );
}

/**
 * Nom en vrai lien : `tabindex=-1`, pas de glisser ; le clic simple et modifié est
 * intercepté (la ligne applique la sélection), le clic du milieu reste natif.
 */
export function NameLink({ item, className }: { item: ListItem; className?: string }) {
  const { hrefOf } = useExplorer();
  return (
    <a
      href={hrefOf(item)}
      tabIndex={-1}
      draggable={false}
      onClick={(event) => {
        if (event.button === 0) event.preventDefault();
      }}
      className={cn('min-w-0 truncate text-text-1 no-underline outline-none', className)}
    >
      <bdi>{item.name}</bdi>
    </a>
  );
}

export function ItemMoreMenu({ item, className }: { item: ListItem; className?: string }) {
  const { t } = useTranslation('explorer');
  const { order, byKey } = useExplorer();
  const items = (): ListItem[] => {
    const { selected } = useSelectionStore.getState();
    if (!selected.has(item.key)) return [item];
    return order.filter((k) => selected.has(k)).map((k) => byKey.get(k)!).filter(Boolean);
  };
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return;
        const store = useSelectionStore.getState();
        if (!store.selected.has(item.key)) store.selectOnly(item.key);
      }}
    >
      <DropdownMenuTrigger asChild>
        <IconButton
          size="sm"
          aria-label={t('menu.moreFor', { name: item.name })}
          tooltip={false}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          className={className}
        >
          <MoreVertical className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <SelectionMenuEntries kit={DROPDOWN_KIT} items={items()} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
