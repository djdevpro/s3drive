import { Button, EmptyState, Skeleton } from '@ud/ui';
import { CloudOff, FolderSearch, ShieldAlert, TriangleAlert, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/*
 * États de l'explorateur : squelettes de la forme finale (apparition
 * différée de 150 ms), vide, erreur de chargement, espace introuvable, hors ligne.
 */

export function LoadingRows({ view }: { view: 'list' | 'grid' }) {
  const { t } = useTranslation('explorer');
  return (
    <div role="status" aria-busy="true" aria-label={t('states.loading')} className="min-h-0 flex-1 overflow-hidden animate-in fade-in delay-150 fill-mode-both duration-200">
      {view === 'list' ? (
        <div className="flex flex-col">
          <div className="h-10 border-b border-line" />
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-10 items-center gap-3 px-4">
              <Skeleton className="size-5 rounded-md" />
              <Skeleton className="h-3" style={{ width: `${30 + ((i * 17) % 35)}%` }} />
              <Skeleton className="ms-auto h-3 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-3 p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3.6] rounded-xl" />
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyFolder({ root, canWrite, onUpload, onNewFolder, onUp }: { root: boolean; canWrite: boolean; onUpload: () => void; onNewFolder: () => void; onUp?: () => void }) {
  const { t } = useTranslation('explorer');
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
      <EmptyState
        icon={<Upload strokeWidth={1.5} />}
        title={t(root ? 'empty.title' : 'empty.folderTitle')}
        description={canWrite ? t('empty.dropHere') : t('empty.readOnly')}
        actions={
          <>
            {canWrite && (
              <Button variant="primary" onClick={onUpload}>
                {t('new.uploadFiles')}
              </Button>
            )}
            {canWrite && <Button onClick={onNewFolder}>{t('new.folder')}</Button>}
            {!canWrite && onUp && <Button onClick={onUp}>{t('actions.up')}</Button>}
          </>
        }
      />
    </div>
  );
}

export function ErrorView({ kind, detail, actions }: { kind: 'error' | 'notFound' | 'denied' | 'offline'; detail?: string; actions?: ReactNode }) {
  const { t } = useTranslation('explorer');
  const icon =
    kind === 'offline' ? <CloudOff strokeWidth={1.5} /> : kind === 'notFound' ? <FolderSearch strokeWidth={1.5} /> : kind === 'denied' ? <ShieldAlert strokeWidth={1.5} /> : <TriangleAlert strokeWidth={1.5} />;
  return (
    <div role={kind === 'offline' ? 'status' : 'alert'} className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
      <EmptyState icon={icon} title={t(`states.${kind}.title`)} description={detail ?? t(`states.${kind}.body`)} actions={actions} />
    </div>
  );
}
