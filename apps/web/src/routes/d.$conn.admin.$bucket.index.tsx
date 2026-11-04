import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/d/$conn/admin/$bucket/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/d/$conn/admin/$bucket/$tab', params: { ...params, tab: 'overview' }, replace: true });
  },
});
