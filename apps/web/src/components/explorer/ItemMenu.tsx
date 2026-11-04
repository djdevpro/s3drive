import type { ListItem } from '@ud/contracts';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@ud/ui';
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  FileUp,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Link2,
  ListChecks,
  Pencil,
  RefreshCw,
  Scissors,
  Trash2,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useExplorer } from './context';

/*
 * Entrées des menus de l'explorateur, communes au menu contextuel et au
 * menu « ⋮ » : fichier, dossier, sélection multiple, zone vide. Une entrée sans droit reste
 * visible, désactivée, avec son motif en infobulle.
 */

interface KitItemProps {
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
  title?: string;
  children?: ReactNode;
}

interface MenuKit {
  Item: ComponentType<KitItemProps>;
  Separator: ComponentType;
  Shortcut: ComponentType<{ children?: ReactNode }>;
}

export const CONTEXT_KIT: MenuKit = { Item: ContextMenuItem, Separator: ContextMenuSeparator, Shortcut: ContextMenuShortcut };
export const DROPDOWN_KIT: MenuKit = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator, Shortcut: DropdownMenuShortcut };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl+';

function Entry({ kit, icon, label, shortcut, onSelect, disabled, reason, destructive }: {
  kit: MenuKit;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  reason?: string;
  destructive?: boolean;
}) {
  const { Item, Shortcut } = kit;
  return (
    <Item
      onSelect={onSelect}
      disabled={disabled}
      variant={destructive ? 'destructive' : 'default'}
      {...(disabled && reason ? { title: reason } : {})}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <Shortcut>{shortcut}</Shortcut>}
    </Item>
  );
}

export function SelectionMenuEntries({ kit, items }: { kit: MenuKit; items: readonly ListItem[] }) {
  const { t } = useTranslation('explorer');
  const { can, actions } = useExplorer();
  const { Separator } = kit;
  if (items.length === 0) return null;
  const single = items.length === 1 ? items[0] : undefined;
  const hasFolder = items.some((i) => i.kind === 'folder');
  const denied = t('permissions.denied');
  const icon = 'size-4';

  return (
    <>
      {single && (
        <>
          <Entry
            kit={kit}
            icon={single.kind === 'folder' ? <FolderOpen className={icon} /> : <Eye className={icon} />}
            label={t(single.kind === 'folder' ? 'menu.open' : 'menu.preview')}
            shortcut={t('keys.enter')}
            onSelect={() => actions.open(single)}
          />
          <Entry kit={kit} icon={<ExternalLink className={icon} />} label={t('menu.openNewTab')} onSelect={() => actions.openInNewTab(single)} />
          <Separator />
        </>
      )}
      <Entry
        kit={kit}
        icon={<Download className={icon} />}
        label={t('menu.download')}
        onSelect={() => actions.download(items)}
        disabled={hasFolder}
        reason={t('menu.folderDownloadUnavailable')}
      />
      {single && (
        <Entry
          kit={kit}
          icon={<Pencil className={icon} />}
          label={t('menu.rename')}
          shortcut="F2"
          onSelect={() => actions.rename(single)}
          disabled={!can.rename}
          reason={denied}
        />
      )}
      <Entry
        kit={kit}
        icon={<FolderInput className={icon} />}
        label={t('menu.moveTo')}
        onSelect={() => actions.moveTo(items)}
        disabled={!can.move}
        reason={denied}
      />
      <Entry kit={kit} icon={<CopyPlus className={icon} />} label={t('menu.copyTo')} onSelect={() => actions.copyTo(items)} />
      <Entry
        kit={kit}
        icon={<Link2 className={icon} />}
        label={t(single ? 'menu.copyLink' : 'menu.copyLinks')}
        onSelect={() => actions.copyLink(items)}
      />
      <Separator />
      <Entry
        kit={kit}
        icon={<Scissors className={icon} />}
        label={t('menu.cut')}
        shortcut={`${MOD}X`}
        onSelect={() => actions.cut(items)}
        disabled={!can.move}
        reason={denied}
      />
      <Entry kit={kit} icon={<Copy className={icon} />} label={t('menu.copy')} shortcut={`${MOD}C`} onSelect={() => actions.copy(items)} />
      <Separator />
      <Entry
        kit={kit}
        icon={<Trash2 className={icon} />}
        label={t('menu.deletePermanently')}
        shortcut={t('keys.delete')}
        onSelect={() => actions.remove(items)}
        disabled={!can.delete}
        reason={denied}
        destructive
      />
    </>
  );
}

export function BackgroundMenuEntries({ kit }: { kit: MenuKit }) {
  const { t } = useTranslation('explorer');
  const { can, actions, hasClipboard } = useExplorer();
  const { Separator } = kit;
  const denied = t('permissions.denied');
  const icon = 'size-4';
  return (
    <>
      <Entry kit={kit} icon={<FolderPlus className={icon} />} label={t('new.folder')} onSelect={actions.newFolder} disabled={!can.write} reason={denied} />
      <Entry kit={kit} icon={<FileUp className={icon} />} label={t('new.uploadFiles')} onSelect={actions.uploadFiles} disabled={!can.write} reason={denied} />
      <Entry kit={kit} icon={<FolderUp className={icon} />} label={t('new.uploadFolder')} onSelect={actions.uploadFolder} disabled={!can.write} reason={denied} />
      {hasClipboard && (
        <Entry
          kit={kit}
          icon={<ClipboardPaste className={icon} />}
          label={t('menu.paste')}
          shortcut={`${MOD}V`}
          onSelect={actions.paste}
          disabled={!can.write}
          reason={denied}
        />
      )}
      <Separator />
      <Entry kit={kit} icon={<ListChecks className={icon} />} label={t('menu.selectAll')} shortcut={`${MOD}A`} onSelect={actions.selectAll} />
      <Entry kit={kit} icon={<RefreshCw className={icon} />} label={t('menu.refresh')} onSelect={actions.refresh} />
      <Entry kit={kit} icon={<Link2 className={icon} />} label={t('menu.copyFolderLink')} onSelect={actions.copyFolderLink} />
    </>
  );
}
