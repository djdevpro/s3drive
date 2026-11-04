import { createFileRoute, redirect } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { ACCESS_TABS, accessSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/access/$tab')({
  validateSearch: accessSearch,
  beforeLoad: ({ params }) => {
    // Onglet inconnu → tokens (replace).
    if (!(ACCESS_TABS as readonly string[]).includes(params.tab)) {
      throw redirect({ to: '/d/$conn/access/$tab', params: { ...params, tab: 'tokens' }, replace: true });
    }
  },
  component: View,
});

function View() {
  return <Placeholder view="access" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
