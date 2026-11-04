import { useRouter } from '@tanstack/react-router';
import type { MeResponse } from '@ud/contracts';
import { useEffect, type ReactNode } from 'react';
import { DriveApiError, isTermsRequired, loginPageHref, termsPageHref } from '../../lib/api/client';
import { useInstance, useMe } from '../../lib/api/queries/session';
import { AppShell } from './AppShell';
import { PageError, ShellSkeleton } from './PageStates';

/** Redirection au montage (remplace l'entrée d'historique). */
export function Redirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    void router.navigate({ href, replace: true });
  }, [href, router]);
  return null;
}

export function useCurrentHref(): string {
  const router = useRouter();
  const { pathname, search } = router.history.location;
  return `${pathname}${search}`;
}

/**
 * Garde des pages connectées du mode instance : charge `/me` et l'instance, renvoie vers /login
 * (401) ou /terms (conditions à accepter), puis rend la coquille autour du contenu.
 */
export function InstanceShell({ children }: { children: ReactNode | ((me: MeResponse) => ReactNode) }) {
  const me = useMe();
  const instance = useInstance();
  const current = useCurrentHref();

  if (me.error) {
    if (me.error instanceof DriveApiError && me.error.code === 'unauthorized') {
      return <Redirect href={loginPageHref({ reason: me.error.reason, next: current })} />;
    }
    if (isTermsRequired(me.error)) return <Redirect href={termsPageHref(current)} />;
    if (me.error instanceof DriveApiError && me.error.code === 'local.gate_expired') return <ShellSkeleton />;
    return <PageError fullPage error={me.error} onRetry={() => void me.refetch()} />;
  }
  if (!me.data || instance.isPending) return <ShellSkeleton />;
  if (me.data.terms.required) return <Redirect href={termsPageHref(current)} />;

  const name = instance.data?.name ?? '';
  return (
    <AppShell me={me.data} instanceName={name} personal={instance.data?.personal ?? false}>
      {typeof children === 'function' ? children(me.data) : children}
    </AppShell>
  );
}
