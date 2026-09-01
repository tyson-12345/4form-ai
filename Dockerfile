# Production image for the 4Form AI API server.
#
# Adopted from Oscar's fork, which was deployable where this tree was not.
# Multi-stage so the runtime image carries no pnpm store, no source, and no
# devDependencies.

# ── Build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable

WORKDIR /app

# Copy only what the dependency graph needs first, so a source-only change does
# not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY lib/api-spec/package.json        lib/api-spec/
COPY lib/api-zod/package.json         lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/db/package.json              lib/db/
COPY artifacts/api-server/package.json artifacts/api-server/

RUN pnpm install --frozen-lockfile

COPY lib/ lib/
# Only the two documents the bundle inlines; named explicitly so a missing one
# fails the build here rather than producing a server with an empty policy.
COPY docs/PRIVACY-POLICY.md docs/TERMS-OF-SERVICE.md docs/
COPY artifacts/api-server/ artifacts/api-server/

RUN pnpm --filter @workspace/api-server run build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable

ENV NODE_ENV=production

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/api-zod/package.json         lib/api-zod/
COPY lib/db/package.json              lib/db/
COPY artifacts/api-server/package.json artifacts/api-server/

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/artifacts/api-server/dist artifacts/api-server/dist
COPY --from=build /app/lib lib

# Don't run as root. The base image ships a `node` user for exactly this.
USER node

# Matches the default in src/index.ts. Platforms that inject PORT override it.
EXPOSE 8080

# The app reads these and will refuse to boot without JWT_SECRET — see
# lib/auth.ts. Set them in the platform's secret store, never in this file:
#   DATABASE_URL, JWT_SECRET            (required)
#   ANTHROPIC_API_KEY                   (optional — coaching prose and chat)
#   REDIS_URL                           (optional — shared rate limits)
#   ALLOWED_ORIGINS, TRUST_PROXY        (set both behind a load balancer)

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
