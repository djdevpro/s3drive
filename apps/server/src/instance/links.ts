import { type Grants, INSTANCE_REASONS } from '@ud/contracts';
import { apiError } from '../errors.js';

// Liens de partage selon le rôle : prêt pour le lot de partage (04), qui l'appelle à la création.

export type LinkAudience = 'anyone' | 'password' | 'people';

export interface LinkRequest {
  audience: LinkAudience;
  /** Échéance (ms epoch), ou `null` pour un lien sans expiration. */
  expiresAt: number | null;
}

/** Lève 403 `scope_denied` + `link_policy` si les droits de liens ne permettent pas ce lien. */
export function checkLinkPolicy(grants: Grants, request: LinkRequest, now: number = Date.now()): void {
  const deny = (rule: string) => apiError('scope_denied', 'Link not allowed by your role', { reason: INSTANCE_REASONS.linkPolicy, rule });
  // « Mot de passe » reste une audience « tout le monde » protégée : elle exige `public`.
  if ((request.audience === 'anyone' || request.audience === 'password') && !grants.links.public) throw deny('public');
  if (request.audience === 'people' && !grants.links.people) throw deny('people');
  const maxDays = grants.links.maxDays;
  if (maxDays > 0) {
    if (request.expiresAt === null) throw deny('expiration_required');
    if (request.expiresAt > now + maxDays * 86_400_000) throw deny('max_days');
  }
}
