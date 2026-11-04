import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';

export const Route = createFileRoute('/share-target')({
  component: View,
});

function View() {
  return <Placeholder view="shareTarget" values={{ ...Route.useParams() }} />;
}
