import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';

export const Route = createFileRoute('/connect_/device')({
  component: View,
});

function View() {
  return <Placeholder view="connectDevice" values={{ ...Route.useParams() }} />;
}
