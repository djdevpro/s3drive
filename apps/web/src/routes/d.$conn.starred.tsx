import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { starredSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/starred')({
  validateSearch: starredSearch,
  component: View,
});

function View() {
  return <Placeholder view="starred" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
