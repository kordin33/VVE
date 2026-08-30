# VVE Snapshot Manual QA Report

Date: 2026-08-27  
Snapshot branch: `codex/full-dev-snapshot-2026-05-18`  
Commit: `1815758d0fe345db391231ae3cd689a76b509a2e`  
Environment: macOS, built-in Codex Browser, PostgreSQL in Docker, frontend on `127.0.0.1:5173`, backend on `127.0.0.1:8000`

## Executive verdict

This snapshot is not ready for enterprise or multi-tenant deployment. The core whiteboard is functional and the collaboration path works in a single local backend process, but two release-blocking authorization failures allow unauthorized board access or mutation. The teacher/admin workflow also contains broken production paths, and several common desktop/mobile viewport issues make controls inaccessible.

The highest-priority work is to centralize and enforce board authorization on the server for every transport and mutation path. UI-only `readOnly` state and room keys must not be treated as security controls.

## Scope and method

The application was built and run locally against a real PostgreSQL database. Testing used only the built-in Codex Browser for UI interaction and visual inspection. Multiple independent browser tabs and both `localhost` and `127.0.0.1` origins were used to separate session state and exercise simultaneous users.

Coverage included:

- room creation, lobby, sharing, joining, reload persistence, and room counts;
- drawing, text, selection, move/resize, undo/redo, erasing, zoom, all available 2D and 3D shapes, line styles, and coordinate systems;
- real-time two-user synchronization, awareness cursors, and presence display;
- math, physics, AI diagram, calculator, chemistry, AI chat, and AI Board Agent surfaces;
- settings, shortcuts, room manager, whiteboard export/import dialogs, Style, Align, and debug tools;
- admin teacher management, permanent teacher login, teacher dashboard, board creation, archive/restore, valid and invalid student invitations;
- visual checks at 1280×720 desktop and 390×844 mobile dimensions;
- frontend and backend build/test suites and browser console warnings/errors.

AI model output was not fully exercised because no `OPENROUTER_API_KEY` was supplied. The disabled/configuration paths were tested.

## Release blockers

### P0-1 — Standard rooms expose board contents without authentication

The public room list reveals active room identifiers and user counts. Entering a listed room identifier loads the complete board and permits collaboration without authentication. The generated room key in the URL does not participate in the transport and no end-to-end encryption occurs.

Evidence:

- `GET /api/rooms` has no authorization guard: `server/src/httpApp.ts:170-180`.
- WebSocket authorization is required only when the database identifies a room as a teacher board: `server/src/server.ts:279-299`.
- On database lookup failure the server explicitly fails open: `server/src/server.ts:281-290`.
- the Yjs client sends plaintext updates and accepts only an optional WebSocket token, not a room encryption key: `frontend/src/services/connectToYjs.ts:17-20`, `63-80`, `112-127`.
- the call site says it passes the room key but does not: `frontend/src/components/WhiteboardCanvas.vue:1177-1185`.

Impact: confidentiality and tenant isolation are absent for standard rooms. Anyone who can enumerate or obtain a room ID can read and modify its content.

Required direction: remove public room enumeration from untrusted clients; bind every connection to an authenticated board/tenant capability; fail closed; either implement actual client-side E2E encryption or remove that product claim.

### P0-2 — Archived/read-only student boards remain writable

After a teacher archives a board, the invitation correctly labels it as read-only, but opening the preview launches the full editor. Pen tools remain enabled and edits are accepted, synchronized, and persisted.

Evidence:

- `StudentBoardEntry` receives `readOnly` but does not propagate it when opening the board: `frontend/src/views/StudentBoardEntry.vue:99-107`.
- the WebSocket server validates only token presence and board identity, then accepts all messages; it does not enforce role, archive state, expiry, or mutation rights: `server/src/server.ts:292-316`.

Impact: an archived or expired lesson can still be changed by a student. UI labels do not protect durable data.

Required direction: authorize every mutation server-side against board identity, tenant, role, archive/expiry state, and operation type. The frontend should additionally disable editing as UX, not as the security control.

## High-priority functional findings

### P1-1 — Admin UI cannot authenticate to the protected admin API

The admin page sends no admin credential to any endpoint. Requests return 401, but the UI displays an empty teacher list, clears submitted data, and shows no useful error.

Evidence: `frontend/src/views/AdminTeachersPanel.vue:150-229` performs unauthenticated fetches, generally does not check `res.ok`, and clears the manual form after a failed request.

Impact: the shipped admin workflow is unusable with the backend's required `ADMIN_SECRET`, and failures look like successful empty results.

### P1-2 — New-board success dialog shows a blank student link

Board creation succeeds, but the immediate success dialog reads `createResult.studentLink`; the backend returns `studentUrl`. The read-only field is blank and copying it does not produce the invitation.

Evidence: `frontend/src/views/TeacherDashboard.vue:121-129`; backend response field in `server/src/routes/teacherBoards.ts:48`.

### P1-3 — Student invitations use a hardcoded real-person teacher identity

Every student invitation displays `Dawid Furmaniuk`, regardless of which teacher created the board.

Evidence: `server/src/routes/boardAccess.ts:5-6`, `22-23`, `45-46`.

Impact: incorrect cross-tenant identity, privacy exposure, and loss of trust. The public display name must be tenant/teacher configuration, not a source-code constant.

### P1-4 — Teacher dashboard actions are inaccessible on mobile

At 390×844 the status filter and the table action buttons extend beyond the viewport. The page itself has no horizontal scrolling path to reach them. Measured examples: filter extended to approximately x=548 and action controls to x=623 in a 390-pixel viewport.

Evidence: fixed-width flex filters and desktop table layout in `frontend/src/views/TeacherDashboard.vue:20-31`, `45-89`, `232-248`.

### P1-5 — Core toolbar and shape controls are clipped at 1280×720

The vertically centered toolbar is taller than the viewport, clipping the first and last controls. The Shapes popover is anchored to the trigger without viewport clamping; its bottom reached y=893 in a 720-pixel viewport. Even at maximum internal scroll, the lower arrowhead control could not be clicked.

Evidence: fixed vertical centering in `frontend/src/App.vue:1661-1669`; popover placement and sizing in `frontend/src/components/ToolBar.vue:561-575`, `830-845`.

## Medium-priority findings

### P2-1 — Presence badge always reports `0 Online`

Two and three active clients synchronized correctly and the lobby displayed accurate counts, but the in-board badge remained `0 Online`.

Evidence: `awarenessStates` is initialized and counted but never populated in `frontend/src/App.vue:398-401`.

### P2-2 — Chemistry inserts visible raw LaTeX as plain text

The pH calculation is correct, but “insert result as LaTeX” creates a plain text element containing commands such as `\\quad` and `\\text{mol/L}`.

Evidence: `frontend/src/components/ChemistryPanel.vue:174-183` emits `type: 'text'` for LaTeX content.

### P2-3 — Tool panels overlap the always-mounted AI panel

Math/physics/diagram/chemistry panels exclude one another, but do not close or reposition the AI panel. At 1280×720 the panels occupy the same right-hand area and obscure one another. On 390×844 the AI panel measured roughly 380×600 and began partly outside the viewport, covering almost the entire canvas.

Evidence: AI chat mounting in `frontend/src/App.vue:41-46`; mutual-exclusion logic only covers the other panels in `frontend/src/App.vue:424-462`.

### P2-4 — Desktop Settings hover trigger was not reachable in the built-in Browser

Repeated pointer movement into the top 25-pixel zone did not reveal the Settings gear at desktop pointer settings. With touch emulation enabled, the gear and all menu actions appeared and worked. This may be a browser-event compatibility issue, but it is reproducible in the required browser and deserves a real-device check.

Evidence: parent container disables pointer events while `mouseenter` is registered on that parent; only the absolutely positioned child re-enables them: `frontend/src/components/TopMenu.vue:2-12`, `295-316`.

### P2-5 — AI disabled-state messaging is inconsistent

The AI Diagram surface clearly reports that `OPENROUTER_API_KEY` is not configured. The AI Board Agent instead reports a generic empty-response/temporary-error message, which sends operators toward the wrong diagnosis.

### P2-6 — Backend auth tests fail in the default disabled-AI configuration

Backend result: 16 passed, 3 failed out of 19. Missing, invalid, and student board-token cases expect 401/401/403, but receive 503 because `aiBoardAssistantEnabled` is checked before authentication in `server/src/routes/aiBoardAssistant.ts:13-18`.

This leaves the intended security behavior unprotected in the default test environment.

### P2-7 — Two behavior-oriented frontend spec files are excluded

Frontend result: 76/76 included tests passed. However, `tests/unit/components/MovableObject.spec.js` and `tests/unit/components/WhiteboardCanvas.spec.js` are excluded because Vite includes only `tests/**/*.test.{js,ts}`.

Evidence: `frontend/vite.config.js:7-10`.

## Confirmed working behavior

- frontend and backend production builds completed successfully;
- health endpoint and main routes returned successfully;
- pen, text, erase, selection, move, resize, undo, redo, zoom, and persistence across reload worked;
- all listed 2D and 3D shapes rendered correctly;
- dashed lines, arrow styles that were reachable, coordinate-system insertion, calculator, physics plot, pH/pOH calculation, and debug tools worked;
- multiple tabs synchronized drawings and remote cursors in real time with no browser console errors or warnings;
- permanent teacher login, teacher dashboard loading, board creation, filtering, archive, restore, valid invitation, invalid-token error, and student board entry worked apart from the findings above;
- shortcuts, room manager, whiteboard export/import dialogs, Style, and Align opened and behaved normally in their available states;
- admin and invitation layouts were visually acceptable at the tested mobile size.

## Test data and cleanup notes

A local test teacher and a local lesson board were created solely in the local PostgreSQL instance. The test board was restored after the archived-write check. No credentials, tokens, or invitation URLs are included in this report.

## Recommended remediation order

1. Introduce one fail-closed server authorization path for all room, board, WebSocket, and AI mutations; bind capabilities to the exact board and tenant.
2. Enforce read-only/archive/expiry server-side and add focused two-client security tests.
3. Decide whether standard rooms are authenticated private boards or genuinely anonymous public rooms; align the lobby, key handling, encryption claim, and retention policy with that decision.
4. Repair the admin and teacher invitation contract mismatches and remove the hardcoded identity.
5. Add responsive layouts for teacher workflows and viewport clamping for every floating control/panel.
6. Repair the red backend tests, include the excluded component specs, and replace source-text assertions with executable behavior and concurrency tests.

## Separate architecture audit

The requested whole-codebase architecture and merge-diff review was completed in a separate task using `improve-codebase-architecture` and `review-agent`. Its visual report is stored at:

`/tmp/vve-enterprise-audit.sOy0gI/vve-enterprise-architecture-audit.html`

That audit independently reaches the same enterprise-readiness conclusion and adds deeper findings around multi-instance Yjs ownership, compaction data loss, cross-board AI mutation, deployment configuration, rate limiting, reconnect behavior, test credibility, and dependency alerts.
