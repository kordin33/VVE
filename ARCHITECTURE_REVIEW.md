# WhiteVue - Doglebna Analiza Architektury i Tech Debt

**Data:** 2026-03-24
**Zakres:** Frontend (`frontend/`) + Backend (`server/`) - PELNY CODEBASE
**Wersja analizowana:** commit `39bf6d40` (HEAD)
**Linie kodu:** ~22 000 (frontend ~17 000, server ~7 500)

---

## Spis tresci

1. [Podsumowanie wykonawcze](#1-podsumowanie-wykonawcze)
2. [Metryki projektu](#2-metryki-projektu)
3. [Architektura ogolna](#3-architektura-ogolna)
4. [Frontend - Analiza strukturalna](#4-frontend---analiza-strukturalna)
5. [Backend - Analiza strukturalna](#5-backend---analiza-strukturalna)
6. [TECH DEBT - Katalog (linia po linii)](#6-tech-debt---katalog)
7. [Bezpieczenstwo](#7-bezpieczenstwo)
8. [Antywzorce i Code Smells](#8-antywzorce-i-code-smells)
9. [Wydajnosc i skalowalnosc](#9-wydajnosc-i-skalowalnosc)
10. [Testowalnosc](#10-testowalnosc)
11. [Modernizacja - plan krok po kroku](#11-modernizacja---plan-krok-po-kroku)

---

## 1. Podsumowanie wykonawcze

WhiteVue to ambitny projekt collaborative whiteboard z zaawansowanymi funkcjami (CRDT, AI agent, OCR, rough.js rendering). Architektura opiera sie na solidnych fundamentach (Yjs, WebSocket, Express), ale **nosi wyrazne slady szybkiego prototypowania** - typowe dla projektu pisanego podczas nauki. Wiele decyzji architektonicznych bylo rozsadnych na wczesnym etapie, ale teraz stanowia dług techniczny.

### Scorecard

| Kategoria | Ocena | Opis |
|-----------|-------|------|
| Struktura kodu | 4/10 | God Components, brak routera, mieszany JS/TS |
| Bezpieczenstwo | 6/10 | Podstawy OK (CSP, rate limiting), ale unsafe-eval, slabe domyslne sekrety |
| Skalowalnosc | 3/10 | In-memory state, brak horizontal scaling, file persistence |
| Testowalnosc | 2/10 | Brak testow frontend, minimalne testy server |
| Wzorce projektowe | 5/10 | Composables to dobry kierunek, ale niekompletna dekompozycja |
| Utrzymywalnosc | 4/10 | Ogromne pliki, duplikacja, brak typow |
| Nowoczesnosc stosu | 5/10 | Vue 3 OK, ale brak script setup, Pinia, Vue Router |

### Top 10 najwazniejszych problemow

| # | Problem | Gdzie | Wplyw |
|---|---------|-------|-------|
| 1 | **WhiteboardCanvas.vue = 2786 LOC** | frontend | Nietestowalny, nierefaktoryzalny |
| 2 | **App.vue = 2128 LOC** | frontend | Caly stan aplikacji w jednym pliku |
| 3 | **Brak Vue Router** | frontend | Zero code splitting per route, brak deep linking |
| 4 | **Brak Pinia/state management** | frontend | Props drilling 17 propsow, stan rozproszony |
| 5 | **~90% JavaScript bez typow** | frontend | Runtime errors, brak IDE support |
| 6 | **CSP unsafe-eval + unsafe-inline** | server | Ochrona XSS anulowana |
| 7 | **Dualna persistencja File + DB** | server | Dwa zrodla prawdy, mozliwa divergencja |
| 8 | **In-memory rooms (Map)** | server | Zero horizontal scaling |
| 9 | **httpApp.ts = fat controller** | server | Logika biznesowa w routerze |
| 10 | **Brak testow** | oba | Zero pewnosci przy zmianach |

---

## 2. Metryki projektu

### Frontend
| Metryka | Wartosc |
|---------|---------|
| Komponenty Vue (.vue) | 36 plikow, **14 452 LOC** |
| Composables | 9 plikow, 2 331 LOC |
| Utils/Services/Modules | ~15 plikow, ~3 000 LOC |
| Najwiekszy komponent | `WhiteboardCanvas.vue` - **2 786 LOC** |
| 2. najwiekszy | `App.vue` - **2 128 LOC** |
| 3. najwiekszy | `MovableObject.vue` - **1 441 LOC** |
| 4. najwiekszy | `AIChatPanel.vue` - **1 187 LOC** |
| 5. najwiekszy | `ToolBar.vue` - **1 081 LOC** |
| Jezyk | ~90% JavaScript, ~10% TypeScript |
| Testy | **0** plikow testowych w src/ |

### Backend
| Metryka | Wartosc |
|---------|---------|
| Pliki TypeScript | 40 plikow, **7 482 LOC** |
| AI module | 3 462 LOC (agent, tools, schema, OCR, solver) |
| Routes | 5 plikow, 544 LOC |
| Services | 9 plikow, ~1 300 LOC |
| Najwiekszy plik | `boardTools.ts` - **890 LOC** |
| 2. najwiekszy | `boardAgent.ts` - **645 LOC** |
| Migracje DB | 2 pliki |

---

## 3. Architektura ogolna

### Diagram warstwowy

```
+------------------------------------------------------------------+
|                        KLIENT (Browser)                           |
|                                                                   |
|  Root.vue (manualny "router" - 5 linii)                           |
|    +-> App.vue (2128 LOC God Component)                           |
|    |     +-> WhiteboardCanvas.vue (2786 LOC God Component)        |
|    |     +-> AIChatPanel.vue + ToolBar + 25 komponentow           |
|    +-> TeacherDashboard.vue                                       |
|    +-> StudentBoardEntry.vue                                      |
|    +-> AdminTeachersPanel.vue                                     |
|                                                                   |
|  Stan: Yjs Doc + lokalne ref() + 1 reactive singleton             |
|  HTTP: raw fetch() (axios zainstalowany ale NIEUZYWANY)           |
+------------------------------------------------------------------+
                   WebSocket            HTTP REST
+------------------------------------------------------------------+
|                       SERWER (Node.js)                            |
|                                                                   |
|  server.ts  (WebSocket inline, 377 LOC)                           |
|    +-> httpApp.ts (Fat Controller, 559 LOC)                       |
|    |     +-> 5 route files + 7 inline endpointow                  |
|    +-> RoomManager (in-memory Map)                                |
|                                                                   |
|  Persistence:                                                     |
|    +-> FilePersistence (data/*.json + data/*.bin) !!               |
|    +-> PostgreSQL via Knex (boards, teachers, yjs)                |
|                                                                   |
|  AI: boardAgent.ts (645 LOC, giant switch/case)                   |
+------------------------------------------------------------------+
```

### Kluczowe decyzje architektoniczne i ich ocena

| Decyzja | Kiedy miala sens | Dlaczego jest problemem teraz |
|---------|------------------|------------------------------|
| Brak routera, manualny pathname check | Prototyp z 1 widokiem | Teraz 4 widoki, brak lazy loading, brak guards |
| Stan w ref() w App.vue | Maly komponent | 17 propsow drilling, 2128 LOC |
| Options API + setup() hybrid | Poczatek nauki Vue 3 | Niespojne z nowszym `<script setup>` |
| File persistence (JSON/bin) | Szybki start bez DB | 30+ plikow w data/, brak rotacji, duplikacja z DB |
| Custom HMAC tokeny | Prosta auth | Brak refresh, rotation, revocation, blacklisting |
| Inline endpoints w httpApp.ts | Szybkie dodawanie | 559 LOC, system prompty w kontrolerze |
| mathjs na frontendzie I backendzie | Solver potrzebny wszedzie | 600KB+ duplikacja w bundle |
| axios w package.json | Planowane uzycie | Nigdy nie uzyte, raw fetch() wszedzie |

---

## 4. Frontend - Analiza strukturalna

### 4.1 KRYTYCZNE: God Components (szczegolowo)

#### WhiteboardCanvas.vue - 2786 LOC

**Co zawiera (linia po linii):**

| Zakres linii | Co robi | LOC | Powinno byc osobno? |
|-------------|---------|-----|---------------------|
| 1-136 | Template (canvas, overlays, controls, notifications, debug) | 136 | Tak - wydzielic sub-templates |
| 138-200 | Imports (15 importow, inline debounce, constants) | 62 | OK |
| 216-253 | Options API boilerplate (name, components, props, emits) | 37 | Powinno byc `<script setup>` |
| 253-560 | Setup init: 90+ ref(), 7 composable inits, closures | 307 | Kompozycja jest, ale za duzo klejenia |
| 562-653 | addElementFromPanel (Yjs transaction, normalizacja) | 91 | Tak - wydzielic do composable |
| 658-740 | updateLocalScene, isElementVisible (culling) | 82 | Tak - rendering composable |
| 742-972 | redrawStatic, redrawDynamic (canvas rendering) | 230 | Tak - CanvasRenderer composable |
| 975-1007 | Render loop (requestAnimationFrame) | 32 | OK w rendering composable |
| 1041-1093 | refreshMovableElements, findMovableElementIdAtPoint | 52 | OK |
| 1095-1214 | Yjs connection, awareness, teardown, connect | 119 | Juz jest w connectToYjs, ale setup tu |
| 1219-1298 | Canvas init, HiDPI scaling, resize observer | 79 | OK |
| 1300-1603 | INPUT HANDLERS: mousedown/move/up/leave, touch, pinch | 303 | TAK - InputHandler composable |
| 1603-1841 | Text editing: addTextElement, startInlineText, finalize | 238 | TAK - InlineTextEditor composable |
| 1849-1960 | Object update, clone, selection handlers | 111 | OK |
| 1969-2072 | Tool setters, cursor, zoom, keyboard | 103 | Czesciowo w composables |
| 2074-2170 | Paste handler, image adding | 96 | TAK - clipboard composable |
| 2177-2786 | clearCanvas, expose, lifecycle, watchers, CSS | 609 | Mieszanka - do podzielenia |

**Kluczowe problemy:**
- `setup()` function ma ~2500 linii - to jest CALA logika komponentu
- 90+ `ref()` declarations w jednym scope
- 7 composables inicjalizowanych z ~25 parametrami kazdy (closure hell)
- Komentarze "moved to composable" powtarzane 15+ razy (slady niekompletnego refactoringu)
- Inline `debounce` function zamiast importu z utils

#### App.vue - 2128 LOC

**Kluczowe problemy:**
- Zarzadza **calym** stanem narzedzi rysowania (tool, color, lineWidth, shape, lineStyle, arrowStyle, roughness, fillColor)
- 8+ feature panel toggles z manualna wylacznoscia
- Pen preset rendering logic (canvas preview)
- Diagram generation + topological layout calculation INLINE w komponencie
- Room management (join, create, share) INLINE
- Calculator, theme, debug mode, export/import flow - wszystko w jednym

### 4.2 KRYTYCZNE: Brak Vue Router

```javascript
// Root.vue - caly "routing" w 5 linii
const pathname = window.location.pathname || '';
const view = computed(() => {
  if (pathname.startsWith('/admin/teachers')) return 'admin';
  if (pathname.startsWith('/teacher/dashboard')) return 'teacher';
  if (pathname.startsWith('/s/') || pathname.startsWith('/board/')) return 'student';
  return 'whiteboard';
});
```

**Co tracimy:**
- `pathname` jest `const` - zmiana URL nie spowoduje re-renderu!
- Brak lazy loading per route (AdminPanel ladowane nawet na whiteboardzie)
- Brak navigation guards (admin bez auth check)
- Brak `router-link`, brak historii, brak `router.push()`
- Brak 404 handling
- Brak per-route code splitting (jeden bundle na wszystko)

### 4.3 KRYTYCZNE: Brak State Management

**Props drilling chain:**
```
App.vue (ref: currentShape)
  -> WhiteboardCanvas (prop: currentShape)
    -> useDrawingEngine (getter: getCurrentShape: () => props.currentShape)
```

Zmiana jednego koloru wymaga przeplyniecia przez 3 warstwy. Z Pinia:
```
// Dowolny komponent
const toolStore = useToolStore()
toolStore.setColor('#ff0000')
```

### 4.4 Mieszany JS/TS - szczegolowy rozklad

| Plik | Jezyk | Problemy z brakiem typow |
|------|-------|--------------------------|
| `WhiteboardCanvas.vue` | JS | `element` to `any` wszedzie, brak interface dla propsow composables |
| `useDrawingEngine.js` | JS | 25 parametrow w destrukturyzacji bez typow |
| `useHelperModules.js` | JS | 18 parametrow, callbacks bez sygnatur |
| `useLineBindings.js` | JS | Geometria - `point` moze byc `{x,y}` lub `[x,y]` - brak union type |
| `canvasDrawing.js` | JS | `element` ma ~30 roznych pol, brak discriminated union |
| `canvasTools.js` | JS | Factory functions zwracaja plain objects bez typow |
| `roomService.js` | JS | `error.status` - custom property na Error bez typu |
| `serializer.js` | JS | Kompresja/dekompresja bez walidacji schematu |
| `MovableObject.vue` | **TS** | Jedyny komponent z `<script setup lang="ts">` i interface! |
| `connectToYjs.ts` | TS | Dobrze otypowany |
| `crypto.ts` | TS | Dobrze otypowany |

### 4.5 Options API hybrid vs `<script setup>`

| Plik | Styl | Problem |
|------|------|---------|
| `WhiteboardCanvas.vue` | `export default { setup() }` | Boilerplate: name, components, props, emits - wszystko deklaratywne zamiast macro |
| `App.vue` | `export default { setup() }` | To samo |
| `AIChatPanel.vue` | `export default { setup() }` | To samo |
| `ToolBar.vue` | `export default { setup() }` | To samo |
| `Root.vue` | `<script setup>` | Nowoczesny styl |
| `MovableObject.vue` | `<script setup lang="ts">` | Najlepszy styl w projekcie |
| `Lobby.vue` | `<script setup>` | Nowoczesny |
| Views (4 pliki) | `<script setup>` | Nowoczesne |

**Wniosek:** Nowsze pliki uzywaja `<script setup>`, stare core components - nie. To oznacza ze **najwazniejsze pliki maja najstarszy styl**.

---

## 5. Backend - Analiza strukturalna

### 5.1 Fat Controller: httpApp.ts

**7 endpointow w osobnych route files vs 7 endpointow INLINE:**

| Endpoint | Gdzie | LOC inline |
|----------|-------|------------|
| `/api/ai/solve-equation` | INLINE httpApp.ts | ~25 |
| `/api/ai/chat` | INLINE httpApp.ts | **120** (z systemowym promptem!) |
| `/api/ai/analyze-pdf` | INLINE httpApp.ts | ~30 |
| `/api/ai/generate-diagram` | INLINE httpApp.ts | ~25 |
| `/api/ai/auto-layout-diagram` | INLINE httpApp.ts | ~22 |
| `/api/ai/vision-chat` | INLINE httpApp.ts | ~20 |
| `/rooms` (legacy) | INLINE httpApp.ts | ~5 |
| Room CRUD | INLINE httpApp.ts | ~80 |
| AI board assistant | `routes/aiBoardAssistant.ts` | Wydzielony |
| Teacher auth | `routes/teacherAuth.ts` | Wydzielony |
| Teacher boards | `routes/teacherBoards.ts` | Wydzielony |
| Admin teachers | `routes/adminTeachers.ts` | Wydzielony |
| Board access | `routes/boardAccess.ts` | Wydzielony |

**System prompt po polsku (120 LOC) wklejony w route handler:**
```typescript
// httpApp.ts:299-335
const system: ChatMessage = {
  role: 'system',
  content:
    'Jestes asystentem tablicy WhiteVue. ' +
    'WAZNE: Gdy to jest pierwsza wiadomosc...' +
    // ... 35 linii hardcoded promptu ...
};
```

### 5.2 Dualna persistencja - szczegolowy problem

```
Tworzenie pokoju ad-hoc (Lobby):
  -> RoomManager.get(roomId)
  -> FilePersistence.saveRoom() -> data/{roomId}.json + .bin

Tworzenie pokoju przez nauczyciela:
  -> boardService.createBoardForTeacher()
  -> PostgreSQL INSERT INTO boards + board_yjs_state

Polaczenie WebSocket:
  -> RoomManager.get(roomId)
  -> if (isBoardRoom) -> BoardYjsPersistence.hydrate() (z DB)
  -> else -> FilePersistence.loadRoom() (z pliku)

Problem: Co jesli pokoje file-based i db-based maja ten sam ID?
         Co jesli DB jest niedostepna? -> "Fail open" (linia 286-288 server.ts)
```

**30+ plikow JSON w `server/data/`** to relikt - niektorych pokojow prawdopodobnie juz nie ma w pamieci ale pliki zostaly.

### 5.3 boardAgent.ts - Monolityczny switch (645 LOC)

**16 case'ow, kazdy z innym wzorcem:**

```typescript
switch (name) {
  case 'align_selection_to_grid':     // Sync, simple
  case 'simplify_equation_block':     // Async! (dodatkowy LLM call inline)
  case 'draw_board_patch':            // Sync, simple
  case 'insert_latex_box':            // Sync
  case 'text_block_to_latex':         // Async! (dodatkowy LLM call inline)
  case 'plot_function':               // Sync
  case 'connect_objects':             // Sync
  case 'label_object':                // Sync
  case 'set_style':                   // Sync
  case 'delete_objects':              // Sync
  case 'draw_handstroke':             // Sync
  case 'distribute_horizontally':     // Sync
  case 'distribute_vertically':       // Sync
  case 'clone_object':                // Sync
  case 'move_object':                 // Sync
  case 'solve_equation':              // Async! (inny wzorzec error handling)
}
```

Dwa case'y (`simplify_equation_block`, `text_block_to_latex`) robia **dodatkowe wywolanie LLM wewnatrz switch** - mieszajac orchestracje z logika biznesowa.

### 5.4 Duplikacja fetch/fallback pattern

Ten sam wzorzec "try models, fallback, log" powtorzony 4 razy:
- `grok.ts:callGrok()` - chat fallback
- `aiSolver.ts:callOCR()` - OCR fallback
- `aiSolver.ts:callSolver()` - solver fallback
- `aiSolver.ts:chatWithVision()` - vision (BEZ fallbacku!)

Kazdy powtarza: `for (const model of fallbackModels) { try { fetch... } catch { if last throw } }`

**Powinno byc:** Jedna generyczna funkcja `callWithFallback(models, messages, options)`.

---

## 6. TECH DEBT - Katalog

### TD-001: Inline debounce w WhiteboardCanvas (powinien byc import)

```javascript
// WhiteboardCanvas.vue:178-188
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => { clearTimeout(timeout); func(...args); };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
```
**Problem:** Reimplementacja standardowej utility. `throttle` jest juz importowany z `canvasDrawing.js`.
**Fix:** Import z utils lub uzycie `lodash-es/debounce`.

### TD-002: Element type listy zduplikowane w 5 miejscach

```javascript
// WhiteboardCanvas.vue:368-393 - movableElementTypes
const movableElementTypes = new Set(['pen', 'line', 'rectangle', ...]);

// WhiteboardCanvas.vue:395-404 - CONTENT_RENDER_TYPES
const CONTENT_RENDER_TYPES = new Set(['text', 'image', 'latex', ...]);

// WhiteboardCanvas.vue:1013-1039 - ALWAYS_DOM_TYPES
const ALWAYS_DOM_TYPES = new Set(['latex', 'functionPlot', 'rectangle', ...]);

// MovableObject.vue:187-196 - CONTENT_RENDER_TYPES (ZNOW!)
const CONTENT_RENDER_TYPES = new Set(['text', 'image', 'latex', ...]);

// canvasDrawing.js:105+ - switch(type) z 20+ case'ami
```

**Problem:** Dodanie nowego ksztaltu wymaga zmian w 5 plikach.
**Fix:** Jeden `elementTypes.ts` z centralnymi definicjami i flagami (hasDOM, hasCachedPath, isShape, etc).

### TD-003: Y.Map -> plain object konwersja powtarzana

```javascript
// WhiteboardCanvas.vue:1494-1497 (eraser hit detection)
const element = {};
for (const [key, value] of elementMap.entries()) {
    element[key] = (value instanceof Y.Map || value instanceof Y.Array) ? value.toJSON() : value;
}

// WhiteboardCanvas.vue:1709-1712 (IDENTYCZNY kod w touch handler!)
const element = {};
for (const [key, value] of elementMap.entries()) {
    element[key] = (value instanceof Y.Map || value instanceof Y.Array) ? value.toJSON() : value;
}

// WhiteboardCanvas.vue:670 (updateLocalScene)
localScene = rawArray.map(map => map.toJSON());
```

**Problem:** 3 rozne sposoby konwersji Y.Map na plain object.
**Fix:** Jedna utility function `yMapToPlain(map)`.

### TD-004: Touch handlers to copy-paste mouse handlerow

```javascript
// handleTouchMove (1702-1730) kopiuje logike z handleMouseMove (1486-1521)
// Eraser: identyczny loop, identyczne hit detection, identyczne if/else

// handleTouchStart (1665-1676) tworzy "syntheticMouseEvent" i deleguje do handleMouseDown
// To juz lepszy wzorzec, ale handleTouchMove NIE deleguje - duplikuje
```

**Problem:** Zmiana w eraser logic wymaga zmian w DWOCH miejscach.
**Fix:** Wydzielic `processEraserAt(coords)` uzywany przez oba handlery.

### TD-005: ID generowanie niespojne

```javascript
// WhiteboardCanvas.vue:1764
const id = `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`;

// WhiteboardCanvas.vue:1944
const newId = `${yjsConnection.value?.awareness?.clientID || 'local'}-${uuidv4()}`;

// WhiteboardCanvas.vue:2119
imageData.id = `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`;

// canvasTools.js (createNewElement)
id: uuidv4()

// boardService.ts
const boardId = uuidv4();
```

**Problem:** 3 rozne formaty ID: `clientID-timestamp`, `clientID-uuid`, `uuid`.
Dwa uzycia `Date.now()` - kolizja mozliwa przy szybkim dodawaniu.
**Fix:** Jeden `generateElementId()` wszedzie.

### TD-006: "Moved to composable" komentarze (ghost comments)

```javascript
// WhiteboardCanvas.vue - 15+ takich komentarzy:
// cancelActiveDrawing moved to useDrawingEngine composable         (linia 1347)
// startDrawing, eraseElement moved to useDrawingEngine composable  (linia 1845)
// LINE_TOOLS, draw, finishDrawing moved to useDrawingEngine        (linia 1847)
// renderLatex moved to useHelperModules composable                 (linia 564)
// addSmoothedPenPoint, computePenWidthFromPreset...                (linia 1452)
// showStatus and showToast moved to useNotifications               (linia 2174)
// updateGlobalState, initializeUndoManager...                      (linia 477)
// syncModulesWithYjs moved to useHelperModules                     (linia 1009)
```

**Problem:** Slady refactoringu. Nowy developer czyta "moved to X" ale nie wie skad to bylo przeniesione ani dlaczego.
**Fix:** Usunac wszystkie. Git blame pokaze historie.

### TD-007: Hardcoded kolory inline w CSS i JS

```javascript
// WhiteboardCanvas.vue:855-856
ctx.fillStyle = 'rgba(99,102,241,0.28)';
ctx.strokeStyle = 'rgba(99,102,241,0.9)';

// WhiteboardCanvas.vue:906-907
drawCircle(..., 'rgba(147,197,253,0.35)', 'rgba(37,99,235,0.9)');

// WhiteboardCanvas.vue:946
ctx.strokeStyle = 'rgba(33, 150, 243, 0.9)';
ctx.fillStyle = 'rgba(33, 150, 243, 0.15)';
```

**Problem:** Kolory UI hardcoded w rendering code. Zmiana motywu wymaga edycji logiki canvas.
**Fix:** Obiekt `THEME_COLORS` importowany z centralnego pliku.

### TD-008: Composable dependency injection z 25+ parametrami

```javascript
// WhiteboardCanvas.vue:528-560
useDrawingEngine({
  isDrawing, currentTool, currentColor, currentLineWidth,
  zoomLevel, panOffset, ydoc, yDrawings, yjsConnection,
  undoManager, smoothingFactor, debugModeEnabled,
  getCurrentShape: () => props.currentShape,
  getCurrentLineStyle: () => props.currentLineStyle,
  getCurrentRoughness: () => props.currentRoughness,
  getCurrentFillColor: () => props.currentFillColor,
  getCurrentArrowStyle: () => props.currentArrowStyle,
  getActiveFeature: () => props.activeFeature,
  getHandwritingStylerOptions: () => props.handwritingStylerOptions,
  updateGlobalState,
  redrawCanvas: (...args) => redrawCanvas(...args),
  scheduleRedraw: (...args) => scheduleRedraw(...args),
  refreshMovableElements: () => refreshMovableElements(),
  openConfigPanel: (...args) => openConfigPanel(...args),
  startInlineText: (...args) => startInlineText(...args),
  attachBindingsToLineDraft,
  getActiveModule, emit, debugLog, debugWarn, showToast,
});
```

**Problem:** To nie jest composable - to jest service z 25+ dependencies recznym DI.
Z Pinia stores wiekszosc tych zaleznosci byloby automatyczna.
**Fix:** Tool state, drawing state, UI state -> oddzielne Pinia stores.

### TD-009: `confirm()` w logice biznesowej

```javascript
// WhiteboardCanvas.vue:2183
if (!skipConfirm && !confirm('Are you sure you want to clear the canvas?')) {
    return;
}
```

**Problem:** Synchroniczny `window.confirm()` blokuje main thread i jest niestylizowany.
**Fix:** Custom Vue dialog component z async/await.

### TD-010: Image data URL przechowywane w Yjs Doc

```javascript
// WhiteboardCanvas.vue:2139
imageMap.set('dataUrl', imageData.dataUrl);
imageMap.set('src', imageData.dataUrl); // DUPLIKACJA!
```

**Problem:**
1. `dataUrl` I `src` to TA SAMA wartosc - duplikacja w CRDT doc
2. Base64 obrazy w Yjs = synchronizowane do kazdego klienta przez WebSocket
3. 5MB limit per obraz * N obrazow = potencjalnie gigantyczny doc

**Fix:** Upload do servera, przechowywac URL zamiast base64. Usunac duplikat `src`.

### TD-011: `let` zamiast scope isolation

```javascript
// WhiteboardCanvas.vue:419
let resizeObserver = null;
let clipboardFocusHandler = null;

// WhiteboardCanvas.vue:659
let localScene = [];

// WhiteboardCanvas.vue:976-978
let redrawStaticNeeded = false;
let redrawDynamicNeeded = false;
let rafId = null;
```

**Problem:** `let` zmienne w scope setup() zamiast `ref()` lub zamkniecia w composable.
Nie sa reaktywne ale sa mutowane - trudne do debugowania.
**Fix:** Przenosc do odpowiednich composables z jasnym ownership.

### TD-012: Bounds caching na mutowalnym obiekcie

```javascript
// WhiteboardCanvas.vue:732
element._bounds = { minX, minY, maxX, maxY };
```

**Problem:** Dodawanie `_bounds` property do obiektu z `toJSON()` - mutowanie danych z Yjs.
Jesli ten obiekt jest wspoldzielony, cache moze wyciec.
**Fix:** Oddzielna WeakMap cache `boundsCache.set(element, bounds)`.

### TD-013: `console.error` zamiast uzytkownickiego feedbacku

```javascript
// WhiteboardCanvas.vue:583
console.error("Invalid data received from panel or Yjs not ready", elementData);

// WhiteboardCanvas.vue:1209
console.error("Failed to connect Yjs provider:", error);

// WhiteboardCanvas.vue:2102
console.error("[addImageFromDataUrl] Error: ydoc or yDrawings not available!");
```

**Problem:** `console.error` widoczny tylko w DevTools. Uzytkownik nie wie ze cos sie nie udalo.
Niektorzy uzywaja `showToast` (dobrze), inni nie (zle).
**Fix:** Kazdy error path powinien miec `showToast()` LUB globalny error handler.

### TD-014: Timeout magic numbers w server

```javascript
// server.ts:202 - setTimeout po polaczeniu
setTimeout(() => {
    initializeUndoManager();
    redrawCanvas(true);
}, 100);  // Dlaczego 100ms? Race condition workaround?
```

**Problem:** Magiczny timeout 100ms prawdopodobnie ukrywa race condition z hydracją Yjs.
**Fix:** Uzyc `await` lub event-based init zamiast timeout.

### TD-015: `as any` w backendzie

```typescript
// httpApp.ts:106
(req as any).correlationId = correlationId;

// httpApp.ts:269
const err = error as any;

// httpApp.ts:489
if ('chatWithVision' in aiSolver) {
    const reply = await (aiSolver as any).chatWithVision(messages);
```

**Problem:** Type assertions omijaja TypeScript safety. `correlationId` powinien byc w interface.
**Fix:** Rozszerzyc Express Request interface (juz jest w express.d.ts ale nie dla correlationId).

### TD-016: `canvasDrawing.js` - 999 LOC switch/case

```javascript
// canvasDrawing.js:105-999
switch (type) {
  case 'pen':           // 44 LOC
  case 'eraser':        // 12 LOC
  case 'line':          // 45 LOC
  case 'rectangle':     // 18 LOC
  case 'circle':        // 20 LOC
  case 'triangle':      // 26 LOC
  case 'trapezoid':     // 30 LOC
  case 'parallelogram': // 30 LOC
  case 'deltoid':       // 30 LOC
  case 'diamond':       // 30 LOC
  case 'cuboid':        // 45 LOC
  case 'tetrahedron':   // 40 LOC
  case 'cube':          // ~50 LOC
  case 'sphere':        // ~30 LOC
  case 'cylinder':      // ~40 LOC
  case 'cone':          // ~40 LOC
  case 'pyramid':       // ~40 LOC
  case 'text':          // 20 LOC
  case 'image':         // 40 LOC
  case 'coordinateSystem2D': // ~60 LOC
  case 'coordinateSystem3D': // ~80 LOC
  default:
}
```

**Problem:** Kazdy ksztalt ma skopiowany pattern `if (isClean) { ... } else { rc.polygon(...) }`.
Kod fill jest IDENTYCZNY w kazdym case.
**Fix:** Strategy pattern - `shapeRenderers.get(type).render(ctx, element, options)`.

### TD-017: aiSolver.ts - `process.env` czytany w metodach

```typescript
// aiSolver.ts:229
const apiKey = process.env.OPENROUTER_API_KEY;

// aiSolver.ts:292
const apiKey = process.env.OPENROUTER_API_KEY;

// aiSolver.ts:355
const apiKey = process.env.OPENROUTER_API_KEY;
```

**Problem:** 3 razy czytany `process.env` w roznych metodach zamiast raz w konstruktorze.
**Fix:** `this.apiKey = process.env.OPENROUTER_API_KEY` w konstruktorze.

### TD-018: `PUBLIC_TEACHER_NAME` hardcoded

```typescript
// routes/boardAccess.ts (znalezione przez agenta)
const PUBLIC_TEACHER_NAME = 'Dawid Furmaniuk';
```

**Problem:** Imie nauczyciela hardcoded w kodzie zrodlowym. Powinno byc w DB lub config.

### TD-019: `closePath + fill + stroke` pattern powtorzony 12 razy

```javascript
// canvasDrawing.js - kazdy ksztalt:
context.beginPath();
context.moveTo(points[0][0], points[0][1]);
for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
context.closePath();
if (fillColor) {
    context.globalAlpha = fillOpacity;
    context.fill();
    context.globalAlpha = 1;
}
context.stroke();
```

**Problem:** Identyczny kod w `triangle`, `trapezoid`, `parallelogram`, `deltoid`, `diamond`, + wiecej.
**Fix:** Helper `drawPolygon(ctx, points, fillColor, fillOpacity)`.

### TD-020: Brak cleanup interval w aiStore

```javascript
// useAiStore.js:35
statusInterval = setInterval(updateElapsed, 100);

// useAiStore.js:84
clearInterval(statusInterval);
```

**Problem:** Jesli komponent unmounta sie podczas request - interval moze nie byc wyczyszczony.
`statusInterval` to zmienna module-level, nie ref - brak Vue lifecycle integration.
**Fix:** `onScopeDispose(() => clearInterval(statusInterval))` lub `watchEffect` z cleanup.

---

## 7. Bezpieczenstwo

### SEC-001: CSP z unsafe-inline + unsafe-eval (KRYTYCZNE)

```typescript
// httpApp.ts:71
scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
```

`'unsafe-eval'` zezwala na `eval()`, `Function()`, `setTimeout(string)` - glowny wektor XSS.
`'unsafe-inline'` zezwala na inline `<script>` - drugi glowny wektor.

**Razem anuluja ~80% ochrony CSP.**

Prawdopodobna przyczyna: KaTeX lub Rough.js moze uzywac `new Function()`. Trzeba to zweryfikowac i uzyc nonce-based CSP.

### SEC-002: Domyslne sekrety

| Plik | Wartosc domyslna | Uzywana gdy |
|------|-------------------|------------|
| `config.ts:53` | `'change-me-in-prod'` | Brak `TEACHER_SESSION_SECRET` |
| `boardTokens.ts:12` | `'change-me'` | Brak `BOARD_WS_SECRET` |
| `boardService.ts:21` | `'change-me'` | Brak `STUDENT_TOKEN_SECRET` |
| `docker-compose.yml:25` | `'postgres_password'` | Zawsze (nie uzywa env) |

W development te wartosci sa **aktywne**, co oznacza ze tokeny sa deterministyczne i zgadywalne.

### SEC-003: 20MB JSON body limit globalny

```typescript
app.use(express.json({ limit: '20mb' }));
```

Kazdy endpoint akceptuje 20MB payloadu, nie tylko AI ze screenshotami. DoS wektor.

### SEC-004: WebSocket bez Origin validation

```typescript
const wss = new WebSocketServer({ server, maxPayload: 5 * 1024 * 1024 });
// Brak: verifyClient: (info) => { check info.origin }
```

### SEC-005: `isBoardRoom` fail-open

```typescript
// server.ts:286-288
} catch (error) {
    // Fail open for non-board rooms to preserve basic realtime when DB is down.
    isBoardRoom = false;
}
```

Jesli DB jest niedostepna, board rooms sa traktowane jak publiczne pokoje - auth bypassed.

---

## 8. Antywzorce i Code Smells

### 8.1 Dead Code / Remnants

| Plik/Element | Problem |
|-------------|---------|
| `server/check_env.ts` | Orfan - nie importowany nigdzie |
| `server/check_env_v2.ts` | Orfan - nie importowany nigdzie |
| `server/data/.json` | Pusty plik JSON |
| Root `package.json` | Zawiera tylko `{}` |
| Root `node_modules/` | Istnieje mimo pustego package.json |
| Root `venv/` | Python venv - relikt, nie uzywany |
| Root `temp/` | Pusty katalog tymczasowy |
| Root `package-lock.json` | 33KB lock file dla pustego `{}` |
| `frontend/package.json:axios` | Zainstalowany, nigdzie nie importowany |
| `frontend/package.json:perfect-freehand` | Zainstalowany, prawdopodobnie nieuzywany |
| 15+ komentarzy "moved to composable" | Ghost comments w WhiteboardCanvas |
| `selectObject()` linia 1962 | Pusta funkcja z komentarzem "old handler" |
| `debugLog`, `debugWarn` | console.log wrappery uzywane sporadycznie |
| `// Commented out` w 10+ miejscach | Zakomentowany kod zamiast usuniecia |
| `serializer.js:saveToDiscord/loadFromDiscord` | Placeholder functions - nie zaimplementowane |

### 8.2 Naming Inconsistencies

| Problem | Przyklady |
|---------|-----------|
| Mieszane jezyki | System prompty po polsku, komentarze PL/EN, UI angielski |
| Niespojne nazwy | `grok.ts` (generic AI, nie tylko Grok), `aiSolver.ts` (tez uzywa grok.ts) |
| Config model names | `BOARD_AI_MODEL`, `CHAT_MODEL`, `OCR_MODEL`, `SOLVER_MODEL` - 4 env vars |
| Event naming | `@update:activeTool` vs `@update:color` vs `@update:fillColor` (camelCase vs not) |

### 8.3 Circular/implicit Dependencies

```
WhiteboardCanvas.vue
  -> useDrawingEngine (needs redrawCanvas callback)
    -> returns startDrawing, draw, finishDrawing
      -> WhiteboardCanvas uses them in event handlers
        -> which call redrawCanvas
          -> which was passed TO useDrawingEngine

// Closure hell - 7 composables all cross-reference each other through callbacks
```

---

## 9. Wydajnosc i skalowalnosc

### 9.1 Bundle Size problemy

| Biblioteka | Szacowany rozmiar | Uzywana gdzie | Lazy loadowana? |
|-----------|-------------------|---------------|-----------------|
| `katex` + CSS | ~300KB | LaTeX rendering | NIE (globalny import w main.js) |
| `tesseract.js` | ~5MB worker | OCR (rzadko) | NIE |
| `mathjs` | ~600KB | Kalkulator, solver | NIE (frontend + backend!) |
| `html2canvas` | ~500KB | Screenshot AI | NIE |
| `jspdf` | ~300KB | PDF export (rzadko) | Dynamiczny import (OK) |
| `pdfjs-dist` | ~400KB | PDF import (rzadko) | NIE |
| `roughjs` | ~80KB | Rendering | OK - zawsze potrzebny |
| `function-plot` | ~50KB | Wykresy | NIE |

**Szacowane potencjalne oszczednosci z lazy loading: ~1.5MB**

### 9.2 Canvas rendering

**Pozytywne:**
- Path2D caching dla pen strokow
- Ramer-Douglas-Peucker simplification
- Static/dynamic canvas separation
- requestAnimationFrame render loop z dirty flags
- View frustum culling (isElementVisible)

**Negatywne:**
- `updateLocalScene()` robi `toArray().map(map => map.toJSON())` na KAZDYM Yjs update
- `refreshMovableElements()` robi `toArray().filter().map()` na kazdym update
- `imageCache` to `ref(new Map())` bez eviction
- Brak Web Workers dla ciezkich operacji

### 9.3 Scaling bottleneck

```
           SINGLE NODE, SINGLE PROCESS
                    |
    +-------------------------------+
    |     Node.js Server            |
    |                               |
    |  Map<roomId, RoomContext>     | <- Non-shared
    |  Map<ip, connectionCount>    | <- Non-shared
    |  Map<key, rateLimitBucket>   | <- Non-shared
    |  FilePersistence (local)     | <- Non-shared
    +-------------------------------+
                    |
               PostgreSQL (shared, OK)
```

---

## 10. Testowalnosc

### Frontend: ZERO testow mimo zainstalowanych narzedzi

- `vitest` 4.0.18 w devDependencies
- `@vue/test-utils` 2.4.6 w devDependencies
- `happy-dom` 20.8.3 w devDependencies
- `@playwright/test` 1.58.2 w devDependencies
- **Zero plikow testowych w `frontend/src/`**
- Brak `vitest.config.ts` w frontend

### Backend: Minimalne testy

- `vitest` w devDependencies, `supertest` dostepny
- Git history: "add 40 regression tests" - istnieja gdzies
- Brak widocznych test files w `server/src/`

### Testowalnosc komponentow

| Komponent | Testowalnosc | Powod |
|-----------|-------------|-------|
| WhiteboardCanvas | 1/10 | 2786 LOC, canvas, WebSocket, Yjs, 17 propsow, 25-param composables |
| App.vue | 1/10 | 2128 LOC, zarzadza calym stanem, uzytkownikiem, pokojami |
| MovableObject | 4/10 | Duzy (1441) ale lepiej izolowany, ma TypeScript |
| ToolBar | 5/10 | 1081 LOC ale glownie UI emit pattern |
| AIChatPanel | 3/10 | External fetch, html2canvas, markdown |
| Mniejsze komponenty | 7/10 | Calculator, Dialog, StatusMessage - testowalne |
| useUndoRedo | 6/10 | Wymaga Yjs mock, ale prosty |
| useNotifications | 9/10 | 29 LOC, pure logic |
| Backend services | 6/10 | DB dependency ale mockable |
| boardAgent.ts | 2/10 | LLM calls, giant switch, tight coupling |

---

## 11. Modernizacja - plan krok po kroku

### Faza 0: Quick Wins - bez zmian architektonicznych (2-3 dni)

| # | Akcja | LOC zmienione | Efekt |
|---|-------|---------------|-------|
| 0.1 | Usunac 15+ "moved to composable" komentarzy | -20 | Czystosc |
| 0.2 | Usunac `check_env.ts`, `check_env_v2.ts`, `data/.json` | -3 pliki | Czystosc |
| 0.3 | Usunac root `node_modules/`, `package-lock.json`, naprawic root `package.json` | -33KB | Czystosc |
| 0.4 | Usunac `axios` z frontend dependencies | -1 dep | Bundle size |
| 0.5 | Usunac inline `debounce` z WhiteboardCanvas, importowac z utils | -10 | DRY |
| 0.6 | Usunac `selectObject()` pusta funkcja | -5 | Czystosc |
| 0.7 | Usunac zakomentowany kod (`// Commented out`) | -30+ | Czystosc |
| 0.8 | Zastapic `confirm()` w clearCanvas wlasnym dialogiem | ~20 | UX |

### Faza 1: Bezpieczenstwo (3-5 dni)

| # | Akcja | Priorytet |
|---|-------|-----------|
| 1.1 | Usunac `'unsafe-eval'` i `'unsafe-inline'` z CSP (zweryfikowac katex/roughjs) | P0 |
| 1.2 | Zamienic domyslne sekrety na `crypto.randomBytes(32)` generowane przy starcie dev | P0 |
| 1.3 | Ograniczyc JSON body limit: 1MB globalnie, 20MB per-route dla AI | P1 |
| 1.4 | Dodac WebSocket `verifyClient` z Origin check | P1 |
| 1.5 | Zamienic fail-open na fail-closed dla `isBoardRoom` | P1 |
| 1.6 | Uzyc zmiennej srodowiskowej dla `POSTGRES_PASSWORD` w docker-compose | P2 |

### Faza 2: Vue Router + Pinia (1-2 tygodnie)

| # | Akcja | Efekt |
|---|-------|-------|
| 2.1 | Zainstalowac `vue-router`, `pinia` | Fundament |
| 2.2 | Stworzyc router z 4 routes (lazy loaded) | Code splitting per route |
| 2.3 | Stworzyc `useToolStore` (color, width, shape, lineStyle, roughness, fill, arrow) | Eliminacja 17 propsow |
| 2.4 | Stworzyc `useRoomStore` (roomId, username, wsToken, connectionStatus) | Centralizacja room state |
| 2.5 | Stworzyc `useUIStore` (darkMode, debugMode, activeFeature, panelToggles) | Centralizacja UI state |
| 2.6 | Migrowac App.vue na uzycie stores zamiast lokalnych ref() | -500+ LOC z App.vue |
| 2.7 | Dodac navigation guards (auth check na /admin, /teacher) | Security |

### Faza 3: Dekompozycja God Components (2-3 tygodnie)

| # | Akcja | LOC reduction |
|---|-------|---------------|
| 3.1 | Wydzielic `InlineTextEditor.vue` z WhiteboardCanvas | -250 LOC |
| 3.2 | Wydzielic `useCanvasRenderer` composable (redrawStatic, redrawDynamic, renderLoop) | -300 LOC |
| 3.3 | Wydzielic `useCanvasInput` composable (mouse/touch handlers) | -350 LOC |
| 3.4 | Wydzielic `useClipboard` composable (paste, image adding) | -100 LOC |
| 3.5 | Wydzielic `FeaturePanelManager.vue` z App.vue | -200 LOC |
| 3.6 | Wydzielic `PenPreviewManager.vue` z App.vue | -150 LOC |
| 3.7 | Stworzyc `elementTypes.ts` z centralnymi definicjami typow | Eliminacja duplikacji |
| 3.8 | Migrowac WhiteboardCanvas do `<script setup>` | -40 LOC boilerplate |
| 3.9 | Migrowac App.vue do `<script setup>` | -40 LOC boilerplate |

### Faza 4: TypeScript + Types (2-3 tygodnie)

| # | Akcja | Efekt |
|---|-------|-------|
| 4.1 | Dodac/poprawic `tsconfig.json` dla frontendu (strict) | Fundament |
| 4.2 | Stworzyc `types/element.ts` z union type dla elementow | Central type source |
| 4.3 | Migrowac composables: useDrawingEngine, useLineBindings, useHelperModules -> .ts | Type safety |
| 4.4 | Migrowac services: roomService, backendUrl -> .ts | Type safety |
| 4.5 | Migrowac utils: canvasDrawing, canvasTools, canvasGrid, penStyles -> .ts | Type safety |
| 4.6 | Dodac shared types package miedzy frontend a backend | Spojnosc |

### Faza 5: Backend refactoring (2-3 tygodnie)

| # | Akcja | Efekt |
|---|-------|-------|
| 5.1 | Wydzielic inline endpointy z httpApp.ts do route files | Utrzymywalnosc |
| 5.2 | Przeniesc system prompty do osobnych plikow/stale | Czystosc |
| 5.3 | Wydzielic `callWithFallback()` z powtorzonego fetch pattern | DRY |
| 5.4 | Zamienic switch/case w boardAgent na tool registry Map | Extensibility |
| 5.5 | Ujednolicic persistence - wybrac DB jako jedyne zrodlo prawdy | Architektura |
| 5.6 | Dodac Zod do walidacji API inputs | Security + quality |
| 5.7 | Zamienic custom HMAC tokens na `jose` (standard JWT) | Security |
| 5.8 | Zamienic custom rate limiter na `express-rate-limit` | Maintenance |
| 5.9 | Stworzyc `drawPolygon()` helper w canvasDrawing eliminujac 12x copy-paste | -200 LOC |

### Faza 6: Testy (2-3 tygodnie, rownolegla)

| # | Akcja | Coverage target |
|---|-------|----------------|
| 6.1 | Skonfigurowac vitest dla frontendu | Setup |
| 6.2 | Unit testy: useNotifications, useUndoRedo, geometry.js | 100% |
| 6.3 | Unit testy: canvasGrid, penStyles, serializer, fileUtils | 80% |
| 6.4 | Unit testy: roomService, backendUrl, crypto | 80% |
| 6.5 | Integration testy: backend routes (supertest) | 70% |
| 6.6 | Integration testy: boardService, teacherService | 80% |
| 6.7 | E2E testy: Playwright - podstawowy flow (rysowanie, save, reload) | Smoke |

### Faza 7: Performance + DX (opcjonalna, 1-2 tygodnie)

| # | Akcja | Efekt |
|---|-------|-------|
| 7.1 | Lazy load: katex, tesseract, pdfjs-dist, html2canvas | -1.5MB bundle |
| 7.2 | Structured logging (pino zamiast console.log) | Observability |
| 7.3 | Dodac CI/CD pipeline (GitHub Actions) | DevOps |
| 7.4 | Dodac ESLint + Prettier config | Code quality |
| 7.5 | Usunac mathjs z frontendu (uzyc backendu jako proxy) | -600KB bundle |

---

## Podsumowanie priorytetow

```
P0 (Natychmiast)  : CSP unsafe-eval, domyslne sekrety, Quick Wins (Faza 0+1)
P1 (Ten sprint)   : Vue Router + Pinia (Faza 2) - fundamentalna zmiana
P2 (Nastepny)     : God Component decomposition (Faza 3)
P3 (Kolejny)      : TypeScript migration (Faza 4) + Backend refactoring (Faza 5)
P4 (Ongoing)      : Testy (Faza 6) - najlepiej rownolegle z innymi fazami
P5 (Nice to have) : Performance, CI/CD, structured logging (Faza 7)
```

**Szacowana calkowita pracochonnosc: 10-14 tygodni** (1 developer full-time)
**Quick wins (Faza 0): 2-3 dni** - natychmiastowa poprawa bez ryzyka

---

*Raport wygenerowany na podstawie analizy kazdego pliku zrodlowego projektu WhiteVue.
Przeanalizowano 36 komponentow Vue, 9 composables, 15 utils/services, 40 plikow TypeScript serwera,
konfiguracje, persistencje, modul AI - linia po linii.*
