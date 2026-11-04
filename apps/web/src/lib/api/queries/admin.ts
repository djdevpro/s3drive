import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, AdminUserPatch, MeResponse } from '@ud/contracts';
import type { DriveClient } from '@ud/sdk';
import { useDriveClient } from '../client';

// Administration des personnes : liste par curseur, fiche, dérogation de quota,
// suspension, recalcul de l'usage.

export const ADMIN_PAGE_SIZE = 50;

export interface AdminUsersParams {
  q?: string | undefined;
  sort?: string | undefined;
  dir?: 'asc' | 'desc' | undefined;
}

export const adminKeys = {
  all: ['admin'] as const,
  users: (params: AdminUsersParams) => ['admin', 'users', { q: params.q ?? '', sort: params.sort ?? 'name', dir: params.dir ?? 'asc' }] as const,
  user: (id: string) => ['admin', 'user', id] as const,
};

/** Droit de lire la console (`users.read`, ou super admin). */
export function canReadUsers(me: Pick<MeResponse, 'admin' | 'superAdmin'> | undefined): boolean {
  return !!me && (me.superAdmin || me.admin.includes('users.read'));
}

/** Droit d'agir sur une personne (`users.manage`, ou super admin). */
export function canManageUsers(me: Pick<MeResponse, 'admin' | 'superAdmin'> | undefined): boolean {
  return !!me && (me.superAdmin || me.admin.includes('users.manage'));
}

export const adminUsersQuery = (client: DriveClient, params: AdminUsersParams) =>
  infiniteQueryOptions({
    queryKey: adminKeys.users(params),
    queryFn: ({ pageParam }) =>
      client.admin.users({
        ...(params.q ? { q: params.q } : {}),
        ...(params.sort ? { sort: params.sort } : {}),
        ...(params.dir ? { dir: params.dir } : {}),
        cursor: pageParam,
        limit: ADMIN_PAGE_SIZE,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 15_000,
  });

export const adminUserQuery = (client: DriveClient, id: string) =>
  queryOptions({ queryKey: adminKeys.user(id), queryFn: () => client.admin.user(id), staleTime: 15_000 });

export function useAdminUsers(params: AdminUsersParams) {
  return useInfiniteQuery(adminUsersQuery(useDriveClient(), params));
}

export function useAdminUser(id: string) {
  return useQuery(adminUserQuery(useDriveClient(), id));
}

function useStoreUser() {
  const queryClient = useQueryClient();
  return (user: AdminUser) => {
    queryClient.setQueryData(adminKeys.user(user.id), user);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  };
}

export function useUpdateAdminUser(id: string) {
  const client = useDriveClient();
  const store = useStoreUser();
  return useMutation({ mutationFn: (patch: AdminUserPatch) => client.admin.updateUser(id, patch), onSuccess: store });
}

export function useRecountAdminUser(id: string) {
  const client = useDriveClient();
  const store = useStoreUser();
  return useMutation({ mutationFn: () => client.admin.recount(id), onSuccess: store });
}
