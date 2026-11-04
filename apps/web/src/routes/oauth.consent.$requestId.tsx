import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';

export const Route = createFileRoute('/oauth/consent/$requestId')({
  component: View,
});

function View() {
  return <Placeholder view="oauthConsent" values={{ ...Route.useParams() }} />;
}
