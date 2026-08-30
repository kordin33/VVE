---
id: VVE-100
title: Pilot surface and test spine
status: closed
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: []
architecture_slice: S0
---

# Pilot surface and test spine

## Outcome

The running application exposes only the agreed Pilot entry points, and a deterministic Managed Board fixture can exercise Administrator, Teacher, and Student browser contexts.

## Context pointer

Implement section `S0 - Pilot Surface and Test Spine` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). That section owns the acceptance criteria. Preserve the Product Availability and highest-Seam testing decisions in the implementation specification.

## Resolution evidence

Return the feature manifest or equivalent Interface contract, direct-navigation and direct-HTTP denial tests, the working local fixture command, configured test discovery, removed public-room entry path, and the focused commit.

## Resolution

**Landed.** A shared `PilotAvailability` manifest (`server/src/pilot/availability.ts`, mirrored client-side by `frontend/src/services/pilotSurface.js`) now drives the whole surface: direct navigation on `/` renders `PilotUnavailable.vue` instead of a lobby or auto-created room, `VVE_PILOT_SURFACE=1` gates the Pilot HTTP surface (`httpApp.ts` slimmed, routes split into `aiRoutes.ts` and `roomsRoutes.ts`), and a deterministic local Managed Board fixture (`server/scripts/pilotFixture.ts`) seeds admin/teacher/board/student through the current auth stack. A three-context Playwright spine (Administrator, Teacher, Student) runs against the seeded backend plus the Vite dev app via `global-setup.js`.

**Commits**

- `8538f56` — feat(pilot): VVE-100 shared PilotAvailability manifest drives the whole surface
- `50c3bb1` — feat(pilot): VVE-100 deterministic local fixture and three-context E2E spine

Merged into `codex/vve-pilot-product-contract` as a fast-forward (`0169ff9` → `50c3bb1`).

**Gate results (merged checkout, 2026-08-29)**

- Server: `tsc` build clean; vitest 43/43 tests passed across 7 files, including the DB-backed `pilotFixture.test.ts` suite against local PostgreSQL (`vve-pilot-pg`, `127.0.0.1:5433`).
- Frontend: `vite build` clean (built in 3.17s); vitest 108/108 tests passed across 7 files.
- Playwright E2E: 5/5 passed (7.5s, chromium via chrome channel) — direct-navigation denial, `__dev` legacy gate, teacher access-link dashboard, student board canvas, admin secret sign-in.
- Fixture convergence: `is deterministic: re-running the flow for the same teacher converges to one teacher` passed — re-running the fixture for the same teacher converges to a single teacher.

**Known deviations**

- Playwright runs on the `chrome` channel (locally installed Google Chrome) instead of the bundled Playwright chromium download; the CDN download for the pinned build was not needed.
- Admin auto-rotate defect (admin token/secret rotation on the pilot surface) is owned by VVE-101.
- Production-build browser pass is deferred to S9/S10.
