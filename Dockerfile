# Production image for the 4Form AI API server.
#
# Adopted from Oscar's fork, which was deployable where this tree was not.
# Multi-stage so the runtime image carries no source and no devDependencies.

# ── The package manager, pinned ─────────────────────────────────────────────
#
# `corepack enable` on its own installs the shims and nothing else: the first
# `pnpm` call then resolves the `latest` dist-tag over the network and runs
# whatever the registry serves at that instant. That is the binary which goes on
# to enforce `minimumReleaseAge` and `--frozen-lockfile` — so the supply-chain
# controls this workspace leans on were themselves being applied by an unpinned
# artifact fetched at build time, and two builds of the same commit could use
# two different pnpm versions.
#
# `corepack prepare` with a version *and* a `+sha512.<hex>` build suffix is the
# strongest form corepack supports: it downloads that exact version and aborts
# on a hash mismatch ("Mismatch hashes. Expected …"), so a tampered or swapped
# tarball fails the build instead of running. The hex is the registry integrity
# for pnpm 11.5.2, base64-decoded:
#
#   sha512-ccYx44IGbvwlYl1c8CkHXeB7YbN/bic1D72Esb2lhkyMGWetwoB3a0XDCnFcA1mjvgj+9C1bsJ4rmQKZeWkpFg==
#
# 11.5.2 is the version this workspace is developed against and the one that
# pnpm-lock.yaml is current with, so local and image installs resolve the same
# tree. Raising it means changing both halves of this string together.
#
# The stronger form still is a `packageManager` field in the root package.json,
# which pins every invocation and not just the ones inside this file. That file
# is not ours to edit; this is the same guarantee, scoped to the image.
ARG PNPM_SPEC=pnpm@11.5.2+sha512.71c631e382066efc25625d5cf029075de07b61b37f6e27350fbd84b1bda5864c8c1967adc280776b45c30a715c0359a3be08fef42d5bb09e2b99029979692916

# ── Build ───────────────────────────────────────────────────────────────────
#
# The base tag is deliberately not digest-pinned. `node:22-alpine` picks up
# Alpine and Node security patches on rebuild, and nothing in this repo watches
# a pinned digest for CVEs — freezing it here would trade a supply-chain risk we
# have controls for against a patch-lag risk we have none for.
FROM node:22-alpine AS build

ARG PNPM_SPEC
RUN corepack enable && corepack prepare "$PNPM_SPEC" --activate && pnpm --version

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
# Named rather than `COPY artifacts/api-server/`, for the same reason as the two
# documents above — and for one more. `.dockerignore` excludes `.env` and
# `**/.env`, but neither pattern covers `artifacts/api-server/.env.local`, which
# exists on developer machines and was being copied into this stage. It never
# reached the runtime image (only `dist/` crosses over), but a secret has no
# business in a build layer either, and naming the inputs is what stops the next
# dotfile from arriving unnoticed.
COPY artifacts/api-server/build.mjs artifacts/api-server/tsconfig.json artifacts/api-server/
# The build's first step vendors the MediaPipe pose runtime, verifying a SHA-384
# for each of the nine files before writing it. 22 MB of pinned third-party
# binaries that we serve ourselves rather than letting a public CDN see every
# EU/UK user's IP — see artifacts/api-server/scripts/fetch-mediapipe.mjs.
COPY artifacts/api-server/scripts/ artifacts/api-server/scripts/
COPY artifacts/api-server/src/ artifacts/api-server/src/

RUN pnpm --filter @workspace/api-server run build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ARG PNPM_SPEC
RUN corepack enable && corepack prepare "$PNPM_SPEC" --activate && pnpm --version

ENV NODE_ENV=production

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/api-zod/package.json         lib/api-zod/
COPY lib/db/package.json              lib/db/
COPY artifacts/api-server/package.json artifacts/api-server/

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/artifacts/api-server/dist artifacts/api-server/dist
# The vendored pose runtime. Not in `dist/` because it is not bundled — 22 MB
# base64-inlined would be ~28 MB of JavaScript — so it crosses stages on its own.
COPY --from=build /app/artifacts/api-server/vendor artifacts/api-server/vendor
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
