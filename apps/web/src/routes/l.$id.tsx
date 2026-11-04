import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Placeholder } from './-lib/Placeholder';

// Filet de sécurité (P1) : /l/* est servi par Hono (302) ; navigation complète.
export const Route = createFileRoute('/l/$id')({
  component: ShortLink,
});

function ShortLink() {
  const { id } = Route.useParams();
  useEffect(() => {
    window.location.replace(`/l/${encodeURIComponent(id)}`);
  }, [id]);
  return <Placeholder view="shortLink" values={{ id }} />;
}
