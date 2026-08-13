# MoraPay API (BUILD_PLAN 12.2).
#
# Multi-stage, non-root, minimal base, healthcheck. The build stage carries the
# whole monorepo because the API imports four workspace packages; the runtime
# stage carries only what `node dist/main.js` needs.

# ---------------------------------------------------------------- base
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat openssl
WORKDIR /app

# --------------------------------------------------------------- deps
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/ledger/package.json packages/ledger/
COPY packages/contracts/package.json packages/contracts/
COPY packages/adapters/package.json packages/adapters/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile

# -------------------------------------------------------------- build
FROM deps AS build
COPY . .
RUN pnpm --filter @morapay/domain build \
 && pnpm --filter @morapay/ledger build \
 && pnpm --filter @morapay/contracts build \
 && pnpm --filter @morapay/adapters build \
 && pnpm --filter @morapay/api exec prisma generate \
 && pnpm --filter @morapay/api exec nest build

# ------------------------------------------------------------- tooling
# Migrations and seeds, which the runtime image deliberately cannot run.
#
# `prisma` and `tsx` are development dependencies, so the pruned tree below has
# neither — a runtime image cannot migrate itself, and on a fresh server that is
# discovered at the least convenient moment. This target keeps the unpruned tree
# and exists to be run as a one-shot before the API starts. Building it costs
# nothing extra: it is the same layers the runtime image is already built from.
FROM build AS tooling
WORKDIR /app
CMD ["pnpm", "--filter", "@morapay/api", "exec", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------- prune
# Strip development dependencies from the tree the runtime stage copies. In its
# own stage so that `build` above keeps them for `tooling`.
FROM build AS prune
RUN pnpm install --frozen-lockfile --prod

# ------------------------------------------------------------ runtime
FROM base AS runtime
ENV NODE_ENV=production
# Guardrail G1 restated in the image itself. Enabling live funds is a
# deliberate act at deploy time, never an image default.
ENV LIVE_FUNDS_ENABLED=false

# Non-root. The node image ships a `node` user; we use it rather than inventing
# another.
RUN mkdir -p /app && chown -R node:node /app
USER node

COPY --from=prune --chown=node:node /app/node_modules ./node_modules
COPY --from=prune --chown=node:node /app/packages ./packages
COPY --from=prune --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prune --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=prune --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=prune --chown=node:node /app/apps/api/package.json ./apps/api/

WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
