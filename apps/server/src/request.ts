import type { Context } from 'hono';

// Informations sur la requête : origine publique, IP du client, agent.

export interface RequestEnv {
  publicUrl: string | undefined;
  trustProxy: boolean;
}

/** Origine publique : `UD_PUBLIC_URL`, sinon schéma + `Host` (en-têtes `X-Forwarded-*` derrière un proxy de confiance). */
export function publicOrigin(c: Context, env: RequestEnv): string {
  if (env.publicUrl) return new URL(env.publicUrl).origin;
  const url = new URL(c.req.url);
  let proto = url.protocol.replace(':', '');
  let host = c.req.header('host') ?? url.host;
  if (env.trustProxy) {
    proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || proto;
    host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim() || host;
  }
  return `${proto}://${host}`;
}

/** Base des URL absolues de l'appli (`UD_PUBLIC_URL` avec son chemin éventuel, sinon l'origine). */
export function publicBase(c: Context, env: RequestEnv): string {
  return env.publicUrl ?? publicOrigin(c, env);
}

export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith('https://');
}

/** IP du client : dernière entrée de `X-Forwarded-For` derrière un proxy de confiance, sinon la socket. */
export function clientIp(c: Context, env: RequestEnv): string | null {
  if (env.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const parts = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
      const last = parts.at(-1);
      if (last) return last;
    }
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  const address = incoming?.socket?.remoteAddress;
  return address ? address.replace(/^::ffff:/, '') : null;
}

export function userAgent(c: Context): string | null {
  const ua = c.req.header('user-agent');
  return ua ? ua.slice(0, 300) : null;
}
