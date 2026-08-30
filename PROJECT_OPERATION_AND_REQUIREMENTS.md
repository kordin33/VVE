# WhiteVue - opis dzialania i wymagania z kodu

Data odtworzenia: 2026-05-18

Ten dokument opisuje projekt na podstawie aktualnego kodu. To nie jest deklaracja biznesowa od wlasciciela produktu, tylko stan wywnioskowany z implementacji, testow i konfiguracji.

## 1. Cel produktu

WhiteVue jest aplikacja do wspolnej pracy na tablicy online. Glowny ekran tworzy lub otwiera pokoj whiteboard, pozwala rysowac po canvasie, przesuwac i edytowac obiekty, korzystac z AI oraz udostepniac tablice innym osobom.

Projekt ma tez tryb nauczyciel/uczen:
- administrator dodaje nauczycieli i generuje stale linki logowania,
- nauczyciel tworzy tablice dla uczniow,
- uczen otwiera publiczny link tablicy z tokenem,
- backend wydaje token WebSocket dla danej tablicy i roli.

## 2. Glowne powierzchnie aplikacji

### Peer whiteboard

Wejscie: `/`

Kod: `frontend/src/App.vue`, `frontend/src/components/WhiteboardCanvas.vue`, `frontend/src/services/connectToYjs.ts`

Zachowanie:
- jesli URL nie zawiera pokoju, frontend automatycznie generuje nowy `roomId` i klucz szyfrowania w hashu `#room=...`,
- tablica laczy sie przez WebSocket `/ws/whiteboard/:roomId`,
- stan rysunkow jest trzymany w Yjs `Y.Array('drawings')`,
- rysowanie i edycja dzialaja lokalnie nawet gdy backend nie odpowiada, ale kolaboracja i lista pokoi wtedy nie dzialaja.

### Panel nauczyciela

Wejscie: `/teacher/dashboard`

Kod: `frontend/src/views/TeacherDashboard.vue`, `server/src/routes/teacherAuth.ts`, `server/src/routes/teacherBoards.ts`

Zachowanie:
- nauczyciel loguje sie linkiem magicznym albo stalym tokenem,
- backend ustawia cookie sesji `teacher_session`,
- panel pokazuje tablice nauczyciela, pozwala tworzyc nowa tablice, kopiowac link ucznia i archiwizowac/przywracac tablice.

### Wejscie ucznia

Wejscie: `/board/:slug` albo `/s/:slug`

Kod: `frontend/src/views/StudentBoardEntry.vue`, `server/src/routes/boardAccess.ts`, `server/src/middleware/boardStudentAuth.ts`

Zachowanie:
- uczen otwiera link z `token`,
- backend sprawdza token ucznia i zwraca dane tablicy plus krotkozyjacy `wsToken`,
- frontend przekierowuje na `/?room=<boardId>&wsToken=<token>&name=<studentName>`,
- w trybie ucznia panel AI jest ukryty, a backend blokuje tokeny roli `student` dla wybranych endpointow AI.

### Panel administratora

Wejscie: `/admin/teachers`

Kod: `frontend/src/views/AdminTeachersPanel.vue`, `server/src/routes/adminTeachers.ts`, `server/src/httpApp.ts`

Zachowanie zamierzone z kodu:
- admin pobiera liste nauczycieli,
- dodaje nauczyciela recznie albo z CSV,
- generuje stale linki nauczyciela.

Uwaga: backend wymaga `x-admin-secret`, ale frontend aktualnie nie wysyla tego naglowka. W praktyce panel admina nie ma kompletnej sciezki autoryzacji po stronie UI.

## 3. Funkcje tablicy

Kod centralny:
- `frontend/src/components/WhiteboardCanvas.vue`
- `frontend/src/composables/useDrawingEngine.js`
- `frontend/src/components/MovableObject.vue`
- `frontend/src/utils/canvasDrawing.js`
- `frontend/src/utils/canvasTools.js`

Funkcje:
- rysowanie pen, linii, strzalek, ksztaltow i tekstu,
- przesuwanie, skalowanie i obracanie obiektow,
- gumka i usuwanie elementow,
- zoom/pan,
- undo/redo oparte o Yjs UndoManager,
- import/eksport whiteboard,
- eksport PDF,
- import PDF jako obraz/strony,
- presety piora i paleta kolorow,
- grid align,
- handwriting styler,
- math recognizer,
- panele matematyczne, fizyczne, diagramow i chemii.

## 4. AI i modele

Kod:
- `frontend/src/components/AIChatPanel.vue`
- `frontend/src/composables/useAiStore.js`
- `server/src/routes/aiBoardAssistant.ts`
- `server/src/httpApp.ts`
- `server/src/ai/**`
- `server/src/services/aiSolver.ts`
- `server/src/services/grok.ts`

Funkcje:
- chat AI z opcjonalnym screenshotem tablicy,
- board agent modyfikujacy tablice przez patch Yjs,
- OCR/rozpoznawanie matematyki,
- solver rownan,
- generowanie diagramow/layoutu.

Wymagania srodowiskowe:
- `OPENROUTER_API_KEY` dla funkcji AI,
- modele konfigurowane przez env, m.in. `BOARD_AI_MODEL`, `SOLVER_MODEL`, `OCR_MODEL`.

## 5. Backend i dane

Backend:
- Node.js + Express 5,
- WebSocket `ws`,
- Yjs jako CRDT,
- PostgreSQL przez Knex dla nauczycieli, tablic i Yjs state,
- fallback file persistence dla pokoi peer whiteboard.

Glowne endpointy:
- `GET /health`
- `GET/POST /api/rooms`
- `GET/PATCH/DELETE /api/rooms/:roomId`
- `POST /api/ai/solve-equation/`
- `POST /api/ai/chat`
- `POST /api/ai/board-assistant`
- `GET /teacher/login`
- `GET/POST/PATCH /api/teacher/boards`
- `GET /api/board/:slug`
- `GET /board/:slug`
- `GET /s/:slug`
- `/api/admin/teachers/**`

## 6. Minimalne wymagania funkcjonalne

- Uzytkownik moze otworzyc `/` i dostac gotowa tablice bez recznej konfiguracji.
- Uzytkownik moze rysowac na canvasie i uzywac undo/redo.
- Dwie osoby w tym samym pokoju widza wspolny stan przez WebSocket.
- Link udostepnienia pokoju zawiera identyfikator pokoju i klucz.
- Nauczyciel moze zalogowac sie linkiem i zarzadzac swoimi tablicami.
- Uczen moze wejsc w tablice tylko przez poprawny link/token.
- Student nie powinien miec dostepu do nauczycielskich funkcji AI.
- Admin moze importowac nauczycieli i generowac stale linki, ale UI musi miec sposob podania sekretu admina.
- Eksport/import nie powinien blokowac iPada ani generowac niekontrolowanie duzych plikow.

## 7. Minimalne wymagania niefunkcjonalne

- `npm run build` musi przechodzic w `frontend/` i `server/`.
- Testy unit i E2E powinny byc uruchamialne bez recznego patchowania.
- Start produkcyjny backendu musi odpalac aktualny output TypeScript.
- Sekrety nie moga miec stalych fallbackow w produkcji.
- CSP nie powinno uzywac `unsafe-eval`; `unsafe-inline` powinno byc zastapione nonce/hash lub ograniczone.
- Duze body requesty powinny byc per-route, nie globalnie.
- Endpointy AI musza miec autoryzacje i rate limit wystarczajacy do ochrony kosztow.
- Bledy backendu powinny byc widoczne w UI jako blad, nie jako pusty stan.
- Artefakty testowe (`frontend/test-results/`) nie powinny wchodzic do repo.

## 8. Rzeczy do doprecyzowania przez wlasciciela produktu

- Czy peer whiteboard ma byc w pelni publiczny po samym linku, czy ma miec role/hasla?
- Czy AI chat ma byc dostepny w pokojach peer bez tokenu?
- Czy admin panel ma uzywac jednego sekretu, logowania admina, czy kont nauczycieli z rola admin?
- Czy stale linki nauczycieli faktycznie maja nigdy nie wygasac?
- Czy uczen ma miec jakikolwiek dostep do AI, czy calkowicie nie?
- Jakie limity rozmiaru eksportu PDF sa akceptowalne na iPadzie?
- Czy dane tablic peer maja byc trwale zachowywane, czy czyszczone po TTL?
- Czy PostgreSQL jest wymagany zawsze w produkcji, czy file persistence ma zostac fallbackiem?
