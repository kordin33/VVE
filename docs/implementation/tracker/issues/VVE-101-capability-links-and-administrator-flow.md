---
id: VVE-101
title: Capability links and Administrator flow
status: closed
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-100]
architecture_slice: S1
---

# Capability links and Administrator flow

## Outcome

An Administrator signs in, creates, retrieves, regenerates, and deactivates a Teacher Access Link, and the Teacher opens the dashboard without incidental credential changes.

## Context pointer

Implement section `S1 - Capability Links and Administrator Flow` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). Use `codebase-design` for any change to the CapabilityAccess Interface or Seam.

## Resolution evidence

Return the shared HTTP and WebSocket access-decision matrix, migration evidence, Administrator and Teacher browser flows, regeneration and revocation tests, Polish error states, proof that list/view is side-effect-free, deleted legacy secret paths, and the focused commit.

## Resolution

Delivered the CapabilityAccess Interface (`server/src/pilot/capabilityAccess.ts`) with HTTP adapters (`server/src/pilot/capabilityHttpAdapters.ts`) shared by HTTP routes and WebSocket admission. Administrator signs in for a 12-hour session per ADR-0005; teacher access links are retrievable with a single active link per teacher per ADR-0008; regeneration and deactivation operate on a durable credential version (hashed share tokens, so rotation revokes old links); WebSocket admission fails closed (`server/src/wsAdmission.ts`); the fixture uses the Public Teacher Identity `Dawid Furmaniuk - Matsin`.

Commits: 42b6343 (server: CapabilityAccess module, admin session, teacher access links), 6817818 (frontend: administrator console and teacher dashboard through CapabilityAccess). Merged into this branch as 9e1026c.

Gate results:

- Server build clean; server tests 64/64.
- Frontend build clean; frontend tests 114/114.
- Playwright E2E 6/6 (three-context spine through the new flows).
- Pilot fixture idempotent re-seed yields the same teacher token.
- Fail-fast preflight 3/3.
- Access-decision matrix 16/16, including cross-board denial, WS fail-closed admission, side-effect-free list/view, and regeneration/deactivation proofs.

Recorded deviations:

1. Logout only clears the cookie client-side (no server-side session invalidation).
2. Inactive teacher links surface 403 (not a dedicated inactive state).
3. The CSV import endpoint is kept alongside the JSON route.
4. The readOnly session downgrade was removed in favor of plain denials.

Known limitation (post-merge verification, 2026-08-30): the Playwright regeneration spec is not idempotent against the persistent pilot database. It ends by deactivating its ad-hoc teacher `e2e-regen@vve-pilot.local` and never removes it, so a second run on the same volume fails (the add-teacher path `createOrReuseTeacherAccessLink` reuses the existing inactive teacher and issues a fresh active link without checking `is_active`; the link then correctly fails closed with 403, but the spec expects the dashboard). After deleting the leftover teacher row, the full suite passes 6/6. Access control itself held fail-closed throughout; follow-up candidates: make the spec self-cleaning and have `createOrReuseTeacherAccessLink` refuse (or reactivate explicitly) for inactive teachers.
