import type { Hono } from 'hono';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerObjectRoutes } from './routes/objects.js';
import { registerUploadRoutes } from './routes/uploads.js';
import type { InstanceEnv, InstanceRuntime } from './runtime.js';

// Routes du mode instance montées sur l'application principale.

export function registerInstanceRoutes(app: Hono, rt: InstanceRuntime): void {
  registerAuthRoutes(app, rt);
  const typed = app as unknown as Hono<InstanceEnv>;
  registerMeRoutes(typed, rt);
  registerObjectRoutes(typed, rt);
  registerUploadRoutes(typed, rt);
  registerAdminRoutes(typed, rt);
}

export { createInstanceRuntime, type InstanceRuntime } from './runtime.js';
export { loadInstanceConfig, parseInstanceConfig, InstanceConfigError } from './config.js';
export { startMaintenance, cleanup, recountAll } from './maintenance.js';
export { checkLinkPolicy } from './links.js';
