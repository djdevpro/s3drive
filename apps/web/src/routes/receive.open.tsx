import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';

export const Route = createFileRoute('/receive/open')({
  component: View,
});

function View() {
  return <Placeholder view="receiveOpen" values={{ ...Route.useParams() }} />;
}
