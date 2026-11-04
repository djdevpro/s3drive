import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { instanceConfigPath, loadConfig } from './config.js';
import { loadSecretKey } from './crypto.js';
import { migrate, openDatabase } from './db.js';
import { type InstanceRuntime, createInstanceRuntime, loadInstanceConfig, startMaintenance } from './instance/index.js';
import { termsActive } from './instance/runtime.js';

const config = loadConfig();
const production = config.NODE_ENV === 'production';
const db = openDatabase(join(config.UD_DATA_DIR, 'ud.sqlite'));
migrate(db);

let instance: InstanceRuntime | undefined;
let stopMaintenance: (() => void) | undefined;
if (config.UD_MODE !== 'personal') {
  // Mode instance : toute erreur de configuration empêche le démarrage.
  try {
    if (production && !config.UD_PUBLIC_URL) throw new Error('UD_PUBLIC_URL is required in production for the instance mode');
    const instanceConfig = loadInstanceConfig(instanceConfigPath(config), {
      allowPrivateEndpoints: config.UD_ALLOW_PRIVATE_ENDPOINTS,
      allowedEndpoints: config.UD_ALLOWED_ENDPOINTS,
      instanceName: config.UD_INSTANCE_NAME,
      production,
    });
    const key = loadSecretKey({ value: config.UD_SECRET_KEY, production, dataDir: config.UD_DATA_DIR });
    instance = createInstanceRuntime({ mode: config.UD_MODE, config: instanceConfig, env: config, key, db });
  } catch (err) {
    console.error(`universal-drive: cannot start in ${config.UD_MODE} mode: ${err instanceof Error ? err.message : 'unknown error'}`);
    db.close();
    process.exit(1);
  }
  if (!termsActive(instance)) console.warn('universal-drive: no terms of use configured (legal.termsVersion and UD_TERMS_FILE or legal.termsUrl): terms acceptance is disabled');
  if (!production && !config.UD_PUBLIC_URL) console.warn('universal-drive: UD_PUBLIC_URL is not set: the OIDC redirect URI is derived from the Host header');
  stopMaintenance = startMaintenance(instance);
}

const app = createApp({
  db,
  webDist: production ? config.UD_WEB_DIST : undefined,
  instance,
  instanceName: config.UD_INSTANCE_NAME,
  security: {
    csp: config.UD_CSP,
    publicUrl: config.UD_PUBLIC_URL,
    allowPrivateEndpoints: config.UD_ALLOW_PRIVATE_ENDPOINTS,
    allowedEndpoints: config.UD_ALLOWED_ENDPOINTS,
  },
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`universal-drive server listening on http://${config.HOST}:${info.port} (mode ${config.UD_MODE})`);
});

function shutdown(): void {
  stopMaintenance?.();
  server.close(() => {
    instance?.storages.destroy();
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
