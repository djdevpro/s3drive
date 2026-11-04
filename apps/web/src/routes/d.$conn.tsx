import { Outlet, createFileRoute } from '@tanstack/react-router';
import { isInstanceConnection } from '../components/shell/helpers';
import { InstanceShell } from '../components/shell/InstanceShell';
import { PageError, ShellSkeleton } from '../components/shell/PageStates';
import { meQuery, useInstance } from '../lib/api/queries/session';
import { Placeholder } from './-lib/Placeholder';
import { CONN_ID, connLayoutSearch } from './-lib/schemas';

// Disposition du stockage. Connexion de l'instance (`drive`…) : coquille du mode
// instance (barre latérale, barre du haut, garde de session). Stockage personnel (10 caractères
// base62) : contrôle de session et capacités à venir.
export const Route = createFileRoute('/d/$conn')({
  validateSearch: connLayoutSearch,
  beforeLoad: ({ params, context }) => {
    // /me part en même temps que /instance.
    if (!CONN_ID.test(params.conn) && isInstanceConnection(params.conn)) void context.queryClient.prefetchQuery(meQuery(context.driveClient));
  },
  component: ConnLayout,
});

function ConnLayout() {
  const { conn } = Route.useParams();
  if (CONN_ID.test(conn)) return <Outlet />;
  // Identifiant mal formé → écran « lien mal formé ».
  if (!isInstanceConnection(conn)) return <Placeholder view="malformed" values={{ conn }} />;
  return <InstanceConnection conn={conn} />;
}

function InstanceConnection({ conn }: { conn: string }) {
  const instance = useInstance();
  if (instance.isPending) return <ShellSkeleton />;
  if (instance.error) return <PageError fullPage error={instance.error} onRetry={() => void instance.refetch()} />;
  // Une autre connexion que celle de l'instance n'existe pas ici.
  if (instance.data.connection !== conn) return <Placeholder view="malformed" values={{ conn }} />;
  return (
    <InstanceShell>
      <Outlet />
    </InstanceShell>
  );
}
