# ADR 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Engineering

## Context

This is a regulated money-movement platform. Decisions taken now — how money is
represented, which rail settles a corridor, where personal data lives — will be
read back by a regulator, an auditor, or an engineer two years from now who was
not in the room. "We discussed it in a call" is not an answer any of them can use.

The build plan already requires that reality and the plan stay in sync
(BUILD_PLAN Part 0, item 6). Decision records are the mechanism for the part of
reality that is a choice rather than a change.

## Decision

Every material architectural decision gets a numbered ADR in `docs/adr/`, using
the template in `docs/adr/template.md`.

A decision is material if any of the following hold:

- it changes how money is represented, moved, or accounted for;
- it changes where personal data is stored or which partition it belongs to;
- it introduces, removes or replaces an external provider;
- it is expensive to reverse;
- someone would reasonably ask "why is it like this?" a year from now.

ADRs are immutable once accepted. A decision that no longer holds is superseded
by a new ADR that links back to it; the original stays, marked `Superseded by
ADR NNNN`.

## Consequences

- Reviewers can require an ADR before approving a structural change.
- Licensing submissions can cite ADRs directly as the systems architecture
  description required by BUILD_PLAN 13.2.
- There is a small tax on every significant PR. That is the point.
