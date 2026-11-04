import { createFileRoute, redirect } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { ADMIN_TABS, adminSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/admin/$bucket/$tab')({
  validateSearch: adminSearch,
  beforeLoad: ({ params }) => {
    // Onglet inconnu → overview (replace).
    if (!(ADMIN_TABS as readonly string[]).includes(params.tab)) {
      throw redirect({ to: '/d/$conn/admin/$bucket/$tab', params: { ...params, tab: 'overview' }, replace: true });
    }
  },
  component: View,
});

function View() {
  return <Placeholder view="admin" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
