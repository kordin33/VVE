# VVE Local Issue Tracker

This directory is the issue tracker for the Pilot implementation package.

GitHub Issues is enabled for `kordin33/VVE`, but the currently authenticated GitHub account has read-only access. The local tracker preserves issue identity, labels, parent relationships, status, and blocking edges so the graph can be used immediately and migrated to GitHub later.

## Conventions

- Each file under `issues/` is one issue.
- YAML frontmatter is tracker metadata.
- `parent` identifies the owning map or specification.
- `blocked_by` lists issue identities that must close first.
- The frontier is every open implementation ticket whose `blocked_by` entries are closed.
- A resolution belongs in its issue under `## Resolution`; maps only link to it.
- Human-facing references use linked issue titles rather than bare identifiers.

## Entry points

- [Prepare VVE Pilot for one complete implementation PR](issues/VVE-000-prepare-vve-pilot-implementation-map.md)
- [Implement the VVE Pilot product contract](issues/VVE-001-implement-vve-pilot-product-contract.md)
- [Implementation ticket graph](../VVE-PILOT-TICKET-GRAPH.md)
- [Agent execution brief](../VVE-PILOT-AGENT-EXECUTION-BRIEF.md)

## Labels

- `ready-for-agent`: the issue has enough context and acceptance criteria for autonomous work.
- `wayfinder:map`: the canonical decision map.
- `wayfinder:research`: an AFK investigation that resolves a decision.
- `wayfinder:grilling`: a decision resolved with the user.
- `implementation:ticket`: an executable vertical slice in the `implement-spec` task graph.
