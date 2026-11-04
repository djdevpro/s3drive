import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { accountsSearch } from './-lib/schemas';

export const Route = createFileRoute('/accounts')({
  validateSearch: accountsSearch,
  component: View,
});

function View() {
  return <Placeholder view="accounts" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
