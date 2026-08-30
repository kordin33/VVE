---
id: VVE-102
title: Managed and Personal Board lifecycle
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-101]
architecture_slice: S2
---

# Managed and Personal Board lifecycle

## Outcome

A Teacher receives one Personal Board and can create, share, rotate, end, and expire a twelve-month Managed Board under the agreed seven-day deletion policy.

## Context pointer

Implement section `S2 - Managed/Personal Board Lifecycle` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). BoardLifecycle owns lifecycle states and scheduling; callers consume its Interface.

## Resolution evidence

Return schema and migration results, concurrent-safe Personal Board proof, Board Access Link lifecycle browser and transport tests, due-purge idempotency evidence, proof that data survives credential rotation, proof that access ends immediately, deleted archive semantics, and the focused commit.
