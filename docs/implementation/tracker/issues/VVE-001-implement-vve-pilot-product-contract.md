---
id: VVE-001
title: Implement the VVE Pilot product contract
status: open
labels:
  - ready-for-agent
  - specification
parent: VVE-000
blocked_by: []
---

# Implement the VVE Pilot product contract

## Problem Statement

VVE already contains a collaborative whiteboard, Teacher and Student entry paths, persistence code, drawing tools, PDF support, and experimental features. The current snapshot does not provide the guarantees needed for real tutoring lessons. Access rules differ between HTTP, WebSocket, AI, and the frontend. Some acknowledged Yjs updates are not part of recovery. The administration flow is incomplete. Several visible tools and responsive layouts work only partially, and the product still exposes or describes experiments that are outside the Pilot.

Teachers need a board that remains responsive and predictable through a two-to-three-hour lesson. Students need frictionless link access without accounts. The tutoring company needs a deliberately small Pilot that can be reset and operated cheaply without turning low-risk data into an enterprise security program.

## Solution

Deliver the complete VVE Pilot as one coherent product. Keep revocable capability links instead of accounts, one Owning Teacher per Managed Board, and independent Student access. Make one Railway instance durable for normal lessons, block mutation while disconnected, polish every visible lesson tool, support desktop pointer devices and iPad with Apple Pencil, and hide every feature that is outside the Pilot.

The implementation must concentrate collaboration, authorization, board operations, input handling, asset handling, and process lifecycle behind deep Modules with small Interfaces. Tests cross those same Seams and verify user-visible behavior. The resulting branch must pass the 57-client capacity gate. The 88-client run measures headroom but does not force premature distributed architecture.

## User Stories

1. As an Administrator, I want to enter one shared passphrase, so that I can manage the Pilot without individual Administrator accounts.
2. As an Administrator, I want the passphrase exchanged for a short secure session, so that the permanent secret is not placed in URLs or frontend storage.
3. As an Administrator, I want failed authentication attempts limited, so that obvious password guessing does not consume the service.
4. As an Administrator, I want to create a Teacher using an internal label, so that company staff can distinguish Teachers without exposing their identities to Students.
5. As an Administrator, I want to retrieve the current Teacher Access Link, so that I can send it through the company's existing communication channel.
6. As an Administrator, I want merely viewing the panel to leave every link unchanged, so that inspection never revokes working access.
7. As an Administrator, I want explicit Teacher Access Link regeneration to invalidate only the previous credential, so that a leaked link can be replaced without losing boards.
8. As an Administrator, I want to deactivate a Teacher, so that all access ends immediately when the company requires it.
9. As an Administrator, I want deactivated Teacher data scheduled for deletion after seven days, so that storage does not grow indefinitely.
10. As a Teacher, I want my access link to open on any computer or iPad, so that I can move between lesson devices without account setup.
11. As a Teacher, I want the same access link open on several devices at once, so that using a computer and iPad does not create a second Teacher identity.
12. As a Teacher, I want to land on my dashboard, so that boards and access links are the first thing I can manage.
13. As a Teacher, I want my Personal Board created on my first dashboard visit, so that I can test tools and prepare material without setup.
14. As a Teacher, I want my Personal Board to remain private, so that it never grants Student access by accident.
15. As a Teacher, I want to create any number of Managed Boards, so that the Pilot does not impose an artificial business quota on my students or lessons.
16. As a Teacher, I want to assign a minimal Student Label or group label, so that I can recognize a board without storing unnecessary identity data.
17. As a Teacher, I want every Managed Board to have exactly one active Board Access Link, so that its access state is simple to understand.
18. As a Teacher, I want to copy the existing Board Access Link, so that opening a dashboard never rotates it.
19. As a Teacher, I want to regenerate a Board Access Link explicitly, so that I can revoke a leaked credential without deleting lesson material.
20. As a Teacher, I want to end Board Access explicitly, so that a completed relationship stops consuming collaboration resources.
21. As a Teacher, I want a board's twelve-month expiry visible before it occurs, so that I can export material while access still exists.
22. As a Teacher, I want to use every visible board tool reliably, so that a lesson does not depend on avoiding unfinished controls.
23. As a Teacher, I want to import PDF pages as movable and scalable objects, so that worksheets can become lesson material.
24. As a Teacher, I want to export the board to PDF, so that I can preserve or share the lesson outside VVE.
25. As a Teacher, I want a controlled full-board clear action, so that I can reset a working area without giving the same destructive action to Students.
26. As a Student, I want a Board Access Link to open directly on any supported device, so that I do not need an account, email, or password.
27. As a Student, I want to enter while the Owning Teacher is absent, so that homework and asynchronous work remain possible.
28. As a Student, I want to use every visible lesson tool, so that collaboration is not divided into arbitrary Teacher-only drawing features.
29. As a Student, I want to edit, move, resize, and delete shared objects, so that the board behaves as a collaborative workspace.
30. As a Student, I want board-level destructive and access controls withheld, so that I cannot clear the entire board, rotate its link, or end access accidentally.
31. As a Student, I want to import worksheets and images, so that I can bring homework into the lesson.
32. As a Student, I want to export PDF while my link is active, so that I can keep my material before access ends.
33. As a Student, I want to see the immutable Teacher identity `Dawid Furmaniuk - Matsin`, so that every lesson presents the company's chosen public identity.
34. As a Student, I want the system to assign my collaborator label and color, so that live cursors are distinguishable without claiming verified identity.
35. As a Student, I want my Board Access Link valid for twelve months, so that the same workspace lasts through a long tutoring relationship.
36. As a Student, I want a clear unavailable state after expiry or revocation, so that a dead link does not appear to load an editable board.
37. As a Student, I accept losing server access to material that I did not export before access ended, so that the Pilot does not build a recovery product it does not need.
38. As a lesson participant, I want local pen feedback below the perceptible delay threshold, so that handwriting tracks my hand rather than following it.
39. As a lesson participant, I want long strokes to remain continuous, so that samples do not jump, disappear, or accumulate lag.
40. As a lesson participant, I want remote edits to arrive promptly, so that conversation and drawing remain synchronized.
41. As a lesson participant, I want my undo and redo to affect my own operations, so that I do not unexpectedly remove another person's work.
42. As a lesson participant, I want every acknowledged change to survive reload and reconnect, so that a routine interruption does not erase work.
43. As a lesson participant, I want a disconnected board to become read-only, so that the client never accepts edits it cannot synchronize.
44. As a lesson participant, I want navigation and PDF export while read-only, so that temporary connection loss does not trap my existing material.
45. As a lesson participant, I want editing restored only after synchronization completes, so that I do not create a divergent local history.
46. As a lesson participant, I want no update from another Managed Board, so that capability scope and company data remain isolated.
47. As a lesson participant, I want an active three-hour session to avoid inactivity logout, so that quiet explanation time does not break the lesson.
48. As a mouse user, I want a `Mysz` Input Style with strong natural smoothing, so that handwriting does not look angular and mechanical.
49. As an Apple Pencil or graphics-tablet user, I want a `Pióro` Input Style based on established pen-input behavior, so that VVE preserves control, pressure, and directness.
50. As an input-device user, I want the application to choose a sensible initial style and allow my override, so that defaults help without trapping me.
51. As an iPad user, I want drawing to avoid accidental page scrolling, so that the canvas stays under direct control.
52. As an iPad user, I want predictable pan and pinch behavior, so that navigating the board does not conflict with drawing.
53. As an iPad user, I want every panel and control reachable without covering required content, so that tablet layout is a complete product rather than a compressed desktop page.
54. As a desktop user, I want mouse and graphics-tablet workflows to share the same board behavior, so that tool semantics do not depend on input hardware.
55. As a user with enlarged text or browser zoom, I want the interface to remain operable, so that basic readability settings do not break the layout.
56. As a user, I want Polish labels and actionable Polish errors, so that Pilot operation does not require interpreting developer language.
57. As a user, I want hidden experiments to remain absent, so that AI, Chemistry, Grid Align, legacy rooms, and unfinished encryption do not distract or create false promises.
58. As a Pilot operator, I want one stable Railway instance to recover active boards correctly after a controlled restart, so that normal deployment does not lose acknowledged work.
59. As a Pilot operator, I want readiness to mean that required dependencies and migrations are ready, so that traffic does not reach a half-started process.
60. As a Pilot operator, I want shutdown to stop new work, drain connections, persist live documents, and close dependencies, so that process lifecycle is predictable.
61. As a Pilot operator, I want idle boards persisted and unloaded after their final connection closes, so that infrastructure usage falls without restricting access.
62. As a Pilot operator, I want generous configurable upload, message, connection, and operation limits, so that broken or abusive clients cannot destabilize normal lessons.
63. As a Pilot operator, I want clear rejection when a file or operation exceeds a limit, so that resource protection does not look like a frozen board.
64. As a Pilot operator, I want technical telemetry for document size, asset size, synchronization time, memory, connections, and errors, so that Company Rollout decisions use measurements.
65. As a Pilot operator, I want routine logs to omit board content, so that observability remains useful without storing material it does not need.
66. As a Pilot operator, I want a stable `main` line and development on `dev`, so that a known-good revision remains available for rollback.
67. As a Pilot operator, I want the 57-client capacity scenario to pass for three hours, so that 22 Teachers and 35 Students have measured headroom.
68. As a Pilot operator, I want an optional 88-client stress run to fail safely if it exceeds current capacity, so that the test teaches us something without forcing premature distributed architecture.
69. As a Pilot operator, I want a mature-board benchmark based on representative PDFs, images, objects, and update history, so that performance testing resembles a year of lessons.
70. As a Pilot operator, I want a separate destructive random-object stress profile, so that overload behavior is measured without confusing it with normal experience.
71. As a maintainer, I want each major behavior concentrated behind a small Interface, so that fixes remain local and tests do not depend on incidental file structure.
72. As a maintainer, I want authorization decided once for HTTP and WebSocket operations, so that role and capability rules cannot drift between transports.
73. As a maintainer, I want collaboration recovery and snapshot ordering owned by one Module, so that every persisted update participates in rehydration.
74. As a maintainer, I want board mutations validated through one Module, so that drawing, undo, collaboration, import, and future tools share invariants.
75. As a maintainer, I want input smoothing and pointer normalization behind one Interface, so that mouse, pen, and touch behavior can be tested without rendering the entire application.
76. As a maintainer, I want Pilot feature availability decided centrally, so that hiding a button and disabling its backend path cannot disagree.
77. As a maintainer, I want tests at the same Seams used by callers, so that internal refactoring does not invalidate behavioral coverage.
78. As a reviewer, I want one complete PR with the full ticket graph closed, so that architecture, behavior, tests, and user experience can be reviewed as one Pilot candidate.

## Implementation Decisions

- Preserve the domain vocabulary and invariants in `CONTEXT.md` and the accepted ADRs. Product code may not redefine Teacher, Student, Managed Board, Personal Board, or capability-link semantics locally.
- Build the deep CapabilityAccess Module. Its Interface decides whether a presented capability may perform a named action against a named resource. It owns role, scope, expiry, regeneration, deactivation, and failure behavior for both HTTP and WebSocket callers.
- Build the deep BoardLifecycle Module. Its Interface creates Personal and Managed Boards, rotates or ends access, deactivates a Teacher, and purges due data. It owns state transitions, twelve-month validity, seven-day deletion scheduling, idempotency, and lifecycle invariants.
- Build the deep BoardDocument Module. Its command-and-query Interface owns the canonical versioned object model, validation, transforms, bindings, participant-scoped undo ownership, serialization, and migration.
- Build the deep CollaborationRuntime Module. Its Interface opens an authorized live Managed Board, accepts operations, acknowledges durable updates, subscribes participants, flushes, unloads, and reports synchronization state. Its Implementation owns Yjs, hydration, update ordering, snapshots, compaction, replay, fan-out, and dedupe.
- Keep the Pilot on one process-local collaboration Adapter. Place the Seam so a later distributed Adapter can replace document ownership and fan-out without changing board tools or access rules. Do not implement the distributed Adapter in this specification.
- Build the deep WhiteboardSession Module. Its Interface accepts user intents, queries render state, exposes local undo and redo, and turns BoardDocument outcomes into one view model. Vue and canvas stay rendering Adapters rather than alternate mutation owners.
- Build the deep InputPipeline Module. Its Interface consumes normalized Pointer Events and an Input Style, then emits intents and preview state. It owns capture, coalesced samples, pressure, smoothing, gesture arbitration, coordinate transforms, continuity, and pointer-specific defaults.
- Build the deep ArtifactPipeline Module. Its Interface imports supported PDF or image data and exports the synchronized board. It owns file validation, page conversion, proportion preservation, progress, cancellation, temporary memory, and Polish user errors.
- Build the deep ResourceGovernor Module. Its Interface admits or rejects uploads, messages, operations, connections, and board resource growth using generous configurable budgets and observable denial reasons.
- Build the deep PilotAvailability Module. Its Interface answers whether a product capability is visible and callable for the Pilot stage and role. AI, legacy peer rooms, unfinished encryption, Chemistry, Grid Align, and production debug controls resolve unavailable through frontend and backend paths.
- Build the deep OperationalSignals Module. Its Interface records structured redacted events and measurements at the owning Module Seams. It provides the evidence needed for lesson diagnosis, performance targets, and capacity gates without logging board content by default.
- Build the deep RuntimeControl Module. Its Interface starts the application, reports liveness and readiness, begins drain, and completes shutdown. It owns migration readiness, dependency health, connection admission, collaboration flush, and resource close ordering.
- Keep resource control technical rather than a business quota. Limits are configurable, generous, observable, and expressed as explicit errors. The product does not hard-code the 20-Teacher Pilot operating limit or a board-count quota.
- Use Polish user-facing copy and English internals. Do not add a general internationalization framework solely for the Pilot.
- Treat the interface as an adaptive tactile Soft UI system. The Teacher and Administrator surfaces lean structured and information-dense. The whiteboard keeps material depth quiet around one signature element: the direct, responsive Input Style control and drawing feedback. Neumorphism communicates hierarchy and state; it must not reduce canvas area, contrast, or direct manipulation.
- Treat iPad behavior as Apple-faithful rather than an exact reproduction of an unspecified Apple product. Use current Apple guidance and browser standards for gestures, pressure, safe areas, hit targets, interruption, reduced motion, and verification.
- Motion must explain state changes, preserve spatial continuity, begin with input, remain interruptible where direct manipulation is involved, and respect reduced motion. Decorative animation is not an acceptance goal.
- Development proceeds on `dev`; `main` is the stable deployment line. Formal release tags are deferred. The implementation effort produces one branch and one PR, following the ticket graph.

## Testing Decisions

- Tests assert external behavior at the highest available Seam. Internal helper structure, source text, private state, and exact decomposition are not test contracts.
- CapabilityAccess and BoardLifecycle tests cover Administrator, Teacher, Student, wrong-board credentials, expired credentials, regenerated credentials, deactivated Teachers, lifecycle transitions, HTTP calls, and WebSocket admission through the same Interfaces.
- CollaborationRuntime tests use real Yjs bytes and a local database substitute or isolated test database. They cover hydration, updates between snapshots, compaction races, durable acknowledgement, replay, reconnect, idle unload, drain, restart, and final digest equality.
- BoardDocument and WhiteboardSession tests cover every visible object type and applicable create, select, transform, style, delete, undo, redo, serialize, reload, and multi-participant behavior through their Interfaces.
- InputPipeline tests replay deterministic mouse, pen, pressure, coalesced-event, coordinate-transform, interruption, and long-stroke traces. Passing a latency number does not excuse visible gaps, jumps, or accumulated lag.
- ArtifactPipeline and ResourceGovernor tests use representative multi-page PDFs and PNG, JPEG, and WebP images. They verify page order, proportions, movement, scaling, collaboration, persistence, export, cancellation, budget decisions, and graceful limit errors.
- Product-flow browser tests cover Administrator login and link management, Teacher dashboard and boards, Student entry, independent Student editing, link regeneration, expiry, read-only connection loss, reconnect, PDF flows, and unavailable Pilot features.
- Visual and interaction tests cover desktop and iPad-sized layouts. No visible control may clip, overlap required content, open off-screen, trap focus, stay invisibly active, or become unreachable.
- Motion review covers purpose, frequency, timing, physicality, interruption, performance, reduced motion, and cohesion. Runtime-dependent claims require observed evidence.
- The short change gate runs deterministic collaboration, drawing, disconnect, reconnect, backend restart, and state comparison after relevant changes.
- The pre-release soak runs 22 Teacher sessions and 35 Student sessions for three hours. It fails on data loss, state divergence, cross-board leakage, unhandled errors, or backend crash.
- The 88-client scenario is a diagnostic stress test. A failure above the 57-client gate does not block release when the system rejects or degrades work safely and the limitation is measured.
- A mature-board profile and a destructive seeded stress profile remain separate tests.
- Kordian performs final confirmation with Apple Pencil, graphics tablet, and mouse. Automated and Browser evidence must make this a confirmation and fine-tuning pass rather than the primary discovery loop.
- Replace shallow implementation-detail tests after deeper behavioral coverage exists. Do not keep both layers merely to preserve test count.

## Out of Scope

- Teacher, Student, or named Administrator accounts.
- Email delivery, password reset, MFA, device binding, or verified participant identity.
- More than one Owning Teacher on a Managed Board or Teacher ownership transfer.
- Full offline editing and later conflict synchronization.
- Multi-instance collaboration, distributed document ownership, or load-balancer coordination.
- Guaranteed database backup or disaster recovery during the Pilot.
- Company Rollout scaling beyond the measured Pilot architecture.
- AI functionality, AI costs, or AI mutation conflict policy.
- Production legacy peer rooms or a public room lobby.
- End-to-end encryption implementation or product claims.
- Chemistry, Grid Align, and other experimental lesson tools.
- A production debug panel.
- Phone editing support.
- Formal WCAG certification.
- Built-in onboarding or tutorial flows.
- Migration of old experimental board snapshots or a public raw-board import format.
- External object storage unless measurement proves it necessary.
- Formal release tags and a mature release train.

## Further Notes

- The authoritative product context is [Pilot Product Specification](../../../PILOT-PRODUCT-SPEC.md), [Pilot Release Gate](../../../PILOT-RELEASE-GATE.md), [VVE Domain](../../../../CONTEXT.md), and the accepted ADRs.
- The architecture context pointer will be [VVE Deep Module Design](../../../architecture/VVE-DEEP-MODULE-DESIGN.md).
- The implementation ticket graph and execution brief are siblings of this issue in the local tracker package.
- Earlier audit findings are evidence from a snapshot. Reproduce them before changing code and keep pre-existing architecture findings distinct from regressions introduced during implementation.
