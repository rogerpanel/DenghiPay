# ADR 0002 — Monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Engineering

## Context

The platform is four deployable things (API, sender PWA, admin app, saga
workers) sitting on shared money code. The shared code is the part that must not
drift: a `Money` type that differs by one rounding rule between the API and the
web app is a defect that reconciliation will find months later.

The previous generation of this work (eipay-api and eipay-client) was two
separate repositories with no shared package. The DTOs were written twice, and
the client and server disagreed about field names and about whether an amount
was a string or a number. That is the specific failure this decision is meant to
prevent.

## Decision

One repository, pnpm workspaces for dependency resolution, Turborepo for task
orchestration and caching.

- `packages/domain` and `packages/ledger` are framework-free and carry a 90%
  coverage floor.
- `packages/contracts` holds the zod schemas that both the API and the front
  ends import, so the wire format has exactly one definition.
- Apps depend on packages. Packages never depend on apps.
- Packages compile to CommonJS `dist/` output so a NestJS app and a Next.js app
  can both consume them without a bundler-specific build.

## Alternatives considered

**Separate repositories with a published shared package.** Correct in the large,
but it puts a publish-and-bump cycle between changing a DTO and using it. At this
team size that latency gets routed around, and the shared package rots. Revisit
when more than one team owns a deployable.

**Nx instead of Turborepo.** More capable and more to learn. Turborepo's task
graph plus remote caching covers what we need; the build plan already specifies
it and matches existing team convention.

**No shared packages, duplicate the money code.** This is what the previous
project did. See Context.

## Consequences

- A change to `packages/domain` rebuilds and retests everything downstream. That
  is intended for money code.
- Packages must be built before apps typecheck. `turbo run build` handles the
  ordering; a fresh clone runs `pnpm install && pnpm build`.
- CI caches pnpm and Turbo, so the common case is fast even though the graph is
  wide.
