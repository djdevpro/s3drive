import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { searchSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/search')({
  validateSearch: searchSearch,
  component: View,
});

function View() {
  return <Placeholder view="search" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
