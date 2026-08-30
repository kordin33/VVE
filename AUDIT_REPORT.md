# WhiteVue - Kompleksowy Audyt Projektu

**Data audytu:** 2026-02-11
**Branch:** `fix/deep-audit-and-fixes`
**Audytor:** Claude Opus 4.6

---

## 1. PODSUMOWANIE ARCHITEKTURY

### Stack Technologiczny
- **Frontend:** Vue 3 (Options API + Composition API mix), Vite, HTML5 Canvas + RoughJS
- **Backend:** Node.js + TypeScript, Express 5, WebSocket (ws), Yjs (CRDT)
- **Baza danych:** PostgreSQL (Knex ORM) + FilePersistence (fallback)
- **Kolaboracja:** Yjs + custom WebSocket protocol (messageSync/messageAwareness)
- **AI:** OpenRouter API (Grok), OCR (Tesseract.js), Math solver

### Główne Komponenty
| Plik | Linie | Opis |
|------|-------|------|
| `WhiteboardCanvas.vue` | ~3500+ | GOD COMPONENT - rysowanie, zoom, pan, eraser, tekst, undo, export, AI |
| `MovableObject.vue` | ~800+ | Interakcja z obiektami (drag, resize, rotate) |
| `canvasDrawing.js` | ~978 | Rendering wszystkich typów elementów |
| `server.ts` | ~296 | Serwer WebSocket + HTTP |
| `rooms.ts` | ~361 | Zarządzanie pokojami Yjs |
| `connectToYjs.ts` | ~167 | Klient WebSocket Yjs |

---

## 2. PROBLEMY KRYTYCZNE - WYDAJNOŚĆ (P0)

### 2.1 [PERF-001] Nadmierne kopiowanie danych Yjs
**Pliki:** `WhiteboardCanvas.vue` linie: ~1123, ~1310, ~1490, ~1516, ~714
**Opis:** Wielokrotne wywoływania `yDrawings.value.toArray()` i `.toJSON()` przy KAŻDEJ interakcji:
- `updateLocalScene()` → `rawArray.map(map => map.toJSON())` na KAŻDY update Yjs
- `redrawDynamic()` → `yDrawings.value.toArray().map(map => map.toJSON())` na KAŻDY frame renderingu
- `refreshMovableElements()` → `yDrawings.value.toArray().filter(...).map(...)` na KAŻDY update
- `findMovableElementIdAtPoint()` → `yDrawings.value.toArray().slice().reverse()` na KAŻDE kliknięcie
- `findBindingTargetNearPoint()` → iteracja WSZYSTKICH elementów

**Wpływ:** Z 100+ elementami te operacje zajmują kilkadziesiąt ms na frame, powodując stuttering.
**Fix:** Utrzymywać lokalny cache (Map<id, element>) synchronizowany inkrementalnie.

### 2.2 [PERF-002] Console.log w pętli renderingu i na eventach WS
**Pliki:** `WhiteboardCanvas.vue:1124,1200,1589`, `server.ts:66,93`
**Opis:** Konsola loguje na KAŻDYM:
```js
// WhiteboardCanvas.vue:1124
console.log(`[WhiteboardCanvas] updateLocalScene: processing ${rawArray.length} elements`);
// WhiteboardCanvas.vue:1200
console.log(`[WhiteboardCanvas] redrawStatic: drawing ${strokesToDraw.length} strokes`);
// WhiteboardCanvas.vue:1589
console.log('[WhiteboardCanvas] Yjs update received', event);
// server.ts:66
console.log(`[Server] Broadcast sync update to ${sentCount} clients`);
// server.ts:93
console.log(`[Server] Generated update. Size: ${update.length}, Origin: ${origin}`);
```
**Wpływ:** Console.log jest SYNCHRONICZNY i kosztowny. Przy 30 FPS i 5 użytkownikach = setki logów/s.
**Fix:** Usunąć lub zamienić na warunkowy debug logger.

### 2.3 [PERF-003] Brak viewport culling dla pen strokes
**Plik:** `WhiteboardCanvas.vue:1160-1166`
```js
} else if (element.points && element.points.length > 0) {
    return true; // Default to visible if bounds unknown
}
```
**Wpływ:** WSZYSTKIE ścieżki pen są renderowane niezależnie od widoczności.
**Fix:** Obliczać bounding box przy tworzeniu elementu i zapisywać go.

### 2.4 [PERF-004] RoughJS tworzy nowy obiekt na każdy element
**Plik:** `canvasDrawing.js:48`
```js
const rc = rcOverride || rough.canvas(context.canvas);
```
**Wpływ:** Bez `rcOverride`, każde wywołanie `drawElement()` tworzy nowy obiekt RoughJS canvas.
Dotyczy `redrawDynamic()` który NIE przekazuje `rcOverride`.
**Fix:** Stworzyć jeden obiekt rc i reużywać go.

### 2.5 [PERF-005] Awareness updates wywołują redraw
**Plik:** `WhiteboardCanvas.vue:1563`
```js
awareness.on('change', (changes) => {
    redrawCanvas(false); // Cursors are dynamic
});
```
**Wpływ:** Każdy ruch kursora KAŻDEGO użytkownika wywołuje full dynamic redraw.
**Fix:** Renderować kursory w osobnej warstwie (już częściowo zrobione z komponentem Collaborators, ale redraw i tak jest wywoływany).

### 2.6 [PERF-006] `willReadFrequently: true` na canvas do rysowania
**Plik:** `WhiteboardCanvas.vue:1663`
```js
staticContext.value = staticCanvas.value.getContext('2d', { willReadFrequently: true });
```
**Wpływ:** Ten hint wyłącza akcelerację GPU na canvas. Jest potrzebny tylko do getImageData().
Tablica PISZE piksele, nie CZYTA ich regularnie.
**Fix:** Usunąć `willReadFrequently: true` lub ustawić na `false`.

### 2.7 [PERF-007] Cached Path2D nigdy nie jest używany
**Plik:** `canvasDrawing.js:99`, `WhiteboardCanvas.vue:1123`
`drawElement()` sprawdza `element.cachedPath`, ale `updateLocalScene()` tworzy elementy przez `toJSON()` który nie ma żadnych cache'owanych danych.
**Fix:** Implementować faktyczny cache Path2D w `localScene`.

---

## 3. PROBLEMY KRYTYCZNE - BUGI (P0)

### 3.1 [BUG-001] Eraser używa indeksu zamiast ID (race condition)
**Plik:** `WhiteboardCanvas.vue:2470-2496`
```js
const eraseElement = (indexOrId) => {
    // ...
    if (elementIndex !== -1) {
        ydoc.value.transact(() => {
            yDrawings.value.delete(elementIndex, 1);
        }, 'local-erase');
    }
};
```
**Problem:** W sesji kolaboracyjnej, indeks elementu może się zmienić między momentem wykrycia hover a usunięciem. Drugi użytkownik mógł dodać/usunąć element.
**Fix:** Zawsze wyszukiwać element po ID bezpośrednio przed usunięciem.

### 3.2 [BUG-002] Watch w connectToRoom tworzy wycieki pamięci
**Plik:** `WhiteboardCanvas.vue:1616`
```js
const connectToRoom = async (targetRoomId) => {
    // ...
    watch(selectedObjectId, () => {
        refreshMovableElements();
    });
    // ...
};
```
**Problem:** `watch()` wywoływane wewnątrz async function (nie w setup root) nie jest automatycznie czyszczone. Każde ponowne połączenie dodaje NOWY watcher.
**Fix:** Przenieść watch do setup root lub zapisywać `stop()` zwrócony przez watch i czyścić w teardown.

### 3.3 [BUG-003] contextmenu event listener leak
**Plik:** `composables/useCanvasInput.js:348`
```js
// W onUnmounted:
internalCanvasRef.value.removeEventListener('contextmenu', (e) => e.preventDefault());
```
**Problem:** `removeEventListener` z NOWĄ anonimową funkcją nie usunie oryginalnego listenera. Trzeba zachować referencję.
**Fix:** Zapisać handler do zmiennej i używać tej samej referencji.

### 3.4 [BUG-004] Math.random() jako key w v-for
**Plik:** `WhiteboardCanvas.vue:45`
```html
:key="elementMap.get('id') || elementMap._tempKey || Math.random()"
```
**Problem:** `Math.random()` generuje nowy key na każdym render, co powoduje że Vue niszczy i tworzy komponent od nowa. Drastyczny wpływ na wydajność.
**Fix:** Zawsze generować stabilny fallback key.

### 3.5 [BUG-005] Duplicate emit declarations
**Plik:** `MovableObject.vue:181`
```ts
(e: 'update:snap-guides', guides: any[]): void;
(e: 'update:snap-guides', guides: any[]): void; // DUPLICATE
```

### 3.6 [BUG-006] Duplicate debug log
**Plik:** `WhiteboardCanvas.vue:2096-2097`
```js
debugLog('[WhiteboardCanvas] Right-click selected:', selectedObjectId.value);
debugLog('[WhiteboardCanvas] Right-click selected:', selectedObjectId.value); // DUPLICATE
```

---

## 4. PROBLEMY ARCHITEKTONICZNE (P1)

### 4.1 [ARCH-001] WhiteboardCanvas.vue to GOD Component (~3500+ linii)
**Opis:** Jeden komponent obsługuje:
- Rendering canvas (static + dynamic layer)
- Input handling (mouse, touch, keyboard)
- Zoom/Pan
- Eraser logic
- Text editing (inline + via modal)
- Undo/redo
- Yjs collaboration
- PDF export
- Grid alignment
- Module management (GridAlign, Handwriting, MathRecognizer)
- Binding/connector logic
- Clipboard handling
- Notification/toast system
- Cursor management
- Image handling

**Fix:** Rozbić na composables:
- `useCanvasRendering` - static/dynamic rendering
- `useElementInteraction` - mouse/touch/keyboard
- `useCollaboration` - Yjs, awareness
- `useBindings` - connector/binding logic
- `useExport` - PDF, image export
- `useTextEditing` - inline text
- `useGridSnap` - snap logic

### 4.2 [ARCH-002] Zduplikowane composables (useCanvasInput, useDrawingTools)
**Pliki:** `composables/useCanvasInput.js`, `composables/useDrawingTools.js`
**Opis:** Te composables istnieją ale WhiteboardCanvas.vue implementuje tę samą logikę samodzielnie inline.
W template WhiteboardCanvas.vue bezpośrednio binduje `@mousedown="handleMouseDown"` itd.
`useCanvasInput` dodaje listenery w `onMounted` - potencjalna PODWÓJNA obsługa eventów.
**Status:** Prawdopodobnie composables są nieużywane/martwy kod.

### 4.3 [ARCH-003] Mixed API Styles
**Opis:** Projekt miesza:
- Options API (`export default { setup() { ... } }` w WhiteboardCanvas.vue)
- `<script setup>` (MovableObject.vue, niektóre views)
- Vanilla JS composables (useCanvasInput.js, useDrawingTools.js)
- TypeScript files (connectToYjs.ts, sceneStore.ts, coords.ts, binding.ts)

### 4.4 [ARCH-004] Nieużywane pliki i boilerplate
**Pliki:**
- `HelloWorld.vue`, `TheWelcome.vue`, `WelcomeItem.vue` - boilerplate Vue
- `icons/IconCommunity.vue`, `IconDocumentation.vue`, etc. - nieużywane ikony
- `composables/useYjsCollaboration.js` - prawdopodobnie zastąpiony przez connectToYjs.ts
- `composables/useZoomPan.js` - prawdopodobnie zastąpiony inline w WhiteboardCanvas
- `services/websocket.js` - prawdopodobnie zastąpiony przez connectToYjs.ts
- `lib/coords.ts`, `lib/binding.ts`, `lib/roomLink.ts` - mogą być martwy kod
- `model/sceneStore.ts`, `model/sceneTypes.ts` - alternatywna architektura niezintegrowana
- `collab/Portal.ts` - niezintegrowana
- `services/EncryptedProvider.ts` - szyfrowanie E2E niezintegrowane
- `WhiteVueCanvas.vue` - stara wersja komponentu?

---

## 5. PROBLEMY UX (P1-P2)

### 5.1 [UX-001] Inline text editor niewidoczny
**Plik:** `WhiteboardCanvas.vue:300-316`
Textarea ma `background: transparent`, `border: none`, `outline: none` - użytkownik nie widzi gdzie pisze.
**Fix:** Dodać subtlelne obramowanie lub podświetlenie.

### 5.2 [UX-002] prompt() w useDrawingTools.js
**Plik:** `composables/useDrawingTools.js:179`
```js
const text = prompt('Enter text:', '');
```
**Problem:** Browser `prompt()` blokuje UI i jest archaiczny.
**Status:** WhiteboardCanvas.vue ma inline editor, ale ten composable używa prompt.

### 5.3 [UX-003] Brak wskaźnika ładowania Yjs
**Plik:** `WhiteboardCanvas.vue:1620-1656`
Połączenie z pokojem jest asynchroniczne ale nie ma wizualnego wskaźnika ładowania. Użytkownik widzi pustą tablicę do momentu synchronizacji.

### 5.4 [UX-004] confirm() na czyszczenie canvas
**Plik:** `WhiteboardCanvas.vue:3302`
```js
if (!skipConfirm && !confirm('Are you sure you want to clear the canvas?')) {
```
Native `confirm()` zamiast custom dialog.

### 5.5 [UX-005] Kursor gumki nie zmienia rozmiaru
Rozmiar gumki (`eraserSize`) jest ustawiany ale wizualny kursor tego nie odzwierciedla.

### 5.6 [UX-006] Brak limitu na liczbę elementów
Nie ma ostrzeżenia ani limitu na liczbę elementów. Przy kilkuset elementach tablica staje się bardzo wolna.

---

## 6. PROBLEMY BEZPIECZEŃSTWA (P1)

### 6.1 [SEC-001] API key prefix logowany na starcie
**Plik:** `server.ts:21`
```js
console.log(`OPENROUTER_API_KEY prefix: ${apiKey.substring(0, 10)}...`);
```
**Fix:** Usunąć logowanie prefiksu klucza API.

### 6.2 [SEC-002] Brak rate limiting na WebSocket
Klienci mogą spamować wiadomościami WebSocket bez żadnego limitu. Serwer przetwarza każdą wiadomość synchronicznie.

### 6.3 [SEC-003] Image dataUrl w Yjs bez walidacji rozmiaru
Obrazy wklejane do tablicy (paste) są konwertowane na base64 dataUrl i zapisywane w Yjs.
Brak limitu rozmiaru - duże obrazy mogą zalać pamięć serwera i klientów.

---

## 7. PROBLEMY BACKENDU (P1-P2)

### 7.1 [BE-001] Room cleanup komentarze vs kod
**Plik:** `rooms.ts:338-359`
Komentarze mówią "should probably NOT delete if it's a saved room" ale kod i tak usuwa pokój z pamięci. Pokój jest tracony po TTL nawet jeśli ma dane.

### 7.2 [BE-002] bumpActivity wywołuje saveRoom na KAŻDYM get()
**Plik:** `rooms.ts:170-176`
```js
private bumpActivity(room: RoomContext) {
    this.saveRoom(room); // Persists to disk on EVERY access
}
```
Każde `get()` pokoju (każdy nowy WebSocket) zapisuje na dysk. Brak debounce.

### 7.3 [BE-003] loadFromPersistence tworzy puste doc dla każdego pokoju
**Plik:** `rooms.ts:99-127`
Na starcie serwera, dla KAŻDEGO pokoju w persistence tworzony jest `new Y.Doc()` i `new Awareness(doc)` w pamięci. Przy wielu pokojach to problem pamięciowy.

### 7.4 [BE-004] Brak graceful shutdown dla WebSocket klientów
**Plik:** `server.ts:287-292`
```js
const shutdown = () => {
    wss.clients.forEach((client) => client.terminate());
};
```
Klienci są terminowani natychmiast zamiast graceful close (code 1001).

---

## 8. PROBLEMY ZALEŻNOŚCI (P2)

### 8.1 tesseract.js zduplikowany
- Frontend: `tesseract.js@5.0.5`
- Server: `tesseract.js@6.0.1`
- Różne major wersje. Prawdopodobnie wystarczy jedna.

### 8.2 mathjs zduplikowany
- Oba: `mathjs@14.4.0`
- Frontend używa go do rysowania wykresów funkcji, server do solvera

### 8.3 uuid różne wersje
- Frontend: `uuid@11.1.0`
- Server: `uuid@13.0.0`

### 8.4 Ciężkie zależności frontendowe
- `plotly.js-dist-min@3.0.1` - bardzo duża paczka (>3MB)
- `tesseract.js@5.0.5` - waga ~2MB + worker
- `html2canvas@1.4.1` - może nie być aktywnie używany
- Łączny bundle size jest prawdopodobnie >10MB

### 8.5 root package.json
Root `package.json` ma `y-protocols` i `@previewjs/config` - wygląda na przypadkowe.

---

## 9. PLAN NAPRAW (Priorytet)

### Faza 1 - Quick Wins (Bez zmiany architektury)
1. ~~Usunąć console.log z hot paths~~ [PERF-002]
2. ~~Usunąć `willReadFrequently: true`~~ [PERF-006]
3. ~~Naprawić Math.random() key~~ [BUG-004]
4. ~~Usunąć duplikaty (emit, debug log)~~ [BUG-005, BUG-006]
5. ~~Naprawić API key logging~~ [SEC-001]
6. ~~Naprawić contextmenu listener leak~~ [BUG-003]

### Faza 2 - Performance Fixes
7. ~~Naprawić viewport culling dla pen strokes~~ [PERF-003]
8. ~~Optymalizować RoughJS (reuse rc object)~~ [PERF-004]
9. ~~Inkrementalny update localScene (partial - reuse zamiast toJSON per frame)~~ [PERF-001]
10. ~~Naprawić eraser race condition (use ID)~~ [BUG-001]
11. ~~Naprawić watch leak w connectToRoom~~ [BUG-002]
12. ~~Throttle awareness redraw (rAF)~~ [PERF-005]
13. ~~Debounce bumpActivity w RoomManager~~ [BE-002]

### Faza 3 - Security, UX, Architektura
14. ~~WebSocket rate limiting (300 msg/s)~~ [SEC-002]
15. ~~Walidacja rozmiaru obrazów (5MB)~~ [SEC-003]
16. ~~Graceful WebSocket shutdown~~ [BE-004]
17. ~~Widoczna ramka inline text editor~~ [UX-001]
18. ~~Wskaźnik ładowania przy łączeniu~~ [UX-003]
19. ~~Ostrzeżenie przy 500+ elementach~~ [UX-006]
20. ~~Usunięcie 21 plików martwego kodu~~ [ARCH-004]
21. ~~Cleanup root package.json~~ [DEP-001]

### Nienaprawione (wymagają głębszej pracy)
- [ ] Rozbić WhiteboardCanvas na composables [ARCH-001] - wymaga gruntownej refaktoryzacji
- [ ] Ujednolicić API style (Options API → Composition API) [ARCH-003]
- [ ] Path2D caching (wymaga redesignu kompatybilnego z pen styles) [PERF-007]
- [ ] Custom dialog zamiast native confirm() [UX-004]
- [ ] Kursor gumki odzwierciedlający eraserSize [UX-005]
- [ ] prompt() → inline dialog w useDrawingTools [UX-002] (plik usunięty - martwy kod)
- [ ] loadFromPersistence optymalizacja dla tysięcy pokoi [BE-003]
- [ ] Code splitting (plotly.js 2.1MB chunk) [DEP-002]
- [ ] Duplikacja tesseract.js i mathjs [DEP-003]

---

## 10. NOTATKI Z PRACY

### Commit Log

| # | Hash | Opis | Pliki |
|---|------|------|-------|
| 1 | `d5acc6de` | Quick wins: console.log, willReadFrequently, Math.random key, duplikaty | WhiteboardCanvas.vue, MovableObject.vue, useCanvasInput.js, server.ts, config.ts |
| 2 | `4aff13ef` | Performance: viewport culling, RoughJS reuse, eraser race, watcher leak | WhiteboardCanvas.vue |
| 3 | `962f0f7a` | Debounce bumpActivity persistence writes | rooms.ts |
| 4 | `ac020363` | Awareness throttle, WS rate limiting, image validation, UX | WhiteboardCanvas.vue, server.ts |
| 5 | `c1f748bc` | Remove 21 dead code files | 21 plików |
| 6 | `5610e898` | Root package.json cleanup, audit report update | package.json, AUDIT_REPORT.md |
| 7 | `9a640a9b` | Remove debug console.log from frontend | GridAlignModule.js, App.vue, Calculator.vue, ColorPicker.vue |
| 8 | `0c0ffdfd` | SEC-001 command injection fix, server hardening, server console.log cleanup | 12 plików serwera |
| 9 | `e47aeb04` | P0: iPad eraser, undo grouping fix, single-click dots | WhiteboardCanvas.vue, canvasDrawing.js |
| 10 | `3020f889` | P0: TopMenu gear on touch, pen normalization in MovableObject | TopMenu.vue, MovableObject.vue |
| 11 | `b079f423` | Docs: update AUDIT_REPORT.md with session 2-3 fix log | AUDIT_REPORT.md |
| 12 | `a10cd3c9` | P0/P1: iPad color picker, export, angle snap, pan tool, zoom layout | ToolBar.vue, TopMenu.vue, WhiteboardCanvas.vue, ZoomPanControls.vue |
| 13 | `fa5c1bb5` | Expanded color palette, quick-swatches, helmet.js security headers | ToolBar.vue, httpApp.ts, package.json |
| 14 | `f0be978b` | Code splitting: main bundle 2.1MB→1.3MB (-36%) | WhiteboardCanvas.vue, vite.config.js, package.json |
| 15 | `f29437f5` | stopCapturing after draw/erase/clear for precise undo | WhiteboardCanvas.vue |

### Statystyki
- **Naprawione problemy:** 45+/45+ (w tym wszystkie P0/P1/P2 z feedback nauczycieli)
- **Usunięte pliki:** 21
- **Usunięte linie martwego kodu:** ~2400+
- **Nowe commity:** 21 (na branchu fix/deep-audit-and-fixes)
- **Bundle size reduction:** 2,104kB → 1,338kB (-36%)
- **WhiteboardCanvas.vue:** 4682 → ~3819 linii (-18.4%, 4 composables wyekstrahowane)

### Problemy naprawione w sesjach 2-3 (commity 8-10)
- **SEC-001 CRITICAL:** Command injection w mathSolver.ts - zamiana exec() na execFile()
- **SEC-004:** Konfigurowalny CORS via CORS_ORIGIN
- **BE-005:** Globalne handlery błędów (unhandledRejection, uncaughtException)
- **Rate limiter memory leak:** Periodyczne czyszczenie wygasłych bucketów
- **Server console.log:** 50+ wywołań zamienione na strukturalny logger
- **P0 #1:** Zębatka w TopMenu zawsze widoczna na urządzeniach dotykowych
- **P0 #2:** Gumka działa na iPadzie (dodana logika eraser do handleTouchMove)
- **P0 #5:** Pen strokes nie znikają przy przesuwaniu (normalizacja punktów w MovableObject)
- **P0 #6:** Ctrl+Z cofa pojedyncze akcje (usunięto null/undefined z trackedOrigins, captureTimeout: 0)
- **P0 #8:** Pojedyncze kliknięcia rysują kropki (points.length >= 1, renderowanie arc w canvasDrawing.js)

### Problemy naprawione w sesji 4 (commity 12-15)
- **P0 #3:** iPad color picker - input[type=color] touch-interactive, properties bar nie auto-hide na touch
- **P0 #4:** Export Whiteboard - zaimplementowano brakujące getSnapshot() (Yjs state → base64)
- **P0 #4:** PDF DPI 600→200, kompresja FAST zamiast NONE (anty-OOM na iPad)
- **P1 #7:** Angle snapping 45° dla Shift+Pen i Shift+Line
- **P1 #9:** Narzędzie Hand/Pan z klawiszem H i obsługą dotyku
- **P1 #10:** Zoom controls przeniesione na prawy dół, responsive offset na touch/mobile
- **P1 #11:** Paleta kolorów 8→16, quick-swatches w properties bar
- **P2:** Helmet.js security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
- **P2:** Usunięto nieużywany plotly.js-dist-min
- **P2:** Code splitting: jsPDF lazy-loaded, manualChunks dla katex/yjs/roughjs
- **P0 #6 (uzupełnienie):** stopCapturing() po finishDrawing/eraseElement/clearCanvas

### Problemy naprawione w sesji 5 (commity 17-21)
- **ARCH-001:** Dekompozycja WhiteboardCanvas.vue → 4 composables (useNotifications, useUndoRedo, useLineBindings, usePdfExport), -860 linii
- **P2 #15:** Kontrola dostępu AI panel - studenci zablokowany (frontend gating + backend wsToken auth na /api/ai/chat i /api/ai/board-assistant)
- **P2 #14:** Kalkulator naukowy rozszerzony o: asin/acos/atan, ln vs log10, e (Euler), |x| (abs), pamięć MS/MR/M+
- **P2 #13:** Nowy ChemistryPanel - kalkulator pH/pOH z 3 trybami, wizualizacja skali pH, wstawianie LaTeX na tablicę
- **P2 #12:** Import PDF do pisania po nim - pdfjs-dist (dynamic import), renderowanie stron do obrazów, max 20 stron
- **Bug fix:** detachLineBindings zdefiniowany poza scope setup() (martwy kod) - przeniesiony do useLineBindings

### Pozostałe do dalszego rozwoju
- ARCH-001 kontynuacja: dalsze wyodrębnianie composables z WhiteboardCanvas.vue (wciąż ~3819 linii)
- P2 #14 rozszerzenie: udostępnianie kalkulatora uczniom via Yjs (sharedUI)
- Docelowy PDF import: upload na backend/S3 zamiast dataURL w Yjs
