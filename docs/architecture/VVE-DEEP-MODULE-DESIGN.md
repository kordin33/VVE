# VVE Deep Module Design for the Pilot

Status: implementation design, not code  
Checkout verified: `codex/full-dev-snapshot-2026-05-18` at `1815758d0fe345db391231ae3cd689a76b509a2e`  
Primary product contract: `CONTEXT.md`, `docs/PILOT-PRODUCT-SPEC.md`, `docs/PILOT-RELEASE-GATE.md`, and accepted ADRs 0001–0011

## Purpose

This document is the architecture context pointer for implementing the entire VVE Pilot. It turns the agreed product contract and the verified state of the current checkout into a set of deep **Modules** and vertical implementation slices.

The design optimizes for:

- **Leverage**: one behavior-rich **Interface** is reused by HTTP, WebSocket, UI, tests, and operations;
- **Locality**: access, document, persistence, input, and lifecycle rules each have one authoritative **Implementation**;
- a small number of high **Seams**, with the same **Interface** used by callers and tests;
- replacement of shallow and duplicated behavior rather than another layer over it;
- a reliable single Railway instance for the Pilot, with no premature distributed system.

This is not permission to change the product model. Capability links, one Owning Teacher per Managed Board, Student access without Teacher presence, the immutable Public Teacher Identity, read-only while disconnected, twelve-month Board Access, seven-day deletion, and the deliberately limited Pilot threat model are constraints.

## Source priority and verified baseline

When sources disagree, use this order:

1. `CONTEXT.md`, `docs/PILOT-PRODUCT-SPEC.md`, `docs/PILOT-RELEASE-GATE.md`, and accepted ADRs.
2. This design.
3. Current code and tests as evidence of the starting point, not as the desired behavior.
4. Older audits as leads only.

Important current facts were rechecked in the checkout:

- WebSocket access infers whether a UUID is a Managed Board, and a failed database lookup deliberately falls back to an unauthenticated room (`server/src/server.ts:279-299`). Every received sync update is then applied without a role, expiry, revocation, or read-only decision (`server/src/server.ts:179-220`, `server/src/server.ts:314-316`).
- `boardStudentAuth` labels expired and archived boards read-only but still issues a writable WebSocket token (`server/src/middleware/boardStudentAuth.ts:37-84`, `server/src/routes/boardAccess.ts:12-29`). `StudentBoardEntry` drops the read-only fact when it opens the editor (`frontend/src/views/StudentBoardEntry.vue:99-107`).
- Opening the Administrator panel lists Teachers and then POSTs the permanent-link route for every Teacher (`frontend/src/views/AdminTeachersPanel.vue:150-178`). That route calls an operation which always generates a new token because only its hash is stored (`server/src/routes/adminTeachers.ts:159-180`, `server/src/services/teacherPermanentTokens.ts:61-95`). Viewing the panel therefore rotates credentials.
- Administrator access is currently a header or query-string secret, not the accepted twelve-hour HttpOnly session (`server/src/httpApp.ts:49-56`, `server/src/httpApp.ts:124-150`). The frontend sends neither (`frontend/src/views/AdminTeachersPanel.vue:150-225`).
- Managed Boards default to six months, not twelve (`server/src/services/boardService.ts:11-16`, `server/src/services/boardService.ts:52-56`). The current schema and routes do not implement a Personal Board, explicit Board Access regeneration, Teacher deactivation, End Board Access, or the seven-day deletion lifecycle (`server/migrations/20241129000000_initial_schema.ts:50-80`, `server/src/routes/teacherBoards.ts:13-81`, `server/src/routes/adminTeachers.ts:86-205`). Cleanup currently removes Yjs rows only after roughly fifteen months and leaves the board row (`server/src/services/boardYjsPersistence.ts:170-192`).
- Hydration reads only `board_yjs_state`, while every incremental update is written to `board_yjs_updates` (`server/src/services/boardYjsPersistence.ts:52-86`, `server/src/services/boardYjsPersistence.ts:88-103`). Snapshot compaction writes a snapshot and then deletes every update without an atomic cutoff (`server/src/services/boardYjsPersistence.ts:134-167`). A hydration failure is logged but does not prevent an empty live document from being served (`server/src/services/boardYjsPersistence.ts:79-85`, `server/src/rooms.ts:217-250`).
- Client transport reports `connected` on socket open, before any synchronization completion, has no acknowledgement frame, and sends local updates only while the socket is open (`frontend/src/services/connectToYjs.ts:63-69`, `frontend/src/services/connectToYjs.ts:83-139`). Current mutation paths are not centrally gated by synchronization state.
- The document shape is duplicated and permissive. The server type explicitly accepts arbitrary keys (`server/src/models/boardSnapshot.ts:11-67`); drawing manually creates `Y.Map` fields (`frontend/src/composables/useDrawingEngine.js:502-599`); `MovableObject` repeats fallback normalization (`frontend/src/components/MovableObject.vue:382-456`); export converts arbitrary maps with `toJSON` (`frontend/src/composables/usePdfExport.js:167-209`).
- `WhiteboardCanvas.vue` is a 2,786-line orchestration surface exposing about eighty refs and methods (`frontend/src/components/WhiteboardCanvas.vue:2488-2585`). It contains duplicated mouse and touch paths, while the canvas has no Pointer Event handlers (`frontend/src/components/WhiteboardCanvas.vue:11-30`, `frontend/src/components/WhiteboardCanvas.vue:1428-1749`). Touch is converted to a synthetic mouse event and pressure is discarded (`frontend/src/components/WhiteboardCanvas.vue:1658-1676`). Eraser hit testing scans and converts the entire document on every move (`frontend/src/components/WhiteboardCanvas.vue:1466-1514`, `frontend/src/components/WhiteboardCanvas.vue:1701-1727`).
- PDF import renders up to twenty pages as PNG data URLs and stores each one inside the Yjs document (`frontend/src/composables/usePdfImport.js:6-80`). Image validation is client-only and based on string length (`frontend/src/components/WhiteboardCanvas.vue:2098-2147`), while the WebSocket accepts a single message up to 5 MB (`server/src/server.ts:257-259`). Export renders large offscreen canvases at fixed 200 DPI (`frontend/src/composables/usePdfExport.js:5-12`, `frontend/src/composables/usePdfExport.js:167-248`).
- Pilot-only availability is not authoritative. `/` still opens the legacy whiteboard, `App.vue` still imports and mounts AI, Chemistry, Grid Align, public-room, E2E, and editable participant-name surfaces (`frontend/src/Root.vue:1-28`, `frontend/src/App.vue:1-220`, `frontend/src/App.vue:237-287`). The backend still registers AI and public-room routes (`server/src/httpApp.ts:143-180`, `server/src/httpApp.ts:252-277`).
- Process startup begins cleanup and listening without awaiting database readiness; shutdown closes sockets but does not await persistence flush, timers, or database destruction (`server/src/server.ts:250-259`, `server/src/server.ts:348-369`). Health reports `ok` based on a local room count (`server/src/httpApp.ts:154-168`).
- The production logger writes untyped console lines (`server/src/logger.ts:1-20`). The current server test run is 16/19 because disabled AI returns 503 before auth checks; the frontend test command must be invoked directly and 76 included tests pass, but `*.spec.js` behavioral files are excluded by configuration (`frontend/vite.config.js:7-10`). Many included tests assert source text rather than behavior (`frontend/tests/unit/drawingEngine.test.js:4-54`, `frontend/tests/unit/audit2.test.js:11-51`).

## Pilot invariants

Every **Module** below must preserve these invariants:

1. A Teacher and Student authenticate through revocable capability links, not accounts.
2. A Managed Board has exactly one Owning Teacher and one active Board Access Link. A Teacher has exactly one active Teacher Access Link.
3. The same link may be used in several sessions and on several devices. No device, IP, or browser binding is added.
4. A Student may work online without the Owning Teacher and may modify shared objects. Only the Teacher receives the product command to clear the whole board, rotate Board Access, or End Board Access.
5. A Student sees exactly `Dawid Furmaniuk - Matsin` and cannot rename any participant. Collaborator Labels are ephemeral system labels, not identities.
6. A Managed Board is valid for twelve months from creation. Expiry or End Board Access removes access immediately and schedules permanent deletion after seven days. Deactivation does the same for all of a Teacher's boards. Regeneration changes credentials without changing data.
7. A disconnected or not-yet-synchronized editor is read-only. Navigation and PDF export remain available. Full offline editing is outside the Pilot.
8. Every visible lesson tool is release-critical. AI, Chemistry, Grid Align, legacy peer rooms, public lobby, and E2E claims are unavailable. Debug is developer-only.
9. Supported editing inputs are mouse, graphics tablet, and iPad with Apple Pencil. Phones are outside scope.
10. The release capacity gate is 22 Teachers plus 35 Students, 57 active clients. The 88-client run is an optional stress probe; it must fail safely but does not justify distributed complexity.
11. Pilot disaster recovery may be modest, but acknowledged lesson changes, tenant isolation, and link enforcement are not negotiable.

## Target Module map

```text
PilotAvailability ───────────────┐
                                 v
CapabilityAccess ─────> BoardLifecycle ─────┐
       │                    │                │
       └──────────────┐     v                │
                      v  CollaborationRuntime <──── ResourceGovernor
                  BoardDocument                    ^          │
                      ^                             │          v
                      │                             │   OperationalSignals
InputPipeline ──> WhiteboardSession ──> ArtifactPipeline      ^
                      │                  │                     │
                      └──────────────────┴─────────────────────┘

RuntimeControl starts, readies, drains, flushes, and stops the server-side Modules.
```

The arrows are dependency direction. UI and transport code are **Adapters** at the outside of these **Seams**, not alternate places to encode domain rules.

## Design rules shared by all Modules

- **Fail closed at authoritative Seams.** Failure to resolve a capability, board, database dependency, or synchronization state yields an explicit denial or unavailable state. It never changes a Managed Board into a peer room or an empty document.
- **Acknowledge durability, not socket delivery.** An update is acknowledged only after its idempotency key and bytes are durably appended. A sent frame, successful `ws.send`, or local Yjs application is not acknowledgement.
- **One mutation path.** All UI tools produce document commands through `WhiteboardSession`; they do not write arbitrary `Y.Map` fields directly. Remote updates enter through `CollaborationRuntime` and the same `BoardDocument` validation.
- **One availability decision.** Navigation, tool manifests, server route registration, shortcuts, and tests consume one Pilot availability definition.
- **Measure before tuning limits.** Defaults are generous and configurable. Overload returns a bounded denial, read-only state, or controlled disconnect. It never produces silent divergence.
- **Replace, do not layer.** Once a new **Interface** covers a behavior, callers move to it and old routes, helpers, duplicate checks, and tests are removed in the same slice.
- **The Interface is the test surface.** Unit tests below a **Seam** are retained only for expensive pure algorithms. Behavioral guarantees are tested through the highest applicable **Interface** with real Yjs and a local PostgreSQL-compatible test dependency.

## Module 1 — CapabilityAccess

### Problem and evidence

Authorization is split among query tokens, cookies, route middleware, WebSocket checks, and UI read-only labels. The split causes fail-open room access, cross-board risk, credential rotation during viewing, and no uniform revocation behavior (`server/src/httpApp.ts:49-56`, `server/src/middleware/boardStudentAuth.ts:30-94`, `server/src/server.ts:279-316`, `frontend/src/views/AdminTeachersPanel.vue:150-178`).

### Seam and Interface

The **Seam** sits immediately after transport credential extraction and before any board metadata, document state, or administrative mutation is returned.

```ts
type CapabilityAction =
  | 'admin.manageTeachers'
  | 'teacher.openDashboard'
  | 'board.read'
  | 'board.edit'
  | 'board.export'
  | 'board.clear'
  | 'board.rotateAccess'
  | 'board.endAccess';

interface CapabilityAccess {
  decide(input: {
    credential: PresentedCredential;
    action: CapabilityAction;
    target?: { teacherId?: string; boardId?: string };
    now: Date;
  }): Promise<AccessDecision>;
}
```

`AccessDecision` is either a scoped grant containing role, Teacher id, exact Board id, allowed action, credential version, and validity bounds, or a typed denial (`missing`, `invalid`, `revoked`, `expired`, `inactive`, `wrongTarget`, `unavailable`). It never returns an unscoped boolean.

Interface invariants and ordering:

- the exact target is resolved before a grant is returned;
- Teacher ownership and active status are checked against durable state, not trusted from a signed token alone;
- a Student grant never contains Teacher-only actions;
- Board expiry, End Board Access, deletion schedule, and credential version are checked on every HTTP request and WebSocket admission;
- long-lived links may establish short transport sessions, but regeneration and deactivation are enforced by a durable credential version so old sessions cannot silently outlive the explicit invalidation contract;
- Administrator passphrase exchange produces the accepted twelve-hour Secure, HttpOnly, SameSite session. The passphrase is never accepted in a URL;
- normal denial p95 should stay below 100 ms against local Railway PostgreSQL; cached positive facts may be used only with an invalidation path that preserves immediate revocation.

### What the Implementation hides

Token generation, hashing or recoverable storage, versioning, constant-time verification, cookie signing, Administrator rate limiting, internal Teacher labels, Board lookup, expiry calculation, Public Teacher Identity, and transport-specific credential parsing.

### Dependencies and Adapter discipline

- Durable access state: **local-substitutable** PostgreSQL dependency. Use real test PostgreSQL or a compatible local stand-in inside Module tests; do not expose a repository port through the external Interface.
- Clock and randomness: **in-process** internal seams with deterministic test values.
- Express and WebSocket: two real transport **Adapters** translating their credentials and actions into `decide` calls.

### Test surface

Test `CapabilityAccess.decide` and transport conformance. Build a decision matrix across Administrator, Teacher, Student, missing/invalid/old credentials, wrong board, expired board, ended access, deactivated Teacher, and database unavailable. Add an executable cross-board test and verify that opening the Administrator list is read-only and does not change credential versions.

### Replace-don't-layer migration

Introduce the Interface with tests, route one complete Administrator-to-Teacher and Student-to-Board flow through it, then move every HTTP and WebSocket caller. Delete `readAdminSecret`, role-only WebSocket checks, automatic permanent-link POSTs, deterministic Student token derivation, and duplicate middleware checks once their callers are gone. Do not keep both old and new credential models active.

### Dependencies, blast radius, completion

Depends on BoardLifecycle's durable state shape and PilotAvailability. It is required by all administration, dashboard, board-entry, WebSocket, and future privileged mutation paths. The blast radius includes every existing link and session; the Pilot starts with a fresh database, so no historical-token migration is required.

Complete when one decision matrix governs every transport, old credentials fail immediately after regeneration or deactivation, no read operation rotates a link, one active link per target is enforced by the database, and no Managed Board path can fail open.

## Module 2 — BoardLifecycle

### Problem and evidence

The current persistence model has no Personal Board kind, link generation, access-ended timestamp, deletion schedule, or Teacher deactivation operation. It defaults Managed Boards to six months and uses `archived_at` as an ambiguous proxy (`server/migrations/20241129000000_initial_schema.ts:13-80`, `server/src/services/boardService.ts:11-108`, `server/src/routes/teacherBoards.ts:54-78`). Cleanup is unrelated to the seven-day contract (`server/src/services/boardYjsPersistence.ts:170-192`).

### Seam and Interface

The **Seam** is the durable lifecycle command handler used by Administrator and Teacher workflows and the expiry worker.

```ts
interface BoardLifecycle {
  execute(command: LifecycleCommand, now: Date): Promise<LifecycleResult>;
  view(query: LifecycleQuery, now: Date): Promise<LifecycleView>;
}
```

Commands include `ensurePersonalBoard`, `createManagedBoard`, `regenerateTeacherAccess`, `regenerateBoardAccess`, `endBoardAccess`, `deactivateTeacher`, and `purgeDueBoards`. Queries include Teacher dashboard, Administrator Teacher list, and access facts for CapabilityAccess.

Interface invariants and error modes:

- `ensurePersonalBoard` is idempotent and yields exactly one Personal Board per Teacher;
- `createManagedBoard` fixes `validUntil = createdAt + 12 months`; a caller cannot accidentally select another validity in the Pilot;
- each Managed Board has exactly one Owning Teacher and one current Board Access credential;
- regeneration atomically increments the credential version and preserves board state;
- End Board Access, expiry, and Teacher deactivation atomically set access-ended and `deleteAfter = accessEndedAt + 7 days`;
- purge is idempotent, deletes board document state, assets, access logs as configured, and the board row in one transaction or a retry-safe order;
- `notFound`, `notOwner`, `alreadyEnded`, `inactive`, and `storageUnavailable` are typed outcomes;
- lifecycle writes complete p95 below 500 ms under the 57-client gate and do not wait for live-session teardown indefinitely.

### What the Implementation hides

Schema details, date calculation, Student Label storage, group labels, Personal versus Managed Board rules, credential version changes, delete scheduling, expiry scanning, active-session notification, and transactional cascade order.

### Dependencies and Adapter discipline

- PostgreSQL: **local-substitutable**. Test through the Module with a real compatible database.
- Expiry scheduling: **in-process** during the single-instance Pilot. A lease **Seam** is not introduced until a second process needs to run the job.
- CollaborationRuntime notification after access ends: **in-process** dependency. The durable transaction is authoritative; notification accelerates socket closure but does not determine correctness.

### Test surface

Test all lifecycle commands through the Interface with a controllable clock. Include concurrent lazy Personal Board creation, duplicate regeneration, expiration at the exact boundary, deactivation with many boards, purge retry after partial failure, and read-after-regeneration. Transport tests verify the dashboard and Administrator views without inspecting tables.

### Replace-don't-layer migration

Add the new schema with explicit board kind, credential records/version, access-ended, and delete-after data. Route creation/listing through the Interface, then remove direct Knex operations from `boardService`, permanent-token helpers, and cleanup in `BoardYjsPersistence`. Replace archive/restore UI with the agreed End Board Access semantics; do not preserve experimental archive behavior as a parallel lifecycle.

### Dependencies, blast radius, completion

Depends on OperationalSignals and informs CapabilityAccess and CollaborationRuntime. The blast radius includes Teacher dashboards, Student links, expiry, deletion, and all Yjs foreign keys.

Complete when the full twelve-month/seven-day state machine is executable, Personal Board creation is idempotent, deactivation closes access immediately, regeneration preserves data, purge is retry-safe, and every lifecycle fact has one durable source.

## Module 3 — BoardDocument

### Problem and evidence

Document rules are spread through a permissive server type, manual `Y.Map` construction, rendering fallbacks, line-binding code, PDF bounds code, and AI patch helpers. Field aliases (`color`/`strokeColor`, root `x/y`/nested `position`, `points`/`start/end`) create different truths (`server/src/models/boardSnapshot.ts:11-67`, `frontend/src/composables/useDrawingEngine.js:502-599`, `frontend/src/components/MovableObject.vue:382-456`, `server/src/yjs/boardDoc.ts:137-208`).

### Seam and Interface

The **Seam** is the canonical document behavior shared by client session logic, server collaboration validation, rendering, and artifacts.

```ts
interface BoardDocument {
  snapshot(): Readonly<BoardScene>;
  execute(command: BoardCommand, origin: OperationOrigin): DocumentResult;
  apply(update: Uint8Array, origin: OperationOrigin): DocumentResult;
  encode(stateVector?: Uint8Array): Uint8Array;
  digest(): string;
}
```

`BoardCommand` covers create, update, delete, transform, clear, and tool-specific insertion using a tagged, versioned object schema. `DocumentResult` returns accepted normalized changes or typed validation failures; callers do not manipulate Yjs collections.

Interface invariants and performance:

- globally unique stable object id and known object type;
- finite coordinates and bounded dimensions, rotation, point counts, string lengths, and asset references;
- one canonical geometry representation per type; compatibility aliases are read only at a dedicated import edge and are never emitted;
- deterministic normalization, bounds, selection, transform, line binding, and state digest;
- a whole-board clear is an explicit command distinguishable from ordinary object deletion;
- local origin is preserved so Yjs UndoManager tracks only the current participant's operations;
- applying an accepted update and re-encoding it is convergent and deterministic;
- ordinary command execution remains below the 50 ms local input-to-paint budget; expensive validation is incremental and does not scan the whole scene per pointer sample.

Commands are applied in caller order inside one Yjs transaction; rejected commands leave the document and undo history unchanged. Typed errors distinguish unsupported schema, invalid geometry, missing object, forbidden command, resource violation, and incompatible update.

### What the Implementation hides

Yjs collection layout, schema versioning, normalization, geometry, object factories, command-to-transaction mapping, diff calculation, update validation using a shadow document, undo origins, line bindings, indexes, and state hashing.

### Dependencies and Adapter discipline

This is an **in-process** Module. Yjs is its Implementation detail, not an external **Adapter**. Rendering and PDF consume `BoardScene`; they do not receive raw `Y.Map` values. A legacy snapshot importer is a temporary internal **Adapter** only if required for developer fixtures; the Pilot has no old-data migration promise.

### Test surface

Property and example tests use the Interface: command sequences, invalid numbers, every visible object type, transforms, selection, line bindings, local undo, encode/apply convergence, state-vector deltas, and deterministic digest. Tests must not assert Yjs field layout. Renderer and Artifact conformance fixtures consume canonical snapshots.

### Replace-don't-layer migration

Choose one thin vertical object family first, such as pen plus text, and make UI, server validation, reload, and export use the new Interface. Expand type coverage, then remove manual `Y.Map` construction, `BoardSnapshot` index signatures, repeated fallback extraction, and source-text tests. Do not retain a generic `set(key, value)` escape hatch in caller-facing code.

### Dependencies, blast radius, completion

Used by CollaborationRuntime, WhiteboardSession, ArtifactPipeline, and rendering. Its blast radius is every visible tool and stored document. Because the Pilot starts fresh, the migration may reject unsupported historical shapes rather than preserving every accidental field.

Complete when all Pilot-visible object types have canonical schemas and commands, no product caller handles `Y.Map`, local undo is behaviorally verified, and client/server digests converge after seeded concurrent scenarios.

## Module 4 — CollaborationRuntime

### Problem and evidence

The current server mixes connection admission, room creation, hydration, Yjs application, broadcast, persistence scheduling, awareness, rate limiting, and cleanup in one process-level file (`server/src/server.ts:23-346`). Durability acknowledgements do not exist, recovery ignores updates, compaction races, and idle unload can destroy a Managed Board document without forcing a snapshot (`server/src/services/boardYjsPersistence.ts:52-167`, `server/src/rooms.ts:349-368`).

### Seam and Interface

The external **Seam** owns one live board session from authenticated admission through durable update, fan-out, disconnect, and idle unload.

```ts
interface CollaborationRuntime {
  connect(input: AuthenticatedConnection, transport: CollaborationTransport): Promise<ConnectionHandle>;
  drain(input: { deadline: Date; reason: string }): Promise<DrainReport>;
  inspect(boardId: string): Promise<CollaborationSnapshot>;
}

interface ConnectionHandle {
  receive(frame: ClientFrame): Promise<ReceiveResult>;
  close(reason: string): Promise<void>;
}
```

The versioned protocol distinguishes sync, awareness, mutation, acknowledgement, denial, synchronization-complete, and server-draining frames. A mutation carries a stable client operation id.

Interface invariants and ordering:

1. CapabilityAccess grant is checked before room creation or hydration.
2. Hydration atomically establishes `snapshotCutoff`, applies the snapshot, then all updates after the cutoff. Failure returns unavailable and never serves an empty document.
3. A client remains read-only until it receives synchronization-complete.
4. A mutation is applied to a shadow BoardDocument and authorized as a document action.
5. The update plus client operation id is appended durably and deduplicated.
6. The live BoardDocument is updated, peers receive the update, and only then is durability acknowledgement returned to the origin. A crash after append is recovered; a retry is idempotent.
7. Snapshot compaction records a cutoff and deletes only updates at or before that cutoff in one transaction.
8. Final disconnect schedules prompt snapshot and idle unload. Drain stops admissions, tells clients to reconnect, persists all dirty documents, and closes storage before its deadline.

Error modes are explicit: unauthorized, revoked, read-only, not-synchronized, malformed, over-limit, slow-client, persistence-unavailable, draining, and internal. Slow clients are disconnected before unbounded `bufferedAmount` threatens the process.

Performance expectations follow the release gate: remote propagation p95 at or below 250 ms in representative conditions, reconnection to synchronized editing within 5 seconds after connectivity returns, controlled restart recovery within 30 seconds, and zero acknowledged loss or cross-board updates.

### What the Implementation hides

Live `Y.Doc` ownership, hydration locks, operation deduplication, update sequencing, snapshot cutoff transactions, awareness cleanup, connection registry, broadcast backpressure, persistence retry, dirty tracking, idle unload, reconnect protocol, and drain.

### Dependencies and Adapter discipline

- PostgreSQL: **local-substitutable**, exercised with real Yjs bytes in Module tests.
- WebSocket transport and deterministic in-memory transport are two real **Adapters** at the `CollaborationTransport` **Seam**.
- CapabilityAccess, BoardDocument, ResourceGovernor, and OperationalSignals are in-process dependencies.
- Multi-instance coordination is not an **Adapter** in the Pilot. The external Interface keeps callers independent of process-local ownership; a distributed Implementation becomes justified only when a second deployment mode is actually required.

### Test surface

Use the Interface with in-memory transports and PostgreSQL. Test two to four clients, concurrent first hydration, disconnect before and after acknowledgement, process crash after append/before acknowledgement, duplicate operation replay, snapshot cutoff race, slow client, revocation during a session, wrong-board grant, idle unload/reload, and drain. Final state is compared by BoardDocument digest, not internal maps.

### Replace-don't-layer migration

Build the new protocol alongside a test-only client **Adapter**, then migrate one Managed Board path. Once the change gate proves it, move all Managed Board clients and delete the legacy raw frame handler, `RoomManager` path for product boards, `BoardYjsPersistence` timers, and peer-room fallback. Legacy peer rooms may remain only on a clearly separate developer entry until their fixtures are replaced; they never share the Pilot runtime.

### Dependencies, blast radius, completion

Depends on CapabilityAccess, BoardLifecycle facts, BoardDocument, ResourceGovernor, OperationalSignals, and RuntimeControl. Blast radius includes every live lesson and Railway restart.

Complete when acknowledged writes survive every injected crash point, hydration replays snapshot plus log, compaction cannot delete newer updates, revocation closes or downgrades live sessions, idle boards unload safely, and the deterministic five-to-ten-minute change gate passes.

## Module 5 — WhiteboardSession

### Problem and evidence

UI state, connection state, drawing, selection, transformations, helpers, undo, viewport, panels, and direct Yjs writes are coordinated through a very wide Vue instance (`frontend/src/components/WhiteboardCanvas.vue:225-480`, `frontend/src/components/WhiteboardCanvas.vue:2488-2585`). The large public surface makes call order and editability implicit and tests couple to file layout.

### Seam and Interface

The **Seam** sits between Vue rendering/input **Adapters** and all board-session behavior.

```ts
interface WhiteboardSession {
  dispatch(intent: SessionIntent): SessionResult;
  view(): Readonly<SessionView>;
  subscribe(listener: (view: SessionView) => void): Unsubscribe;
  dispose(): Promise<void>;
}
```

`SessionIntent` covers tool selection, pointer intents, text entry, selection, transforms, undo/redo, viewport changes, import/export requests, and privileged Teacher commands. `SessionView` exposes render scene, overlays, selection handles, viewport, tool manifest, Collaborator Labels, connection/editability state, and user-facing errors.

Interface invariants and performance:

- all document changes call BoardDocument commands; the Vue **Adapter** never edits Yjs;
- editability is a single state derived from authenticated role, synchronization, connection, lifecycle, and resource status;
- `connecting`, `synchronizing`, `editable`, `readOnlyDisconnected`, `readOnlyRevoked`, and `draining` are explicit states;
- disconnected states permit pan, zoom, selection inspection, and PDF export but reject mutation intents before any local document change;
- Student has no `clear`, rotate, or End Board Access intent in its manifest; server authorization remains authoritative;
- undo/redo tracks only operations from this session and may reset on reload;
- one intent produces at most one semantic transaction and one undo entry;
- pointer-driven view updates fit inside the 50 ms input-to-paint p95 target and avoid a full scene rebuild for cursor-only changes.

Intents are processed serially per session and publish a view only after their document and session-state effects are coherent. Rejected, unavailable, read-only, invalid-state, and resource-limited results are typed; none may partially mutate the document.

### What the Implementation hides

Session state machine, selected tool, panel exclusivity, selection lifecycle, viewport, command creation, local origins, collaboration client protocol, reconnect state, undo grouping, renderer invalidation, awareness presentation, and error translation.

### Dependencies and Adapter discipline

BoardDocument, Collaboration client **Adapter**, InputPipeline, ArtifactPipeline, and PilotAvailability are in-process dependencies. Vue/canvas rendering and a headless deterministic renderer are two **Adapters** at the view **Seam**. Do not expose composable internals as an external Interface.

### Test surface

Drive the Interface with intents and assert SessionView plus BoardDocument digest. Cover every visible tool's complete workflow, role restrictions, offline read-only, reconnect, local undo, panel exclusivity, clipboard/image insertion, reload, and collaboration. Vue tests are thin **Adapter** conformance tests for events, layout, and accessibility.

### Replace-don't-layer migration

Start with a vertical pen/text/select flow and render it through SessionView. Move one behavior family at a time, deleting equivalent refs, exposed methods, watchers, and direct document writes from `WhiteboardCanvas.vue`. The goal is a thin rendering **Adapter**, not a new coordinator that forwards eighty arguments to the old one.

### Dependencies, blast radius, completion

Depends on BoardDocument, CollaborationRuntime's client protocol, InputPipeline, ArtifactPipeline, PilotAvailability, and OperationalSignals. Blast radius is the entire editor UX.

Complete when Vue owns layout only, every visible tool dispatches intents, one editability state gates every mutation, tool tests survive internal refactors, and no product caller reaches past the Interface.

## Module 6 — InputPipeline

### Problem and evidence

Mouse and touch paths are duplicated; touch becomes a synthetic mouse event; Apple Pencil pressure and pointer identity are discarded; pinch, pan, drawing, erasing, and awareness have separate coordinate logic (`frontend/src/components/WhiteboardCanvas.vue:11-30`, `frontend/src/components/WhiteboardCanvas.vue:1430-1749`). Per-move eraser work is O(number of objects). The existing pen renderer uses several independent smoothing algorithms and presets (`frontend/src/utils/penStyles.js:28-85`, `frontend/src/modules/HandwritingStylerModule.js:214-239`).

### Seam and Interface

The **Seam** converts browser input into deterministic session intents.

```ts
interface InputPipeline {
  configure(profile: 'mouse' | 'pen'): void;
  ingest(batch: PointerSampleBatch): InputResult;
  cancel(reason: 'blur' | 'lostcapture' | 'gesture' | 'dispose'): InputResult;
}
```

`PointerSampleBatch` carries Pointer Event identity, pointer type, buttons, pressure, tilt where available, timestamps, coalesced samples, viewport transform, and accessibility settings. `InputResult` is a bounded list of start/update/finish/cancel drawing, pan, pinch, hover, or awareness intents.

Interface invariants and performance:

- Pointer Events are the primary browser **Adapter** for mouse, pen, and touch; pointer capture prevents dropped end events;
- two-finger touch controls navigation and does not draw; Apple Pencil draws while palm/touch rejection follows browser pointer identity and explicit gesture rules;
- the `Mysz` profile applies stronger smoothing; `Pióro` preserves useful pressure and native detail. Auto-selection may choose an initial profile, but user override persists;
- coordinate conversion is performed once per batch using one viewport transform;
- coalesced samples are consumed when available and scheduled within animation frames without accumulating unbounded lag;
- cancellation never commits a corrupt partial object;
- hit testing uses BoardDocument's spatial index or bounded candidate query, not a full document conversion per sample;
- input-to-paint p95 is at or below 50 ms on representative hardware, with no gaps, jumps, growing lag, or sustained frame loss.

Samples are ordered by pointer id and timestamp before gesture reduction. Out-of-order, duplicate, unsupported, or invalid-coordinate samples yield typed ignored/cancelled results rather than a partial commit; ingestion remains bounded by the accepted batch and cannot recursively dispatch input.

### What the Implementation hides

Pointer capture, coalesced samples, event normalization, palm/gesture arbitration, pressure curve, smoothing profiles, resampling, batching, frame scheduling, coordinate transforms, hover throttling, and stroke finalization.

### Dependencies and Adapter discipline

Browser Pointer Events and deterministic recorded pointer traces are two real **Adapters**. Smoothing and resampling are **in-process**. BoardDocument candidate queries and WhiteboardSession dispatch are dependencies.

### Test surface

Replay deterministic mouse, pen, Apple Pencil-like, touch, pinch, lost-capture, and mixed-input traces through the Interface. Assert intents, sample continuity, pressure preservation, cancellation, coordinate results, and work per frame. Browser conformance tests exercise real Pointer Events. Kordian's Apple Pencil and graphics-tablet pass confirms feel and regressions; it is not the discovery loop for basic correctness.

### Replace-don't-layer migration

Add Pointer Event handling for one pen path behind the Interface, prove equivalence, then remove mouse/touch drawing handlers and synthetic events. Consolidate smoothing into profiles and remove competing per-feature smoothing logic after visual and trace comparisons.

### Dependencies, blast radius, completion

Depends on WhiteboardSession, BoardDocument queries, and OperationalSignals. Blast radius includes drawing, erasing, selecting, panning, pinch zoom, awareness cursor, and iPad browser behavior.

Complete when all three supported input setups use one Interface, trace tests pass, real-device confirmation passes, and no duplicate mouse/touch mutation path remains.

## Module 7 — ArtifactPipeline

### Problem and evidence

Import, images, export bounds, canvas rendering, and download behavior are separate ad hoc flows. PDF pages become large inline PNG strings; import is capped by a hardcoded page count with English messages; export uses fixed large canvases and repeats document normalization (`frontend/src/composables/usePdfImport.js:6-83`, `frontend/src/composables/usePdfExport.js:16-337`, `frontend/src/components/WhiteboardCanvas.vue:2098-2169`).

### Seam and Interface

The **Seam** owns user artifacts from validation through canonical board commands or exported bytes.

```ts
interface ArtifactPipeline {
  planImport(source: ImportSource): Promise<ImportPlan>;
  import(plan: ImportPlan, target: ImportTarget): AsyncIterable<ArtifactProgress>;
  export(scene: Readonly<BoardScene>, options: ExportOptions): Promise<ExportArtifact>;
}
```

Interface invariants and error modes:

- required imports: PDF, PNG, JPEG, WebP; SVG and HEIC are explicit best effort;
- PDF pages preserve proportions and become movable/resizable canonical image objects;
- import is transactional at a user-meaningful level: cancellation or failure reports exactly which pages were committed and never leaves malformed objects;
- MIME, decoded dimensions, page count, pixel count, and encoded size are validated before insertion;
- exported PDF contains every visible supported object type, preserves proportions, and works on iPad save/share behavior;
- export from a disconnected read-only session remains available from the last synchronized state;
- all errors are typed and translated to clear Polish UI; no `check console` product error;
- large work is chunked/yielded so it does not freeze the editor, and temporary canvases/assets are released deterministically.

Validation precedes decoding, decoding precedes budget reservation, and canonical document commands are emitted only after a page or image is valid. Progress events preserve source order. Normal single-page work must not consume the input-to-paint budget; longer work is asynchronous, cancellable, and bounded by ResourceGovernor.

### What the Implementation hides

PDF.js worker configuration, decode/render scale, page layout, asset encoding, export tiling, scene bounds, renderer reuse, jsPDF behavior, iOS delivery, progress, cancellation, and memory cleanup.

### Dependencies and Adapter discipline

PDF.js and jsPDF are **in-process** Implementation dependencies, not external **Adapters**. Browser file, decode, canvas, download, and share behavior is **local-substitutable** for Module tests and is confirmed with the production built-in Browser **Adapter**. BoardDocument commands and ResourceGovernor are dependencies. The Pilot keeps inline/document assets only if measured limits pass; external object storage is not introduced without evidence and therefore is not a current **Adapter**.

### Test surface

Use the Interface with fixture PDFs/images and canonical scenes. Verify multi-page order, proportions, malformed/encrypted/oversized files, cancellation, every object type in export, iPad delivery branch, memory release, and Polish errors. Add visual PDF regression fixtures and a browser end-to-end import-collaborate-reload-export flow.

### Replace-don't-layer migration

Route PDF import/export through the Interface, then image paste. Delete duplicate bounds and normalization helpers only after canonical renderer parity. Remove raw import/export from production manifests rather than making the ArtifactPipeline support the experimental format.

### Dependencies, blast radius, completion

Depends on BoardDocument, ResourceGovernor, WhiteboardSession, renderer, and OperationalSignals. Blast radius includes document size, Yjs messages, browser memory, and PDF fidelity.

Complete when required formats pass representative fixtures, normal imports remain within measured budgets, oversize input fails clearly without board corruption, and exported PDFs visually match the synchronized board.

## Module 8 — ResourceGovernor

### Problem and evidence

Current limits count messages or bytes at unrelated points and do not model cost. WebSocket permits 5 MB per frame, the client permits a roughly 5 MB data URL, HTTP JSON allows 20 MB, and broadcast ignores slow-client buffers (`server/src/server.ts:136-187`, `server/src/server.ts:257-259`, `server/src/httpApp.ts:97-99`, `frontend/src/components/WhiteboardCanvas.vue:2098-2111`).

### Seam and Interface

The **Seam** evaluates resource attempts before expensive work and observes their actual cost.

```ts
interface ResourceGovernor {
  admit(attempt: ResourceAttempt, context: UsageContext): AdmissionDecision;
  observe(sample: ResourceSample): void;
}
```

Attempts include connection, message, document update, decoded image, PDF, board hydration, export, and slow-client buffer. Decisions are `allow`, `allowWithBudget`, `retryAfter`, `readOnly`, or `reject`, always with a stable reason and public-safe Polish message key.

Interface invariants:

- normal Lesson Sessions have generous headroom;
- limits are configuration with documented measured defaults, not scattered constants;
- per-process limits are sufficient for the single-instance Pilot;
- 57 clients must pass; 88 clients are observed but do not force architectural expansion;
- overload preserves tenant isolation and durable state and produces bounded memory/queue growth;
- one broken client cannot consume unbounded broadcast buffers or event-loop time;
- the Interface never logs board content.

Admission occurs before allocation or queueing, and observation occurs after measured work without retroactively changing an accepted result. Unknown usage, stale configuration, and accounting failure fail to a typed conservative decision. Hot-path admission is synchronous and bounded; it performs no network or database I/O.

### What the Implementation hides

Token buckets, concurrent-work budgets, decoded-pixel estimates, document/update size thresholds, per-board and per-process accounting, slow-client thresholds, retry hints, and measurement calibration.

### Dependencies and Adapter discipline

This is primarily **in-process**. Configuration and OperationalSignals are dependencies. Do not add Redis or a distributed quota **Adapter** for the Pilot. If Company Rollout introduces multiple instances, global quota storage becomes a real second deployment requirement and can earn a port then.

### Test surface

Deterministic budget tests plus CollaborationRuntime and ArtifactPipeline conformance. Exercise normal mature-board traffic, destructive random objects, oversized PDF/image, update flood, 57 clients, 88 clients, and deliberately slow consumers. Assert controlled denials and bounded queues, not internal counters.

### Replace-don't-layer migration

Inventory current constants, measure representative workloads, introduce decisions at WebSocket and artifact entry, then remove duplicated rate/size checks. Keep a single translation table from denial reason to Polish UI.

### Dependencies, blast radius, completion

Used by CapabilityAccess rate limits, CollaborationRuntime, ArtifactPipeline, and RuntimeControl. Blast radius includes legitimate large lessons, so defaults require representative evidence.

Complete when all costly entry points ask one Interface, 57 clients pass, overload is bounded, and no duplicated hardcoded product limit remains.

## Module 9 — PilotAvailability

### Problem and evidence

Feature availability is currently inferred from what a Vue template happens to render and what server configuration happens to contain. Legacy peer rooms, AI, Chemistry, Grid Align, E2E claims, editable names, and debug controls remain reachable or mounted (`frontend/src/Root.vue:1-28`, `frontend/src/App.vue:41-220`, `server/src/httpApp.ts:143-180`, `server/src/httpApp.ts:252-277`).

### Seam and Interface

The **Seam** is a shared, versioned Pilot manifest consumed at build/start and session creation.

```ts
interface PilotAvailability {
  resolve(input: { environment: 'development' | 'pilot'; role: RuntimeRole }): FeatureManifest;
  require(feature: FeatureId, input: AvailabilityContext): AvailabilityDecision;
}
```

The production manifest includes all release-critical lesson tools, Input Style, Administrator/Teacher/Student flows, Personal Board, PDF, and developer-approved operational surfaces. It excludes AI, Chemistry, Grid Align, legacy lobby/peer rooms, E2E claims, raw board import/export, editable participant names, and production debug.

Interface invariants:

- UI navigation, toolbar, shortcuts, server route registration, and tests use the same manifest version;
- hidden means no visible control, route, shortcut, background provider call, or manually callable server path in Pilot;
- debug is reachable only in development/internal mode and cannot be activated by an untrusted query parameter;
- every visible tool is automatically included in release-gate enumeration;
- Public Teacher Identity and Collaborator Label behavior cannot be overridden by local storage.

The manifest resolves before routes, shortcuts, or sessions are constructed. Unknown feature ids, manifest-version mismatch, and invalid environment fail closed with typed startup or availability errors. Resolution is pure, deterministic, and constant-time relative to product data.

### What the Implementation hides

Feature ids, role matrices, environment parsing, server startup assertions, toolbar generation, internal debug activation, and manifest/version reporting.

### Dependencies and Adapter discipline

Pure **in-process** Module shared by frontend and server packages. No **Adapter** is required. Build tooling may generate typed constants from one source, but generated copies are verified against one hash and are not separate sources of truth.

### Test surface

Snapshot the manifest by role and environment, then crawl UI routes, controls, shortcuts, and server routes to prove conformance. A production test attempts every excluded path directly and expects unavailable/not found without provider calls.

### Replace-don't-layer migration

Define the manifest, make one visible-tool registry drive toolbar and tests, then remove template-level one-off gates and unregister excluded server routes. Delete public-room auto-bootstrap after Managed Board and Personal Board entry fixtures replace it.

### Dependencies, blast radius, completion

Read by all user-facing Modules and RuntimeControl. Blast radius includes accidental removal of a critical tool, so manifest conformance is a release blocker.

Complete when production exposes exactly the agreed Pilot surface, excluded backend paths are uncallable, debug is internal-only, and the test suite enumerates all visible tools from the manifest.

## Module 10 — OperationalSignals

### Problem and evidence

Current observability is untyped console logging, local counters, and a health route that reports `ok` without checking dependencies (`server/src/logger.ts:1-20`, `server/src/httpApp.ts:100-121`, `server/src/httpApp.ts:154-168`). Collaboration failures are often logged and swallowed, so operators cannot distinguish unavailable persistence from a healthy room.

### Seam and Interface

The **Seam** accepts structured operational events and exposes a content-free runtime snapshot.

```ts
interface OperationalSignals {
  record(event: OperationalEvent): void;
  measure(sample: OperationalMeasurement): void;
  snapshot(): OperationalSnapshot;
}
```

Events cover access decisions, credential lifecycle, session admission/close, synchronization, durable acknowledgements, persistence errors, snapshot/compaction, read-only transitions, artifact work, resource denials, lifecycle jobs, and process phases. Measurements cover event-loop delay, memory, active connections/boards, update/asset sizes, persistence latency, sync/load latency, and per-board state digest.

Interface invariants:

- board content, access tokens, passphrases, signed sessions, full Student Labels, and URLs are never recorded;
- correlation ids join HTTP, WebSocket, lifecycle, and persistence events without becoming credentials;
- event names and dimensions are bounded to avoid cardinality explosions;
- a failed persistence acknowledgement, cross-board digest mismatch, or unhandled error is visible as a release-test failure;
- metrics overhead remains small enough not to distort the 57-client gate.

Events receive a monotonic per-process sequence before asynchronous serialization, while measurements may be aggregated without preserving global event order. Recording is non-blocking and bounded; sink failure increments an internal loss signal and never crashes or delays an acknowledged lesson update.

### What the Implementation hides

Redaction, structured serialization, counters/histograms, event-loop sampling, test capture, log levels, correlation propagation, and Railway-compatible output.

### Dependencies and Adapter discipline

Structured console/metrics output and an in-memory recording **Adapter** are two real **Adapters**. External monitoring vendors are not required for the Pilot.

### Test surface

Every event schema is tested for redaction and bounded fields. Module tests use the recording **Adapter** to assert observable behavior. Soak tests consume snapshots for memory, event loop, connections, database failures, and digests.

### Replace-don't-layer migration

Introduce typed events in CapabilityAccess and CollaborationRuntime first, replace direct logger calls as each Module migrates, then delete legacy sensitive-route logging and local health-derived truth.

### Dependencies, blast radius, completion

Used by every server-side Module and selected client diagnostics. Blast radius is operational cost and accidental data leakage.

Complete when release-gate failures are diagnosable from structured events, secrets/content are redacted by construction, and soak metrics are emitted without ad hoc parsing of console strings.

## Module 11 — RuntimeControl

### Problem and evidence

Startup, readiness, periodic work, WebSocket admission, drain, persistence flush, and database closure are not one ordered lifecycle. `FilePersistence` starts asynchronous initialization in its constructor (`server/src/persistence.ts:14-28`); cleanup starts and the server listens immediately (`server/src/server.ts:250-259`, `server/src/server.ts:348-350`); shutdown does not await snapshots or database close (`server/src/server.ts:352-369`).

### Seam and Interface

The **Seam** is the executable process lifecycle used by the Railway entry point and integration tests.

```ts
interface RuntimeControl {
  start(): Promise<RunningRuntime>;
  status(): RuntimeStatus;
  stop(input: { reason: string; deadline: Date }): Promise<ShutdownReport>;
}
```

Ordering and invariants:

1. Validate PilotAvailability and required secrets.
2. Connect database, run/verify migrations, and prove read/write readiness.
3. Construct Modules and start lifecycle jobs.
4. Start HTTP/WebSocket listeners.
5. Mark ready only after all authoritative dependencies pass.
6. On stop, mark unready, reject new admissions, ask CollaborationRuntime to drain, flush dirty boards, stop timers, close listeners, destroy database pool, and return a report before exit.
7. If the deadline expires, report exactly what remains and terminate without claiming a clean shutdown.

Invalid configuration, dependency-unavailable, migration-failed, listener-failed, drain-timeout, and flush-failed are typed lifecycle outcomes. Startup and stop are serialized and idempotent; no implicit retry may reorder lifecycle phases. Readiness checks are bounded and controlled restart recovery remains within the 30-second release target.

Liveness means the process loop runs. Readiness means it can authenticate, hydrate, persist, and serve a lesson. These are separate status values. Controlled restart recovery must remain within 30 seconds without acknowledged loss.

### What the Implementation hides

Configuration validation, migration orchestration, dependency probes, listener construction, signal idempotency, drain deadlines, timer ownership, database destruction, liveness/readiness routing, and shutdown report aggregation.

### Dependencies and Adapter discipline

Node process signals and a deterministic lifecycle driver are two **Adapters**. Database and network listeners are owned dependencies. Railway is not wrapped in a speculative deployment port.

### Test surface

Use the Interface in process-level integration tests. Inject failures at configuration, database connect, migration, hydration, append, snapshot, listener start, drain, and close. Verify readiness transitions, double signal idempotency, no admission during drain, final digest after restart, and bounded deadline behavior.

### Replace-don't-layer migration

Move executable construction out of module import side effects into `RuntimeControl.start`, then route signals through `stop`. Delete constructor-started initialization, global cleanup timers, direct `server.listen`, and direct `process.exit` once covered.

### Dependencies, blast radius, completion

Constructs all server-side Modules and depends on OperationalSignals. Blast radius is every deployment and restart.

Complete when readiness is truthful, startup fails before listening on missing dependencies, graceful shutdown flushes all acknowledged state, double shutdown is safe, and a controlled restart passes the 30-second gate.

## Highest-Seam testing architecture

The desired test pyramid is organized by **Seam**, not file size:

1. **Domain Interface tests**: CapabilityAccess, BoardLifecycle, BoardDocument, ResourceGovernor, PilotAvailability, and InputPipeline with deterministic dependencies.
2. **Session Interface tests**: WhiteboardSession intent-to-view and document outcomes; no Vue selectors for domain behavior.
3. **Collaboration Interface tests**: real Yjs bytes, local PostgreSQL-compatible storage, and in-memory transport **Adapters** with crash injection.
4. **Transport conformance**: Express/cookie and WebSocket **Adapters** prove they translate into the same domain decisions.
5. **Browser workflows**: Administrator → Teacher → Student, every visible tool, collaboration, reconnect, reload, PDF, and desktop/iPad-sized layout.
6. **Capacity and failure lanes**: deterministic change gate, mature board, three-hour 57-client soak, and optional 88-client stress run.

Tests replaced by the higher **Seam** are deleted. Source-text assertions do not count as behavior gates. Existing `*.spec.js` files must either join the configured suite or be replaced; they must not remain as invisible evidence.

The acknowledgement oracle is:

```text
client operation id accepted
  -> durable update row committed
  -> server acknowledgement emitted
  -> restart hydrates snapshot plus all rows after cutoff
  -> every client and server BoardDocument digest is equal
```

## Replace-don't-layer migration order

The migration remains safe by keeping each slice vertically usable:

1. Establish PilotAvailability and an executable Managed Board test fixture.
2. Replace access and link lifecycle before exposing new collaboration behavior.
3. Establish BoardLifecycle durable states and schema.
4. Move a minimal pen/text path through BoardDocument, WhiteboardSession, and acknowledged CollaborationRuntime.
5. Expand canonical commands and visible tool families while deleting direct Yjs callers.
6. Replace input paths and artifact flows.
7. Complete RuntimeControl, OperationalSignals, and capacity gates.

At no point should the product route a request through old authorization and then the new authorization, write both old and new document shapes, or persist through both `FilePersistence` and Managed Board storage. Dual reads are allowed only as a short, explicit fixture migration and are removed before the slice is complete.

## Vertical implementation slice graph

These are autonomous vertical slices. Each slice owns behavior from UI/transport through the relevant **Interfaces**, durable state, and executable tests. They are not assignments by file.

```text
S0 Pilot Surface and Test Spine
 ├──> S1 Capability Links and Administrator Flow
 │      └──> S2 Managed/Personal Board Lifecycle
 │              └──> S3 Acknowledged Durable Lesson
 │                      ├──> S4 Core Whiteboard Commands
 │                      │      ├──> S5 Pointer and iPad Input
 │                      │      ├──> S6 Math/Physics and Object Tool Completion
 │                      │      └──> S7 PDF, Images, and Resource Safety
 │                      └──> S8 Runtime Recovery and Observability
 └──────────────────────────────────────────────┐
                                                v
                                     S9 Pilot Release Gates

S10 Pilot UI Fidelity depends on S0, S1, S2, and the visible flows from S4–S7.
S9 depends on S5–S8 and S10.
```

### S0 — Pilot Surface and Test Spine

Goal: the running Pilot exposes only agreed entry points and every visible feature is machine-enumerable.

Acceptance criteria:

- PilotAvailability drives frontend routes, toolbar/shortcuts, and backend route registration.
- AI, Chemistry, Grid Align, legacy lobby/peer rooms, E2E claims, editable participant names, raw product import/export, and production debug are unreachable by direct navigation and direct HTTP calls.
- A deterministic local Managed Board fixture launches Administrator, Teacher, and Student browser contexts.
- All current test files intended to execute are included; source-text suites are marked for replacement rather than treated as acceptance evidence.
- Old public-room product entry is removed after the fixture works.

### S1 — Capability Links and Administrator Flow

Goal: an Administrator signs in, creates/retrieves/regenerates/deactivates a Teacher Access Link, and a Teacher opens the dashboard without incidental credential changes.

Acceptance criteria:

- twelve-hour Administrator HttpOnly session and rate-limited login;
- one active retrievable Teacher Access Link per Teacher; list/view is side-effect-free; explicit regeneration invalidates the old credential and preserves data;
- capability decision matrix covers HTTP and WebSocket targets and fails closed on database errors;
- public/student surfaces never expose internal Teacher labels;
- Administrator and Teacher flows show clear Polish errors;
- old header/query admin secret and automatic link rotation are deleted.

### S2 — Managed/Personal Board Lifecycle

Goal: a Teacher receives one Personal Board and can create and end a twelve-month Managed Board with one shareable group link.

Acceptance criteria:

- lazy, concurrent-safe Personal Board creation;
- Managed Board creation with exactly one Owning Teacher, Student Label/group label, one active link, and fixed twelve-month validity;
- Board Access regeneration preserves state and invalidates the old credential;
- expiry, End Board Access, and Teacher deactivation remove access immediately and schedule deletion after seven days;
- retry-safe purge permanently removes due board state and assets;
- no recovery/renewal/restore product control is exposed;
- experimental archive semantics and six-month default are removed.

### S3 — Acknowledged Durable Lesson

Goal: one Teacher and up to three Students collaborate on one Managed Board with durable acknowledgements, reconnect, and safe restart.

Acceptance criteria:

- client read-only until authenticated synchronization-complete; connection loss changes to read-only within 2 seconds and recovery restores editing only after sync;
- stable operation ids, durable append before acknowledgement, dedupe, snapshot cutoff, replay, and safe compaction;
- Student works without Teacher present; the same link works in several sessions;
- no acknowledged loss across every crash injection point, idle unload, or controlled restart;
- wrong-board tokens and revocation are denied; no cross-board update appears;
- legacy product raw-frame/RoomManager persistence path is deleted.

### S4 — Core Whiteboard Commands

Goal: pen, eraser, text, select, move, resize, undo/redo, pan/zoom, shapes, lines, styles, clear, and image paste operate through BoardDocument and WhiteboardSession.

Acceptance criteria:

- canonical schema and commands for every listed object family;
- Vue/canvas is a thin rendering **Adapter**, with no direct `Y.Map` mutation;
- Teacher and Student can edit each other's objects; whole-board clear is a Teacher command;
- undo/redo affects only the current participant and resets safely on reload;
- collaboration, persistence, reload, transforms, handles, bindings, and export representation pass behavior tests;
- duplicated field aliases and direct mutation helpers are removed after replacement.

### S5 — Pointer and iPad Input

Goal: mouse, graphics tablet, and Apple Pencil share one Pointer Event pipeline and feel continuous.

Acceptance criteria:

- one Pointer Event **Adapter** with capture, coalesced samples, pressure preservation, touch gesture arbitration, and cancellation;
- `Mysz` and `Pióro` Input Style presets, automatic initial choice, and persistent manual override;
- two-finger pinch/pan does not create strokes; drawing does not scroll the page; palm/touch behavior is predictable;
- input-to-paint p95 at or below the initial 50 ms target on representative hardware, with no jumps, gaps, increasing lag, or sustained frame drops;
- deterministic pointer traces pass, followed by Kordian's real Apple Pencil and graphics-tablet confirmation;
- duplicated mouse/touch mutation handlers are deleted.

### S6 — Math/Physics and Object Tool Completion

Goal: every remaining visible lesson tool completes its full collaborative workflow.

Acceptance criteria:

- calculator, coordinate systems, mathematical graphs, physical graphs, all visible shapes/lines/styles, and required panels work in Polish;
- created output uses canonical document commands, synchronizes, transforms, persists, reloads, exports, and participates in local undo where applicable;
- panel exclusivity, viewport clamping, focus, shortcuts, and supported-screen reachability pass;
- no visible button is a placeholder or partial happy path;
- Chemistry and other hidden experiments do not re-enter the manifest.

### S7 — PDF, Images, and Resource Safety

Goal: Teacher and Student can import lesson materials and export the synchronized board without freezing or corrupting a lesson.

Acceptance criteria:

- PDF pages preserve proportions and are movable/resizable; PNG/JPEG/WebP and clipboard image paths work;
- representative multi-page PDF import, collaboration, reload, and PDF export pass on desktop and iPad;
- limits use ResourceGovernor, are configurable and measured, and return Polish errors;
- malformed, oversized, and destructive stress inputs fail safely with bounded memory and queues;
- artifact work reports progress/cancellation and releases temporary memory;
- 57-client normal traffic is not rejected by protection limits.

### S8 — Runtime Recovery and Observability

Goal: the single Railway process starts honestly, drains safely, and emits enough content-free evidence to diagnose the Pilot.

Acceptance criteria:

- separate liveness/readiness; readiness proves database and collaboration persistence;
- startup awaits configuration, database, migrations, and Module construction before listening;
- shutdown rejects admissions, drains, flushes, closes storage, and reports deadline failures;
- a controlled backend restart restores active sessions within 30 seconds without acknowledged loss;
- structured redacted events and soak measurements cover access, sync, persistence, memory, event-loop delay, connections, errors, and state digests;
- process import side effects, unowned timers, and direct `process.exit` paths are removed.

### S9 — Pilot Release Gates

Goal: turn the agreed release contract into repeatable executable evidence.

Acceptance criteria:

- deterministic five-to-ten-minute change gate with one Teacher, three Students, thousands of seeded operations, reconnects, reloads, backend restart, and digest equality;
- mature-board profile with realistic tools, images, PDFs, history, and twice-observed-p95 calibration after Pilot telemetry exists;
- unattended three-hour 57-client gate with 22 Teachers and 35 Students passes with recorded metrics and zero blocker event;
- optional 88-client stress run records headroom and fails safely if capacity is exceeded; it is not used to force distributed architecture;
- destructive random-object profile proves bounded failure behavior;
- full built-in Browser pass covers Administrator, Teacher, Student, every visible tool, PDF, collaboration, reconnect, reload, and supported layouts;
- Kordian's hardware confirmations are recorded.

### S10 — Pilot UI Fidelity

Goal: all Pilot surfaces form one coherent, tactile, Apple-faithful neumorphic family without compromising direct manipulation or working area.

Acceptance criteria:

- the UI design contract explicitly names geometry, typography, materials, motion, interaction, and accessibility states before implementation;
- desktop and iPad layouts keep every required control reachable without clipping, overlap, dead controls, or off-screen panels;
- feedback starts immediately, direct manipulation tracks input continuously, dynamic motion is interruptible, and reduced-motion/transparency variants preserve hierarchy;
- depth communicates hierarchy rather than decorating every surface; the whiteboard remains visually dominant;
- Administrator, Teacher, Student entry, and lesson surfaces are recognizable as one system while each serves its task density;
- runtime visual comparison, gesture interruption, focus, contrast, and enlarged layout checks pass.

## Slice autonomy and merge discipline

Each implementer should receive one slice with this document, the product spec, release gate, and relevant ADR pointers. The implementer owns the entire slice through acceptance, including schema, server, frontend, migration, tests, and deletion of the replaced path. A slice is not complete with a partial layer or a list of remaining integration tasks.

Parallel work is safe only across unblocked slices. Shared **Interfaces** are agreed by their prerequisite slice; dependent implementers consume them rather than introducing parallel abstractions. When a slice exposes a missing decision, it reports the smallest decision needed instead of inventing a new product rule.

## Final self-check against the Pilot

- [x] Capability links remain the access model; no accounts, fingerprinting, or one-device restriction.
- [x] One active Teacher Access Link and one active Board Access Link are explicit invariants.
- [x] Exactly one Owning Teacher per Managed Board; Students may work without that Teacher.
- [x] Public Teacher Identity is exactly `Dawid Furmaniuk - Matsin`; Student labels are immutable ephemeral markers.
- [x] Personal Board, twelve-month Managed Board, immediate access end, and seven-day permanent deletion are designed.
- [x] Disconnected and not-yet-synchronized states are read-only; full offline is not introduced.
- [x] Every visible lesson tool is critical; AI, Chemistry, Grid Align, peer rooms, E2E, and production debug are excluded.
- [x] Mouse, graphics tablet, and iPad/Apple Pencil are covered by one input **Seam**.
- [x] PDF import/export and resource limits are behaviorally covered.
- [x] Single-instance Railway is the Pilot target; no Redis, distributed ownership, global quota, or backup system is added prematurely.
- [x] The release gate is 57 clients; 88 clients remain an optional safe-overload stress run.
- [x] Acknowledged lesson changes, isolation, truthful readiness, and controlled restart recovery are hard guarantees.
- [x] Migration is replace-don't-layer and tests use the highest practical **Seam**.
