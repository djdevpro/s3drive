import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Racine du dépôt déduite de l'emplacement du module (src/ ou dist/ de apps/server).
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const flag = z.enum(['0', '1']).default('0').transform((v) => v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  HOST: z.string().min(1).default('0.0.0.0'),
  UD_DATA_DIR: z.string().min(1).default(`${repoRoot}data`),
  UD_WEB_DIST: z.string().min(1).default(`${repoRoot}apps/web/dist`),
  // Vide : l'origine publique est déduite des en-têtes.
  UD_PUBLIC_URL: z
    .union([z.url(), z.literal('')])
    .optional()
    .transform((v) => (v ? v.replace(/\/+$/, '') : undefined)),
  // 32 octets en base64 ; générée dans <UD_DATA_DIR>/secret.key en développement.
  UD_SECRET_KEY: z.string().optional(),
  UD_TRUST_PROXY: flag,
  UD_INSTANCE_NAME: z.string().min(1).default('Universal Drive'),
  UD_ALLOW_PRIVATE_ENDPOINTS: flag,
  // Absente : CSP stricte ; `off` : aucune CSP ; sinon politique personnalisée.
  UD_CSP: z.string().optional(),
  UD_ALLOWED_ENDPOINTS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),
  UD_S3_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  UD_S3_CONCURRENCY: z.coerce.number().int().positive().default(32),
  UD_AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  UD_IP_MODE: z.enum(['full', 'truncate', 'hash']).default('truncate'),
  // Mode instance.
  UD_MODE: z.enum(['personal', 'instance', 'both']).default('personal'),
  UD_CONFIG: z.string().min(1).optional(),
  UD_TERMS_FILE: z.string().min(1).optional(),
  UD_OIDC_REFRESH_SECONDS: z.coerce.number().int().min(0).default(300),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Une variable vide vaut une variable absente.
  const defined = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = envSchema.safeParse(defined);
  if (!parsed.success) {
    // Jamais la valeur fautive : seulement le nom de la variable et le motif.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const data = parsed.data;
  // Chemins relatifs : par rapport au dossier d'où la commande a été lancée (INIT_CWD sous npm -w,
  // qui exécute le script dans apps/server).
  const base = env['INIT_CWD'] || process.cwd();
  const abs = (p: string | undefined) => (p === undefined || isAbsolute(p) ? p : resolve(base, p));
  return { ...data, UD_CONFIG: abs(data.UD_CONFIG), UD_TERMS_FILE: abs(data.UD_TERMS_FILE) };
}

/** Chemin du fichier du mode instance (défaut `<UD_DATA_DIR>/drive.config.yaml`). */
export function instanceConfigPath(config: Config): string {
  return config.UD_CONFIG ?? `${config.UD_DATA_DIR.replace(/[\\/]+$/, '')}/drive.config.yaml`;
}
