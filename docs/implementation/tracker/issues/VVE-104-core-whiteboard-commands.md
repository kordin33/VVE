---
id: VVE-104
title: Core whiteboard commands
status: open
labels:
  - ready-for-agent
  - "implementation:ticket"
parent: VVE-001
blocked_by: [VVE-103]
architecture_slice: S4
---

# Core whiteboard commands

## Outcome

Pen, eraser, text, selection, transforms, participant-scoped undo and redo, pan, zoom, shapes, lines, styles, clear, and image paste operate through BoardDocument and WhiteboardSession.

## Context pointer

Implement section `S4 - Core Whiteboard Commands` in [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md). Use `codebase-design` for the canonical command Interface. User-facing work also follows `neumorphic-design` without reducing canvas area.

## Resolution evidence

Return canonical schema and command contracts, per-object behavior coverage, Teacher-only clear proof, participant-scoped undo proof, collaboration and reload results, deleted direct Yjs mutation paths, render evidence, and the focused commit.
