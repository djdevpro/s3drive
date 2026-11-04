// Fichier de configuration de référence des tests du mode instance.
export const BASE_YAML = `
version: 1
instance:
  connection: drive
  name: Drive test
auth:
  oidc:
    issuer: \${UD_OIDC_ISSUER}
    clientId: \${UD_OIDC_CLIENT_ID}
    clientSecret: \${UD_OIDC_CLIENT_SECRET}
    roleClaims: [resource_access.drive.roles, realm_access.roles]
storages:
  main:
    endpoint: https://s3.example.com
    region: eu
    addressing: path
    accessKeyId: \${UD_S3_ACCESS_KEY_ID}
    secretAccessKey: \${UD_S3_SECRET_ACCESS_KEY}
spaces:
  home:
    storage: main
    bucket: drive-test
    prefix: users/{userId}/
  commun:
    name: { fr: Commun, en: Shared }
    storage: main
    bucket: drive-test
    prefix: commun/
    quota: 50GB
roles:
  super_admin:
    from: [super-admin]
    quota: unlimited
  admin:
    from: [admin]
    quota: 10GB
    spaces: { home: [read, write, delete, share], commun: [read, write, delete, share] }
    links: { public: true, people: true, maxDays: 90 }
    admin: [users.read, users.manage]
  user:
    from: [user]
    quota: 1GB
    spaces: { home: [read, write, delete, share], commun: [read] }
    links: { public: false, people: true, maxDays: 30 }
legal:
  termsVersion: "2026-11-03"
  uploadLogDays: 365
  abuseEmail: \${UD_ABUSE_EMAIL:-}
`;
