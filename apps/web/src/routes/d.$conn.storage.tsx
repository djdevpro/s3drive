import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { storageSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/storage')({
  validateSearch: storageSearch,
  component: View,
});

function View() {
  return <Placeholder view="storage" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
