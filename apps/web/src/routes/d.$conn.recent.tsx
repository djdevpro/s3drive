import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { recentSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/recent')({
  validateSearch: recentSearch,
  component: View,
});

function View() {
  return <Placeholder view="recent" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
