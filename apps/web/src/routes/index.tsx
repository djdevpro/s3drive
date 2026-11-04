import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { homeHref } from '../components/shell/helpers';
import { Redirect } from '../components/shell/InstanceShell';
import { PageError, PageLoading } from '../components/shell/PageStates';
import { DriveApiError, isTermsRequired, loginPageHref, termsPageHref } from '../lib/api/client';
import { useInstance, useMe } from '../lib/api/queries/session';
import { Placeholder } from './-lib/Placeholder';
import { indexSearch } from './-lib/schemas';

// `/` : en mode instance, « Mon drive » si une session est ouverte, sinon /login.
// Mode personnel : dernier stockage, sinon /accounts ou /connect.
export const Route = createFileRoute('/')({
  validateSearch: indexSearch,
  component: Home,
});

function Home() {
  const instance = useInstance();
  if (instance.isPending) return <PageLoading />;
  if (instance.error) return <PageError fullPage error={instance.error} onRetry={() => void instance.refetch()} />;
  if (instance.data.mode === 'personal' || !instance.data.connection) return <PersonalHome />;
  return <InstanceHome />;
}

function InstanceHome() {
  const me = useMe();
  if (me.error) {
    if (me.error instanceof DriveApiError && me.error.code === 'unauthorized') return <Redirect href={loginPageHref({ reason: me.error.reason })} />;
    if (isTermsRequired(me.error)) return <Redirect href={termsPageHref()} />;
    return <PageError fullPage error={me.error} onRetry={() => void me.refetch()} />;
  }
  if (!me.data) return <PageLoading />;
  const home = homeHref(me.data.connection);
  return <Redirect href={me.data.terms.required ? termsPageHref(home) : home} />;
}

function PersonalHome() {
  const { t } = useTranslation('common');
  const search = Route.useSearch();
  return (
    <main>
      <header className="px-6 pt-6">
        <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
        <p>{t('app.tagline')}</p>
      </header>
      <Placeholder view="index" values={search} level={2} />
    </main>
  );
}
