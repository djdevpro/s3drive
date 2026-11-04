import { createFileRoute } from '@tanstack/react-router';
import { Placeholder } from './-lib/Placeholder';
import { jobsSearch } from './-lib/schemas';

export const Route = createFileRoute('/d/$conn/jobs')({
  validateSearch: jobsSearch,
  component: View,
});

function View() {
  return <Placeholder view="jobs" values={{ ...Route.useParams(), ...Route.useSearch() }} />;
}
