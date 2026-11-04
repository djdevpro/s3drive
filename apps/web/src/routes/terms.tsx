import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AuthCard, Button, Checkbox, Label, Skeleton } from '@ud/ui';
import { ExternalLink } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { AuthLogo, Callout, LanguagePicker } from '../components/shell/AuthBits';
import { Markdown, safeHref } from '../components/shell/markdown';
import { DriveApiError, loginPageHref, safeNext } from '../lib/api/client';
import { useAcceptTerms, useInstance, useTerms } from '../lib/api/queries/session';
import { Redirect } from '../components/shell/InstanceShell';
import { PageError, useErrorMessage } from '../components/shell/PageStates';

// /terms : texte des conditions (Markdown de GET /api/v1/me/terms, ou lien
// externe), case « J'ai lu et j'accepte », « Continuer », puis retour à l'URL demandée.
export const Route = createFileRoute('/terms')({
  validateSearch: z.object({ next: z.string().max(4096).optional().catch(undefined) }),
  component: Terms,
});

function Terms() {
  const { t } = useTranslation(['instance', 'common']);
  const { next } = Route.useSearch();
  const router = useRouter();
  const instance = useInstance();
  const terms = useTerms();
  const accept = useAcceptTerms();
  const errorMessage = useErrorMessage();
  const [checked, setChecked] = useState(false);
  const checkId = useId();
  const target = safeNext(next, '/');
  const current = `/terms${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  if (terms.error) {
    if (terms.error instanceof DriveApiError && terms.error.code === 'unauthorized') {
      return <Redirect href={loginPageHref({ reason: terms.error.reason, next: current })} />;
    }
    return <PageError fullPage error={terms.error} onRetry={() => void terms.refetch()} />;
  }
  const data = terms.data;
  // Aucune condition active, ou version déjà acceptée : rien à faire ici.
  if (data && (data.version === null || data.acceptedVersion === data.version)) return <Redirect href={target} />;

  const externalUrl = data?.url ? safeHref(data.url) : null;
  const submit = () => {
    if (!data?.version || !checked) return;
    accept.mutate(data.version, {
      onSuccess: () => void router.navigate({ href: target, replace: true }),
      // Version changée entre-temps : le nouveau texte est rechargé.
      onError: (error) => {
        if (error instanceof DriveApiError && error.reason === 'terms_version') void terms.refetch();
      },
    });
  };

  return (
    <AuthCard
      className="[&>div:last-child]:max-w-xl"
      logo={<AuthLogo name={instance.data?.name} />}
      title={t('instance:terms.title')}
      description={data?.version ? t('instance:terms.description', { version: data.version }) : undefined}
      actions={
        <Button variant="primary" size="lg" disabled={!data || !checked} loading={accept.isPending} onClick={submit}>
          {t('common:actions.continue')}
        </Button>
      }
      footer={<LanguagePicker />}
    >
      {!data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : (
        <>
          {data.markdown ? (
            <div
              tabIndex={0}
              role="region"
              aria-label={t('instance:terms.textLabel')}
              className="max-h-[50dvh] overflow-y-auto rounded-lg border border-line bg-app px-4 py-3 text-start outline-none focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Markdown source={data.markdown} headingOffset={1} />
            </div>
          ) : externalUrl ? (
            <Button asChild variant="secondary">
              <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                {t('instance:terms.openExternal')}
              </a>
            </Button>
          ) : null}
          <div className="flex items-start gap-3 pt-1 text-start">
            <Checkbox id={checkId} checked={checked} onCheckedChange={(value) => setChecked(value === true)} className="mt-0.5" />
            <Label htmlFor={checkId} className="text-row font-normal text-text-1">
              {t('instance:terms.accept')}
            </Label>
          </div>
          {accept.error && (
            <Callout role="alert" tone="danger" title={t('instance:terms.acceptFailed')}>
              {accept.error instanceof DriveApiError && accept.error.reason === 'terms_version' ? t('instance:terms.versionChanged') : errorMessage(accept.error)}
            </Callout>
          )}
        </>
      )}
    </AuthCard>
  );
}
