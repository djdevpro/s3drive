import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import type { DriveClient } from '@ud/sdk';
import { useDriveClient } from '../client';

// Requêtes du compte et de l'instance : GET /instance, /me, /me/terms ; POST /me/terms, /auth/logout.

export const sessionKeys = {
  instance: ['instance'] as const,
  me: ['me'] as const,
  terms: ['me', 'terms'] as const,
};

export const instanceQuery = (client: DriveClient) =>
  queryOptions({ queryKey: sessionKeys.instance, queryFn: () => client.instance(), staleTime: 5 * 60_000 });

export const meQuery = (client: DriveClient) =>
  queryOptions({ queryKey: sessionKeys.me, queryFn: () => client.me(), staleTime: 30_000 });

export const termsQuery = (client: DriveClient) =>
  queryOptions({ queryKey: sessionKeys.terms, queryFn: () => client.terms(), staleTime: 60_000 });

/** Description publique de l'instance (mode, connexion, nom, bouton de connexion). */
export function useInstance() {
  return useQuery(instanceQuery(useDriveClient()));
}

/** Personne connectée, ses espaces, son quota et ses droits ; `enabled: false` pour ne pas la demander. */
export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery({ ...meQuery(useDriveClient()), enabled: options.enabled ?? true });
}

export function useTerms() {
  return useQuery(termsQuery(useDriveClient()));
}

export function useAcceptTerms() {
  const client = useDriveClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => client.acceptTerms(version),
    onSuccess: async () => {
      // Les refus `terms_required` mis en cache n'ont plus lieu d'être.
      await queryClient.invalidateQueries();
    },
  });
}

/**
 * Déconnexion : supprime la session, vide le cache, puis navigue vers la déconnexion du
 * fournisseur (`endSessionUrl`) ou, à défaut, vers /login.
 */
export function useLogout() {
  const client = useDriveClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => client.logout(),
    onSuccess: ({ endSessionUrl }) => {
      queryClient.clear();
      if (endSessionUrl) window.location.assign(endSessionUrl);
      else void router.navigate({ href: '/login', replace: true });
    },
  });
}
