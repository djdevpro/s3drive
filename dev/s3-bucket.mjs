// Crée le bucket de développement du mode instance dans le RustFS local (compose.dev.yaml), s'il manque,
// et pose sa règle CORS pour le Vite de dev (envois et aperçus en direct depuis le navigateur).
// Idempotent. Usage : node dev/s3-bucket.mjs [bucket]   (défaut : ud-dev-drive)
// Refuse tout point de terminaison autre que local : ce script ne touche jamais un stockage réel.
import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const endpoint = process.env.UD_DEV_S3_ENDPOINT || 'http://127.0.0.1:9000';
const bucket = process.argv[2] || 'ud-dev-drive';

const host = new URL(endpoint).hostname;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
  console.error(`s3-bucket: refus, point de terminaison non local (${host})`);
  process.exit(1);
}

const s3 = new S3Client({
  endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.UD_DEV_S3_ACCESS_KEY || 'udadmin',
    secretAccessKey: process.env.UD_DEV_S3_SECRET_KEY || 'udadmin-dev-secret',
  },
});

try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`s3-bucket: ${bucket} existe déjà`);
} catch (err) {
  const status = err?.$metadata?.httpStatusCode;
  if (status !== 404) {
    console.error(`s3-bucket: HeadBucket a échoué (${err?.name ?? 'erreur'}, HTTP ${status ?? '?'})`);
    process.exit(1);
  }
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`s3-bucket: ${bucket} créé`);
}

// Origines du front de dev (Vite) : UD_DEV_WEB_ORIGINS, séparées par des virgules.
const origins = (process.env.UD_DEV_WEB_ORIGINS || 'http://localhost:5290,http://127.0.0.1:5290')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
await s3.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag', 'Retry-After'],
          MaxAgeSeconds: 600,
        },
      ],
    },
  }),
);
console.log(`s3-bucket: CORS posé pour ${origins.join(', ')}`);
