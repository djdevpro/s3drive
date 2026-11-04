import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { connectSearch } from './-lib/schemas';

export const Route = createFileRoute('/connect')({
  validateSearch: connectSearch,
  component: View,
});

function View() {
  return <Placeholder view="connect" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
