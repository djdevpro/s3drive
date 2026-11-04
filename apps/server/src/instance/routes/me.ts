import { HOME_SPACE, type MeResponse, type TermsResponse, acceptTermsRequestSchema } from '@ud/contracts';
import type { Hono } from 'hono';
import { apiError } from '../../errors.js';
import { clientIp } from '../../request.js';
import { requireUser } from '../auth.js';
import { type InstanceEnv, type InstanceRuntime, actorOf, termsActive, termsRequired } from '../runtime.js';
import { spaceBucket, visibleSpaces } from '../spaces.js';
import { parseJson } from './util.js';

// Compte : GET /me, conditions d'utilisation.

const TERMS_TEXT_PATH = '/api/v1/me/terms';

export function registerMeRoutes(app: Hono<InstanceEnv>, rt: InstanceRuntime): void {
  const beforeTerms = requireUser(rt, { beforeTerms: true });

  app.get('/api/v1/me', beforeTerms, (c) => {
    const principal = c.get('principal');
    const user = c.var.user;
    const spaces = visibleSpaces(rt, principal).map((id) => {
      const b = spaceBucket(rt, principal, id);
      return { id, label: b.label, scopes: b.scopes, quota: b.quota, usage: b.usage };
    });
    const home = rt.usage.get(HOME_SPACE, principal.userId);
    const active = termsActive(rt);
    const body: MeResponse = {
      user: { id: user.id, email: user.email, name: user.name, roles: principal.roles },
      connection: rt.config.connection,
      spaces,
      quota: { limit: principal.grants.quota, used: home.bytes, reserved: home.reserved },
      links: principal.grants.links,
      admin: principal.grants.admin,
      superAdmin: principal.grants.superAdmin,
      terms: {
        required: termsRequired(rt, user),
        version: active ? rt.config.legal.termsVersion : null,
        url: active ? (rt.config.legal.termsUrl ?? TERMS_TEXT_PATH) : null,
      },
    };
    return c.json(body);
  });

  app.get('/api/v1/me/terms', beforeTerms, (c) => {
    const active = termsActive(rt);
    const body: TermsResponse = {
      version: active ? rt.config.legal.termsVersion : null,
      markdown: active ? rt.termsMarkdown : null,
      url: active ? rt.config.legal.termsUrl : null,
      acceptedVersion: c.var.user.terms_version,
    };
    return c.json(body);
  });

  app.post('/api/v1/me/terms', beforeTerms, async (c) => {
    const { version } = await parseJson(c, acceptTermsRequestSchema);
    if (!termsActive(rt)) throw apiError('not_found', 'No terms to accept');
    if (version !== rt.config.legal.termsVersion) {
      throw apiError('conflict', 'Terms version changed', { reason: 'terms_version', current: rt.config.legal.termsVersion });
    }
    const user = c.var.user;
    rt.users.acceptTerms(user.id, version);
    rt.audit.write({
      connectionId: rt.config.connection,
      source: 'web',
      actor: actorOf(user.id),
      action: 'account.accept_terms',
      details: { version },
      ip: clientIp(c, rt.requestEnv),
    });
    return c.body(null, 204);
  });
}
