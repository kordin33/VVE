# Pilot Product Specification

This document records the product boundary agreed for the VVE Pilot. It complements the domain glossary in `CONTEXT.md` and the executable expectations in `PILOT-RELEASE-GATE.md`.

## Product scope

- The Pilot serves up to 20 selected Teachers and their real Students.
- VVE uses capability links instead of Teacher or Student accounts.
- The public lobby and legacy anonymous peer rooms are unavailable.
- AI and unfinished end-to-end encryption are unavailable and make no product claims.
- The user interface is Polish. Source code, identifiers, internal documentation, and developer logs remain English.
- Phones are outside the supported editing scope even if the application happens to open on them.

## Access and identity

- A link works on any device where it is opened. VVE does not bind it to a person, browser, IP address, or device.
- A Teacher may open one Teacher Access Link in several sessions at once, including a computer and an iPad.
- Each Teacher has one active Teacher Access Link. Explicit regeneration invalidates the old credential without changing boards.
- Each Managed Board has one active Board Access Link. One Student or a group of up to three Students may share it during the Pilot.
- Explicit Board Access Link regeneration invalidates the old credential without changing the board.
- Every Student sees the immutable Public Teacher Identity `Dawid Furmaniuk - Matsin`.
- The Administrator and Teacher dashboards may use real names or internal labels. These never appear to Students.
- Student collaborator labels and colors are system-assigned and cannot be edited.

## Board lifecycle

- A Teacher creates any number of Managed Boards. The Pilot has no business quota on board count.
- A Managed Board expires twelve months after creation.
- Expiry or explicit End Board Access removes access immediately. The system permanently deletes the board seven days later.
- The Pilot provides no renewal, recovery, or restoration control during the seven-day delay.
- A Teacher's Personal Board is created lazily on their first dashboard visit. It never grants Student access.
- Deactivating a Teacher immediately removes their access and schedules their Personal Board and Managed Boards for deletion after seven days.
- Teacher and Student may export a Managed Board to PDF while their access remains valid. They cannot retrieve an export after access ends.

## Collaboration permissions

- Teacher and Student may use every visible lesson tool and may modify or delete each other's board objects.
- Only the Teacher may clear the entire board, regenerate its access link, or end Board Access.
- Undo and redo affect only the current participant's own operations. The local undo history may reset after a page reload.
- Students may work online without the Teacher being present.
- A disconnected or not-yet-synchronized board is read-only. Navigation and PDF export remain available.
- An active connected lesson has no inactivity timeout. After the final connection closes, the server may persist and unload the live document from memory.

## Visible lesson tools

Every visible lesson tool is release-critical. The Pilot does not divide them into a polished core and a tolerated secondary set.

- Pen, eraser, text, selection, movement, resize, undo, redo, pan, and zoom.
- Shapes, lines, styles, image paste, PDF import, and PDF export.
- Calculator, coordinate systems, mathematical graphs, and physical graphs.
- Input Style, renamed from Handwriting Styler, with two initial presets shown in the Polish interface:
  - `Mysz`, with strong smoothing that produces a natural Miro-like line instead of angular pointer traces.
  - `Pióro`, tuned according to established Apple Pencil and browser pen-input guidance without discarding useful pressure and motion data.
- The application may choose the initial Input Style from the pointer type, but the user can override it.

Future iterations may add smoothing or edge-cutting controls. The Pilot does not need those controls before the two presets work well.

## Hidden and internal tools

- Chemistry tools, Grid Align, AI, and other experiments are hidden from Pilot users.
- The debug panel remains available to developers through an internal path or flag and stays hidden in production. It only needs to support diagnosis; it is not held to lesson-tool polish.
- Raw board JSON import or export may remain as a developer tool. Pilot users rely on PDF.
- Old experimental snapshots and board formats carry no migration guarantee. The Pilot starts with a fresh database.

## PDF and image handling

- Teacher and Student may import PDF files.
- Each PDF page becomes a proportion-preserving board object that can be moved and resized. VVE does not edit text embedded in a PDF.
- Required image formats are PNG, JPEG, and WebP. SVG and HEIC are best effort.
- Upload, message, and document limits must be generous enough for normal lessons, configurable, and based on measurement. Exceeding a limit returns a clear Polish error instead of freezing or crashing the board.
- External object storage is a later option if images and PDFs materially increase Railway cost. The Pilot does not add it without evidence.

## Device and interface requirements

- Supported editing setups are a computer with a mouse, a computer with a graphics tablet, and an iPad with Apple Pencil.
- The iPad experience is a full product requirement. Drawing must not trigger accidental page scrolling, gestures must behave predictably, and controls must not cover the working area.
- VVE does not pursue formal WCAG certification during the Pilot. It still requires readable contrast, visible focus, usable text input, safe keyboard shortcuts, and layouts that remain usable when enlarged.
- The Pilot has no built-in onboarding or tutorial. The company explains the workflow directly to Teachers.

## Operations and data

- The operating limit of 20 Teachers is not a hard architectural limit.
- The release capacity gate covers 22 concurrent Teachers and 35 concurrent Students, for 57 clients.
- An optional 88-client run probes headroom. It does not justify architectural complexity when the 57-client gate passes and overload fails safely.
- Pilot telemetry collects only data useful for diagnosis and sizing. Normal logs should not contain board content even though Pilot agreements permit manual inspection.
- Administrative audit events are optional and lowest priority. If implemented cheaply, they record the time and type of operation without pretending to identify a person behind the shared Administrator session.
- Rate, upload, message, and connection limits protect the service from broken clients and obvious abuse. They must leave generous room for normal lessons.
- The Pilot requires no database backup. Full backup and tested recovery become a Company Rollout gate.
- Development work is prepared on `dev`; `main` represents the stable deployed line. During the Pilot, rollback may target a known-good commit. Formal release tags may be added later.
- Development and Pilot iteration may still reset the system. This stops when VVE enters Company Rollout. A reset during active real lessons requires an explicit operational decision.
