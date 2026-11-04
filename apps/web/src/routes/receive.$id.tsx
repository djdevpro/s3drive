import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';

export const Route = createFileRoute('/receive/$id')({
  component: View,
});

function View() {
  return <Placeholder view="receive" values={{ ...Route.useParams() }} />;
}
