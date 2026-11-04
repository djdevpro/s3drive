import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { sharedSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/shared')({
  validateSearch: sharedSearch,
  component: View,
});

function View() {
  return <Placeholder view="shared" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
