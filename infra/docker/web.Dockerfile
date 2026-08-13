# MoraPay sender PWA (BUILD_PLAN 12.2).
#
# `ARG APP` builds either front end from this one file: they share a design
# system, a build shape and a runtime, and two near-identical Dockerfiles would
# drift.

FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/domain/package.json packages/domain/
COPY packages/ledger/package.json packages/ledger/
COPY packages/contracts/package.json packages/contracts/
COPY packages/adapters/package.json packages/adapters/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG APP=web
# Baked at build time, as Next.js requires for NEXT_PUBLIC_*. A different API
# host means a different image, which is the honest way to model it.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN pnpm --filter @morapay/domain build \
 && pnpm --filter @morapay/contracts build \
 && pnpm --filter @morapay/${APP} exec next build

FROM base AS runtime
ARG APP=web
ENV NODE_ENV=production
ENV PORT=3000

RUN mkdir -p /app && chown -R node:node /app
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/${APP} ./apps/${APP}

WORKDIR /app/apps/${APP}
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node_modules/.bin/next start -p ${PORT}"]
