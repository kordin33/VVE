# Execute the VVE Pilot specification

## Mission

Deliver the entire VVE Pilot product contract in one reviewable pull request. Own the result across architecture, backend, frontend, collaboration, persistence, input, visual behavior, tests, and release evidence.

Use `implement-spec` as the leading process. The specification and tickets form a task graph. Keep every ready ticket moving, integrate completed slices as the frontier advances, run the final review, fix its findings, and return one PR ready for human review.

## Context pointers

Read these before dispatching implementation work:

- [Implementation specification](tracker/issues/VVE-001-implement-vve-pilot-product-contract.md) defines user behavior, implementation decisions, testing decisions, and scope.
- [Ticket graph](VVE-PILOT-TICKET-GRAPH.md) defines the frontier, blocking edges, and acceptance criteria for every vertical slice.
- [Deep Module design](../architecture/VVE-DEEP-MODULE-DESIGN.md) defines the Modules, Interfaces, Seams, Adapters, migration order, and test surfaces.
- [VVE domain](../../CONTEXT.md) defines canonical terms and invariants.
- [Pilot product specification](../PILOT-PRODUCT-SPEC.md), [Pilot release gate](../PILOT-RELEASE-GATE.md), and [accepted ADRs](../adr/) resolve product choices. They outrank older audit suggestions.
- [Enterprise audit](../../VVE_ENTERPRISE_AUDIT_PL.html) and [manual QA report](../../MANUAL_QA_REPORT_2026-08-27.md) provide evidence to reproduce. Recheck each material claim against the working tree.

The current planning package uses a local Markdown tracker because the authenticated GitHub account could not write Issues in `kordin33/VVE`. The tracker metadata still defines issue identity, status, parentage, and `blocked_by` edges.

## Orchestrator role

You own the destination, not a queue of tiny edits.

- Maintain the ticket frontier and run every unblocked slice that can progress independently.
- Give each implementer one vertical slice with an outcome, context pointers, constraints, and acceptance criteria.
- Let the implementer choose its internal approach and sub-decomposition.
- Require the implementer to return a complete slice with code, tests, runtime evidence, migration notes, and a focused commit.
- Integrate slice branches through a merger agent. Resolve conflicts at the owning Module rather than preserving two competing implementations.
- Keep communication sparse. Point to durable documents, tickets, commits, test output, screenshots, and review notes.
- Replan the frontier when code evidence invalidates a ticket assumption. Preserve the destination and settled product contract.

The implementation run is authorized to create a `codex/` feature branch, commits, worktrees, and one draft PR for this specification. It may mark that PR ready after every completion criterion below passes. It does not merge the PR or deploy the product.

## Skill routing

### Leading process

Invoke `implement-spec` before implementation. Follow its branch, draft PR, worktree, implementer, merger, frontier, code-review, and cleanup sequence.

### Architecture

Use `codebase-design` whenever a slice introduces or materially changes a Module Interface or Seam. The accepted deep-module document is the starting design, not permission to add pass-through wrappers. A changed Interface must retain or improve Depth, Leverage, Locality, and testability.

### Product UI

Every slice that changes user-facing UI uses `neumorphic-design`. VVE leans toward structured Soft UI for dashboards and quiet sculptural control around the whiteboard. The signature is direct input feedback and the `Mysz` or `Pióro` Input Style control. Material depth communicates hierarchy and state while the canvas keeps maximum working area.

### iPad and direct manipulation

Every slice that changes pointer handling, gestures, pressure, safe areas, responsive iPad layout, or direct manipulation uses `apple-design`. No concrete Apple product is being reproduced, so describe the result as Apple-faithful. The slice owner reads only the relevant Apple references plus accessibility and verification, then records assumptions and runtime evidence.

### Motion

Every slice that changes animation or gesture motion uses `motion` for the appropriate branch. A focused review runs after implementation. Motion starts with input, explains a state change, remains interruptible where manipulation is direct, avoids layout-heavy work, and has a reduced-motion result.

A slice that needs visual judgment is owned or reviewed by an agent that can inspect the rendered application. That agent uses the built-in Browser, captures matched viewport evidence, exercises normal and interrupted behavior, and reports remaining deviations. The orchestrator owns the verdict through that evidence.

## Execution loop

### 1. Establish the branch and graph

Read the specification, architecture design, graph, domain glossary, and ADRs. Inspect repository status and current tests. Create the PR branch and draft PR required by `implement-spec`. Record the initial frontier in the PR description.

Completion criterion: every ticket has a known state, every blocking edge is represented, the branch contains the planning documents, and the draft PR points to the specification and graph.

### 2. Dispatch vertical slices

For each frontier ticket, create an implementer worktree and branch. A slice brief contains:

- the ticket title and destination behavior;
- pointers to the specification, ticket, architecture section, domain terms, and relevant ADRs;
- the Interfaces it owns and the Interfaces it consumes;
- its acceptance criteria and required runtime evidence;
- known neighboring slices and merge order.

The implementer may change any code needed to complete the slice. It also owns tests, Polish user errors, feature availability, responsive states, and cleanup directly caused by its changes. It returns when the acceptance criteria pass, not when the first path works.

Completion criterion: each running implementer owns a non-overlapping outcome or an explicitly coordinated shared Interface, and every ready ticket has an owner within available concurrency.

### 3. Integrate completed slices

Use a merger agent to bring each completed slice into the PR branch. Run the slice gate before closing its ticket. When an Interface changed, run the gates for every direct consumer. Replace superseded shallow tests after the higher-Seam behavioral tests pass.

Completion criterion: the PR branch contains one coherent implementation, the ticket's acceptance evidence is durable, conflicts are resolved at the owning Module, and the newly exposed frontier is recorded.

### 4. Verify product behavior

Run automated tests, builds, migrations, short collaboration gates, browser flows, visual checks, the mature-board profile, and the three-hour 57-client capacity gate. Run the 88-client stress profile when practical and report the measured limit without reshaping the architecture solely for that number.

Use the built-in Browser for local frontend verification. Exercise Administrator, Teacher, and Student paths, every visible lesson tool, PDF import and export, reconnect, reload, read-only state, desktop layouts, and iPad-sized layouts. Capture console errors and visual defects as failures, not commentary.

Completion criterion: every release blocker in the Pilot release gate has an explicit passing test or observed result. The only permitted external verification is Kordian's final Apple Pencil, graphics-tablet, and mouse confirmation.

### 5. Review and close

Run the code review required by `implement-spec` across the full PR branch. Route motion review through `motion`, Apple-faithful interaction review through `apple-design`, and material-system review through `neumorphic-design`. Give all actionable findings to one final implementer so fixes remain coherent. Re-run affected gates and the full release suite.

Completion criterion: every implementation ticket is closed, no HIGH review finding remains, no known Pilot release blocker remains, the PR description contains test and visual evidence, worktrees are cleaned up, and the PR is marked ready for human review.

## Slice completion contract

A vertical slice is complete when all of these are true:

- the user-visible outcome works through the real frontend, backend, collaboration, and persistence paths it needs;
- the owning Module exposes the agreed small Interface and hides its internal coordination;
- authorization and Pilot feature availability use the central decisions;
- tests cross the highest useful Seam and fail on the prior defect;
- normal, error, reconnect, reload, and relevant multi-participant states pass;
- Polish copy, responsive layout, focus, reduced motion, and supported input behavior pass where the slice has UI;
- runtime evidence contains the commands, scenarios, observed results, and any bounded deviation;
- the commit contains no unrelated cleanup that obscures review.

## Integration rules

- The product contract is fixed for this PR. Code evidence may change the implementation plan, not the agreed business rules.
- One Module owns each invariant. Callers consume its Interface instead of recreating the rule.
- Two justified Adapters create a real Seam. Test-only internals stay inside the Module.
- Replace old paths as slices land. Do not keep a new architecture beside an active legacy implementation.
- Keep the Pilot single-instance. Preserve the future collaboration Seam without building a distributed Adapter.
- Treat 57 concurrent clients as the required gate and 88 as diagnostic headroom.
- Hide excluded product paths at both UI and backend admission. Developer-only diagnostics remain reachable through an intentional internal flag or route.
- Preserve user work already present in the checkout. Report any overlap before replacing it.

## Final PR evidence

The ready PR includes:

- a ticket checklist with every ticket linked to its implementing commit;
- build, unit, integration, browser, collaboration, capacity, and stress results;
- screenshots or recordings for representative desktop and iPad states;
- motion, Apple-faithful interaction, and neumorphic-system verdicts;
- migration, rollback, readiness, shutdown, and resource-limit notes;
- the measured status of the 50 ms local input target, 250 ms remote propagation target, five-second synchronization targets, and 30-second restart target;
- any external hardware checks still awaiting Kordian, clearly separated from completed automated and Browser evidence.
