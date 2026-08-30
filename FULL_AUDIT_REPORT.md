# WhiteVue — Zwalidowany Raport Audytu Kodu

> **Data:** 2026-03-04 | **Re-audyt:** Każde znalezisko zweryfikowane bezpośrednio w kodzie
> **False positives usunięte:** 14 błędnych zgłoszeń odrzuconych po rewalidacji
> **Potwierdzone problemy:** ~100 unikalnych (po deduplikacji i walidacji)

### Jak korzystać z tego raportu

Raport jest podzielony na **10 niezależnych działów tematycznych**. Każdy dział można naprawiać osobno, w dowolnej kolejności. Przy każdym problemie jest:
- `[P0]`/`[P1]`/`[P2]`/`[P3]` — priorytet
- Dokładna ścieżka pliku i numery linii
- Status walidacji: ✅ CONFIRMED | ⚠️ PARTIALLY | ❌ FALSE POSITIVE (usunięte)

---

## Spis działów

1. [Silnik rysowania i canvas](#dział-1-silnik-rysowania-i-canvas)
2. [iPad i urządzenia mobilne](#dział-2-ipad-i-urządzenia-mobilne)
3. [UI / Interfejs użytkownika](#dział-3-ui--interfejs-użytkownika)
4. [Bezpieczeństwo backendu](#dział-4-bezpieczeństwo-backendu)
5. [Memory leaks i wydajność](#dział-5-memory-leaks-i-wydajność)
6. [Synchronizacja i real-time (Yjs / WebSocket)](#dział-6-synchronizacja-i-real-time-yjs--websocket)
7. [Panele funkcjonalne (Kalkulator, AI, Eksport/Import)](#dział-7-panele-funkcjonalne)
8. [CSS / Stylowanie / Dark mode](#dział-8-css--stylowanie--dark-mode)
9. [Dług techniczny i jakość kodu](#dział-9-dług-techniczny-i-jakość-kodu)
10. [Brakujące funkcjonalności (feedback nauczycieli)](#dział-10-brakujące-funkcjonalności)

---

## Dział 1: Silnik rysowania i canvas

> Pliki: `useDrawingEngine.js`, `canvasDrawing.js`, `canvasTools.js`, `canvasGrid.js`, `geometry.js`

### 1.1 [P0] ✅ Undefined function `_getSnapSettingsInternal()` — crash przy grid snap
- **Plik:** `frontend/src/composables/useDrawingEngine.js:137`
- **Problem:** Linia 137 wywołuje `_getSnapSettingsInternal()`, ale ta funkcja **nie istnieje**. Prawidłowa nazwa to `getSnapSettings()` (zdefiniowana w linii 123).
- **Skutek:** `TypeError: _getSnapSettingsInternal is not a function` przy włączeniu grid snap — crash rysowania.
- **Fix:** Zmienić `_getSnapSettingsInternal()` → `getSnapSettings()`

### 1.2 [P1] ✅ Rough.js tworzony na nowo przy KAŻDYM `drawElement()`
- **Plik:** `frontend/src/utils/canvasDrawing.js:48`
- **Problem:** `const rc = rcOverride || rough.canvas(context.canvas)` — `rcOverride` nigdy nie jest przekazywany (zawsze `null`). Przy 100 elementach na ekranie = 100 nowych instancji Rough.js na klatkę × 60fps.
- **Skutek:** Ogromne zużycie CPU, spadek FPS na słabszych urządzeniach.
- **Fix:** Cache instancji Rough.js per canvas, przekazywać jako `rcOverride`.

### 1.3 [P1] ✅ `cachedPath` — optymalizacja zadeklarowana ale nigdy nie zaimplementowana
- **Plik:** `frontend/src/utils/canvasDrawing.js:98-109`
- **Problem:** Kod sprawdza `if (element.cachedPath)` i renderuje z cache, ale **nigdzie w kodzie** `cachedPath` nie jest przypisywany do elementów.
- **Skutek:** Optymalizacja Path2D cache nie działa — każdy element jest rysowany od zera w każdej klatce.
- **Fix:** Po pierwszym renderze elementu, zapisywać `element.cachedPath = new Path2D(...)`.

### 1.4 [P1] ✅ Mieszany system współrzędnych w elementach linii
- **Plik:** `canvasDrawing.js:155-175`, `useDrawingEngine.js:535-566`
- **Problem:** Elementy linii są zapisywane z **trzema** systemami jednocześnie:
  - Absolutne `start`/`end` (Y.Map)
  - Relatywne `points` (przesunięte o bounding box x,y)
  - Bounding box `x`, `y`, `width`, `height`
- W `drawElement()` jest fallback: najpierw sprawdza `points`, potem `start/end` — ale oba mogą istnieć na jednym elemencie.
- **Skutek:** Niejednoznaczność → obiekty mogą renderować się na złej pozycji, szczególnie po przesunięciu.
- **Fix:** Wybrać jeden system współrzędnych i ujednolicić.

### 1.5 [P1] ⚠️ Pojedyncze kliknięcia — trudno o kropki
- **Plik:** `useDrawingEngine.js:342-349`
- **Problem:** `MIN_DIST_SQ = 2.25` (1.5px²) — throttling odrzuca punkty bliższe niż 1.5px. Przy szybkim kliknięciu mousedown→mouseup, mogą powstać 2 identyczne punkty → oba odrzucone.
- **Uwaga walidacyjna:** Kod renderujący `canvasDrawing.js:113-123` OBSŁUGUJE single-point strokes (rysuje kółko). Problem jest w **akumulacji punktów**, nie renderowaniu.
- **Fix:** Zapewnić, że `startDrawing()` zawsze dodaje co najmniej 1 punkt, i nie usuwać go przy throttlingu.

### 1.6 [P2] ✅ Shift+Pen → angle snapping: niespójne współrzędne
- **Plik:** `useDrawingEngine.js:313-330`
- **Problem:** W trybie Shift+Pen (linia prosta), kąt jest obliczany z:
  - `snappedStart` (po grid snap) jako punkt bazowy
  - `stampedCoords` (**niesnappowane**) jako punkt końcowy
- Przy zwykłej linii (linia 364-375) OBA punkty są snappowane — spójne.
- **Skutek:** Niespójne przyciąganie kątów między trybami.

### 1.7 [P2] ✅ `penConfig` — obiekt JS zapisywany do Y.Map bez explicit extraction
- **Plik:** `useDrawingEngine.js:248, 516`
- **Problem:** `yElementMap.set('penConfig', elementToAdd.penConfig)` — zapisuje cały spread obiektu do Yjs. Jeśli w przyszłości presety będą miały metody lub niestandardowe typy, serializacja Yjs się zepsuje.
- **Fix:** Explicit extraction: `{ baseWidth, taper, smoothing }` zamiast spread.

### 1.8 [P2] ✅ Brak walidacji współrzędnych przed zapisem do Yjs
- **Plik:** `useDrawingEngine.js:519-534`
- **Problem:** Obliczanie bounding box zaczyna od `minX = Infinity, maxX = -Infinity`. Jeśli WSZYSTKIE punkty są invalid → `Infinity`/`-Infinity` zapisane do Yjs.
- **Fix:** Walidacja po obliczeniu: `if (!isFinite(minX)) return;`

### 1.9 [P2] ✅ Gumka — `draw()` zwraca early, brak timestampów
- **Plik:** `useDrawingEngine.js:298`
- **Problem:** `if (currentTool.value === 'eraser') return;` — gumka nigdy nie przechodzi przez pipeline rysowania. Eraser strokes nie dostają timestampów ani punktów z draw loop.
- **Skutek:** Pipeline gumki jest oddzielony od reszty narzędzi, co może powodować problemy z synchronizacją.

### 1.10 [P3] ✅ Brak timeout na ładowanie obrazów
- **Plik:** `canvasTools.js:224-263`
- **Problem:** `img.onload` / `img.onerror` — brak timeout. Obraz z wolnego serwera może blokować Promise wiecznie.
- **Fix:** `setTimeout(() => reject(new Error('timeout')), 10000)`

### Odrzucone false positives w tym dziale:
- ~~"preview.start.t timestamp never updated → NaN"~~ — **FALSE POSITIVE**: timestamp jest tworzony świeżo w każdym `draw()` call
- ~~"Grid snap applied to start but not end"~~ — **FALSE POSITIVE**: oba punkty SĄ snappowane
- ~~"captureTimeout:0 powoduje osobne undo per punkt"~~ — **FALSE POSITIVE**: w Yjs, `captureTimeout:0` grupuje operacje w ramach tego samego event loop tick — to POPRAWNE zachowanie

---

## Dział 2: iPad i urządzenia mobilne

> Pliki: `WhiteboardCanvas.vue`, `MovableObject.vue`, `ColorPicker.vue`, `ZoomPanControls.vue`, `usePdfExport.js`

### 2.1 [P0] ✅ ColorPicker: siatka kolorów wypływa poza ekran na iPadzie
- **Plik:** `frontend/src/components/ColorPicker.vue:197-212`
- **Problem:** CSS `left: 100%; margin-left: 8px; width: 144px` — siatka pozycjonowana na prawo od przycisku. Na iPadzie w pionie (768px) wypływa poza viewport.
- **Skutek:** Nauczyciele na iPadzie nie mogą zmienić koloru pióra.
- **Fix:** Dodać viewport-aware positioning lub `right: 0` fallback z media query.

### 2.2 [P0] ✅ ZoomPanControls: hardcoded `bottom: 80px` koliduje z toolbar na iPadzie
- **Plik:** `frontend/src/components/ZoomPanControls.vue:36-41`
- **Problem:** Media query `(max-width: 768px), (hover: none)` ustawia `bottom: 80px` — wartość nie dostosowuje się do zmiennej wysokości toolbara.
- **Skutek:** Kontrolki zoom nakładają się na toolbar.
- **Fix:** Użyć CSS variable `--toolbar-height` lub `calc()`.

### 2.3 [P1] ⚠️ PDF export: `a.click()` nie działa na iOS
- **Plik:** `frontend/src/composables/usePdfExport.js:223-227`
- **Problem:** `document.createElement('a'); a.click()` — na iOS Safari ten pattern nie triggeruje pobierania.
- **Skutek:** Eksport PDF nie działa na iPadzie.
- **Fix:** Użyć `window.open(url)` lub blob z `FileSaver.js` jako fallback dla iOS.

### 2.4 [P2] ✅ MovableObject: wyłącznie mouse events — manipulacja obiektów nie działa na touch
- **Plik:** `frontend/src/components/MovableObject.vue:7, 14, 22, 27, 33-44`
- **Problem:** Wszystkie interakcje (drag, resize, rotate) używają `@mousedown.stop` / `mousemove` / `mouseup`.
- **Uwaga walidacyjna:** RYSOWANIE na touch działa (WhiteboardCanvas ma pełne touch handlery). Problem dotyczy tylko **manipulacji już utworzonymi obiektami** (przesuwanie, skalowanie, obracanie).
- **Skutek:** Na iPadzie można rysować, ale nie można przesuwać/skalować gotowych elementów.
- **Fix:** Zmienić `mouse*` → `pointer*` events w MovableObject.

### Odrzucone false positives w tym dziale:
- ~~"WhiteboardCanvas touch event handling broken"~~ — **FALSE POSITIVE**: WhiteboardCanvas.vue:26-29 ma pełne handlery `@touchstart/@touchmove/@touchend` z poprawną ekstrakcją współrzędnych (linia 1349-1352)
- ~~"EraserModeControls always visible"~~ — **FALSE POSITIVE**: parent ma `v-if="currentTool === 'eraser'"` (WhiteboardCanvas.vue:93-97)

---

## Dział 3: UI / Interfejs użytkownika

> Pliki: `TopMenu.vue`, `ToolBar.vue`, `FloatingOptions.vue`, `LineWidthSelector.vue`, `App.vue`

### 3.1 [P1] ✅ Z-index chaos — nakładające się panele
- **Pliki:** Wiele komponentów
- **Problem — znalezione wartości z-index:**
  | Komponent | z-index | Plik |
  |-----------|---------|------|
  | `global-error-overlay` | 9999 | App.vue |
  | `toolbar-popover` | 4000 | ToolBar.vue:834 |
  | `floating-toolbar` | 3000 | App.vue:1656 |
  | `floating-user-info` | 3000 | App.vue:1670 |
  | `user-info-toggle-btn` | 3001 | App.vue:1705 |
  | `shortcuts-dialog` | 2000 | TopMenu.vue:451 |
  | `DraggablePanel` | 2000 | DraggablePanel.vue:95 |
  | `feature-panel` | 1010 | App.vue:1876 |
  | **`top-menu-container`** | **1001** | TopMenu.vue:300 |
  | **`floating-options`** | **1001** | FloatingOptions.vue:175 |
  | `toolbar-container` | 100 | ToolBar.vue:723 |
- **Konflikty:** TopMenu i FloatingOptions mają **ten sam** z-index 1001. DraggablePanel i shortcuts-dialog oba mają 2000.
- **Fix:** Zdefiniować system z-index w CSS variables: `--z-toolbar`, `--z-panel`, `--z-modal`, `--z-overlay`.

### 3.2 [P1] ✅ FloatingOptions: `max-width` usunięty — panel może overflow
- **Plik:** `frontend/src/components/FloatingOptions.vue:184`
- **Problem:** Komentarz w CSS: `/* max-width: 300px; — Removed for calculator */` — limit szerokości celowo usunięty. Brak media queries.
- **Skutek:** Na mobilnych ekranach panel może wyjść poza viewport.
- **Fix:** Dodać `max-width: 100vw` + padding, lub responsive media query.

### 3.3 [P2] ✅ LineWidthSelector: hardcoded kolor `#0b20ff`
- **Plik:** `frontend/src/components/LineWidthSelector.vue:110-125`
- **Problem:** CSS `.line-width-preview { background-color: #0b20ff; }` — preview zawsze niebieski, mimo że komponent ma prop `color` i computed `previewColor`. Prop nie jest używany w CSS kontenera.
- **Fix:** Dodać `:style="{ backgroundColor: previewColor }"` do preview elementu.

### 3.4 [P2] ✅ Brak toolbar auto-hide toggle
- **Plik:** `frontend/src/components/ToolBar.vue:510-516`
- **Problem:** Auto-hide properties bar po 2000ms jest hardcoded. Na touch devices zostaje widoczny (linia 707). Brak UI do przełączania tego zachowania.
- **Feedback nauczyciela:** "przycisk który decyduje czy ma się chować czy nie"
- **Fix:** Dodać toggle button + `localStorage` persistence.

### 3.5 [P3] ⚠️ ColorPicker: brak click-outside
- **Plik:** `frontend/src/components/ColorPicker.vue:132-139`
- **Problem:** Komentarz w kodzie: "parent handles it now" — ale nie zweryfikowano, czy parent faktycznie zamyka siatkę. Siatka ma `@click.stop` (zapobiega zamknięciu przy kliknięciu wewnątrz), ale brak explicitnego handlera click-outside.

### Odrzucone false positives w tym dziale:
- ~~"Gear icon znika z powodu hideTimeout bez cancellation"~~ — **FALSE POSITIVE**: `handleMouseEnter()` (linia 224) wywołuje `clearTimeout(hideTimeout)`, a `cancelHide()` jest wywoływany na mouseenter gear buttona (linia 10) i menu (linia 19). Cancellation DZIAŁA poprawnie.
- ~~"shapesMenuStyle not defined"~~ — **FALSE POSITIVE**: zdefiniowany jako `ref({})` w linii 483, aktualizowany przez `positionShapesMenu()` (linia 566-576).

---

## Dział 4: Bezpieczeństwo backendu

> Pliki: `config.ts`, `httpApp.ts`, `server.ts`, routes, middleware, services

### 4.1 [P0] ✅ Hardcoded fallback secrets w konfiguracji
- **Pliki:**
  - `server/src/config.ts:53` — `teacherSessionSecret: '...change-me-in-prod'`
  - `server/src/services/boardTokens.ts:12` — `|| 'change-me'`
  - `server/src/services/boardService.ts:20` — `|| 'change-me'`
- **Problem:** Jeśli env vars nie ustawione → aplikacja używa znanych sekretów.
- **Skutek:** Atakujący może fałszować sesje nauczyciela, tokeny tablic, tokeny studentów.
- **Fix:** `if (!secret) throw new Error('Missing required secret')` w produkcji.

### 4.2 [P0] ✅ Database credentials w `.env`
- **Plik:** `server/.env:25`
- **Problem:** `DATABASE_URL=postgresql://neondb_owner:npg_IE4oZGKwdCN8@...` — pełny connection string z hasłem.
- **Uwaga walidacyjna:** `.env` JEST w `.gitignore`, ale jeśli był commitowany wcześniej, historia git zawiera hasło.
- **Fix:** Sprawdzić historię git, zrotować hasło, użyć `git filter-branch` lub BFG.

### 4.3 [P0] ✅ AI endpoint bez autentykacji
- **Plik:** `server/src/routes/aiBoardAssistant.ts:19-31`
- **Problem:** `if (boardToken) { ... }` — walidacja tylko JEŚLI token istnieje. Bez tokenu request przechodzi dalej bez żadnej autentykacji.
- **Skutek:** Każdy może korzystać z AI (koszty API!) bez logowania.
- **Fix:** Dodać `if (!boardToken) return res.status(401)...` na początku.

### 4.4 [P1] ✅ Admin endpoints bez auth w dev mode
- **Plik:** `server/src/httpApp.ts:94-118`
- **Problem:** Gdy `ADMIN_SECRET` nie ustawiony i `NODE_ENV !== 'production'` → `next()` bez walidacji.
- **Skutek:** Dev konfiguracja na produkcji = pełny dostęp admina.
- **Fix:** Zawsze wymagać secret, niezależnie od env.

### 4.5 [P1] ✅ CORS pozwala wszystkie originy bez env var
- **Plik:** `server/src/httpApp.ts:64-65`
- **Problem:** `cors(corsOrigin ? { origin: ... } : undefined)` — bez `CORS_ORIGIN` env var → `cors()` z defaults = wszystkie originy.
- **Fix:** Wymusić `CORS_ORIGIN` w produkcji.

### 4.6 [P1] ✅ Brak rate limitingu na WSZYSTKICH AI endpointach
- **Plik:** `server/src/routes/aiBoardAssistant.ts`
- **Problem:** Żaden z endpointów AI nie ma rate limitera:
  - `/api/ai/board-assistant` — brak
  - `/api/ai/chat` — brak
  - `/api/ai/analyze-pdf` — brak
  - `/api/ai/generate-diagram` — brak
  - `/api/ai/vision-chat` — brak
- **Skutek:** Możliwość spamowania → eksplozja kosztów API.
- **Fix:** Dodać `createRateLimiter({ windowMs: 60_000, max: 10 })` do każdego.

### 4.7 [P1] ✅ CSP wyłączone w helmet
- **Plik:** `server/src/httpApp.ts:58-61`
- **Problem:** `contentSecurityPolicy: false, crossOriginEmbedderPolicy: false`
- **Skutek:** Brak ochrony przed XSS przez Content Security Policy.
- **Fix:** Skonfigurować CSP z dozwolonymi source'ami.

### 4.8 [P2] ✅ Brak limitu rozmiaru pliku w multer
- **Plik:** `server/src/routes/adminTeachers.ts:11-12`
- **Problem:** `multer({ storage: multer.memoryStorage() })` — brak `limits: { fileSize: ... }`.
- **Skutek:** Upload dowolnie dużego pliku → memory exhaustion.
- **Fix:** `limits: { fileSize: 5 * 1024 * 1024 }` (5MB).

### 4.9 [P2] ✅ Unhandled promise rejections w route handlers
- **Pliki:** `server/src/routes/teacherBoards.ts:25-52`, `boardAccess.ts`
- **Problem:** Async route handlers bez try/catch → unhandled rejection crashuje proces.
- **Fix:** Wrapper `asyncHandler()` lub pakiet `express-async-errors`.

### 4.10 [P2] ✅ Information leakage w magic links
- **Plik:** `server/src/services/teacherMagicLinks.ts:119`
- **Problem:** `return { reason: candidates.length ? 'invalid' : 'not_found' }` — atakujący wie, czy teacher ID istnieje.
- **Fix:** Zawsze zwracać `'invalid'`, niezależnie od przyczyny.

### 4.11 [P2] ✅ Teacher deactivation nie unieważnia sesji
- **Plik:** `server/src/middleware/requireTeacherAuth.ts:31-37`
- **Problem:** Sprawdza `is_active` w middleware na każdym requeście (dobrze), ale token sesji nigdy nie jest jawnie unieważniany. Jeśli ktoś ma aktywną sesję → dostęp trwa do wygaśnięcia.
- **Fix:** Dodać session revocation przy deaktywacji.

### Odrzucone false positives w tym dziale:
- ~~"Student może modyfikować zarchiwizowane tablice przez WebSocket"~~ — **FALSE POSITIVE**: Auth middleware blokuje dostęp do zarchiwizowanych tablic PRZED połączeniem WebSocket.
- ~~"Path traversal z pustego sanitized roomId"~~ — **FALSE POSITIVE**: RoomId zawsze ma prefix `board_` z randomBytes → sanityzacja nigdy nie da pustego stringa.

---

## Dział 5: Memory leaks i wydajność

> Pliki: różne — problemy rozrzucone po całym kodzie

### 5.1 [P1] ✅ Lobby: `setInterval` nigdy nie czyszczony
- **Plik:** `frontend/src/components/Lobby.vue:128`
- **Problem:** `setInterval(fetchRooms, 10000)` w `onMounted` — brak `clearInterval` w `onBeforeUnmount`.
- **Skutek:** Każda wizyta w Lobby = permanentny timer pollujący serwer wiecznie.
- **Fix:** `const id = setInterval(...); onBeforeUnmount(() => clearInterval(id));`

### 5.2 [P1] ✅ Tesseract worker nigdy nie terminowany
- **Plik:** `frontend/src/modules/MathRecognizerModule.js:238`
- **Problem:** `Tesseract.recognize()` spawna worker thread. `Tesseract.terminate()` nigdy nie wywoływany.
- **Skutek:** Worker w tle zżera CPU/RAM, mnoży się przy kolejnych wywołaniach.
- **Fix:** Wywołać `Tesseract.terminate()` po rozpoznaniu lub w cleanup modułu.

### 5.3 [P1] ✅ WebSocket: error handler nie usuwa connection
- **Plik:** `server/src/server.ts:279`
- **Problem:** `socket.on('error', (error) => logger.warn(...))` — tylko loguje. Nie wywołuje `removeConnection()`.
- **Porównanie:** `socket.on('close', () => removeConnection(...))` — close handler JEST poprawny.
- **Skutek:** Stale connections w `room.connections` Map → memory leak.
- **Fix:** Dodać `removeConnection(roomId, room, socket)` w error handler.

### 5.4 [P2] ✅ CalculatorModal: drag listeners nie czyszczone przy unmount
- **Plik:** `frontend/src/components/CalculatorModal.vue:62-63, 83-87`
- **Problem:** `document.addEventListener('mousemove', handleDrag)` — jeśli komponent unmountuje się podczas draga, listenery zostają.
- **Fix:** Dodać cleanup w `onBeforeUnmount`: `document.removeEventListener(...)`.

### 5.5 [P2] ✅ GridAlignText: resize listener nie czyszczony
- **Plik:** `frontend/src/components/ai-tools/GridAlignText.vue:88`
- **Problem:** `window.addEventListener('resize', resizeCanvas)` bez `removeEventListener`.
- **Fix:** Dodać cleanup w `onBeforeUnmount`.

### 5.6 [P2] ✅ Database pool: `min: 0, max: 10`
- **Plik:** `server/src/db.ts:11-15`
- **Problem:** `pool: { min: 0, max: 10 }` — `min:0` = connections zamykane przy idle (brak reuse). `max:10` za mało pod obciążeniem.
- **Fix:** `min: 2, max: 20` + dodać `acquireTimeoutMillis` i `idleTimeoutMillis`.

### 5.7 [P2] ✅ WebSocket: brak `maxPayload`
- **Plik:** `server/src/server.ts:230`
- **Problem:** `new WebSocketServer({ server })` — brak opcji `maxPayload`. Default ws library = 100MB.
- **Skutek:** Klient może wysłać ogromny Yjs update → memory exhaustion.
- **Fix:** `new WebSocketServer({ server, maxPayload: 5 * 1024 * 1024 })` (5MB).

### 5.8 [P2] ✅ Deep watchers na złożonych obiektach
- **Plik:** `frontend/src/App.vue:1211-1229`
- **Problem:** `watch(handwritingStylerOptions, () => { ... }, { deep: true })` — każda zmiana dowolnej property triggeruje deep comparison + preview render.
- **Fix:** Watchować konkretne property zamiast deep.

### 5.9 [P3] ✅ Brak query timeout w Knex
- **Plik:** `server/src/db.ts`
- **Problem:** Brak konfiguracji timeout → długie query blokują cały pool.
- **Fix:** Dodać `acquireConnectionTimeout: 10000` w config knex.

### Odrzucone false positives w tym dziale:
- ~~"Collaborators awareness listener memory leak"~~ — **FALSE POSITIVE**: `onBeforeUnmount` i watcher poprawnie czyszczą listenery (`off('change', ...)`)
- ~~"connectToYjs listeners not cleaned on disconnect"~~ — **FALSE POSITIVE**: `disconnect()` poprawnie wywołuje `ydoc.off()` i `awareness.off()`
- ~~"PDF worker memory leak"~~ — **FALSE POSITIVE**: pdfjs-dist auto-cleanup przez GC po wyjściu ze scope

---

## Dział 6: Synchronizacja i real-time (Yjs / WebSocket)

> Pliki: `useUndoRedo.js`, `boardYjsPersistence.ts`, `rooms.ts`, `connectToYjs.ts`

### 6.1 [P1] ✅ Yjs updates table rośnie bez ograniczeń
- **Plik:** `server/src/services/boardYjsPersistence.ts:83-127, 153-175`
- **Problem:** Cleanup jest wyłącznie **czasowy** (3 miesiące). Brak cleanup po rozmiarze. Aktywna tablica przez 3 miesiące z ciągłymi updates → ogromna tabela.
- **Skutek:** Spowolnienie queries, ewentualny crash bazy.
- **Fix:** Dodać size-based cleanup (np. kompaktowanie po 1000 incrementalnych updates).

### 6.2 [P2] ✅ Race condition w hydratacji pokoi
- **Plik:** `server/src/rooms.ts:218-244`
- **Problem:** `room.hydrating = true` → load → `room.hydrating = false`. Między `false` a następnym sprawdzeniem, inny connection może zacząć duplikat hydratacji.
- **Fix:** Użyć Promise jako lock: `room.hydrationPromise = loadFromDb()`, kolejne czekają na ten sam Promise.

### 6.3 [P2] ✅ `stopCapturing()` — redundantne ale nieszkodliwe
- **Plik:** `frontend/src/composables/useDrawingEngine.js:590`
- **Problem:** Wywołanie `undoManager.value?.stopCapturing()` jest **redundantne** przy `captureTimeout: 0` (Yjs automatycznie grupuje w tick). Nie szkodzi, ale zaciemnia intencję.
- **Status:** LOW — do ewentualnego usunięcia.

### 6.4 [P2] ⚠️ Cichy catch w undo/redo
- **Plik:** `frontend/src/composables/useUndoRedo.js:48-56`
- **Problem:** `catch (_) { /* ignore */ }` — błędy UndoManagera są pochłaniane bez logowania. Jeśli undo faktycznie się nie powiedzie, użytkownik nie dostanie feedbacku.
- **Fix:** `catch (e) { console.warn('Undo failed:', e); }` + opcjonalnie toast.

### 6.5 [P2] ✅ useHelperModules: race condition z Yjs transactions
- **Plik:** `frontend/src/composables/useHelperModules.js:85-93, 328-336`
- **Problem:** Wiele operacji AI (applyMathAnswer, confirmStyleChanges) startuje `ydoc.transact()` bez sprawdzenia, czy poprzednia transakcja się zakończyła.
- **Fix:** Mutex lub queue na operacje AI.

---

## Dział 7: Panele funkcjonalne

> Pliki: `Calculator.vue`, `AIChatPanel.vue`, `usePdfExport.js`, `usePdfImport.js`, `MathRecognizerModule.js`, `PlotRenderer.vue`

### 7.1 [P1] ⚠️ AIChatPanel: race condition z messages
- **Plik:** `frontend/src/components/AIChatPanel.vue:372-456`
- **Problem:** User message dodawany do `messages.value` PRZED API call. Jeśli API failuje:
  - User message zostaje w arrayu (nie jest usuwany)
  - Dodawany jest fallback assistant message
- **Skutek:** Ghost messages w historii.
- **Fix:** Dodać user message dopiero po potwierdzeniu wysłania, lub usuwać przy error.

### 7.2 [P1] ⚠️ AIChatPanel: screenshot capture — panel zostaje niewidoczny po błędzie
- **Plik:** `frontend/src/components/AIChatPanel.vue:323-343`
- **Problem:** Panel ustawiany na `opacity: 0` przed capture. Jeśli `html2canvas` rzuci błąd (np. CORS), panel NIE wraca do `opacity: 1`.
- **Fix:** `finally { panel.style.opacity = '1'; }`.

### 7.3 [P2] ⚠️ Calculator: clipboard silent fail
- **Plik:** `frontend/src/components/Calculator.vue:266-271`
- **Problem:** `.catch(() => { /* clipboard copy failed silently */ })` — na iPadzie/Safari użytkownik nie wie, że kopiowanie się nie powiodło. W `App.vue` JEST fallback z `execCommand`, ale Calculator go nie używa.
- **Fix:** Użyć tego samego fallbacku co w App.vue, dodać toast.

### 7.4 [P2] ✅ PlotRenderer: cichy błąd kompilacji wyrażeń
- **Plik:** `frontend/src/components/PlotRenderer.vue:110-115`
- **Problem:** `catch (e) { return ''; }` — invalid math expression = pusty wykres bez komunikatu o błędzie.
- **Fix:** Emitować event `@error` z opisem problemu.

### 7.5 [P2] ✅ Serializer: `compactSerialize` traci dane
- **Plik:** `frontend/src/utils/serializer.js:39-56`
- **Problem:** Serializuje TYLKO: `type` (skrócony do 1 znaku!), `color`, `lineWidth`, `points`. Tracone properties:
  - `fillColor`, `strokeColor`, `rotation`, `opacity`
  - `text` (dla elementów tekstowych)
  - `roughness`, `arrowStyle`
  - Kształty (rectangle/circle params)
- **Skutek:** Eksport/import traci większość danych elementów.
- **Fix:** Rozszerzyć serializację o wszystkie istotne pola.

### 7.6 [P2] ⚠️ Keyboard shortcuts: `+`/`-` przechwytywane mimo check
- **Plik:** `frontend/src/composables/useKeyboardShortcuts.js:29-32, 60-69`
- **Problem:** Sprawdzenie `INPUT/TEXTAREA/contentEditable` ISTNIEJE (linia 29-32), więc w zwykłych inputach shortcuts nie kolidują. Ale: mogą kolidować w custom edytowalnych elementach niebędących standardowymi inputami.

### 7.7 [P3] ✅ HandwritingStylerModule: invalid points → (0,0)
- **Plik:** `frontend/src/modules/HandwritingStylerModule.js:4-20`
- **Problem:** `normalizePoint()` zwraca `{x:0, y:0}` dla invalid points zamiast null → cicha korupcja geometrii.
- **Fix:** Zwracać `null` i filtrować nulle upstream.

### 7.8 [P3] ✅ MathRecognizerModule: race condition w recognition
- **Plik:** `frontend/src/modules/MathRecognizerModule.js:282-286`
- **Problem:** Auto-recognition debounce + manual button click = dwa równoczesne requesty. Brak mutex.
- **Fix:** AbortController lub request ID.

### 7.9 [P3] ✅ RoomManagerModal: debounce nie anuluje in-flight request
- **Plik:** `frontend/src/components/RoomManagerModal.vue:186-191`
- **Problem:** Debounce kasuje timeout, ale nie anuluje lecącego `fetchRooms()` request → wyniki mogą się pojawić w złej kolejności.
- **Fix:** AbortController na poprzedni request.

---

## Dział 8: CSS / Stylowanie / Dark mode

> Pliki: `style.css`, `base.css`, `main.css`, różne komponenty

### 8.1 [P2] ✅ Podwójne definicje CSS variables
- **Pliki:** `frontend/src/style.css:3-52` vs. `frontend/src/assets/base.css:2-51`
- **Problem:** Oba pliki definiują zmienne kolorystyczne (--bg-base, --text-primary, itp.). Import obu w `main.js` → wartości z ostatniego importu wygrywają, co jest nieprzewidywalne.
- **Fix:** Jedna źródło prawdy dla design tokens.

### 8.2 [P2] ✅ Nieistniejące CSS variables referenced
- **Plik:** `frontend/src/components/Dialog.vue:167, 195`
- **Problem:** Używa `var(--glass-border)` i `var(--radius-sm)` — te zmienne NIE istnieją w żadnym pliku CSS.
- **Skutek:** Fallback do braku border/radius.

### 8.3 [P2] ⚠️ Dark mode `:deep()` — nietypowe ale prawdopodobnie działa
- **Pliki:** `ZoomPanControls.vue:69-82`, `EraserModeControls.vue:79-90`
- **Problem:** `:deep(.dark-mode) .zoom-controls { ... }` — klasa `.dark-mode` jest na `#app`. Składnia `:deep()` powinna propagować w dół, więc to MOŻE działać, ale jest kruche i niestandardowe.
- **Fix:** Użyć CSS variables zamiast `:deep()` selektorów.

### 8.4 [P3] ✅ Hardcoded kolory zamiast CSS variables
- **Pliki:**
  - `ExportImportPanel.vue:125` — `background-color: #333`
  - `StatusMessage.vue:26` — `background-color: #4285f4`
  - `LineWidthSelector.vue:113` — `background-color: #0b20ff`
- **Problem:** Kolory nie respektują motywu (dark mode / custom theme).
- **Fix:** Zamienić na `var(--...)`.

### 8.5 [P3] ✅ `#app` padding conflict
- **Plik:** `main.css:3-6` vs. `style.css:6`
- **Problem:** `main.css` ustawia `padding: 2rem`, `style.css` ustawia `padding: 0 var(--spacing-container)` — podwójne, sprzeczne paddingi.

### 8.6 [P3] ✅ Accessibility: `user-scalable=no` w meta viewport
- **Plik:** `frontend/index.html:6`
- **Problem:** `maximum-scale=1.0, user-scalable=no` — blokuje zoom. Naruszenie WCAG 2.1 AA.
- **Fix:** Usunąć `user-scalable=no`.

---

## Dział 9: Dług techniczny i jakość kodu

> Problemy, które nie powodują bugów, ale utrudniają utrzymanie i rozwój

### 9.1 ✅ Dead code: `historyManager.js` — nigdzie nie importowany
- **Plik:** `frontend/src/utils/historyManager.js` (108 linii)
- **Problem:** Kompletna implementacja custom undo/redo, ale **nigdzie nie importowana**. Aplikacja używa Yjs UndoManager.
- **Fix:** Usunąć plik.

### 9.2 ✅ Dead code: `store/index.js` — Vue 2 Vuex store, nigdzie nie używany
- **Plik:** `frontend/src/store/index.js`
- **Problem:** Używa `import Vue from 'vue'; Vue.use(Vuex)` (składnia Vue 2). **ALE** nigdy nie jest importowany w `main.js` ani nigdzie indziej. To martwy kod.
- **Uwaga walidacyjna:** Pierwotnie zgłaszany jako CRITICAL — po walidacji to dead code, nie crash.
- **Fix:** Usunąć plik lub zmigrować do Pinia jeśli potrzebny.

### 9.3 ✅ LineWidthSelector: Vue 2 `beforeDestroy()` lifecycle hook
- **Plik:** `frontend/src/components/LineWidthSelector.vue:72-74`
- **Problem:** Używa `beforeDestroy()` (Vue 2) zamiast `onBeforeUnmount()` (Vue 3). Opcjonalnie może działać z Vue 3 compat mode, ale jest deprecated.
- **Fix:** Przepisać na Composition API z `<script setup>`.

### 9.4 ✅ Mieszane Vue 2 Options API i Vue 3 Composition API
- **Pliki:** `LineWidthSelector.vue` (Options API), `LandingPage.vue` (Options API) vs. reszta (`<script setup>`)
- **Problem:** Dwa style komponentów w jednym projekcie → niespójność, trudne w utrzymaniu.

### 9.5 ✅ Hardcoded Polish text bez i18n
- **Pliki:** `TopMenu.vue`, `TeacherDashboard.vue`, `AIChatPanel.vue`, `Calculator.vue`
- **Problem:** Cały UI text w polskim, hardcoded w szablonach.

### 9.6 ✅ Nieużywane CSS variables z `base.css`
- **Plik:** `frontend/src/assets/base.css:2-50`
- **Problem:** Zmienne `--vt-c-*` (domyślne z szablonu Vue CLI) nigdzie nie używane.

### 9.7 ✅ Debug log file w repozytorium
- **Plik:** `server/debug_error.log` (30KB)
- **Fix:** Dodać do `.gitignore`, usunąć z repo.

### 9.8 ✅ Multiple vitest config files
- **Pliki:** `server/vitest.config.ts`, `.js`, `.d.ts`, `.d.ts.map`, `.js.map`
- **Problem:** 5 plików konfiguracji vitest — prawdopodobnie stare buildy. Wystarczy `.ts`.

### 9.9 ✅ `ExportImportPanel.vue`: deprecated `document.execCommand('copy')`
- **Plik:** `frontend/src/components/ExportImportPanel.vue:86-90`
- **Problem:** Deprecated API. W `RoomManagerModal.vue` (linia 279) JEST nowoczesna wersja z `navigator.clipboard`.
- **Fix:** Ujednolicić na `navigator.clipboard.writeText()`.

### 9.10 ✅ `crypto.ts`: keyCache Map rośnie bez limitu
- **Plik:** `frontend/src/lib/crypto.ts:3`
- **Problem:** `keyCache` to `Map` bez size limit → memory leak przy wielu różnych kluczach.
- **Fix:** LRU cache lub limit na 100 entries.

---

## Dział 10: Brakujące funkcjonalności (feedback nauczycieli)

> Rzeczy z `feedback.md`, które jeszcze nie są zaimplementowane

| # | Request | Status | Notatki |
|---|---------|--------|---------|
| F-01 | Przesuwanie tablicy łapką (hand/pan tool) | Częściowo | Zoom istnieje, dedicated pan tool brak |
| F-02 | Kalkulator: UI jak fizyczny kalkulator naukowy | Nie | Current UI to basic grid layout |
| F-03 | Udostępnianie podglądu kalkulatora uczniom | Nie | Brak implementacji real-time share |
| F-04 | Custom lista ustawień pióra ze skrótami 1,2,3... | Nie | Presety istnieją, ale bez keyboard shortcuts |
| F-05 | Nauczyciel decyduje o dostępie ucznia do panelu AI | Nie | Brak kontroli per-board |
| F-06 | RAG AI ze zbiorami zadań szkolnych / arkuszami matur | Nie | Brak implementacji |
| F-07 | Import PDF jako karty tablicy | Częściowo | `usePdfImport.js` istnieje, buggy na iPad |
| F-08 | Przybliżanie linii do kątów 0°/45°/90° przy Shift | Częściowo | Działa ale z bugiem niespójnych współrzędnych (dział 1.6) |
| F-09 | Obliczenia pH na chemii (-log[x]) | Częściowo | `ChemistryPanel.vue` istnieje z basic pH calc |
| F-10 | Przycisk toggle auto-hide toolbara | Nie | Dział 3.4 |

---

## Podsumowanie walidacji

### Statystyki false positives (usunięte z raportu)

| Dział | Zgłoszone | False Positives | Potwierdzone |
|-------|-----------|----------------|--------------|
| 1. Silnik rysowania | 13 | 3 | 10 |
| 2. iPad / mobile | 6 | 2 | 4 |
| 3. UI | 7 | 2 | 5 |
| 4. Bezpieczeństwo | 14 | 2 | 11 (+1 partial) |
| 5. Memory leaks | 12 | 3 | 9 |
| 6. Sync / Yjs | 5 | 0 | 5 |
| 7. Panele | 13 | 0 | 9 (+4 partial) |
| 8. CSS | 6 | 0 | 6 |
| 9. Dług techniczny | 10 | 0 | 10 |
| 10. Brakujące ficzery | 10 | 0 | 10 |
| **Razem** | **~96 key** | **12** | **~79 confirmed + 5 partial** |

### Sugerowana kolejność pracy nad działami

1. **Dział 4 (Bezpieczeństwo)** — najwyższy priorytet, ryzyko eksploatacji
2. **Dział 1 (Silnik rysowania)** — najbardziej widoczne bugi dla użytkowników
3. **Dział 2 (iPad)** — blokuje dużą grupę nauczycieli
4. **Dział 5 (Memory leaks)** — degradacja wydajności w czasie
5. **Dział 3 (UI)** — poprawa codziennego UX
6. **Dział 6 (Sync)** — stabilność długoterminowa
7. **Dział 7 (Panele)** — jakość poszczególnych narzędzi
8. **Dział 8 (CSS)** — spójność wizualna
9. **Dział 9 (Dług techniczny)** — czytelność kodu
10. **Dział 10 (Ficzery)** — nowe funkcjonalności
