#!/usr/bin/env node
// Lance le mode instance en développement : serveur du Drive (tsx watch, port 18080) et front Vite
// (port 5290, proxy /api vers 18080). La redirection OIDC passe par Vite : UD_PUBLIC_URL vaut
// http://localhost:5290, enregistrée dans la graine Keycloak (dev/keycloak/ud-dev-realm.json).
//
//   node dev/start-instance.mjs                 serveur + Vite
//   node dev/start-instance.mjs --server-only   serveur seul
//   node dev/start-instance.mjs --web-only      Vite seul
//
// Pré-requis : docker compose -f compose.dev.yaml --profile iam up -d ; node dev/s3-bucket.mjs.
// Les secrets de développement sont lus dans .env.example (RustFS) et dans la graine Keycloak
// (secret du client `drive`) ; une variable déjà posée dans l'environnement l'emporte.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PORT = 18080;
const WEB_PORT = 5290;
const args = new Set(process.argv.slice(2));
const runServer = !args.has('--web-only');
const runWeb = !args.has('--server-only');

/** Valeurs `NOM=valeur` de .env.example (lignes commentées comprises : `# NOM=valeur`). */
function envExample() {
  const out = {};
  let text = '';
  try {
    text = readFileSync(join(ROOT, '.env.example'), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && m[2] !== '') out[m[1]] = m[2];
  }
  return out;
}

/** Secret du client `drive` de la graine Keycloak (valeur de test). */
function driveClientSecret() {
  try {
    const realm = JSON.parse(readFileSync(join(ROOT, 'dev/keycloak/ud-dev-realm.json'), 'utf8'));
    return realm.clients?.find((c) => c.clientId === 'drive')?.secret ?? '';
  } catch {
    return '';
  }
}

const example = envExample();
const pick = (name, fallback) => process.env[name] || example[name] || fallback;

const serverEnv = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(SERVER_PORT),
  UD_MODE: process.env.UD_MODE || 'instance',
  UD_CONFIG: process.env.UD_CONFIG || 'dev/drive.config.dev.yaml',
  UD_TERMS_FILE: process.env.UD_TERMS_FILE || 'dev/terms.dev.md',
  UD_ALLOW_PRIVATE_ENDPOINTS: '1',
  UD_PUBLIC_URL: process.env.UD_PUBLIC_URL || `http://localhost:${WEB_PORT}`,
  UD_OIDC_REFRESH_SECONDS: pick('UD_OIDC_REFRESH_SECONDS', '300'),
  UD_OIDC_ISSUER: pick('UD_OIDC_ISSUER', 'http://localhost:8180/realms/ud-dev'),
  UD_OIDC_CLIENT_ID: pick('UD_OIDC_CLIENT_ID', 'drive'),
  UD_OIDC_CLIENT_SECRET: process.env.UD_OIDC_CLIENT_SECRET || driveClientSecret() || example.UD_OIDC_CLIENT_SECRET || '',
  UD_DEV_S3_ACCESS_KEY: pick('UD_DEV_S3_ACCESS_KEY', 'udadmin'),
  UD_DEV_S3_SECRET_KEY: pick('UD_DEV_S3_SECRET_KEY', ''),
  // Chemins relatifs résolus depuis la racine du dépôt (apps/server/src/config.ts).
  INIT_CWD: ROOT,
};

const children = [];

function start(name, color, command, argv, options) {
  const child = spawn(command, argv, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const relay = (stream, target) => {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk.toString()).split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const line of lines) target.write(prefix + line + '\n');
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    process.stdout.write(`${prefix}terminé (${signal ?? code})\n`);
    stopAll(code ?? 1);
  });
  children.push(child);
  return child;
}

let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  setTimeout(() => process.exit(code), 300).unref();
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

if (runServer) {
  if (!serverEnv.UD_OIDC_CLIENT_SECRET) console.warn('start-instance: secret du client OIDC introuvable (UD_OIDC_CLIENT_SECRET)');
  if (!serverEnv.UD_DEV_S3_SECRET_KEY) console.warn('start-instance: clé secrète RustFS introuvable (UD_DEV_S3_SECRET_KEY)');
  start('server', '34', process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'watch', '--conditions=@ud/source', 'apps/server/src/index.ts'], {
    cwd: ROOT,
    env: serverEnv,
  });
}
if (runWeb) {
  start('web', '35', process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js')], { cwd: join(ROOT, 'apps/web'), env: { ...process.env } });
  process.stdout.write(`start-instance: front sur http://localhost:${WEB_PORT} (API proxifiée vers http://127.0.0.1:${SERVER_PORT})\n`);
}
