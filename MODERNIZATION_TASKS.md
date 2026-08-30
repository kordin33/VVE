# WhiteVue - Plan Modernizacji: Taski

**Dokument towarzyszacy:** `ARCHITECTURE_REVIEW.md`
**Data:** 2026-03-25
**Format:** Kazdy task ma: opis, pliki do zmiany, acceptance criteria, definition of done, quality gates

---

## Globalne reguly jakosci (obowiazuja KAZDY task)

### Quality Gates - kod NIE moze byc zmergowany jesli:
- [ ] Lamiee istniejace testy (jesli jakies istnieja)
- [ ] Wprowadza nowe `any` type assertions w TypeScript (chyba ze task jest na migre JS->TS)
- [ ] Dodaje nowe `console.log` / `console.error` bez towarzyszacego user-facing feedbacku
- [ ] Wprowadza nowy dead code lub komentarze "TODO" bez powiazanego taska
- [ ] Zmienia zachowanie widoczne dla uzytkownika bez wyraznego powodu w opisie taska
- [ ] Dodaje nowe hardcoded strings (kolory, URL-e, timeouty) bez wyciagniecia do stalych/config

### Konwencje commitow:
- Format: `type(scope): description` np. `fix(security): remove unsafe-eval from CSP`
- Typy: `fix`, `feat`, `refactor`, `chore`, `test`, `perf`, `docs`
- Kazdy commit buduje sie bez bledow (`npm run build` przechodzi)

---

## FAZA 0: Quick Wins (bez zmian architektonicznych)

**Cel:** Czystosc kodu, usuniecie smieci, zero ryzyka regresji.
**Szacowany czas:** 2-3 dni
**Wymagana wiedza:** Podstawowa znajomosc projektu

---

### TASK-0.1: Usuniecie dead code i ghost comments

**Opis:**
Usunac wszystkie remnants niekompletnych refactoringow z WhiteboardCanvas.vue, martwe pliki z serwera, i puste/bezuzyteczne pliki z roota.

**Pliki do zmiany:**
- `frontend/src/components/WhiteboardCanvas.vue` - usunac 15+ komentarzy "moved to composable"
- `frontend/src/components/WhiteboardCanvas.vue` - usunac pusta funkcje `selectObject()` (linia ~1962)
- `frontend/src/components/WhiteboardCanvas.vue` - usunac zakomentowany kod (szukac `// Commented out`, `// debugLog`)
- `server/check_env.ts` - USUNAC caly plik
- `server/check_env_v2.ts` - USUNAC caly plik
- `server/data/.json` - USUNAC (pusty plik)

**Pliki do NIE ruszania:**
- Root `node_modules/`, `venv/`, `package-lock.json` - te powinny byc dodane do `.gitignore` i usuniete z repo w osobnym tasku (TASK-0.2)

**Acceptance Criteria:**
- [ ] Zero komentarzy zawierajacych fraze "moved to" w WhiteboardCanvas.vue
- [ ] Zero komentarzy zawierajacych "// Commented out" w calym frontend/src/
- [ ] Funkcja `selectObject` nie istnieje w WhiteboardCanvas.vue
- [ ] Pliki `check_env.ts` i `check_env_v2.ts` nie istnieja w `server/`
- [ ] Plik `server/data/.json` nie istnieje
- [ ] `npm run build` przechodzi w frontend/ BEZ bledow
- [ ] `npm run build` przechodzi w server/ BEZ bledow
- [ ] Aplikacja startuje i rysowanie dziala (manual smoke test)

**Definition of Done:**
- Commit: `chore(cleanup): remove dead code, ghost comments, and orphaned files`
- Brak zmian w logice - TYLKO usuniecia

---

### TASK-0.2: Czyszczenie root directory

**Opis:**
Root directory zawiera artefakty ktore nie powinny byc w repo: pusty package.json, node_modules bez sensownego package.json, Python venv, pusty temp/.

**Pliki do zmiany:**
- `package.json` (root) - dodac sensowne workspace scripts LUB usunac
- `.gitignore` - upewnic sie ze `node_modules/`, `venv/`, `temp/` sa ignorowane na root level
- USUNAC z repozytorium (git rm): `node_modules/`, `venv/`, `temp/`, `package-lock.json` na root level

**Acceptance Criteria:**
- [ ] Root `package.json` ma albo sensowne scripts (np. `"dev:all"`) albo nie istnieje
- [ ] Root `package-lock.json` nie istnieje w repo (git tracked)
- [ ] Root `node_modules/` nie jest trackowane przez git
- [ ] Root `venv/` nie jest trackowane przez git
- [ ] Root `temp/` nie jest trackowane przez git
- [ ] `.gitignore` jawnie ignoruje te katalogi na root level
- [ ] `git status` jest czysty po zmianach

**Definition of Done:**
- Commit: `chore(root): clean up root directory, remove tracked artifacts`

---

### TASK-0.3: Usuniecie nieuzywanych dependencies

**Opis:**
`axios` jest w `frontend/package.json` ale nigdzie nie importowany (uzywa raw `fetch()`).
`perfect-freehand` prawdopodobnie tez nie jest uzywany.

**Pliki do zmiany:**
- `frontend/package.json` - usunac `axios` z dependencies

**Wymagana weryfikacja PRZED usunieciem:**
- `grep -r "axios" frontend/src/` musi zwrocic 0 wynikow
- `grep -r "perfect-freehand" frontend/src/` - sprawdzic czy uzywany
- Jesli `perfect-freehand` jest uzywany gdzies w kodzie - NIE USUWAC

**Acceptance Criteria:**
- [ ] `axios` nie istnieje w `frontend/package.json`
- [ ] `npm install` w frontend/ przechodzi bez bledow
- [ ] `npm run build` w frontend/ przechodzi bez bledow
- [ ] Grep na `import.*axios` w frontend/src/ zwraca 0 wynikow (weryfikacja wsteczna)

**Definition of Done:**
- Commit: `chore(deps): remove unused axios dependency from frontend`

---

### TASK-0.4: Eliminacja duplikatu debounce

**Opis:**
`WhiteboardCanvas.vue` definiuje inline funkcje `debounce()` (linia 178-188) mimo ze `throttle` jest juz importowany z `canvasDrawing.js`. Trzeba albo uzyc istniejacego importu, albo wydzielic do utils.

**Pliki do zmiany:**
- `frontend/src/components/WhiteboardCanvas.vue` - usunac inline debounce
- `frontend/src/utils/canvasDrawing.js` - dodac export debounce (jesli nie ma) LUB
- Stworzyc `frontend/src/utils/timing.js` z debounce i throttle

**Acceptance Criteria:**
- [ ] W `WhiteboardCanvas.vue` NIE MA inline definicji `function debounce`
- [ ] Wszystkie uzycia debounce w projekcie korzystaja z jednego importu
- [ ] `npm run build` przechodzi
- [ ] Rysowanie na tablicy dziala bez regresji (smooth drawing, no jank)

**Definition of Done:**
- Commit: `refactor(utils): extract debounce to shared utility, remove inline duplicate`

---

### TASK-0.5: Zastapienie window.confirm() wlasnym dialogiem

**Opis:**
`WhiteboardCanvas.vue` linia ~2183 uzywa synchronicznego `window.confirm()` do potwierdzenia czyszczenia canvas. To blokuje main thread i wyglada niespojernie z reszta UI.

**Pliki do zmiany:**
- `frontend/src/components/WhiteboardCanvas.vue` - zamienic `confirm()` na emit do App.vue
- `frontend/src/components/Dialog.vue` - uzyc istniejacego komponentu Dialog (juz jest w projekcie!)
- `frontend/src/App.vue` - dodac obsluge potwierdzenia czyszczenia

**Acceptance Criteria:**
- [ ] `window.confirm` nie jest uzywany NIGDZIE w frontend/src/
- [ ] Potwierdzenie czyszczenia uzywa komponentu `Dialog.vue`
- [ ] Dialog ma przycisk "Wyczysc" (destructive) i "Anuluj"
- [ ] Dialog jest stylizowany spojnie z reszta UI (glass-panel style)
- [ ] ESC zamyka dialog bez czyszczenia
- [ ] Klikniecie poza dialog zamyka go bez czyszczenia

**Definition of Done:**
- Commit: `fix(ux): replace window.confirm with styled Dialog component for canvas clear`

---

## FAZA 1: Bezpieczenstwo

**Cel:** Zamkniecie krytycznych luk bezpieczenstwa.
**Szacowany czas:** 3-5 dni
**Wymagana wiedza:** Express.js, CSP, kryptografia

---

### TASK-1.1: Naprawienie CSP - usuniecie unsafe-eval i unsafe-inline

**Opis:**
`httpApp.ts` linia 71 ma `scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"]` co anuluje ochrone CSP. Trzeba zidentyfikowac ktore biblioteki wymagaja eval (prawdopodobnie KaTeX lub function-plot) i znalezc alternatywe (nonce-based CSP lub hash-based).

**Pliki do zmiany:**
- `server/src/httpApp.ts` - zmienic CSP directives

**Wymagana analiza PRZED zmiana:**
1. Uruchomic frontend z `'unsafe-eval'` usunietym i sprawdzic console errors
2. Zidentyfikowac ktore biblioteki rzucaja CSP violations
3. Jesli KaTeX wymaga eval - rozwazyc server-side rendering LaTeX
4. Jesli nie da sie calkiem usunac - uzyc nonce-based approach

**Acceptance Criteria:**
- [ ] `'unsafe-eval'` NIE ISTNIEJE w CSP directives
- [ ] `'unsafe-inline'` jest zastapiony nonce-based LUB hash-based approach, LUB usuniety
- [ ] Frontend laduje sie bez bledow CSP w konsoli przegladarki
- [ ] LaTeX rendering dziala (wpisac `$$x^2$$` w chat)
- [ ] Rough.js rendering dziala (narysowac prostokat ze sketchy style)
- [ ] Calculator dziala (otworzyc Shift+K i policzyc cos)
- [ ] Rysowanie pen/shapes dziala normalnie

**Definition of Done:**
- Commit: `fix(security): harden CSP - remove unsafe-eval, implement nonce-based policy`
- Komentarz w kodzie wyjasniajacy dlaczego uzyte podejscie zostalo wybrane

**Uwaga:** Jesli calkowite usuniecie `unsafe-eval` jest niemozliwe z powodu zewnetrznych bibliotek, UDOKUMENTOWAC powod w komentarzu i otworzyc issue na GitHub biblioteki.

---

### TASK-1.2: Eliminacja domyslnych sekretow

**Opis:**
4 pliki uzywaja hardcoded domyslnych sekretow (`'change-me'`, `'change-me-in-prod'`, `'postgres_password'`). W development powinny byc generowane losowo przy starcie.

**Pliki do zmiany:**
- `server/src/config.ts` - wygenerowac losowy secret jesli nie ustawiony (development only)
- `server/src/services/boardTokens.ts` - usunac fallback `'change-me'`, wymagac ustawienia
- `server/src/services/boardService.ts` - usunac fallback `'change-me'`, wymagac ustawienia
- `docker-compose.yml` - uzyc zmiennej `${POSTGRES_PASSWORD:-}` z ostrzezeniem
- `server/.env.example` - dodac wygenerowane przykladowe sekrety z komentarzem

**Acceptance Criteria:**
- [ ] Zaden plik w `server/src/` nie zawiera stringu `'change-me'` (grep test)
- [ ] W development mode: sekrety sa automatycznie generowane z `crypto.randomBytes(32)`
- [ ] W development mode: WARNING w logach ze uzywane sa auto-generated secrets
- [ ] W production mode: brak sekretu = HARD FAIL (juz jest, zweryfikowac)
- [ ] `docker-compose.yml` uzywa `${POSTGRES_PASSWORD}` z env
- [ ] `.env.example` zawiera instrukcje generowania sekretow
- [ ] Server startuje w dev mode bez zadnych env vars (auto-generate)
- [ ] Server CRASHUJE w production mode bez wymaganych sekretow

**Definition of Done:**
- Commit: `fix(security): eliminate hardcoded default secrets, auto-generate in development`

---

### TASK-1.3: Per-route JSON body limit

**Opis:**
`express.json({ limit: '20mb' })` jest zastosowany globalnie. Tylko endpointy AI ze screenshotami potrzebuja duzego limitu.

**Pliki do zmiany:**
- `server/src/httpApp.ts` - zmienic globalny limit na 1MB
- `server/src/httpApp.ts` - dodac per-route `express.json({ limit: '20mb' })` TYLKO dla `/api/ai/*`

**Acceptance Criteria:**
- [ ] Globalny `express.json()` ma limit `'1mb'`
- [ ] Endpointy `/api/ai/chat`, `/api/ai/board-assistant`, `/api/ai/vision-chat` maja limit `'20mb'`
- [ ] POST na `/api/rooms` z payloadem >1MB zwraca 413 (Payload Too Large)
- [ ] POST na `/api/ai/chat` z payloadem 5MB (screenshot) dziala poprawnie
- [ ] Wszystkie istniejace endpointy dzialaja normalnie

**Definition of Done:**
- Commit: `fix(security): apply per-route JSON body limits, restrict global to 1MB`

---

### TASK-1.4: WebSocket origin validation

**Opis:**
`WebSocketServer` w `server.ts` nie sprawdza headera `Origin` przy upgrade. Dowolna strona moze otworzyc WS.

**Pliki do zmiany:**
- `server/src/server.ts` - dodac `verifyClient` callback do WebSocketServer
- `server/src/config.ts` - dodac `allowedWsOrigins` config

**Acceptance Criteria:**
- [ ] WebSocket connections z nieznanych originow sa odrzucane z kodem 403
- [ ] WebSocket connections z dozwolonego origin (CORS_ORIGIN env var) sa akceptowane
- [ ] W development mode (bez CORS_ORIGIN) - wszystkie originy dozwolone (backward compatible)
- [ ] W production mode - tylko explicite dozwolone originy
- [ ] Frontend nadal laczy sie przez WebSocket bez problemow
- [ ] Log entry dla odrzuconych polaczen (origin, IP)

**Definition of Done:**
- Commit: `fix(security): add WebSocket origin validation via verifyClient`

---

### TASK-1.5: Zamiana fail-open na fail-closed

**Opis:**
`server.ts` linia 286-288: jesli DB jest niedostepna, `isBoardRoom` jest ustawiane na `false`, co omija auth. Powinno byc fail-closed (odrzucic polaczenie).

**Pliki do zmiany:**
- `server/src/server.ts` - zmienic catch block na close z kodem 1011

**Acceptance Criteria:**
- [ ] Jesli `boardPersistence.isBoardRoom()` rzuci blad -> WS close z kodem 1011
- [ ] Log entry z bledem (ale NIE z tokenem ani innymi secrets)
- [ ] Normalne pokoje (nie-board) nadal dzialaja gdy DB jest niedostepna
- [ ] Board rooms dzialaja gdy DB jest dostepna
- [ ] Board rooms sa ODRZUCANE gdy DB jest niedostepna (zamiast fail-open)

**Definition of Done:**
- Commit: `fix(security): change isBoardRoom from fail-open to fail-closed on DB error`

---

## FAZA 2: Vue Router + Pinia

**Cel:** Fundamentalna zmiana architektury frontendu - centralizacja stanu i routing.
**Szacowany czas:** 1-2 tygodnie
**Wymagana wiedza:** Vue 3, Vue Router 4, Pinia

---

### TASK-2.1: Instalacja i konfiguracja Vue Router

**Opis:**
Zainstalowac `vue-router@4`, stworzyc konfiguracje routera z 4 lazy-loaded routes, zamienic manualny routing w Root.vue.

**Nowe pliki:**
- `frontend/src/router/index.ts` - konfiguracja routera

**Pliki do zmiany:**
- `frontend/src/main.js` - dodac `app.use(router)`
- `frontend/src/Root.vue` - zamienic manualne `computed` na `<router-view>`
- `frontend/package.json` - dodac `vue-router`

**Routes do zdefiniowania:**
```
/                          -> App.vue (whiteboard + lobby)
/board/:slug               -> StudentBoardEntry.vue (lazy)
/s/:slug                   -> redirect do /board/:slug
/teacher/dashboard          -> TeacherDashboard.vue (lazy)
/admin/teachers             -> AdminTeachersPanel.vue (lazy)
/:pathMatch(.*)*            -> 404 (nowy komponent lub redirect do /)
```

**Acceptance Criteria:**
- [ ] `vue-router` jest w `package.json` dependencies
- [ ] `frontend/src/router/index.ts` istnieje z TypeScript definicja routes
- [ ] Wszystkie 4 widoki (whiteboard, student, teacher, admin) dzialaja przez nowe routes
- [ ] `Root.vue` uzywa `<router-view>` zamiast manualnego `v-if`/`v-else`
- [ ] Routes `/teacher/dashboard` i `/admin/teachers` sa lazy-loaded (`() => import(...)`)
- [ ] URL `/board/test-slug` renderuje StudentBoardEntry z poprawnym slugiem
- [ ] URL `/nieistniejacy` renderuje 404 lub redirect
- [ ] Nawigacja przegladarki (back/forward) dziala
- [ ] `npm run build` generuje osobne chunki dla lazy routes (zweryfikowac w dist/)
- [ ] Bundle rozmiaru lazy-loaded routes < 50KB kazdy (nie laduja calego whiteboardu)

**Definition of Done:**
- Commit: `feat(router): add Vue Router with lazy-loaded routes, replace manual pathname routing`

---

### TASK-2.2: Instalacja i konfiguracja Pinia

**Opis:**
Zainstalowac `pinia`, stworzyc 3 core stores ktore zastąpią stan rozproszony po ref() w App.vue.

**Nowe pliki:**
- `frontend/src/stores/toolStore.ts` - stan narzedzi rysowania
- `frontend/src/stores/roomStore.ts` - stan pokoju i polaczenia
- `frontend/src/stores/uiStore.ts` - stan UI (dark mode, debug, panele)

**Pliki do zmiany:**
- `frontend/src/main.js` - dodac `app.use(createPinia())`
- `frontend/package.json` - dodac `pinia`

**Store: useToolStore:**
```typescript
// Stan do przeniesienia z App.vue ref():
interface ToolState {
  currentTool: string          // 'pen' | 'select' | 'eraser' | 'shapes' | 'lines' | 'text' | 'pan' | ...
  currentColor: string         // hex color
  currentFillColor: string | null
  currentLineWidth: number
  currentShape: string         // 'rectangle' | 'circle' | ...
  currentLineStyle: string     // 'solid' | 'dashed' | 'dotted'
  currentArrowStyle: string    // 'none' | 'end' | 'start' | 'both'
  currentRoughness: number     // 0 | 1 | 2
  activePenPresetKey: string
}
```

**Store: useRoomStore:**
```typescript
interface RoomState {
  roomId: string | null
  username: string
  wsToken: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
  userRole: 'teacher' | 'student' | null
  activeUsersCount: number
}
```

**Store: useUIStore:**
```typescript
interface UIState {
  darkMode: boolean
  debugMode: boolean
  activeFeature: string | null   // 'gridAlign' | 'styleHandwriting' | 'mathRecognizer' | null
  toolbarCollapsed: boolean
  userInfoCollapsed: boolean
  showMathGraphPanel: boolean
  showPhysicsGraphPanel: boolean
  showDiagramPanel: boolean
  showChemistryPanel: boolean
  showCalculator: boolean
}
```

**Acceptance Criteria:**
- [ ] `pinia` jest w `package.json` dependencies
- [ ] 3 store pliki istnieja w `frontend/src/stores/`
- [ ] Kazdy store jest napisany w TypeScript z pelnym typowaniem interface
- [ ] Kazdy store uzywa `defineStore` z setup syntax (Composition API style)
- [ ] Stores sa NIEZALEZNE od siebie (zero circular dependencies)
- [ ] `npm run build` przechodzi
- [ ] Stores NIE SA JESZCZE UZYWANE przez komponenty (to jest nastepny task)
- [ ] Kazdy store ma odpowiednie actions (setters z walidacja)
- [ ] `useToolStore` ma localStorage persistence dla wybranych properties (color, lineWidth)
- [ ] `useRoomStore` ma localStorage persistence dla username
- [ ] `useUIStore` ma localStorage persistence dla darkMode, toolbarCollapsed

**Definition of Done:**
- Commit: `feat(state): add Pinia stores for tools, room, and UI state`

---

### TASK-2.3: Migracja App.vue na Pinia stores

**Opis:**
Zamienic lokalne `ref()` w App.vue na uzycie Pinia stores. To jest NAJWIEKSZA zmiana w tej fazie - eliminuje props drilling.

**Pliki do zmiany:**
- `frontend/src/App.vue` - zamienic ~30 ref() na store getters/actions
- `frontend/src/components/WhiteboardCanvas.vue` - zamienic props na store access
- `frontend/src/components/ToolBar.vue` - zamienic props/emits na store access
- `frontend/src/components/TopMenu.vue` - zamienic emits na store actions
- Kazdy komponent ktory otrzymywal props z App.vue

**Acceptance Criteria:**
- [ ] App.vue NIE MA ref() dla: currentTool, currentColor, currentLineWidth, currentShape, currentLineStyle, currentArrowStyle, currentRoughness, currentFillColor
- [ ] App.vue NIE MA ref() dla: darkMode, debugMode, activeFeature, toolbarCollapsed
- [ ] App.vue NIE MA ref() dla: showMathGraphPanel, showPhysicsGraphPanel, showDiagramPanel, showChemistryPanel
- [ ] WhiteboardCanvas.vue NIE PRZYJMUJE props: currentShape, currentLineStyle, currentArrowStyle, currentRoughness, currentFillColor, activeFeature, debugMode
- [ ] WhiteboardCanvas.vue uzywa `useToolStore()` i `useUIStore()` zamiast props
- [ ] ToolBar.vue uzywa `useToolStore()` zamiast props i emits
- [ ] KAZDE narzedzie rysowania dziala identycznie jak przed zmiana (smoke test):
  - Pen z roznym kolorem i gruboscia
  - Shapes (rectangle, circle, triangle) z fill color
  - Line z arrowheads
  - Eraser
  - Select + move/resize
  - Text tool
  - Pan tool
- [ ] Zmiana narzedzia w ToolBar natychmiast widoczna w Canvas (reaktywnosc)
- [ ] Zmiana koloru natychmiast widoczna w Canvas
- [ ] Dark mode toggle dziala
- [ ] Panel toggles dzialaja (Math, Physics, Diagram, Chemistry)
- [ ] `npm run build` przechodzi
- [ ] Redukcja LOC w App.vue o minimum 200 linii

**Definition of Done:**
- Commit: `refactor(state): migrate App.vue local refs to Pinia stores, eliminate props drilling`
- Manual smoke test: rysowanie, narzedzia, panele, dark mode

---

### TASK-2.4: Dodanie navigation guards

**Opis:**
Dodac guards sprawdzajace auth przed wejsciem na `/admin/teachers` i `/teacher/dashboard`.

**Pliki do zmiany:**
- `frontend/src/router/index.ts` - dodac `beforeEnter` guards

**Acceptance Criteria:**
- [ ] `/admin/teachers` wymaga jakiejs formy autoryzacji (np. check localStorage/cookie)
- [ ] `/teacher/dashboard` wymaga teacher session cookie
- [ ] Niezalogowany uzytkownik jest przekierowany na strone glowna z komunikatem
- [ ] Zalogowany uzytkownik normalnie widzi dashboard/admin

**Definition of Done:**
- Commit: `feat(auth): add navigation guards for teacher and admin routes`

---

## FAZA 3: Dekompozycja God Components

**Cel:** Rozbicie WhiteboardCanvas.vue (2786 LOC) i App.vue (2128 LOC) na mniejsze, testowalne czesci.
**Szacowany czas:** 2-3 tygodnie
**Wymagana wiedza:** Vue 3 Composition API, refactoring patterns

---

### TASK-3.1: Wydzielenie InlineTextEditor.vue

**Opis:**
Wydzielic logike edytora tekstu inline (textarea overlay) z WhiteboardCanvas.vue do osobnego komponentu.

**Nowe pliki:**
- `frontend/src/components/InlineTextEditor.vue`

**Pliki do zmiany:**
- `frontend/src/components/WhiteboardCanvas.vue` - usunac logike tekstu, uzyc nowego komponentu

**Zakres do wydzielenia (z WhiteboardCanvas.vue):**
- Reactive state: `inlineTextEditor` (linia 276-284)
- Ref: `inlineTextRef` (linia 285)
- Function: `focusInlineEditor` (linia 286-302)
- Computed: `inlineTextStyle` (linia 305-330)
- Function: `addTextElement` (linia 1761-1806)
- Function: `startInlineText` (linia 1808-1822)
- Function: `finalizeInlineText` (linia 1824-1833)
- Function: `handleInlineTextEnter` (linia 1836-1841)
- Template: textarea element (linia 70-82)

**Acceptance Criteria:**
- [ ] `InlineTextEditor.vue` istnieje i jest < 200 LOC
- [ ] `InlineTextEditor.vue` uzywa `<script setup lang="ts">`
- [ ] WhiteboardCanvas.vue jest krotszy o minimum 200 LOC
- [ ] Wpisywanie tekstu na tablicy dziala identycznie:
  - Klikniecie narzedzia text -> klikniecie na canvas -> pojawia sie textarea
  - Wpisanie tekstu + Enter -> tekst pojawia sie na tablicy
  - Shift+Enter -> nowa linia w edytorze
  - Blur (klikniecie poza) -> tekst dodany
  - ESC -> anulowanie
- [ ] Tekst jest widoczny dla innych uzytkownikow (Yjs sync)
- [ ] Undo/Redo dziala dla tekstu
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(canvas): extract InlineTextEditor into standalone component`

---

### TASK-3.2: Wydzielenie useCanvasRenderer composable

**Opis:**
Wydzielic logike renderowania canvas (redrawStatic, redrawDynamic, render loop) do osobnego composable.

**Nowe pliki:**
- `frontend/src/composables/useCanvasRenderer.js` (lub .ts jesli juz w fazie TS)

**Zakres do wydzielenia:**
- `redrawStatic()` (linia 742-817)
- `redrawDynamic()` (linia 819-972)
- `invalidate()`, `redrawCanvas()`, `scheduleRedraw()` (linia 980-991)
- `renderLoop()` (linia 993-1007)
- `updateLocalScene()` (linia 663-693)
- `isElementVisible()` (linia 695-740)
- Stale: `ALWAYS_DOM_TYPES`, `CONTENT_RENDER_TYPES` (linia 1013-1039)

**Acceptance Criteria:**
- [ ] Composable `useCanvasRenderer` istnieje i jest < 400 LOC
- [ ] WhiteboardCanvas.vue jest krotszy o minimum 300 LOC
- [ ] Canvas rendering dziala identycznie:
  - Rysowanie pen wyglada tak samo
  - Shapes (rectangle, circle) renderuja sie poprawnie
  - Eraser hover highlight dziala
  - Grid jest widoczny
  - Snap indicators dzialaja
  - Connector dots dzialaja przy narzedziu line
- [ ] Performance: render loop utrzymuje 60fps przy 50 elementach
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(canvas): extract rendering logic into useCanvasRenderer composable`

---

### TASK-3.3: Wydzielenie useCanvasInput composable

**Opis:**
Wydzielic mouse/touch event handling do osobnego composable. Obecnie te handlery to ~350 LOC z duplikacja miedzy mouse i touch.

**Nowe pliki:**
- `frontend/src/composables/useCanvasInput.js`

**Zakres do wydzielenia:**
- `getCoordinates()` (linia 1430-1443)
- `transformCoordinates()` (linia 1445-1450)
- `handleMouseDown()` (linia 1523-1603)
- `handleMouseMove()` (linia 1466-1521)
- `handleMouseUp()` (linia 1606-1626)
- `handleMouseLeave()` (linia 1634-1656)
- `handleTouchStart()` (linia 1658-1677)
- `handleTouchMove()` (linia 1679-1732)
- `handleTouchEnd()` (linia 1734-1756)
- `handleWindowMouseUp()` (linia 1628-1632)
- Pinch gesture: `startPinchGesture`, `updatePinchGesture`, `endTouchGesture` (linia 1360-1416)

**Dodatkowe wymaganie: eliminacja duplikacji touch/mouse:**
- Wydzielic `processEraserAt(coords)` uzywany przez OBA handlery (zamiast zduplikowanego kodu)
- Touch handlers powinny delegowac do wspolnych metod zamiast kopiowac logike

**Acceptance Criteria:**
- [ ] Composable `useCanvasInput` istnieje
- [ ] WhiteboardCanvas.vue jest krotszy o minimum 300 LOC
- [ ] BRAK zduplikowanej logiki eraser miedzy mouse i touch handlers
- [ ] Wszystkie interakcje dzialaja:
  - Mouse: rysowanie, klikanie, panning, zooming (scroll)
  - Touch (testowac w DevTools mobile mode): rysowanie jednym palcem
  - Touch: pinch zoom dwoma palcami
  - Touch: eraser dziala na tablecie
  - Right-click: selekcja obiektu
  - Alt+click: panning
  - Space+drag: panning
  - Middle mouse: panning
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(canvas): extract input handling into useCanvasInput, deduplicate touch/mouse`

---

### TASK-3.4: Centralizacja definicji typow elementow

**Opis:**
Element type listy (np. `Set(['rectangle', 'circle', ...])`) sa zduplikowane w 5 plikach. Stworzyc centralny plik z definicjami.

**Nowe pliki:**
- `frontend/src/types/elementTypes.ts`

**Struktura:**
```typescript
export interface ElementTypeConfig {
  name: string;
  category: 'shape' | 'line' | 'content' | 'special';
  hasDOM: boolean;           // Czy potrzebuje MovableObject overlay
  isMovable: boolean;        // Czy mozna przesuwac
  contentRenderedInDOM: boolean; // Czy content renderowany w DOM (nie canvas)
  shapeTool: boolean;        // Czy uzywa start/end points
}

export const ELEMENT_TYPES: Record<string, ElementTypeConfig> = { ... };

// Derived sets (zamiast manualnych Set() w kazdym pliku):
export const MOVABLE_TYPES = new Set(...);
export const ALWAYS_DOM_TYPES = new Set(...);
export const CONTENT_RENDER_TYPES = new Set(...);
export const SHAPE_TOOLS = new Set(...);
```

**Pliki do zmiany:**
- `frontend/src/components/WhiteboardCanvas.vue` - importowac z elementTypes.ts
- `frontend/src/components/MovableObject.vue` - importowac z elementTypes.ts
- `frontend/src/composables/useDrawingEngine.js` - importowac z elementTypes.ts
- `frontend/src/utils/canvasTools.js` - importowac z elementTypes.ts

**Acceptance Criteria:**
- [ ] `frontend/src/types/elementTypes.ts` istnieje
- [ ] ZERO manualnych `new Set(['rectangle', 'circle', ...])` w komponentach (grep test)
- [ ] Dodanie nowego typu elementu wymaga zmiany TYLKO w `elementTypes.ts`
- [ ] Wszystkie ksztalty renderuja sie poprawnie
- [ ] MovableObject overlay pojawia sie dla wlasciwych typow
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(types): centralize element type definitions, eliminate 5x duplication`

---

### TASK-3.5: Migracja WhiteboardCanvas do script setup

**Opis:**
Zamienic `export default { name, components, props, emits, setup() }` na `<script setup>` z `defineProps`, `defineEmits`, `defineExpose`.

**Pliki do zmiany:**
- `frontend/src/components/WhiteboardCanvas.vue`

**Prerequisite:** TASK-2.3 (Pinia) musi byc ukonczony - wiele propsow juz nie bedzie potrzebnych.

**Acceptance Criteria:**
- [ ] WhiteboardCanvas.vue uzywa `<script setup>` (lub `<script setup lang="ts">`)
- [ ] Brak `export default { }` wrappera
- [ ] `defineProps` zamiast `props: { }` w obiekcie
- [ ] `defineEmits` zamiast `emits: [ ]` w obiekcie
- [ ] `defineExpose` zamiast `expose` w setup return
- [ ] Brak `name: 'WhiteboardCanvas'` (automatycznie z nazwy pliku)
- [ ] Brak `components: { }` (auto-import lub explicit import w script)
- [ ] Wszystkie funkcjonalnosci dzialaja identycznie
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(canvas): migrate WhiteboardCanvas.vue to script setup syntax`

---

## FAZA 4: TypeScript Migration

**Cel:** Dodanie type safety do frontendu.
**Szacowany czas:** 2-3 tygodnie
**Wymagana wiedza:** TypeScript, Vue 3 types

---

### TASK-4.1: Konfiguracja TypeScript frontendu

**Opis:**
Dodac/poprawic `tsconfig.json` z strict mode, skonfigurowac Vite do TypeScript.

**Nowe/zmieniane pliki:**
- `frontend/tsconfig.json`
- `frontend/tsconfig.node.json`
- `frontend/vite.config.js` -> `vite.config.ts`

**Acceptance Criteria:**
- [ ] `frontend/tsconfig.json` ma `strict: true`
- [ ] `frontend/tsconfig.json` ma `noUncheckedIndexedAccess: true`
- [ ] `npm run build` przechodzi (moze wymagac dodania `// @ts-nocheck` w starych .js plikach tymczasowo)
- [ ] Nowe pliki .ts sa poprawnie kompilowane
- [ ] IDE (VS Code) pokazuje typy poprawnie w .vue plikach

**Definition of Done:**
- Commit: `feat(typescript): configure TypeScript for frontend with strict mode`

---

### TASK-4.2: Typy elementow i board state

**Opis:**
Stworzyc centralne definicje TypeScript dla elementow tablicy, board state, i API responses. Te typy powinny byc uzywane zarowno na frontendzie jak i (docelowo) na backendzie.

**Nowe pliki:**
- `frontend/src/types/element.ts` - typy elementow (pen, shape, text, image, latex, etc.)
- `frontend/src/types/board.ts` - typy board state, room, user
- `frontend/src/types/api.ts` - typy API responses

**Acceptance Criteria:**
- [ ] `BoardElement` jest discriminated union type z polem `type` jako discriminator
- [ ] Kazdy typ elementu (PenElement, RectangleElement, TextElement, etc.) ma wlasny interface
- [ ] Wspolne pola (id, x, y, width, height, color, rotation) sa w base interface
- [ ] Typy sa EKSPORTOWANE i dostepne dla importu
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `feat(types): add TypeScript type definitions for board elements and API`

---

### TASK-4.3: Migracja composables na TypeScript

**Opis:**
Migrowac composables z .js na .ts, dodajac pelne typowanie.

**Kolejnosc migracji (od najprostszego):**
1. `useNotifications.js` -> `.ts` (29 LOC, pure logic)
2. `useUndoRedo.js` -> `.ts` (91 LOC, Yjs types)
3. `useAiStore.js` -> `.ts` (94 LOC, reactive singleton)
4. `usePdfImport.js` -> `.ts` (88 LOC)
5. `useKeyboardShortcuts.js` -> `.ts` (137 LOC)
6. `usePdfExport.js` -> `.ts` (368 LOC)
7. `useHelperModules.js` -> `.ts` (400 LOC)
8. `useLineBindings.js` -> `.ts` (423 LOC)
9. `useDrawingEngine.js` -> `.ts` (701 LOC)

**Acceptance Criteria (per composable):**
- [ ] Plik .js zastapiony plikiem .ts
- [ ] ZERO uzycien `any` (chyba ze wymuszone przez zewnetrzna biblioteke - wtedy komentarz dlaczego)
- [ ] Parametry funkcji maja pelne typy
- [ ] Return type jest jawnie zdefiniowany
- [ ] Importy z tego composable w innych plikach dzialaja
- [ ] `npm run build` przechodzi po kazdym migrowanym pliku
- [ ] Funkcjonalnosc nie zmieniona (pure type migration)

**Definition of Done (calosc):**
- 9 commitow: `refactor(types): migrate useXxx to TypeScript`
- ZERO plikow .js w `frontend/src/composables/`

---

## FAZA 5: Backend Refactoring

**Cel:** Ustrukturyzowanie backendu, eliminacja fat controllera i duplikacji.
**Szacowany czas:** 2-3 tygodnie
**Wymagana wiedza:** Express.js, TypeScript, wzorce projektowe

---

### TASK-5.1: Wydzielenie inline endpointow z httpApp.ts

**Opis:**
Przeniesc 7 inline endpointow do osobnych route files.

**Nowe pliki:**
- `server/src/routes/aiChat.ts` - `/api/ai/chat`, `/api/ai/vision-chat`
- `server/src/routes/aiPdf.ts` - `/api/ai/analyze-pdf`
- `server/src/routes/aiDiagram.ts` - `/api/ai/generate-diagram`, `/api/ai/auto-layout-diagram`
- `server/src/routes/aiSolver.ts` - `/api/ai/solve-equation`
- `server/src/routes/rooms.ts` - room CRUD (`/api/rooms`, `/rooms`)

**Pliki do zmiany:**
- `server/src/httpApp.ts` - zostaje TYLKO middleware setup i router mounting (~100 LOC)

**Acceptance Criteria:**
- [ ] `httpApp.ts` ma MAKSIMUM 150 LOC
- [ ] `httpApp.ts` zawiera TYLKO: middleware setup, router mounting, error handler
- [ ] ZERO inline route handlers w httpApp.ts (poza `/` i `/health`)
- [ ] Kazdy nowy route file < 150 LOC
- [ ] System prompty sa w oddzielnych stalych/plikach, NIE inline w handlerach
- [ ] Wszystkie endpointy dzialaja identycznie (test curl/Postman)
- [ ] `npm run build` przechodzi
- [ ] `npm run test` przechodzi (jesli sa testy)

**Definition of Done:**
- Commit: `refactor(routes): extract inline endpoints from httpApp.ts into route modules`

---

### TASK-5.2: Generyczna funkcja callWithFallback

**Opis:**
Wydzielic powtorzony pattern "try models one by one, fallback on failure" do jednej generycznej funkcji.

**Nowe pliki:**
- `server/src/ai/provider/callWithFallback.ts`

**Pliki do zmiany:**
- `server/src/services/grok.ts` - uzyc callWithFallback
- `server/src/services/aiSolver.ts` - uzyc callWithFallback (3 metody!)

**Acceptance Criteria:**
- [ ] `callWithFallback.ts` istnieje z generyczna funkcja
- [ ] Funkcja akceptuje: liste modeli, messages, options, fetchImpl
- [ ] Funkcja loguje ktory model jest probowany i ktory zawiodl
- [ ] grok.ts uzywa callWithFallback zamiast wlasnego for-loop
- [ ] aiSolver.ts uzywa callWithFallback w callOCR, callSolver, chatWithVision
- [ ] ZERO zduplikowanych for-loop z fallback pattern w projekcie
- [ ] Wszystkie AI endpointy dzialaja (chat, solver, OCR)
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(ai): extract callWithFallback utility, eliminate 4x duplicated fallback pattern`

---

### TASK-5.3: Tool registry zamiast switch/case w boardAgent

**Opis:**
Zamienic 645-liniowy switch/case w `boardAgent.ts` na tool registry (Map z handlerami).

**Nowe pliki:**
- `server/src/ai/agent/toolRegistry.ts`

**Pliki do zmiany:**
- `server/src/ai/agent/boardAgent.ts` - uzyc registry zamiast switch

**Struktura:**
```typescript
interface ToolHandler {
  name: string;
  execute: (doc: BoardDoc, snapshot: BoardSnapshot, args: any) => Promise<BoardPatch> | BoardPatch;
  requiresLLM?: boolean; // Jesli true, dostaje llmClient
}

const toolRegistry = new Map<string, ToolHandler>();
toolRegistry.set('draw_board_patch', { name: '...', execute: toolDrawBoardPatch });
// ...
```

**Acceptance Criteria:**
- [ ] `toolRegistry.ts` istnieje z Map<string, ToolHandler>
- [ ] `boardAgent.ts` NIE ZAWIERA switch/case na tool names
- [ ] boardAgent.ts < 200 LOC (z obecnych 645)
- [ ] Dodanie nowego narzedzia = dodanie 1 wpisu w registry + 1 handler function
- [ ] Wszystkie 16 narzedzi AI dzialaja identycznie
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(ai): replace giant switch/case with tool registry pattern`

---

### TASK-5.4: Ujednolicenie persistencji - DB jako jedyne zrodlo prawdy

**Opis:**
Zdecydowac czy pokoje ad-hoc (z Lobby) powinny tez isc do DB, czy file persistence zostaje jako fallback. Najlepiej: wszystko do DB, FilePersistence jako opcjonalny fallback gdy DB niedostepne (development only).

**Pliki do zmiany:**
- `server/src/rooms.ts` - logika hydratacji
- `server/src/persistence.ts` - dodac adnotacje "development-only fallback"
- `server/src/config.ts` - dodac flage `persistenceMode: 'db' | 'file' | 'hybrid'`

**Acceptance Criteria:**
- [ ] Jasna dokumentacja w config.ts ktory tryb persistencji jest uzywany
- [ ] W production mode: TYLKO DB persistence (file persistence wylaczone)
- [ ] W development mode: file persistence jako fallback gdy brak DATABASE_URL
- [ ] Pokoje tworzone przez Lobby sa trwale (przetrwaja restart serwera)
- [ ] Brak data loss przy przejsciu miedzy trybami
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(persistence): unify persistence strategy, DB as single source of truth`

---

### TASK-5.5: Walidacja inputow API (Zod)

**Opis:**
Dodac `zod` do walidacji API request bodies zamiast manualnych `typeof` checkow.

**Pliki do zmiany:**
- `server/package.json` - dodac `zod`
- Kazdy route file - dodac schematy walidacji

**Priorytet walidacji (od najwazniejszych):**
1. `/api/ai/chat` - message, history, mode
2. `/api/ai/board-assistant` - boardId, message, viewport
3. `/api/rooms` - displayName, ownerName, roomId
4. `/api/teacher/boards` - title, validUntil
5. `/api/admin/teachers/import` - CSV/JSON format

**Acceptance Criteria:**
- [ ] `zod` jest w dependencies
- [ ] Minimum 5 endpointow ma Zod schema validation
- [ ] Bledna walidacja zwraca 400 z czytelnym komunikatem bledu
- [ ] Brak manualnych `typeof req.body?.X === 'string'` w zwalidowanych endpointach
- [ ] Istniejacy klienci nie sa zlamani (backward compatible validation)
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `feat(validation): add Zod schema validation to API endpoints`

---

## FAZA 6: Testy

**Cel:** Minimum viable test coverage.
**Szacowany czas:** 2-3 tygodnie (rownolegla z innymi fazami)
**Wymagana wiedza:** Vitest, Vue Test Utils, Supertest

---

### TASK-6.1: Konfiguracja vitest dla frontendu

**Nowe pliki:**
- `frontend/vitest.config.ts`
- `frontend/src/__tests__/setup.ts` (global test setup)

**Acceptance Criteria:**
- [ ] `npm run test` w frontend/ uruchamia vitest
- [ ] Happy-dom jest skonfigurowany jako test environment
- [ ] Vue Test Utils jest dostepny w testach
- [ ] Przykladowy test `1 + 1 = 2` przechodzi

**Definition of Done:**
- Commit: `test(setup): configure vitest for frontend with happy-dom`

---

### TASK-6.2: Testy unit - utils i composables (pure logic)

**Nowe pliki:**
- `frontend/src/__tests__/utils/geometry.test.ts`
- `frontend/src/__tests__/utils/canvasGrid.test.ts`
- `frontend/src/__tests__/composables/useNotifications.test.ts`
- `frontend/src/__tests__/utils/serializer.test.ts`

**Acceptance Criteria:**
- [ ] `geometry.ts` - 100% coverage (isPointInRotatedRectangle)
- [ ] `canvasGrid.ts` - 80%+ coverage (computeGridSteps, drawGrid)
- [ ] `useNotifications` - 100% coverage (showStatus, showToast)
- [ ] `serializer.ts` - 80%+ coverage (serialize, deserialize, compact)
- [ ] Wszystkie testy przeczhodza (`npm run test`)
- [ ] Testy sa deterministyczne (brak flaky tests)

**Definition of Done:**
- Commit: `test(unit): add unit tests for geometry, canvasGrid, useNotifications, serializer`

---

### TASK-6.3: Testy integration - backend API

**Nowe pliki:**
- `server/src/__tests__/routes/rooms.test.ts`
- `server/src/__tests__/routes/health.test.ts`
- `server/src/__tests__/services/boardTokens.test.ts`
- `server/src/__tests__/services/teacherSessions.test.ts`

**Acceptance Criteria:**
- [ ] Health endpoint test: GET /health returns 200
- [ ] Room CRUD test: create, get, update, archive
- [ ] Token test: create + verify + expired token rejection
- [ ] Session test: create + verify + expired session rejection
- [ ] Rate limiter test: exceed limit returns 429
- [ ] Testy uzywaja `supertest` dla HTTP i mocki dla DB
- [ ] Wszystkie testy przeczhodza (`npm run test`)

**Definition of Done:**
- Commit: `test(api): add integration tests for rooms, health, tokens, and sessions`

---

## FAZA 7: Performance i DX

**Cel:** Optymalizacja bundle, observability, CI/CD.
**Szacowany czas:** 1-2 tygodnie
**Wymagana wiedza:** Vite, webpack analysis, GitHub Actions

---

### TASK-7.1: Lazy loading ciezkich bibliotek

**Pliki do zmiany:**
- `frontend/src/main.js` - usunac globalny import katex CSS
- `frontend/src/components/MovableObject.vue` - lazy import katex
- `frontend/src/components/AIChatPanel.vue` - lazy import html2canvas
- `frontend/src/composables/usePdfImport.js` - sprawdzic czy pdfjs-dist jest juz lazy

**Acceptance Criteria:**
- [ ] `katex/dist/katex.min.css` NIE jest importowany w main.js
- [ ] KaTeX CSS jest ladowany TYLKO gdy komponent z LaTeX jest renderowany
- [ ] `html2canvas` jest ladowany TYLKO gdy uzytkownik robi screenshot
- [ ] Initial bundle size (main chunk) zmniejszony o minimum 200KB (zmierzyc przed/po)
- [ ] LaTeX rendering nadal dziala (testowac po lazy load)
- [ ] Screenshot AI nadal dziala
- [ ] `npm run build` przechodzi
- [ ] `npm run build` output pokazuje osobne chunki dla katex, html2canvas

**Definition of Done:**
- Commit: `perf(bundle): lazy load katex, html2canvas - reduce initial bundle by ~300KB`
- Dolaczony screenshot/log z porownaniem bundle size przed i po

---

### TASK-7.2: drawPolygon helper - eliminacja copy-paste w canvasDrawing

**Opis:**
Wydzielic wspolny pattern renderowania polygonow (beginPath, moveTo, lineTo, closePath, fill, stroke) do helpera.

**Pliki do zmiany:**
- `frontend/src/utils/canvasDrawing.js` - dodac `drawPolygon()`, zrefaktoryzowac case'y

**Acceptance Criteria:**
- [ ] Funkcja `drawPolygon(ctx, points, options, rc, isClean)` istnieje
- [ ] Minimum 8 case'ow w switch (triangle, trapezoid, parallelogram, deltoid, diamond, ...) uzywa `drawPolygon`
- [ ] `canvasDrawing.js` jest krotszy o minimum 150 LOC
- [ ] Wszystkie ksztalty renderuja sie identycznie (visual regression test - porownac screenshoty)
- [ ] Fill color dziala dla kazdego ksztaltu
- [ ] Sketchy (roughness > 0) i clean (roughness = 0) mode dzialaja
- [ ] `npm run build` przechodzi

**Definition of Done:**
- Commit: `refactor(drawing): extract drawPolygon helper, eliminate 12x copy-paste pattern`

---

### TASK-7.3: CI/CD Pipeline (GitHub Actions)

**Nowe pliki:**
- `.github/workflows/ci.yml`

**Acceptance Criteria:**
- [ ] Pipeline uruchamia sie na kazdym push i PR
- [ ] Steps: install -> lint (jesli eslint skonfigurowany) -> build frontend -> build server -> test frontend -> test server
- [ ] Pipeline FAILUJE jesli build lub testy nie przechodza
- [ ] Pipeline trwa < 5 minut
- [ ] Badge statusu w README.md

**Definition of Done:**
- Commit: `ci: add GitHub Actions workflow for build and test`

---

## Zaleznosci miedzy taskami

```
FAZA 0 (Quick Wins)
  0.1 ──> 0.2 ──> 0.3 ──> 0.4 ──> 0.5
  (kazdy niezalezny, ale wygodniej sekwencyjnie)

FAZA 1 (Security)
  1.1, 1.2, 1.3, 1.4, 1.5 - wszystkie niezalezne, mozna rownolegle

FAZA 2 (Router + Pinia)
  2.1 (Router) ──> 2.4 (Guards)
  2.2 (Pinia setup) ──> 2.3 (Migration) ──> zalezy od 2.1 i 2.2

FAZA 3 (Decomposition) - WYMAGA ukonczenia 2.3
  3.1, 3.2, 3.3, 3.4 - moga byc rownoleglejne
  3.5 (script setup) ──> wymaga 3.1, 3.2, 3.3

FAZA 4 (TypeScript) - WYMAGA ukonczenia 3.4 (typy elementow)
  4.1 ──> 4.2 ──> 4.3 (sekwencyjnie)

FAZA 5 (Backend) - niezalezna od frontendu
  5.1 ──> 5.2 (po wydzieleniu routeow latwiej refaktoryzowac)
  5.3 (niezalezny)
  5.4 (niezalezny)
  5.5 ──> wymaga 5.1

FAZA 6 (Testy) - mozna zaczac rownolegle z faza 3+
  6.1 ──> 6.2 (frontend testy)
  6.3 (backend testy - niezalezne)

FAZA 7 (Perf) - niezalezna, po fazie 3
  7.1, 7.2, 7.3 - niezalezne
```

---

## Metryki sukcesu (po ukonczeniu wszystkich faz)

| Metryka | Przed | Cel |
|---------|-------|-----|
| Najwiekszy komponent | 2786 LOC | < 500 LOC |
| App.vue | 2128 LOC | < 400 LOC |
| httpApp.ts | 559 LOC | < 150 LOC |
| Frontend TypeScript coverage | ~10% | > 80% |
| Test coverage (frontend) | 0% | > 40% |
| Test coverage (backend) | ~10% | > 50% |
| Initial bundle size | ~2.5MB | < 1.5MB |
| Props na WhiteboardCanvas | 17 | < 5 |
| CSP unsafe-eval | TAK | NIE |
| Hardcoded secrets | 4 | 0 |

---

*Dokument zawiera 31 taskow w 7 fazach. Kazdy task ma jasne acceptance criteria i definition of done.
Szacowana calkowita pracochonnosc: 10-14 tygodni (1 developer full-time).*
