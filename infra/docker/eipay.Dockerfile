# syntax=docker/dockerfile:1.7
#
# eipay, the developers' Paycrest app handed over under Agreement No. 04, built
# from its own checkout and run next to the MoraPay services.
#
# The build context is the eipay checkout, not this repository:
#
#   docker build -f infra/docker/eipay.Dockerfile \
#     --secret id=eipay_env,src=/root/DenghiPay/eipay.env \
#     -t morapay-eipay:local /root/DenghiPay/eipay
#
# infra/scripts/server-deploy.sh does this when run with EIPAY=1.
#
# Why the env file is a build secret and not build arguments: `next build`
# bakes NEXT_PUBLIC_* into the browser bundle and eipay's server config is
# checked during the build, so the build needs the file. A build secret is
# mounted for that one RUN step and never written to a layer; a build argument
# would be readable in `docker history` by anyone with the image.
#
# The resulting image therefore still contains the NEXT_PUBLIC_* values (they
# are public by design: they ship to every browser) and nothing else from the
# file. It is built on the server and never pushed to a registry.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A stray .env in the checkout would be copied into the image by the line
# above. The deploy script refuses to build from such a checkout; this is the
# second lock on the same door.
RUN if ls -a | grep -E '^\.env' | grep -vqx '.env.example'; then \
      echo 'refusing: the eipay checkout contains an .env file' >&2; exit 1; \
    fi
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=3072
# A fingerprint of the public (NEXT_PUBLIC_*) values, from the deploy script.
# The secret below is not part of the cache key; this is, so changing one of
# those values rebuilds instead of reusing a bundle that has the old ones.
ARG EIPAY_PUBLIC_FINGERPRINT=unset
# Node 22 reads a dotenv file itself, which avoids sourcing it with a shell
# (values with spaces or quotes would break, or worse, execute).
RUN --mount=type=secret,id=eipay_env,required=true \
    echo "public settings ${EIPAY_PUBLIC_FINGERPRINT}" && \
    node -e "process.loadEnvFile('/run/secrets/eipay_env'); \
      require('child_process').execFileSync('pnpm', ['build'], { stdio: 'inherit', env: process.env })" \
  && rm -rf .next/cache

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
