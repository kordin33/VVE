---
id: VVE-108
title: Runtime recovery and observability
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-103]
architecture_slice: S8
---

# Runtime recovery and observability

## Outcome

The single Railway process starts honestly, drains safely, restores acknowledged work, and emits enough content-free evidence to diagnose the Pilot.

## Context pointer

Implement section `S8 - Runtime Recovery and Observability` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). RuntimeControl and OperationalSignals own startup, readiness, drain, shutdown, and telemetry.

## Resolution evidence

Return liveness and readiness contracts, startup failure tests, drain and flush results, controlled restart timing, structured redacted event examples, soak metric availability, timer and resource ownership proof, rollback notes, and the focused commit.
