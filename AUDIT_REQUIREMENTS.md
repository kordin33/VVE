# WhiteVue — Szczegółowe Wymagania Napraw (Audit TODO)

> Ten plik zawiera WSZYSTKIE wymagania z audytu w formie umożliwiającej śledzenie postępu.
> Każdy dział jest niezależny. Po każdym dziale: commit + testy.

---

## DZIAŁ 1: Silnik rysowania i canvas
**Pliki:** `useDrawingEngine.js`, `canvasDrawing.js`, `canvasTools.js`, `canvasGrid.js`

- [x] 1.1 Fix `_getSnapSettingsInternal()` → `getSnapSettings()` w useDrawingEngine.js:137
- [x] 1.2 Cache Rough.js instancji per canvas w canvasDrawing.js:48 (nie tworzyć nowego co drawElement)
- [x] 1.3 Zaimplementować cachedPath — po pierwszym renderze pen stroke zapisywać Path2D w elemencie (canvasDrawing.js:98-137)
- [x] 1.4 Ujednolicić system współrzędnych linii — wybrać jeden format (points relative LUB start/end absolute) w canvasDrawing.js:155-175 i useDrawingEngine.js:535-566
- [x] 1.5 Naprawić single-click dots — zapewnić min 1 punkt po throttlingu w useDrawingEngine.js:342-349
- [x] 1.6 Naprawić Shift+Pen angle snap — użyć spójnych współrzędnych (obie snappowane LUB obie raw) w useDrawingEngine.js:313-330
- [x] 1.7 Explicit property extraction dla penConfig zamiast spread do Y.Map w useDrawingEngine.js:516
- [x] 1.8 Walidacja współrzędnych (isFinite check) przed zapisem do Yjs w useDrawingEngine.js:519-534
- [x] 1.9 Naprawić eraser pipeline — zapewnić timestampy i punkty w useDrawingEngine.js:298, 568-571
- [x] 1.10 Dodać timeout 10s na image loading w canvasTools.js:224-263

**Testy dział 1:**
- Unit: geometry.js pure functions, RDP simplification, coordinate validation
- Unit: canvasDrawing.js drawElement z różnymi typami elementów
- Regression: single-click → dot rendered, shift+line → correct angles

---

## DZIAŁ 2: iPad i urządzenia mobilne
**Pliki:** `ColorPicker.vue`, `ZoomPanControls.vue`, `MovableObject.vue`, `usePdfExport.js`

- [x] 2.1 ColorPicker: viewport-aware positioning — dodać auto-flip jeśli grid wychodzi poza viewport (ColorPicker.vue:197-212)
- [x] 2.2 ZoomPanControls: dynamiczny bottom z CSS variable zamiast hardcoded 80px (ZoomPanControls.vue:36-41)
- [x] 2.3 PDF export: iOS fallback — użyć window.open() lub FileSaver zamiast a.click() (usePdfExport.js:223-227)
- [x] 2.4 MovableObject: zmienić mouse* → pointer* events dla touch support (MovableObject.vue:7,14,22,27,33-44)

**Testy dział 2:**
- Unit: ColorPicker positioning logic
- Manual test checklist: iPad color picker, zoom controls overlap, PDF export, object manipulation

---

## DZIAŁ 3: UI / Interfejs
**Pliki:** `TopMenu.vue`, `ToolBar.vue`, `FloatingOptions.vue`, `LineWidthSelector.vue`, `App.vue`

- [x] 3.1 Zdefiniować z-index system w CSS variables i ujednolicić wartości
- [x] 3.2 FloatingOptions: dodać responsive max-width (max-width: min(400px, 95vw))
- [x] 3.3 LineWidthSelector: użyć dynamicznego koloru z prop zamiast hardcoded #0b20ff
- [x] 3.4 Toolbar auto-hide toggle: dodać przycisk + localStorage persistence
- [x] 3.5 ColorPicker: dodać click-outside handler

**Testy dział 3:**
- Unit: z-index values verification
- Manual: toolbar auto-hide toggle, click-outside, line width preview color

---

## DZIAŁ 4: Bezpieczeństwo backendu
**Pliki:** `config.ts`, `httpApp.ts`, `aiBoardAssistant.ts`, `boardTokens.ts`, `boardService.ts`, `adminTeachers.ts`, `teacherMagicLinks.ts`

- [x] 4.1 config.ts: fail-fast jeśli brak sekretów w production (throw Error zamiast fallback)
- [x] 4.2 aiBoardAssistant.ts: wymusić token — return 401 jeśli brak x-board-token
- [x] 4.3 httpApp.ts: wymusić admin secret ZAWSZE (nie tylko w production)
- [x] 4.4 httpApp.ts: wymusić CORS_ORIGIN w production
- [x] 4.5 aiBoardAssistant.ts: dodać rate limiter na WSZYSTKIE AI endpointy
- [x] 4.6 httpApp.ts: włączyć CSP z dozwolonymi source'ami
- [x] 4.7 adminTeachers.ts: dodać multer fileSize limit (5MB)
- [x] 4.8 Dodać asyncHandler wrapper na async route handlers
- [x] 4.9 teacherMagicLinks.ts: zawsze zwracać 'invalid' (nie 'not_found')
- [x] 4.10 requireTeacherAuth.ts: dodać session revocation check

**Testy dział 4:**
- Unit: config validation (fail on missing secrets)
- Unit: AI endpoint auth (reject without token)
- Unit: admin auth (reject without secret regardless of NODE_ENV)
- Unit: rate limiter on AI routes
- Unit: multer file size limit
- Regression: existing auth flow still works

---

## DZIAŁ 5: Memory leaks i wydajność
**Pliki:** `Lobby.vue`, `MathRecognizerModule.js`, `server.ts`, `CalculatorModal.vue`, `GridAlignText.vue`, `db.ts`, `App.vue`

- [x] 5.1 Lobby.vue: clearInterval w onBeforeUnmount
- [x] 5.2 MathRecognizerModule.js: Tesseract.terminate() po rozpoznaniu
- [x] 5.3 server.ts:279: dodać removeConnection() w socket error handler
- [x] 5.4 CalculatorModal.vue: cleanup drag listeners w onBeforeUnmount
- [x] 5.5 GridAlignText.vue: removeEventListener('resize') w onBeforeUnmount
- [x] 5.6 db.ts: zmienić pool na min:2, max:20, dodać acquireConnectionTimeout
- [x] 5.7 server.ts: dodać maxPayload: 5*1024*1024 do WebSocketServer
- [x] 5.8 App.vue: zamienić deep watcher na specific property watchers
- [x] 5.9 db.ts: dodać acquireConnectionTimeout w knex config

**Testy dział 5:**
- Unit: Lobby interval cleanup
- Unit: WebSocket maxPayload config
- Unit: DB pool config
- Regression: app still starts and connects

---

## DZIAŁ 6: Synchronizacja i real-time
**Pliki:** `useUndoRedo.js`, `boardYjsPersistence.ts`, `rooms.ts`, `useHelperModules.js`

- [x] 6.1 boardYjsPersistence.ts: dodać size-based cleanup (compaction po N updates)
- [x] 6.2 rooms.ts: Promise-based hydration lock zamiast boolean flag
- [x] 6.3 useDrawingEngine.js: usunąć redundantne stopCapturing()
- [x] 6.4 useUndoRedo.js: zamienić silent catch na console.warn
- [x] 6.5 useHelperModules.js: mutex/queue na operacje AI transactions

**Testy dział 6:**
- Unit: undo/redo error handling (should log, not swallow)
- Unit: boardYjsPersistence cleanup logic
- Unit: room hydration lock (concurrent access)

---

## DZIAŁ 7: Panele funkcjonalne
**Pliki:** `AIChatPanel.vue`, `Calculator.vue`, `PlotRenderer.vue`, `serializer.js`, `HandwritingStylerModule.js`, `MathRecognizerModule.js`, `RoomManagerModal.vue`

- [x] 7.1 AIChatPanel.vue: naprawić race condition — nie dodawać user message przed API response, lub usuwać przy error
- [x] 7.2 AIChatPanel.vue: finally block na screenshot opacity restore
- [x] 7.3 Calculator.vue: dodać clipboard fallback + toast na error
- [x] 7.4 PlotRenderer.vue: emitować error zamiast cichego return ''
- [x] 7.5 serializer.js: rozszerzyć compactSerialize o brakujące pola (fillColor, strokeColor, rotation, opacity, text, roughness)
- [x] 7.6 HandwritingStylerModule.js: normalizePoint zwraca null zamiast {x:0,y:0} dla invalid
- [x] 7.7 MathRecognizerModule.js: AbortController na concurrent requests
- [x] 7.8 RoomManagerModal.vue: AbortController na debounced search

**Testy dział 7:**
- Unit: serializer roundtrip (serialize → deserialize = identical)
- Unit: normalizePoint(invalid) returns null
- Unit: PlotRenderer error handling

---

## DZIAŁ 8: CSS / Stylowanie
**Pliki:** `style.css`, `base.css`, `main.css`, `Dialog.vue`, `ExportImportPanel.vue`, `StatusMessage.vue`, `index.html`

- [x] 8.1 Usunąć duplikowane CSS variables — jedna źródło prawdy (style.css)
- [x] 8.2 Dodać brakujące CSS variables: --glass-border, --radius-sm
- [x] 8.3 Dark mode: zamienić :deep() na CSS variables
- [x] 8.4 Zamienić hardcoded kolory na CSS variables (#333, #4285f4, #0b20ff)
- [x] 8.5 Naprawić #app padding conflict
- [x] 8.6 Usunąć user-scalable=no z meta viewport

**Testy dział 8:**
- Visual regression: screenshots before/after
- Manual: dark mode toggle, mobile viewport zoom

---

## DZIAŁ 9: Dług techniczny
**Pliki:** `historyManager.js`, `store/index.js`, `LineWidthSelector.vue`, `ExportImportPanel.vue`, `crypto.ts`

- [x] 9.1 Usunąć historyManager.js (dead code)
- [x] 9.2 Usunąć store/index.js (dead Vue 2 code)
- [x] 9.3 LineWidthSelector: przepisać beforeDestroy → onBeforeUnmount (lub pełny Composition API)
- [x] 9.4 ExportImportPanel: zamienić execCommand('copy') na navigator.clipboard
- [ ] 9.5 crypto.ts: dodać LRU limit na keyCache (max 100 entries) — N/A: keyCache nie istnieje w kodzie projektu
- [x] 9.6 Usunąć debug_error.log z repo, dodać do .gitignore
- [x] 9.7 Usunąć nadmiarowe vitest config files z server/
- [x] 9.8 Usunąć nieużywane CSS variables z base.css

**Testy dział 9:**
- Build: npm run build passes after cleanup
- Unit: crypto keyCache eviction

---

## DZIAŁ 10: Brakujące funkcjonalności
- [x] 10.1 Pen presets: keyboard shortcuts 1-4 do szybkiego przełączania
- [x] 10.2 Toolbar auto-hide toggle button (UI part → patrz 3.4)
- [x] 10.3 Rozszerzona paleta kolorów — 20+ kolorów + custom picker + ulubione
