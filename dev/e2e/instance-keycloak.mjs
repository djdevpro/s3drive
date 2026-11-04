// Essai réel du mode instance avec le Keycloak de développement et le RustFS local.
// Node 24, fetch seul, sans navigateur : redirections suivies à la main, formulaire de connexion
// Keycloak lu dans le HTML, cookies gardés par origine.
//
// Prérequis : docker compose -f compose.dev.yaml --profile iam up -d ; node dev/s3-bucket.mjs
// Usage     : node dev/e2e/instance-keycloak.mjs
//
// Par défaut le script lance lui-même le serveur (mode instance, base SQLite temporaire).
// UD_PUBLIC_URL vaut toujours http://localhost:8080 (redirection enregistrée chez Keycloak) ; si le
// port 8080 local est pris, le serveur écoute ailleurs (UD_E2E_PORT, sinon 18080) et le script
// réécrit l'origine publique vers ce port : Keycloak ne voit que l'URL publique.
// UD_E2E_SERVER=external : serveur déjà lancé (UD_E2E_SERVER_URL, UD_E2E_DB = sa base SQLite).
// UD_E2E_SERVER_LOG=1 : affiche le journal du serveur à la fin.
// Sortie : code 0 seulement si toutes les étapes passent.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

// node:sqlite est encore « expérimental » en Node 24 : avertissement masqué, import différé.
process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC_URL = 'http://localhost:8080';
const KC_URL = process.env.UD_E2E_KC_URL || 'http://localhost:8180';
const REALM = 'ud-dev';
const ISSUER = `${KC_URL}/realms/${REALM}`;
const REFRESH_SECONDS = 10;
const BUCKET = 'ud-dev-drive';
const S3_ENDPOINT = 'http://127.0.0.1:9000';
const KC_ADMIN = { username: process.env.UD_DEV_KC_ADMIN || 'admin', password: process.env.UD_DEV_KC_ADMIN_PASSWORD || 'ud-dev-kc-admin' };

// Personnes et secret du client : lus dans la graine du realm (une seule source pour les valeurs de test).
const realm = JSON.parse(readFileSync(join(ROOT, 'dev/keycloak/ud-dev-realm.json'), 'utf8'));
const driveClient = realm.clients.find((c) => c.clientId === 'drive');
const people = Object.fromEntries(
  realm.users.map((u) => [u.username, { username: u.username, password: u.credentials[0].value, email: u.email, name: `${u.firstName} ${u.lastName}` }]),
);
const ALICE = people.alice; // rôle user
const BRUNO = people.bruno; // rôle admin
const CHLOE = people.chloe; // rôle super-admin
const DAMIEN = people.damien; // aucun rôle Drive

// ---------- Affichage et assertions ----------

let stepCount = 0;
let failed = false;
const t0 = Date.now();

function log(line) {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${line}`);
}

class CheckError extends Error {}

function check(condition, message, detail) {
  if (!condition) throw new CheckError(detail === undefined ? message : `${message} — obtenu : ${JSON.stringify(detail)}`);
}

async function step(title, fn) {
  stepCount += 1;
  const n = String(stepCount).padStart(2, '0');
  try {
    const note = await fn();
    log(`OK    ${n}. ${title}${note ? ` (${note})` : ''}`);
  } catch (err) {
    failed = true;
    log(`ÉCHEC ${n}. ${title}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
    if (!(err instanceof CheckError) && err instanceof Error && err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
    const out = serverOutput().trim();
    if (out) console.log(`        journal du serveur (fin) :\n${out.split('\n').slice(-15).map((l) => `        | ${l}`).join('\n')}`);
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Client HTTP avec cookies ----------

let serverOrigin = PUBLIC_URL;

/** URL réellement appelée : l'origine publique du Drive est réécrite vers l'adresse d'écoute. */
function physical(url) {
  const u = new URL(url);
  if (u.origin === PUBLIC_URL) return new URL(u.pathname + u.search, serverOrigin);
  return u;
}

class Agent {
  constructor(label) {
    this.label = label;
    this.jars = new Map();
  }

  jar(origin) {
    if (!this.jars.has(origin)) this.jars.set(origin, new Map());
    return this.jars.get(origin);
  }

  cookie(origin, name) {
    return this.jar(origin).get(name);
  }

  async fetch(url, init = {}) {
    const logical = new URL(url, PUBLIC_URL);
    const jar = this.jar(logical.origin);
    const headers = new Headers(init.headers);
    if (jar.size > 0) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(physical(logical.href), { ...init, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a) || /^\s*expires\s*=\s*thu, 01 jan 1970/i.test(a));
      if (expired || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }

  /** Appel de l'API du Drive : en-tête anti-CSRF et Origin publique, corps JSON. */
  async api(path, { method = 'GET', body } = {}) {
    const headers = { 'x-ud': '1', origin: PUBLIC_URL, 'sec-fetch-site': 'same-origin' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetch(`${PUBLIC_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/**
 * Connexion complète : Drive → Keycloak (formulaire) → callback du Drive.
 * Renvoie l'URL finale de redirection du Drive (`next` ou `/login?error=…`) et l'URL d'autorisation.
 */
async function login(agent, person, next = '/d/drive/b/home/') {
  const start = await agent.fetch(`${PUBLIC_URL}/api/v1/auth/oidc/login?next=${encodeURIComponent(next)}`);
  check(start.status === 302, 'login : 302 attendu', start.status);
  const authorize = new URL(start.headers.get('location'));
  check(authorize.href.startsWith(`${ISSUER}/protocol/openid-connect/auth`), 'login : redirection vers Keycloak', authorize.origin + authorize.pathname);

  let page = await agent.fetch(authorize.href);
  // Session Keycloak déjà ouverte dans ce « navigateur » : redirection directe.
  let callback;
  if (page.status === 302) {
    callback = page.headers.get('location');
  } else {
    check(page.status === 200, 'Keycloak : page de connexion attendue', page.status);
    const html = await page.text();
    const form = html.match(/<form[^>]*id="kc-form-login"[^>]*>/i)?.[0];
    check(form, 'Keycloak : formulaire kc-form-login introuvable');
    const action = decodeHtml(form.match(/action="([^"]+)"/i)[1]);
    const posted = await agent.fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: person.username, password: person.password, credentialId: '' }).toString(),
    });
    if (posted.status !== 302) {
      const body = await posted.text();
      const err = body.match(/id="input-error"[^>]*>([^<]*)/i)?.[1] ?? body.match(/kc-feedback-text[^>]*>([^<]*)/i)?.[1];
      check(false, `Keycloak : connexion de ${person.username} refusée (${err?.trim() ?? `HTTP ${posted.status}`})`);
    }
    callback = posted.headers.get('location');
  }
  check(callback?.startsWith(`${PUBLIC_URL}/api/v1/auth/oidc/callback?`), 'Keycloak : retour vers le callback du Drive', callback);
  const done = await agent.fetch(callback);
  check(done.status === 302, 'callback : 302 attendu', done.status);
  return { location: done.headers.get('location'), authorize };
}

async function acceptTerms(agent) {
  const terms = await agent.api('/api/v1/me/terms');
  check(terms.status === 200 && terms.body.version, 'GET /me/terms', terms);
  const accepted = await agent.api('/api/v1/me/terms', { method: 'POST', body: { version: terms.body.version } });
  check(accepted.status === 204, 'POST /me/terms : 204 attendu', accepted.status);
  return terms.body.version;
}

// ---------- API d'administration de Keycloak ----------

const kcAdmin = {
  token: null,
  async auth() {
    const res = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', ...KC_ADMIN }).toString(),
    });
    check(res.ok, 'Keycloak admin : jeton refusé (UD_DEV_KC_ADMIN / UD_DEV_KC_ADMIN_PASSWORD ?)', res.status);
    this.token = (await res.json()).access_token;
  },
  async call(path, { method = 'GET', body } = {}) {
    // Jetons du realm master : 60 s ; on en reprend un à chaque appel.
    await this.auth();
    const res = await fetch(`${KC_URL}/admin/realms/${REALM}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    check(res.ok, `Keycloak admin : ${method} ${path}`, res.status);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  },
  async userId(username) {
    const [user] = await this.call(`/users?exact=true&username=${encodeURIComponent(username)}`);
    check(user, `Keycloak : personne ${username} introuvable`);
    return user.id;
  },
  async clientUuid() {
    const [client] = await this.call('/clients?clientId=drive');
    return client.id;
  },
  async clientRole(name) {
    return this.call(`/clients/${await this.clientUuid()}/roles/${name}`);
  },
  async removeClientRole(username, role) {
    const uid = await this.userId(username);
    const r = await this.clientRole(role);
    await this.call(`/users/${uid}/role-mappings/clients/${r.containerId}`, { method: 'DELETE', body: [{ id: r.id, name: r.name }] });
  },
  async addClientRole(username, role) {
    const uid = await this.userId(username);
    const r = await this.clientRole(role);
    await this.call(`/users/${uid}/role-mappings/clients/${r.containerId}`, { method: 'POST', body: [{ id: r.id, name: r.name }] });
  },
  async sessions(username) {
    return this.call(`/users/${await this.userId(username)}/sessions`);
  },
  async logoutUser(username) {
    await this.call(`/users/${await this.userId(username)}/logout`, { method: 'POST' });
  },
};

// ---------- Serveur ----------

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

let server = null;
let dataDir = null;
let dbPath = null;

async function startServer() {
  if (process.env.UD_E2E_SERVER === 'external') {
    serverOrigin = process.env.UD_E2E_SERVER_URL || PUBLIC_URL;
    dbPath = process.env.UD_E2E_DB || join(ROOT, 'data/ud.sqlite');
    return `serveur externe ${serverOrigin}`;
  }
  let port = Number(process.env.UD_E2E_PORT || 0);
  if (!port) port = (await portFree(8080)) ? 8080 : 18080;
  check(await portFree(port), `port ${port} déjà pris (UD_E2E_PORT)`);
  serverOrigin = `http://127.0.0.1:${port}`;
  dataDir = mkdtempSync(join(tmpdir(), 'ud-e2e-'));
  dbPath = join(dataDir, 'ud.sqlite');
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(port),
    UD_DATA_DIR: dataDir,
    UD_MODE: 'instance',
    UD_CONFIG: 'dev/drive.config.dev.yaml',
    UD_TERMS_FILE: 'dev/terms.dev.md',
    UD_ALLOW_PRIVATE_ENDPOINTS: '1',
    UD_PUBLIC_URL: PUBLIC_URL,
    UD_OIDC_REFRESH_SECONDS: String(REFRESH_SECONDS),
    UD_OIDC_ISSUER: ISSUER,
    UD_OIDC_CLIENT_ID: 'drive',
    UD_OIDC_CLIENT_SECRET: driveClient.secret,
    UD_DEV_S3_ACCESS_KEY: process.env.UD_DEV_S3_ACCESS_KEY || 'udadmin',
    UD_DEV_S3_SECRET_KEY: process.env.UD_DEV_S3_SECRET_KEY || 'udadmin-dev-secret',
    UD_IP_MODE: 'full',
    INIT_CWD: ROOT,
  };
  server = spawn(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), '--conditions=@ud/source', 'apps/server/src/index.ts'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  serverOutput = () => output;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) check(false, `le serveur s'est arrêté :\n${output}`);
    try {
      const res = await fetch(`${serverOrigin}/healthz`);
      if (res.ok) return `écoute ${serverOrigin}, UD_PUBLIC_URL=${PUBLIC_URL}, base ${dbPath}`;
    } catch {}
    await sleep(200);
  }
  check(false, `serveur injoignable :\n${output}`);
}

/** Journal du serveur lancé par le script (affiché en cas d'échec). */
let serverOutput = () => '';

// ---------- Nettoyage ----------

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.UD_DEV_S3_ACCESS_KEY || 'udadmin', secretAccessKey: process.env.UD_DEV_S3_SECRET_KEY || 'udadmin-dev-secret' },
});

/** Préfixes réels des drives personnels des personnes créées par l'essai. */
const createdPrefixes = new Set();
/** Rôles retirés pendant l'essai, à remettre. */
const removedRoles = [];

/** Attributs du client drive à remettre après l'étape du jeton expiré. */
let restoreClient = null;

async function restoreDriveClient() {
  if (!restoreClient) return;
  const current = await kcAdmin.call(`/clients/${restoreClient.id}`);
  // Keycloak garde les attributs absents du PUT : un attribut ajouté est remis à vide (valeur du realm).
  const attributes = { ...restoreClient.attributes };
  for (const name of Object.keys(current.attributes)) if (!(name in attributes)) attributes[name] = '';
  await kcAdmin.call(`/clients/${restoreClient.id}`, { method: 'PUT', body: { ...current, attributes } });
  restoreClient = null;
}

async function cleanup() {
  try {
    await restoreDriveClient();
  } catch (err) {
    log(`nettoyage : client drive non remis (${err.message})`);
  }
  for (const { username, role } of removedRoles.splice(0)) {
    try {
      await kcAdmin.addClientRole(username, role);
      log(`nettoyage : rôle ${role} remis à ${username}`);
    } catch (err) {
      log(`nettoyage : impossible de remettre ${role} à ${username} (${err.message})`);
    }
  }
  for (const prefix of createdPrefixes) {
    try {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
      const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key }));
      if (keys.length) {
        await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
        log(`nettoyage : ${keys.length} objet(s) supprimé(s) sous ${prefix}`);
      }
    } catch (err) {
      log(`nettoyage : S3 ${prefix} (${err.name})`);
    }
  }
  for (const p of Object.values(people)) {
    try {
      await kcAdmin.logoutUser(p.username);
    } catch {}
  }
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((r) => server.once('exit', r));
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

// ---------- Parcours ----------

const ids = {};
const FILE_KEY = 'e2e/rapport-5mo.bin';
const FILE_SIZE = 5_000_000;
const QUOTA = 1_000_000_000;

function uploadLog(userId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM upload_log WHERE user_id = ? ORDER BY at').all(userId);
  } finally {
    db.close();
  }
}

/** PUT sur l'URL présignée avec les en-têtes signés (la longueur est celle du corps envoyé). */
async function putPresigned(created, body) {
  const headers = { ...created.headers };
  delete headers['content-length'];
  delete headers['host'];
  return fetch(created.url, { method: 'PUT', headers, body });
}

async function main() {
  const alice = new Agent('alice');
  const bruno = new Agent('bruno');
  const chloe = new Agent('chloe');
  const damien = new Agent('damien');

  await step('Keycloak : découverte du realm ud-dev', async () => {
    const res = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    check(res.ok, 'découverte OIDC injoignable (docker compose -f compose.dev.yaml --profile iam up -d)', res.status);
    const meta = await res.json();
    check(meta.issuer === ISSUER, 'issuer', meta.issuer);
    check(meta.code_challenge_methods_supported?.includes('S256'), 'S256 annoncé');
    return `issuer ${meta.issuer}`;
  });

  await step('Keycloak : réglages du realm et du client drive (API d\'administration)', async () => {
    const r = await kcAdmin.call('');
    check(r.registrationAllowed === false, 'inscription désactivée', r.registrationAllowed);
    check(r.bruteForceProtected === true, 'force brute', r.bruteForceProtected);
    check(r.defaultLocale === 'fr', 'langue par défaut', r.defaultLocale);
    check(r.accessTokenLifespan === 300, 'durée des jetons d\'accès', r.accessTokenLifespan);
    const [c] = await kcAdmin.call('/clients?clientId=drive');
    check(!c.publicClient && c.standardFlowEnabled && !c.implicitFlowEnabled && !c.directAccessGrantsEnabled && !c.serviceAccountsEnabled, 'client confidentiel, standard flow seul', c);
    check(c.attributes['pkce.code.challenge.method'] === 'S256', 'PKCE S256 exigé', c.attributes);
    check(!c.attributes['access.token.lifespan'], 'pas de durée de jeton propre au client (300 s du realm)', c.attributes['access.token.lifespan']);
    const mapper = c.protocolMappers.find((m) => m.protocolMapper === 'oidc-usermodel-client-role-mapper');
    check(mapper && mapper.config['id.token.claim'] === 'true' && mapper.config['userinfo.token.claim'] === 'true', 'mappeur client roles (ID token, userinfo)', mapper);
    const roles = (await kcAdmin.call(`/clients/${c.id}/roles`)).map((x) => x.name).sort();
    check(JSON.stringify(roles) === JSON.stringify(['admin', 'super-admin', 'user']), 'rôles du client', roles);
    return 'inscription off, force brute on, fr, 300 s, PKCE S256, mappeur ID token + userinfo';
  });

  await step('S3 local : bucket ud-dev-drive présent', async () => {
    await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 })).catch((err) => check(false, 'bucket absent (node dev/s3-bucket.mjs)', err.name));
  });

  await step('Serveur du mode instance démarré', startServer);

  await step('GET /api/v1/instance', async () => {
    const res = await alice.api('/api/v1/instance');
    check(res.status === 200 && res.body.mode === 'instance' && res.body.login?.label, 'description de l\'instance', res.body);
    return JSON.stringify(res.body);
  });

  await step('alice (user) : connexion Keycloak, code + PKCE S256, cookie de session', async () => {
    const { location, authorize } = await login(alice, ALICE);
    check(authorize.searchParams.get('code_challenge_method') === 'S256', 'PKCE S256');
    check(authorize.searchParams.get('nonce') && authorize.searchParams.get('state'), 'state et nonce');
    check(authorize.searchParams.get('redirect_uri') === `${PUBLIC_URL}/api/v1/auth/oidc/callback`, 'redirect_uri', authorize.searchParams.get('redirect_uri'));
    check(location === '/d/drive/b/home/', 'redirection vers next', location);
    check(alice.cookie(PUBLIC_URL, 'ud_sid'), 'cookie ud_sid');
    check(!alice.cookie(PUBLIC_URL, 'ud_oidc'), 'cookie de transaction effacé');
    return `→ ${location}`;
  });

  await step('alice : GET /me (rôles Drive lus dans le vrai jeton), conditions requises', async () => {
    const me = await alice.api('/api/v1/me');
    check(me.status === 200, 'GET /me', me);
    check(JSON.stringify(me.body.user.roles) === '["user"]', 'rôles Drive', me.body.user.roles);
    check(me.body.user.email === ALICE.email && me.body.user.name === ALICE.name, 'e-mail et nom', me.body.user);
    check(me.body.terms.required === true, 'conditions requises', me.body.terms);
    check(me.body.quota.limit === QUOTA && me.body.quota.used === 0, 'quota 1 Go, vide', me.body.quota);
    ids.alice = me.body.user.id;
    createdPrefixes.add(`users/${ids.alice}/`);
    return `id ${ids.alice}, rôles ${me.body.user.roles}, quota ${me.body.quota.limit}`;
  });

  await step('alice : 403 terms_required, acceptation, home vide, commun en lecture', async () => {
    const blocked = await alice.api('/api/v1/c/drive/buckets');
    check(blocked.status === 403 && blocked.body.details?.reason === 'terms_required', '403 terms_required', blocked);
    const version = await acceptTerms(alice);
    const buckets = await alice.api('/api/v1/c/drive/buckets');
    check(buckets.status === 200, 'buckets', buckets);
    const view = buckets.body.items.map((b) => `${b.name}:${b.scopes.join('+')}`);
    check(JSON.stringify(view) === '["home:read+write+delete+share","commun:read"]', 'espaces', view);
    const list = await alice.api('/api/v1/c/drive/b/home/objects');
    check(list.status === 200 && list.body.items.length === 0, 'home vide', list.body);
    return `version ${version} acceptée ; ${view.join(', ')}`;
  });

  await step('alice : envoi réel de 5 Mo (déclaration, PUT présigné vers RustFS, confirmation)', async () => {
    const created = await alice.api(`/api/v1/c/drive/b/home/uploads?key=${encodeURIComponent(FILE_KEY)}`, {
      method: 'POST',
      body: { size: FILE_SIZE, contentType: 'application/octet-stream', mode: 'auto' },
    });
    check(created.status === 201 && created.body.mode === 'single', 'déclaration', created);
    check(created.body.headers['content-length'] === String(FILE_SIZE), 'longueur signée', created.body.headers);
    check(created.body.url.startsWith(S3_ENDPOINT), 'URL vers RustFS', created.body.url.slice(0, 40));
    const reserved = await alice.api('/api/v1/me');
    check(reserved.body.quota.reserved === FILE_SIZE, 'taille réservée', reserved.body.quota);
    const put = await putPresigned(created.body, randomBytes(FILE_SIZE));
    check(put.status === 200, 'PUT présigné', `${put.status} ${await put.text()}`);
    const confirm = await alice.api('/api/v1/c/drive/b/home/uploads/confirm', {
      method: 'POST',
      body: { items: [{ key: FILE_KEY, receipt: created.body.receipt, size: FILE_SIZE }] },
    });
    check(confirm.status === 200 && confirm.body.results[0]?.ok === true, 'confirmation', confirm.body);
    return `PUT ${put.status}, confirmé`;
  });

  await step('alice : fichier listé, usage dans /me, ligne dans upload_log', async () => {
    const list = await alice.api('/api/v1/c/drive/b/home/objects?prefix=e2e/');
    const file = list.body.items.find((i) => i.key === FILE_KEY);
    check(file && file.size === FILE_SIZE, 'fichier listé', list.body);
    check(!JSON.stringify(list.body).includes(BUCKET) && !JSON.stringify(list.body).includes('users/'), 'ni bucket ni préfixe réels');
    const me = await alice.api('/api/v1/me');
    check(me.body.quota.used === FILE_SIZE && me.body.quota.reserved === 0, 'usage', me.body.quota);
    const rows = uploadLog(ids.alice);
    check(rows.length === 1 && rows[0].key === FILE_KEY && rows[0].size === FILE_SIZE && rows[0].space_id === 'home' && rows[0].ip, 'upload_log', rows);
    return `usage ${me.body.quota.used}/${me.body.quota.limit}, upload_log : ${rows[0].space_id} ${rows[0].key} ${rows[0].size} o, ip ${rows[0].ip}`;
  });

  await step('alice : envoi au-delà du quota refusé avant tout octet', async () => {
    const big = await alice.api('/api/v1/c/drive/b/home/uploads?key=e2e/trop-gros.iso', { method: 'POST', body: { size: 2_000_000_000, mode: 'auto' } });
    check(big.status === 403 && big.body.error === 'quota_exceeded', 'quota_exceeded', big);
    check(big.body.details.limit === 'user_quota' && big.body.details.remaining === QUOTA - FILE_SIZE, 'reste disponible', big.body.details);
    check(!big.body.url && !big.body.uploadId, 'aucune URL émise');
    const head = await alice.api('/api/v1/c/drive/b/home/object?key=e2e/trop-gros.iso');
    check(head.status === 404, 'aucun objet', head.status);
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `users/${ids.alice}/e2e/trop` }));
    check(!listed.Contents?.length, 'rien dans RustFS');
    return `403 quota_exceeded, remaining ${big.body.details.remaining}`;
  });

  await step('alice : PUT d\'une autre longueur que celle déclarée refusé par S3', async () => {
    const created = await alice.api('/api/v1/c/drive/b/home/uploads?key=e2e/longueur.bin', { method: 'POST', body: { size: 1000, mode: 'single' } });
    check(created.status === 201, 'déclaration', created);
    const longer = await putPresigned(created.body, randomBytes(1001));
    const shorter = await putPresigned(created.body, randomBytes(999));
    check(longer.status >= 400 && shorter.status >= 400, 'S3 refuse', [longer.status, shorter.status]);
    const head = await alice.api('/api/v1/c/drive/b/home/object?key=e2e/longueur.bin');
    check(head.status === 404, 'aucun objet', head.status);
    return `1001 o → ${longer.status}, 999 o → ${shorter.status}`;
  });

  await step('bruno (admin) : ne voit pas le fichier d\'alice (404 sur sa clé)', async () => {
    const { location } = await login(bruno, BRUNO);
    check(location === '/d/drive/b/home/', 'connexion', location);
    await acceptTerms(bruno);
    const me = await bruno.api('/api/v1/me');
    check(JSON.stringify(me.body.user.roles) === '["admin"]', 'rôles', me.body.user.roles);
    ids.bruno = me.body.user.id;
    createdPrefixes.add(`users/${ids.bruno}/`);
    const head = await bruno.api(`/api/v1/c/drive/b/home/object?key=${encodeURIComponent(FILE_KEY)}`);
    check(head.status === 404, '404', head);
    const list = await bruno.api('/api/v1/c/drive/b/home/objects?recursive=1');
    check(list.status === 200 && list.body.items.length === 0, 'home de bruno vide', list.body);
    return `404 ${head.body.error}`;
  });

  await step('alice : commun en lecture seule (scope_denied à l\'envoi)', async () => {
    const res = await alice.api('/api/v1/c/drive/b/commun/uploads?key=e2e.txt', { method: 'POST', body: { size: 10, mode: 'single' } });
    check(res.status === 403 && res.body.error === 'scope_denied', 'scope_denied', res);
    const list = await alice.api('/api/v1/c/drive/b/commun/objects');
    check(list.status === 200, 'lecture permise', list.status);
    return `envoi 403 scope_denied, lecture ${list.status}`;
  });

  await step('damien (sans rôle Drive) : /login?error=no_role', async () => {
    const { location } = await login(damien, DAMIEN);
    check(location === '/login?error=no_role', 'no_role', location);
    check(!damien.cookie(PUBLIC_URL, 'ud_sid'), 'aucune session');
    return location;
  });

  await step('chloe (super-admin) : voit tous les espaces et toutes les personnes', async () => {
    const { location } = await login(chloe, CHLOE);
    check(location === '/d/drive/b/home/', 'connexion', location);
    await acceptTerms(chloe);
    const me = await chloe.api('/api/v1/me');
    check(me.body.superAdmin === true && me.body.quota.limit === null, 'super admin, illimité', me.body);
    ids.chloe = me.body.user.id;
    createdPrefixes.add(`users/${ids.chloe}/`);
    const buckets = await chloe.api('/api/v1/c/drive/buckets');
    const view = buckets.body.items.map((b) => `${b.name}:${b.scopes.join('+')}`);
    check(JSON.stringify(view) === '["home:read+write+delete+share","commun:read+write+delete+share"]', 'espaces', view);
    const users = await chloe.api('/api/v1/admin/users');
    const emails = users.body.items.map((u) => u.email).sort();
    check(users.status === 200 && JSON.stringify(emails) === JSON.stringify([ALICE.email, BRUNO.email, CHLOE.email]), 'personnes', emails);
    return `${view.join(', ')} ; ${emails.length} personnes`;
  });

  await step('chloe suspend alice (PATCH /admin/users/:id) : la session d\'alice tombe', async () => {
    const res = await chloe.api(`/api/v1/admin/users/${ids.alice}`, { method: 'PATCH', body: { status: 'suspended' } });
    check(res.status === 200 && res.body.status === 'suspended', 'suspension', res);
    const me = await alice.api('/api/v1/me');
    check(me.status === 401, 'session tombée', me);
    const again = await login(alice, ALICE);
    check(again.location === '/login?error=suspended', 'reconnexion refusée', again.location);
    return `/me → ${me.status}, reconnexion → ${again.location}`;
  });

  await step('chloe réactive alice : reconnexion possible', async () => {
    const res = await chloe.api(`/api/v1/admin/users/${ids.alice}`, { method: 'PATCH', body: { status: 'active' } });
    check(res.status === 200 && res.body.status === 'active', 'réactivation', res);
    const { location } = await login(alice, ALICE);
    check(location === '/d/drive/b/home/', 'connexion', location);
    const me = await alice.api('/api/v1/me');
    check(me.status === 200 && me.body.terms.required === false && me.body.quota.used === FILE_SIZE, 'session et données', me.body);
    return `→ ${location}`;
  });

  await step(`rôle user retiré à alice dans Keycloak : 401 session_ended en ${REFRESH_SECONDS} s au plus`, async () => {
    // Rafraîchissement juste avant le retrait : le pire cas est l'échéance complète.
    const before = await alice.api('/api/v1/me');
    check(before.status === 200, 'session active', before.status);
    await kcAdmin.removeClientRole(ALICE.username, 'user');
    removedRoles.push({ username: ALICE.username, role: 'user' });
    const removedAt = Date.now();
    let res;
    for (;;) {
      res = await alice.api('/api/v1/me');
      if (res.status !== 200) break;
      check(Date.now() - removedAt < (REFRESH_SECONDS + 5) * 1000, 'toujours connectée après l\'échéance');
      await sleep(500);
    }
    const elapsed = (Date.now() - removedAt) / 1000;
    check(res.status === 401 && res.body.details?.reason === 'session_ended', '401 session_ended', res);
    check(elapsed <= REFRESH_SECONDS + 1, `coupure en ${elapsed} s`);
    check(!alice.cookie(PUBLIC_URL, 'ud_sid'), 'cookie effacé');
    return `coupée après ${elapsed.toFixed(1)} s`;
  });

  await step('rôle user remis : alice se reconnecte', async () => {
    const pending = removedRoles.splice(0);
    for (const r of pending) await kcAdmin.addClientRole(r.username, r.role);
    const { location } = await login(alice, ALICE);
    check(location === '/d/drive/b/home/', 'connexion', location);
    const me = await alice.api('/api/v1/me');
    check(me.status === 200 && JSON.stringify(me.body.user.roles) === '["user"]', 'rôles', me.body.user);
    return 'rôles ["user"]';
  });

  await step('rafraîchissement réel : rôles relus chez Keycloak, session gardée', async () => {
    await sleep((REFRESH_SECONDS + 1) * 1000);
    const me = await alice.api('/api/v1/me');
    check(me.status === 200 && JSON.stringify(me.body.user.roles) === '["user"]', 'après rafraîchissement', me);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT roles_at FROM session WHERE user_id = ? ORDER BY created_at DESC').get(ids.alice);
    db.close();
    check(row && Date.now() - row.roles_at < 5000, 'roles_at mis à jour', row);
    return `roles_at il y a ${((Date.now() - row.roles_at) / 1000).toFixed(1)} s`;
  });

  await step(`session Keycloak d'alice révoquée par l'admin : invalid_grant, 401 session_ended en ${REFRESH_SECONDS} s au plus`, async () => {
    check((await alice.api('/api/v1/me')).status === 200, 'session active');
    await kcAdmin.logoutUser(ALICE.username);
    const revokedAt = Date.now();
    let res;
    for (;;) {
      res = await alice.api('/api/v1/me');
      if (res.status !== 200) break;
      check(Date.now() - revokedAt < (REFRESH_SECONDS + 5) * 1000, "toujours connectée après l'échéance");
      await sleep(500);
    }
    const elapsed = (Date.now() - revokedAt) / 1000;
    check(res.status === 401 && res.body.details?.reason === 'session_ended', '401 session_ended', res);
    check(elapsed <= REFRESH_SECONDS + 1, `coupure en ${elapsed} s`);
    const { location } = await login(alice, ALICE);
    check(location === '/d/drive/b/home/', 'reconnexion', location);
    return `coupée après ${elapsed.toFixed(1)} s, reconnectée`;
  });

  await step('déconnexion après expiration du jeton d\'identité (personne inactive)', async () => {
    // Durée des jetons du client ramenée à 10 s le temps de l'étape, puis remise (nettoyage).
    const [client] = await kcAdmin.call('/clients?clientId=drive');
    restoreClient = { id: client.id, attributes: { ...client.attributes } };
    await kcAdmin.call(`/clients/${client.id}`, { method: 'PUT', body: { ...client, attributes: { ...client.attributes, 'access.token.lifespan': '10' } } });
    const idle = new Agent('chloe-idle');
    const { location } = await login(idle, CHLOE);
    check(location === '/d/drive/b/home/', 'connexion', location);
    await restoreDriveClient();
    // Aucune requête : ni rafraîchissement ni nouveau jeton d'identité.
    await sleep(12_000);
    const res = await idle.api('/api/v1/auth/logout', { method: 'POST' });
    check(res.status === 200 && res.body.endSessionUrl, 'endSessionUrl', res);
    const hint = new URL(res.body.endSessionUrl).searchParams.get('id_token_hint');
    const exp = hint ? JSON.parse(Buffer.from(hint.split('.')[1], 'base64url').toString()).exp : null;
    const out = await idle.fetch(res.body.endSessionUrl);
    const target = out.headers.get('location');
    check(out.status === 302 && target === `${PUBLIC_URL}/login`, 'Keycloak redirige vers /login', `${out.status} ${target} ${out.status === 200 ? (await out.text()).replace(/\s+/g, ' ').slice(0, 300) : ''}`);
    // Client remis : un nouveau jeton d'identité reprend la durée du realm (300 s).
    const fresh = new Agent('chloe-fresh');
    check((await login(fresh, CHLOE)).location === '/d/drive/b/home/', 'connexion après remise');
    const freshOut = await fresh.api('/api/v1/auth/logout', { method: 'POST' });
    const freshHint = JSON.parse(Buffer.from(new URL(freshOut.body.endSessionUrl).searchParams.get('id_token_hint').split('.')[1], 'base64url').toString());
    check(freshHint.exp - freshHint.iat === 300, "durée du jeton d'identité après remise", freshHint.exp - freshHint.iat);
    await fresh.fetch(freshOut.body.endSessionUrl);
    return `id_token_hint ${exp ? `expiré depuis ${Math.round(Date.now() / 1000 - exp)} s` : 'absent'}, 302 → ${target} ; client remis (jeton de 300 s)`;
  });

  await step('déconnexion de bruno : endSessionUrl valide chez Keycloak', async () => {
    const res = await bruno.api('/api/v1/auth/logout', { method: 'POST' });
    check(res.status === 200 && res.body.endSessionUrl, 'endSessionUrl', res);
    const url = new URL(res.body.endSessionUrl);
    check(url.href.startsWith(`${ISSUER}/protocol/openid-connect/logout`), 'point de déconnexion', url.origin + url.pathname);
    check(url.searchParams.get('id_token_hint') && url.searchParams.get('post_logout_redirect_uri') === `${PUBLIC_URL}/login`, 'paramètres', [...url.searchParams.keys()]);
    check((await bruno.api('/api/v1/me')).status === 401, 'session Drive supprimée');
    check((await kcAdmin.sessions(BRUNO.username)).length >= 1, 'session Keycloak ouverte avant');
    const out = await bruno.fetch(url.href);
    const target = out.headers.get('location');
    check(out.status === 302 && target === `${PUBLIC_URL}/login`, 'Keycloak redirige vers /login', `${out.status} ${target} ${out.status === 200 ? (await out.text()).slice(0, 200) : ''}`);
    const left = await kcAdmin.sessions(BRUNO.username);
    check(left.length === 0, 'session Keycloak fermée', left.length);
    return `302 → ${target}, session Keycloak fermée`;
  });

  await step('alice : suppression du fichier de test, usage revenu à 0', async () => {
    const del = await alice.api(`/api/v1/c/drive/b/home/object?key=${encodeURIComponent(FILE_KEY)}`, { method: 'DELETE' });
    check(del.status === 200 && del.body.deleted === 1, 'suppression', del);
    const me = await alice.api('/api/v1/me');
    check(me.body.quota.used === 0, 'usage', me.body.quota);
    return `deleted ${del.body.deleted}`;
  });
}

try {
  await main();
} catch {
  failed = true;
} finally {
  await cleanup().catch((err) => {
    failed = true;
    log(`nettoyage en échec : ${err.message}`);
  });
}
// UD_E2E_SERVER_LOG=1 : journal complet du serveur lancé par le script.
if (process.env.UD_E2E_SERVER_LOG === '1') console.log(`--- journal du serveur ---
${serverOutput().trim()}
---`);
log(failed ? `ÉCHEC après ${stepCount} étape(s)` : `toutes les étapes passent (${stepCount})`);
process.exit(failed ? 1 : 0);
