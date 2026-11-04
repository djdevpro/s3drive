import { createFileRoute, redirect } from '@tanstack/react-router';

// /d/$conn/b → accueil du stockage (replace).
export const Route = createFileRoute('/d/$conn/b/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/d/$conn', params: { conn: params.conn }, replace: true });
  },
});
