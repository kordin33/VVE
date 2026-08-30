---
id: VVE-105
title: Pointer and iPad input
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-104]
architecture_slice: S5
---

# Pointer and iPad input

## Outcome

Mouse, graphics tablet, and Apple Pencil share one continuous Pointer Event pipeline with working `Mysz` and `Pióro` Input Styles and predictable gesture arbitration.

## Context pointer

Implement section `S5 - Pointer and iPad Input` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). Use `apple-design` for Apple-faithful direct manipulation, `motion` for gesture motion review, and `neumorphic-design` for the Input Style control.

## Resolution evidence

Return the InputPipeline Interface, deterministic pointer traces, pressure and coalesced-event evidence, capture and cancellation tests, pan and pinch results, input-to-paint measurements, desktop and iPad Browser evidence, reduced-motion behavior, removed mouse/touch duplicates, and the focused commit. Mark Kordian's hardware check as the remaining external confirmation.
