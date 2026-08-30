# Pilot Release Gate

The Pilot serves real Teachers and Students. A release may have limited administration polish and disaster recovery, but it must not disrupt a live Lesson Session or make access links unreliable.

## Required user paths

- An Administrator can create, retrieve, regenerate, and deactivate a Teacher Access Link without rotating unrelated links.
- A Teacher Access Link opens the Teacher dashboard on every supported device.
- The same Teacher Access Link can remain open on a computer and iPad at once without creating a second Owning Teacher.
- A Teacher can create a Managed Board and copy its Board Access Link.
- One Teacher and up to three Students can join the same Managed Board and work for three hours.
- A Student can enter and edit while the Owning Teacher is absent.
- A Student can modify shared objects and export the board to PDF, but cannot clear the whole board, rotate its link, or end Board Access.
- Undo and redo affect only the current participant's own operations.
- A temporary connection loss makes the board read-only. Successful synchronization restores editing.
- Reloading or rejoining does not lose acknowledged changes.
- No update from one Managed Board appears on another Managed Board.

## Required board behavior

- Pen, eraser, text, selection, move, resize, undo, redo, pan, zoom, shapes, lines, image paste, PDF import, and PDF export work during collaboration.
- Calculator, coordinate-system, mathematical-graph, and physical-graph tools work and synchronize their output.
- Every tool visible to Pilot users is required. Each one must pass its complete normal workflow, not merely render a button or complete one happy-path action. Selection behavior, handles, transformations, interaction between tools, collaboration, persistence, reload, and undo/redo are part of the gate where applicable.
- Continuous drawing remains responsive and visually continuous: strokes do not jump, develop gaps, accumulate increasing lag, or cause sustained frame drops.
- Multiple cursors remain distinguishable through an ephemeral Collaborator Label and color.
- Every Student sees the immutable Public Teacher Identity `Dawid Furmaniuk - Matsin`. A Student cannot rename themselves or the Teacher.
- Connection and read-only states are visible to the user.
- AI functionality is hidden and inaccessible.
- Input Style, renamed from Handwriting Styler, remains visible and release-critical. Its `Mysz` and `Pióro` presets provide suitable smoothing without overriding useful native pen characteristics.
- Chemistry tools, Grid Align, and explicitly experimental tools are hidden from Pilot users but remain in the codebase for possible later restoration.
- The debug panel is hidden in production and may remain available to developers. It is not a lesson feature and does not need production-level polish.
- No panel, toolbar, dialog, toast, handle, or status element clips, overlaps required content, opens off-screen, traps interaction, or leaves a dead control on a supported screen.

## Initial performance targets

These are engineering targets for the Pilot, not immutable contractual limits. A target may be adjusted when representative measurements show that it is unnecessarily strict or measures the wrong thing. Any material relaxation must be documented with evidence and reviewed as a product decision; an implementation agent must not silently widen a target merely to make a test pass.

- Local pen input-to-paint latency: p95 at or below 50 ms on a supported representative device.
- Remote propagation of an acknowledged edit under normal network conditions: p95 at or below 250 ms.
- Time from opening a mature board to an interactive synchronized state: p95 at or below 5 seconds.
- Detect a lost connection and enter read-only mode within 2 seconds.
- Restore editing within 5 seconds after connectivity returns and synchronization completes.
- Recover an active session within 30 seconds after a controlled backend restart.
- Zero lost acknowledged changes, cross-board updates, or divergent final states.

The numerical targets do not replace experience-based checks. A pen path that meets the latency threshold but visibly jumps, stutters, drops samples, or degrades during a longer stroke still fails.

## Automated lanes

### Change gate

Run a deterministic five-to-ten-minute scenario after changes to collaboration, persistence, access, drawing, or deployment code.

- Start one Teacher and three Student clients.
- Execute thousands of seeded drawing and object operations.
- Disconnect and reconnect clients at deterministic points.
- Restart the backend after acknowledged writes.
- Compare the final Yjs state of every client and the rehydrated server document.
- Fail on any missing update, cross-board update, unhandled client error, or unhandled server error.

### Pre-release soak

Run an unattended three-hour scenario before a Pilot release.

- Start 22 independent Teacher sessions and distribute 35 Student sessions across their Managed Boards, for 57 active clients.
- Include individual lessons and rare group lessons with up to three Students on one board.
- Keep every session active with periodic seeded operations and heartbeats.
- Inject disconnects, reconnects, page reloads, and a controlled backend restart.
- Record memory, event-loop delay, connection counts, database errors, and per-room state hashes.
- Fail if any client diverges, any board receives another board's data, any acknowledged update disappears, or the backend crashes.

The test runs as a background process. It does not require a person or an agent to interact with the board for three hours.

### Extended stress run

An 88-client run uses one Teacher and three Students on each of 22 Managed Boards. It measures headroom and overload behavior but is not a Pilot release gate. Do not complicate the architecture solely to make this target pass when the 57-client capacity gate is stable. Failure above the gate must still be controlled: no cross-board leakage, silent data corruption, or unrecoverable service crash.

### Mature-board and destructive stress profiles

Use two distinct profiles instead of treating a random pile of objects as representative usage.

- A deterministic mature-board profile models months of realistic lessons, tool mixes, images, imported PDFs, edits, reloads, and collaboration history.
- A destructive stress profile generates an intentionally excessive seeded mix of random objects and operations. It probes failure behavior and resource limits but does not define normal user experience.

Initially, the mature-board profile uses a documented synthetic workload. During the Pilot, collect the technical measurements needed to replace it with a profile based on twice the observed p95 board workload. Pilot agreements permit content inspection, but routine telemetry should collect only what the benchmark needs: document and asset sizes, object counts by type, update volume, and load and synchronization timings.

## Supported editing devices

- iPad with Apple Pencil.
- Desktop or laptop with a graphics tablet.
- Desktop or laptop with a mouse.

Phones are outside the Pilot editing scope.

Implementation and automated tests use established browser and platform input behavior as the baseline for pen, touch, mouse, pressure, coordinate transforms, and gesture handling. Hardware testing confirms that baseline; it is not the primary discovery loop for basic correctness. The iPad layout and gesture model receive the same release-gate status as desktop behavior.

Automated pointer tests cover pen, touch, and mouse event paths. Before the first Pilot release, Kordian completes one real-device lesson flow on an iPad with Apple Pencil and one with a graphics tablet. Repeat the relevant hardware check after changes to pointer handling, coordinate transforms, gestures, smoothing, or rendering. Hardware feedback is used for regression confirmation and fine tuning.

## Manual release check

Use the built-in Browser for a complete end-to-end pass of the Administrator, Teacher, and Student flows. Exercise every visible tool, PDF import and export, collaboration, reconnect, reload, and device-sized layouts. Check that nothing clips, overlaps, becomes unreachable, scales incorrectly, stays invisibly active, or produces browser console errors.

## Release blockers

A Pilot release is blocked by any of the following:

- a lost acknowledged change, divergent client state, cross-board update, unauthorized entry, or backend crash;
- any visible lesson tool that is incomplete, unreliable, poorly synchronized, or visibly rough enough to disrupt normal work;
- pen input that jumps, stutters, accumulates lag, or drops samples during sustained use;
- broken PDF import or export;
- a production path to AI, legacy public rooms, or another hidden experiment;
- a layout, scaling, gesture, focus, clipping, overlap, or dead-control defect that interferes with a supported desktop or iPad workflow.

Performance numbers are initial targets with bounded room for measurement error. An implementation agent cannot relax them to make a test pass. A material exception requires measured evidence and Kordian's approval.

## Pilot operations

- Deploy outside known Lesson Sessions whenever Teachers are using the Pilot continuously.
- A controlled backend restart may reconnect clients within the documented recovery target but must not lose acknowledged work.
- Prepare changes on `dev` and keep `main` as the stable deployed line.
- Keep a clear code rollback path to the previous known-good Git revision and Railway deployment.
- Regular database backup is not a Pilot gate.
- System resets remain available during development and Pilot iteration. Do not reset during an active real lesson without an explicit operational decision.
