# Universal Drive — image de production : un conteneur, port 8080, volume /data.
#   docker build -t universal-drive .
# Étapes : deps (toutes les dépendances) → build (paquets, serveur, front) → prod-deps (dépendances de
# production du serveur seulement) → image finale minimale, utilisateur non root.

# ---------- deps : installation complète, cache npm partagé entre les constructions ----------
FROM node:24-alpine AS deps
WORKDIR /app
# Manifestes d'abord : la couche npm ci ne se refait que si un package.json ou le verrou change.
COPY package.json package-lock.json .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/s3/package.json packages/s3/
COPY packages/sdk/package.json packages/sdk/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ---------- build : tsc -b (paquets + serveur vers dist/) puis vite build (apps/web/dist) ----------
FROM deps AS build
COPY . .
RUN npm run build

# ---------- prod-deps : dépendances de production du serveur et de ses paquets (@ud/contracts, @ud/s3) ----------
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/s3/package.json packages/s3/
COPY packages/sdk/package.json packages/sdk/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @ud/server --no-audit --no-fund \
 && rm -rf node_modules/.package-lock.json

# ---------- image finale ----------
FROM node:24-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    UD_DATA_DIR=/data \
    UD_WEB_DIST=/app/apps/web/dist
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
# Paquets de l'espace de travail : node_modules/@ud/* sont des liens vers packages/* (exports → dist/).
COPY packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY packages/s3/package.json packages/s3/
COPY --from=build /app/packages/s3/dist packages/s3/dist
COPY apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
# Le serveur lit ses migrations dans apps/server/src/migrations, depuis dist/ comme depuis src/ (db.ts).
COPY apps/server/src/migrations apps/server/src/migrations
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/dist/index.js"]
