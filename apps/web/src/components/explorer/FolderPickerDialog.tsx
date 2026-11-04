import { type ConflictPolicy, type ListItem, type SpaceBucket, keyName, parentPrefix } from '@ud/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileIcon,
  Skeleton,
  SpaceIcon,
  cn,
} from '@ud/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useObjects, useSpaces } from '../../lib/api/queries/objects';
import { useSpaceLabel } from './spaceLabel';

/*
 * Déplacer vers… et Copier vers… (adapté au mode instance) : colonne des
 * espaces où la personne peut écrire, dossiers du niveau courant, fil interne. Destinations
 * désactivées : la source elle-même ou un de ses descendants (déplacement d'un dossier).
 */

export interface PickTarget {
  bucket: string;
  prefix: string;
  conflict: ConflictPolicy;
}

export interface FolderPickerDialogProps {
  mode: 'move' | 'copy' | null;
  conn: string;
  sourceBucket: string;
  items: readonly ListItem[];
  initialPrefix: string;
  onClose: () => void;
  onPick: (target: PickTarget) => Promise<void>;
}

const CONFLICTS: ConflictPolicy[] = ['fail', 'rename', 'overwrite', 'skip'];

export function FolderPickerDialog({ mode: modeProp, conn, sourceBucket, items: itemsProp, initialPrefix, onClose, onPick }: FolderPickerDialogProps) {
  // Titre et contenu gardés pendant l'animation de fermeture.
  const last = useRef<{ mode: 'move' | 'copy'; items: readonly ListItem[] }>({ mode: 'copy', items: [] });
  if (modeProp) last.current = { mode: modeProp, items: itemsProp };
  const mode = modeProp ?? last.current.mode;
  const items = modeProp ? itemsProp : last.current.items;
  const { t } = useTranslation('explorer');
  const spaces = useSpaces(conn);
  const [bucket, setBucket] = useState(sourceBucket);
  const [prefix, setPrefix] = useState(initialPrefix);
  const [conflict, setConflict] = useState<ConflictPolicy>('fail');
  const [pending, setPending] = useState(false);
  const open = modeProp !== null;

  useEffect(() => {
    if (!open) return;
    setBucket(sourceBucket);
    setPrefix(initialPrefix);
    setConflict('fail');
    setPending(false);
  }, [initialPrefix, open, sourceBucket]);

  const writable = useMemo(() => (spaces.data ?? []).filter((s) => s.scopes.includes('write')), [spaces.data]);
  const list = useObjects(conn, bucket, prefix, { enabled: open });
  const folders = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items).filter((i) => i.kind === 'folder'), [list.data]);
  const label = useSpaceLabel();

  const sourceFolders = items.filter((i) => i.kind === 'folder').map((i) => i.key);
  const blocked = (key: string) => bucket === sourceBucket && sourceFolders.some((f) => key.startsWith(f));
  const sameParent = bucket === sourceBucket && items.every((i) => parentPrefix(i.key) === prefix);
  const canSubmit = !pending && !blocked(prefix) && !(mode === 'move' && sameParent) && writable.some((s) => s.name === bucket);

  const segments = prefix === '' ? [] : prefix.slice(0, -1).split('/');
  const space = (spaces.data ?? []).find((s) => s.name === bucket);

  const submit = async () => {
    setPending(true);
    try {
      await onPick({ bucket, prefix, conflict });
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="flex max-h-[min(40rem,90vh)] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(mode === 'copy' ? 'picker.copyTitle' : 'picker.moveTitle', { count: items.length, name: items[0]?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('picker.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-72 flex-1 overflow-hidden rounded-lg border border-line">
          <nav aria-label={t('picker.spaces')} className="hidden w-48 shrink-0 flex-col gap-0.5 overflow-auto border-e border-line bg-sidebar p-1.5 sm:flex">
            {writable.map((s: SpaceBucket) => (
              <button
                key={s.name}
                type="button"
                aria-current={s.name === bucket ? 'true' : undefined}
                onClick={() => {
                  setBucket(s.name);
                  setPrefix('');
                }}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-start text-row ud-transition',
                  'outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
                  s.name === bucket ? 'bg-row-selected font-medium text-text-1' : 'text-text-2 hover:bg-row-hover hover:text-text-1',
                )}
              >
                <SpaceIcon kind={s.name === 'home' ? 'home' : 'shared'} size={16} />
                <span className="truncate">{label(s)}</span>
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2 text-row">
              {prefix !== '' && (
                <button
                  type="button"
                  aria-label={t('picker.up')}
                  onClick={() => setPrefix(parentPrefix(prefix))}
                  className="inline-flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-row-hover hover:text-text-1"
                >
                  <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
                </button>
              )}
              <ol className="flex min-w-0 items-center gap-1 text-text-2">
                <li className="truncate">
                  <button type="button" className="truncate rounded px-1 hover:text-text-1" onClick={() => setPrefix('')}>
                    <bdi>{space ? label(space) : bucket}</bdi>
                  </button>
                </li>
                {segments.map((segment, index) => (
                  <li key={index} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="size-3.5 shrink-0 text-text-3 rtl:-scale-x-100" aria-hidden />
                    <button
                      type="button"
                      className={cn('truncate rounded px-1 hover:text-text-1', index === segments.length - 1 && 'font-medium text-text-1')}
                      onClick={() => setPrefix(`${segments.slice(0, index + 1).join('/')}/`)}
                    >
                      <bdi>{segment}</bdi>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <ul aria-label={t('picker.folders')} className="flex-1 overflow-auto p-1.5">
              {list.isPending &&
                [0, 1, 2].map((i) => (
                  <li key={i} className="flex h-9 items-center gap-2 px-2">
                    <Skeleton className="size-5 rounded" />
                    <Skeleton className="h-3 w-40" />
                  </li>
                ))}
              {!list.isPending && folders.length === 0 && <li className="px-3 py-6 text-center text-row text-text-2">{t('picker.noFolders')}</li>}
              {folders.map((folder) => {
                const disabled = blocked(folder.key);
                return (
                  <li key={folder.key}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setPrefix(folder.key)}
                      title={disabled ? t('picker.blocked') : undefined}
                      className={cn(
                        'flex h-9 w-full items-center gap-2 rounded-md px-2 text-start text-row text-text-1 ud-transition',
                        'outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
                        disabled ? 'cursor-not-allowed opacity-55' : 'hover:bg-row-hover',
                      )}
                    >
                      <FileIcon category="folder" size={20} />
                      <bdi className="min-w-0 flex-1 truncate">{keyName(folder.key)}</bdi>
                      <ChevronRight className="size-4 text-text-3 rtl:-scale-x-100" aria-hidden />
                    </button>
                  </li>
                );
              })}
              {list.hasNextPage && (
                <li>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                    {t('picker.more')}
                  </Button>
                </li>
              )}
            </ul>
          </div>
        </div>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-row">
          <legend className="sr-only">{t('conflict.legend')}</legend>
          <span className="text-text-2">{t('conflict.legend')}</span>
          {CONFLICTS.map((c) => (
            <label key={c} className="inline-flex cursor-pointer items-center gap-1.5 text-text-1">
              <input type="radio" name="conflict" value={c} checked={conflict === c} onChange={() => setConflict(c)} className="accent-(--ud-accent)" />
              {t(`conflict.${c}`)}
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('actions.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={pending} disabled={!canSubmit}>
            {t(mode === 'copy' ? 'picker.copyHere' : 'picker.moveHere')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
