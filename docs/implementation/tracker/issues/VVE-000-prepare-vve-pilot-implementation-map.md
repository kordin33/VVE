---
id: VVE-000
title: Prepare VVE Pilot for one complete implementation PR
status: closed
labels:
  - "wayfinder:map"
children:
  - VVE-010
  - VVE-011
  - VVE-012
  - VVE-001
---

# Prepare VVE Pilot for one complete implementation PR

## Destination

Produce an implementation-ready specification, deep-module design, dependency-aware ticket graph, and agent execution brief from which one orchestrator can deliver the entire VVE Pilot in one PR.

## Notes

- Use the domain vocabulary in `CONTEXT.md` and respect every accepted ADR.
- The Pilot product contract and release gate are authoritative. Earlier audits supply evidence, not product policy.
- `implement-spec` owns the later implementation run.
- The orchestrator owns the whole outcome, ticket frontier, integration, internal review, and final PR.
- Implementer subagents own autonomous vertical slices with explicit acceptance criteria. A slice crosses the required UI, backend, persistence, tests, and documentation instead of stopping at one file or small function.
- UI slices consult `neumorphic-design`. iPad and direct-manipulation slices also consult `apple-design`. Changed motion receives the relevant `motion` review.
- Communication between agents uses context pointers to the specification, architecture, tickets, commits, and test evidence.

## Decisions so far

- [Choose the VVE Pilot product contract](VVE-010-choose-the-vve-pilot-product-contract.md): capability links, board ownership, lifecycle, visible tools, devices, capacity, and deliberate exclusions are settled.
- [Choose the implementation orchestration model](VVE-011-choose-the-implementation-orchestration-model.md): one lead orchestrator manages autonomous vertical-slice subagents and returns one integrated PR.
- [Design the deep Modules and implementation Seams](VVE-012-design-the-deep-modules-and-implementation-seams.md): 11 deep Modules and the S0 through S10 vertical slice graph define the migration and test Seams.

## Not yet specified

None. The route to the implementation PR is fully specified. The open work now lives in the implementation ticket graph rather than wayfinding fog.

## Out of scope

- Implementing product code in this planning effort.
- Creating or pushing an implementation branch or PR before the execution brief is handed off.
- Deploying the Pilot or running the real-device acceptance check.
- Planning Company Rollout features that the Pilot measurements have not justified.
