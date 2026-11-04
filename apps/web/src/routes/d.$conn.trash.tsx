import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { trashSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/trash')({
  validateSearch: trashSearch,
  component: View,
});

function View() {
  return <Placeholder view="trash" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
