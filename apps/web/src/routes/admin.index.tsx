import { createFileRoute, useRouter } from '@tanstack/react-router';
import { ADMIN_USER_SORTS } from '@ud/contracts';
import { useCallback } from 'react';
import { z } from 'zod';
import { UsersTable } from '../components/admin/UsersTable';

// /admin : liste des personnes ; recherche et tri partageables dans l'URL.
export const Route = createFileRoute('/admin/')({
  validateSearch: z.object({
    q: z.string().max(200).optional().catch(undefined),
    sort: z.enum(ADMIN_USER_SORTS).optional().catch(undefined),
    dir: z.enum(['asc', 'desc']).optional().catch(undefined),
  }),
  component: AdminUsers,
});

function AdminUsers() {
  const { q, sort, dir } = Route.useSearch();
  const router = useRouter();
  // URL canonique `/admin?…` (sans `/` final), état partageable.
  const onSearchChange = useCallback(
    (next: { q?: string | undefined; sort?: (typeof ADMIN_USER_SORTS)[number] | undefined; dir?: 'asc' | 'desc' | undefined }) => {
      const search = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
      void router.navigate({ href: `/admin${router.options.stringifySearch(search)}`, replace: true });
    },
    [router],
  );
  return <UsersTable q={q} sort={sort} dir={dir} onSearchChange={onSearchChange} />;
}
