import { createFileRoute } from '@tanstack/react-router';
import { LOGIN_ERRORS, type LoginError } from '@ud/contracts';
import { AuthCard, Button, Skeleton } from '@ud/ui';
import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { AuthLogo, Callout, type CalloutTone, LanguagePicker } from '../components/shell/AuthBits';
import { Redirect } from '../components/shell/InstanceShell';
import { PageError } from '../components/shell/PageStates';
import { safeNext, useDriveClient } from '../lib/api/client';
import { useInstance, useMe } from '../lib/api/queries/session';

// /login : nom de l'instance, « Se connecter avec <label> » (navigation réseau vers
// /api/v1/auth/oidc/login?next=), message du refus précédent ; en mode `both`, lien vers /connect.
export const Route = createFileRoute('/login')({
  validateSearch: z.object({
    next: z.string().max(4096).optional().catch(undefined),
    error: z.enum(LOGIN_ERRORS).optional().catch(undefined),
  }),
  component: Login,
});

const TONES: Record<LoginError, CalloutTone> = {
  no_role: 'danger',
  suspended: 'danger',
  session_ended: 'warning',
  idp_unreachable: 'warning',
  oidc_error: 'danger',
};

function Login() {
  const { t } = useTranslation(['instance', 'common']);
  const { next, error } = Route.useSearch();
  const client = useDriveClient();
  const instance = useInstance();
  // Session déjà ouverte : retour direct à l'URL demandée.
  const me = useMe({ enabled: instance.data?.mode !== undefined && instance.data.mode !== 'personal' && !error });
  const target = safeNext(next, '/');

  if (me.data) return <Redirect href={target} />;
  if (instance.error) return <PageError fullPage error={instance.error} onRetry={() => void instance.refetch()} />;

  const info = instance.data;
  const login = info?.login ?? null;
  return (
    <AuthCard
      logo={<AuthLogo />}
      title={info ? <bdi>{info.name}</bdi> : <Skeleton className="mx-auto h-7 w-48" />}
      description={t('instance:login.description')}
      actions={
        info ? (
          login ? (
            <Button asChild variant="primary" size="lg">
              <a href={client.loginHref(target === '/' ? undefined : target)} data-testid="oidc-login">
                <LogIn aria-hidden className="rtl:-scale-x-100" />
                {t('instance:login.signInWith', { label: login.label })}
              </a>
            </Button>
          ) : null
        ) : (
          <Skeleton className="h-10 w-full rounded-md" />
        )
      }
      footer={
        <div className="flex flex-col items-center gap-3">
          {info?.personal && (
            <a href={next ? `/connect?next=${encodeURIComponent(target)}` : '/connect'} className="text-ud-accent-strong underline-offset-4 hover:underline">
              {t('instance:login.personal')}
            </a>
          )}
          <LanguagePicker />
        </div>
      }
    >
      {error && (
        <Callout role="alert" tone={TONES[error]} title={t(`instance:login.errors.${error}.title`)}>
          {t(`instance:login.errors.${error}.body`)}
        </Callout>
      )}
      {info && !login && (
        <Callout tone="neutral" title={t('instance:login.noProvider.title')}>
          {t('instance:login.noProvider.body')}
        </Callout>
      )}
    </AuthCard>
  );
}
