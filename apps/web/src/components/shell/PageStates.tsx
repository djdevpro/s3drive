import { Button, EmptyState, Skeleton, Spinner } from '@ud/ui';
import { CloudOff, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DriveApiError } from '../../lib/api/client';

// États de page : pas de spinner plein écran d'emblée ; un indicateur discret
// n'apparaît qu'après un court délai, et une erreur propose de réessayer.

/** Écran d'attente neutre : fond de l'appli, indicateur après 400 ms. */
export function PageLoading() {
  const { t } = useTranslation('common');
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-app" aria-busy="true">
      {visible ? <Spinner size={20} label={t('states.loading')} slowAfterMs={8000} /> : <span className="sr-only">{t('states.loading')}</span>}
    </div>
  );
}

/** Message traduit d'une erreur de l'API (`common:errors.*`), repli générique. */
export function useErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation('common');
  return (error) => {
    if (error instanceof DriveApiError) {
      const key = error.code.startsWith('local.') ? `errors.${error.code}` : `errors.api.${error.code}`;
      return t(key, { defaultValue: t('errors.generic') });
    }
    return t('errors.generic');
  };
}

export function PageError({ error, onRetry, fullPage = false }: { error: unknown; onRetry?: () => void; fullPage?: boolean }) {
  const { t } = useTranslation('common');
  const message = useErrorMessage();
  const state = (
    <EmptyState
      variant="page"
      icon={<CloudOff aria-hidden />}
      title={t('states.errorTitle')}
      description={message(error)}
      actions={
        onRetry ? (
          <Button variant="secondary" icon={<RotateCw aria-hidden />} onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        ) : undefined
      }
    />
  );
  if (!fullPage) return <div role="alert">{state}</div>;
  return (
    <main role="alert" className="flex min-h-dvh items-center justify-center bg-app px-4">
      {state}
    </main>
  );
}

/** Squelette de la coquille pendant le chargement de /me. */
export function ShellSkeleton() {
  const { t } = useTranslation('common');
  return (
    <div className="flex h-dvh bg-panel md:bg-rail" aria-busy="true">
      <span className="sr-only">{t('states.loading')}</span>
      <div className="hidden w-(--ud-rail-w) shrink-0 flex-col items-center gap-3 py-3 md:flex">
        <Skeleton className="size-[30px] rounded-lg" />
        <Skeleton className="mt-3 size-9 rounded-[12px]" />
      </div>
      <div className="flex min-w-0 flex-1 overflow-hidden bg-panel md:rounded-ss-[14px] md:border-s md:border-t md:border-line">
        <div className="hidden w-[248px] shrink-0 flex-col gap-2 border-e border-line bg-sidebar px-4 pt-5 md:flex">
          <Skeleton className="mb-3 h-4 w-32" />
          <Skeleton className="h-[30px] w-full rounded-md" />
          <Skeleton className="h-[30px] w-4/5 rounded-md" />
          <Skeleton className="h-[30px] w-3/5 rounded-md" />
        </div>
        <div className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
