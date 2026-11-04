import { createFileRoute, redirect } from '@tanstack/react-router';
import { homeHref, isInstanceConnection } from '../components/shell/helpers';
import { Placeholder } from './-lib/Placeholder';
import { CONN_ID, homeSearch } from './-lib/schemas';

// Accueil du stockage. Connexion de l'instance : « Mon drive » (`/d/<connexion>/b/home/`, replace).
export const Route = createFileRoute('/d/$conn/')({
  validateSearch: homeSearch,
  beforeLoad: ({ params }) => {
    if (!CONN_ID.test(params.conn) && isInstanceConnection(params.conn)) {
      throw redirect({ href: homeHref(params.conn), replace: true });
    }
  },
  component: View,
});

function View() {
  return <Placeholder view="home" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
