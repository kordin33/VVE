---
id: VVE-011
title: Choose the implementation orchestration model
status: closed
labels:
  - "wayfinder:grilling"
parent: VVE-000
blocked_by:
  - VVE-010
---

# Choose the implementation orchestration model

## Question

How should the later implementation agent divide and integrate a codebase-wide Pilot build while preserving quality and controlling cost?

## Resolution

One lead orchestrator runs `implement-spec`, owns the destination, maintains the ticket frontier, integrates completed work, resolves conflicts, runs review, and returns one PR. It delegates autonomous vertical slices rather than granular edits. Each implementer receives context pointers, a bounded outcome, affected product behavior, blocking relationships, and acceptance criteria. It may choose its internal method and sub-decomposition. It returns only after the full slice passes its criteria.

The orchestrator uses sparse messages and durable artifacts. It assigns motion, Apple-faithful interaction, and the adaptive neumorphic design language to agents equipped to inspect and verify those behaviors. The primary orchestration model need not perform visual judgment itself when a capable subagent can own the entire visual slice and return evidence.
