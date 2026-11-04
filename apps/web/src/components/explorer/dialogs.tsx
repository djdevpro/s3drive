import { type ConflictPolicy, type ListItem, parentPrefix } from '@ud/contracts';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  formatBytes,
} from '@ud/ui';
import { TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiError, errorMessageKey } from './errors';
import { type NameCheck, baseNameEnd, checkName } from './names';

/*
 * Boîtes de l'explorateur : renommer (avec conflit de nom), nouveau dossier
 *, suppression définitive (pas encore de corbeille). Fermeture
 * bloquée pendant la requête ; erreurs affichées dans la boîte.
 */

function NameMessage({ check, id }: { check: NameCheck; id: string }) {
  const { t } = useTranslation('explorer');
  if (check.error) {
    return (
      <p id={id} role="alert" className="text-2xs font-normal text-danger-text">
        {t(`rename.${check.error}`, { count: check.excess ?? 0 })}
      </p>
    );
  }
  if (check.warning) {
    return (
      <p id={id} className="flex items-center gap-1.5 text-2xs font-normal text-text-2">
        <TriangleAlert aria-hidden className="size-3.5 text-warn" />
        {t(`rename.${check.warning}`)}
      </p>
    );
  }
  if (check.levels && check.levels > 1) {
    return (
      <p id={id} className="text-2xs font-normal text-text-2">
        {t('newFolder.nested', { count: check.levels })}
      </p>
    );
  }
  return null;
}

export interface RenameDialogProps {
  item: ListItem | null;
  onClose: () => void;
  /** Renomme ; rejette l'erreur de l'API (conflit `already_exists` traité ici). */
  onRename: (item: ListItem, newName: string, conflict: ConflictPolicy) => Promise<void>;
}

export function RenameDialog({ item, onClose, onRename }: RenameDialogProps) {
  const { t } = useTranslation('explorer');
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ key: string; conflict?: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageId = useId();
  const isFolder = item?.kind === 'folder';

  useEffect(() => {
    if (!item) return;
    setValue(item.name);
    setError(null);
    setPending(false);
  }, [item]);

  const check = checkName(value, { prefix: item ? parentPrefix(item.key) : '', isFolder });
  const unchanged = item !== null && value.normalize('NFC') === item.name;

  const submit = async (conflict: ConflictPolicy = 'fail') => {
    if (!item || check.error || pending) return;
    if (unchanged) {
      onClose();
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onRename(item, check.value, conflict);
      onClose();
    } catch (cause) {
      const api = apiError(cause);
      if (api?.code === 'already_exists') setError({ key: 'rename.conflict', conflict: true });
      else setError({ key: errorMessageKey(cause) });
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const input = inputRef.current;
          if (!input || !item) return;
          input.focus();
          input.setSelectionRange(0, baseNameEnd(item.name, isFolder));
        }}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('rename.title')}</DialogTitle>
            <DialogDescription>{t(isFolder ? 'rename.descriptionFolder' : 'rename.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${messageId}-input`} className="sr-only">
              {t('rename.label')}
            </Label>
            <Input
              id={`${messageId}-input`}
              ref={inputRef}
              dir="auto"
              value={value}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={check.error || error ? true : undefined}
              aria-describedby={messageId}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p id={messageId} role="alert" className="text-2xs font-normal text-danger-text">
                {t(error.key, { name: check.value })}
              </p>
            ) : (
              <NameMessage check={check} id={messageId} />
            )}
          </div>
          <DialogFooter>
            {error?.conflict ? (
              <>
                <Button type="button" variant="secondary" onClick={() => void submit('rename')} disabled={pending}>
                  {t('conflict.keepBoth')}
                </Button>
                <Button type="button" variant="danger" onClick={() => void submit('overwrite')} loading={pending}>
                  {t('conflict.replace')}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                  {t('actions.cancel')}
                </Button>
                <Button type="submit" variant="primary" loading={pending} disabled={!!check.error}>
                  {t('rename.submit')}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface NewFolderDialogProps {
  open: boolean;
  prefix: string;
  onClose: () => void;
  /** Crée le dossier `name` (peut contenir des `/`) ; rejette l'erreur de l'API. */
  onCreate: (name: string) => Promise<void>;
  onOpenExisting: (name: string) => void;
}

export function NewFolderDialog({ open, prefix, onClose, onCreate, onOpenExisting }: NewFolderDialogProps) {
  const { t } = useTranslation('explorer');
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ key: string; exists?: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (!open) return;
    setValue(t('newFolder.defaultName'));
    setError(null);
    setPending(false);
  }, [open, t]);

  const check = checkName(value, { prefix, isFolder: true, allowSlash: true });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (check.error || pending) return;
    setPending(true);
    setError(null);
    try {
      await onCreate(check.value.replace(/\/+$/, ''));
      onClose();
    } catch (cause) {
      const api = apiError(cause);
      if (api?.code === 'already_exists') setError({ key: 'errors.folder_exists', exists: true });
      else setError({ key: errorMessageKey(cause) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('newFolder.title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('newFolder.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${messageId}-input`} className="sr-only">
              {t('newFolder.label')}
            </Label>
            <Input
              id={`${messageId}-input`}
              ref={inputRef}
              dir="auto"
              value={value}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={check.error || error ? true : undefined}
              aria-describedby={messageId}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p id={messageId} role="alert" className="flex items-center gap-2 text-2xs font-normal text-danger-text">
                {t(error.key)}
                {error.exists && (
                  <button type="button" className="font-medium text-ud-accent-strong underline-offset-2 hover:underline" onClick={() => onOpenExisting(check.value)}>
                    {t('menu.open')}
                  </button>
                )}
              </p>
            ) : (
              <NameMessage check={check} id={messageId} />
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={pending} disabled={!!check.error}>
              {t('newFolder.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface DeleteDialogProps {
  items: readonly ListItem[] | null;
  locale: string;
  onClose: () => void;
  onConfirm: (items: readonly ListItem[]) => Promise<void>;
}

/** Suppression définitive : alert-dialog, focus sur Annuler, nombre et taille connue. */
export function DeleteDialog({ items, locale, onClose, onConfirm }: DeleteDialogProps) {
  const { t } = useTranslation('explorer');
  const [pending, setPending] = useState(false);
  // Contenu gardé pendant l'animation de fermeture.
  const last = useRef<readonly ListItem[]>([]);
  if (items) last.current = items;
  const list = items ?? last.current;
  const single = list.length === 1 ? list[0] : undefined;
  const folders = list.filter((i) => i.kind === 'folder').length;
  const bytes = list.reduce((sum, i) => sum + (i.kind === 'file' ? i.size : 0), 0);

  const title = single
    ? t(single.kind === 'folder' ? 'delete.titleFolder' : 'delete.titleFile', { name: single.name })
    : t('delete.titleMany', { count: list.length });
  const body = folders > 0 ? t('delete.bodyFolder', { count: folders }) : t('delete.body');

  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm(list);
    } finally {
      setPending(false);
      onClose();
    }
  };

  return (
    <AlertDialog open={items !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            <bdi>{title}</bdi>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {body}
            {bytes > 0 && ` ${t('delete.size', { size: formatBytes(bytes, locale) })}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('actions.cancel')}</AlertDialogCancel>
          {/* Bouton simple, pas AlertDialogAction : la boîte reste ouverte pendant la requête. */}
          <Button variant="danger" loading={pending} onClick={() => void confirm()}>
            {t('delete.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
