import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/d/$conn/access/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/d/$conn/access/$tab', params: { ...params, tab: 'tokens' }, replace: true });
  },
});
