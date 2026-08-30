# WhiteVue - re-audyt codebase i testow

Data: 2026-05-18
Branch: `fix/deep-audit-and-fixes`
Zakres: caly codebase `frontend/`, `server/`, konfiguracja, testy, dokumenty i runtime smoke.

## 1. Co zostalo sprawdzone

- Przeczytane glowne entrypointy: `frontend/src/main.js`, `frontend/src/Root.vue`, `frontend/src/App.vue`, `frontend/src/components/WhiteboardCanvas.vue`, `server/src/server.ts`, `server/src/httpApp.ts`.
- Przejrzane sciezki: peer room, teacher dashboard, student board access, admin teachers, AI chat/agent, WebSocket/Yjs, persistence.
- Uruchomione buildy i testy frontendu oraz backendu.
- Uruchomione smoke testy przez Playwright na desktop i iPad viewport.
- Uruchomiony backend przez `npm start` i sprawdzony `GET /health` oraz `GET /api/rooms`.
- Uruchomiony `npm audit --omit=dev` dla frontendu i backendu.

## 2. Wyniki testow

| Obszar | Komenda / metoda | Wynik |
|---|---|---|
| Frontend build | `npm run build` w `frontend/` | PASS, z ostrzezeniem o duzych chunkach |
| Frontend unit | `npx vitest run` w `frontend/` | PASS, 76 testow |
| Backend build | `npm run build` w `server/` | poczatkowo FAIL, po poprawce PASS |
| Backend unit | `npm test` w `server/` | PASS, 19 testow |
| E2E | `npx playwright test` w `frontend/` przy Vite + backend | PASS, 5 testow |
| Backend runtime | `npm start` w `server/` | PASS po zmianie entrypointu na `dist/src/server.js` |
| API smoke | `GET /health`, `GET /api/rooms?limit=2` | PASS, 200 |
| WS peer smoke | `ws://127.0.0.1:8000/ws/whiteboard/lW0H4UO8I1EDbZWoysSS6h` | PASS, brak bledu UUID po poprawce |
| Manual smoke desktop | Playwright: otwarcie `/`, rysowanie, undo/redo | PASS, brak console errors przy dzialajacym backendzie |
| Manual smoke iPad | Playwright: 768x1024, canvas i przyciski widoczne | PASS |

Uwaga testowa: pierwsze E2E uruchomienie bylo falszywie czerwone, bo Vite zostal odpalony zle pod PowerShellem. `npm run dev -- --host ...` zostalo sparsowane jako argument root Vite. Poprawne uruchomienie w tym srodowisku: `npx vite --host 127.0.0.1 --port 5173`.

## 3. Poprawki wykonane w trakcie audytu

### 3.1 Backend build TypeScript

Problem:
- `server/src/rooms.ts` ustawial opcjonalne pole `hydrationPromise` na `undefined`, co lamalo `exactOptionalPropertyTypes`.
- `server/src/server.ts` zakladal, ze `forwarded.split(',')[0]` zawsze istnieje.

Zmiana:
- `delete room.hydrationPromise`,
- fallback IP dla pustego `x-forwarded-for`.

Efekt:
- `npm run build` w `server/` przechodzi.

### 3.2 Backend startowal ze starego pliku

Problem:
- `tsc` generuje aktualny output do `server/dist/src/server.js`,
- `server/package.json` i `server/Dockerfile` wskazywaly `dist/server.js`,
- lokalny start odpalal stary build, ktory logowal prefix API key i mogl nie odpowiadac aktualnemu kodowi z `src/`.

Zmiana:
- `server/package.json`: `main` i `start` ustawione na `dist/src/server.js`,
- `server/Dockerfile`: `CMD ["node", "dist/src/server.js"]`.

Efekt:
- `npm start` odpala aktualny skompilowany kod.

### 3.3 AI chat wysylal request przy samym mount

Problem:
- `frontend/src/components/AIChatPanel.vue` wykonywal `sendMessage('screenshot_intro')` w `onMounted`.
- Przy samym otwarciu tablicy frontend wysylal screenshot do `/api/ai/chat`, nawet gdy uzytkownik nie otworzyl chatu.
- Bez backendu powodowalo to 500 w dev proxy; z backendiem generowalo niepotrzebny koszt i ryzyko prywatnosci.

Zmiana:
- usuniety automatyczny `onMounted` request.
- Zachowane wyslanie intro dopiero przy odminimalizowaniu chatu, gdy aktywna jest zakladka `chat`.

Efekt:
- smoke test bez backendu nie generuje juz `/api/ai/chat` na starcie.

### 3.4 Artefakty Playwright

Problem:
- `frontend/test-results/` bylo nietrackowane i moglo przypadkiem trafic do commita.

Zmiana:
- dodane do `.gitignore`: `frontend/test-results/`, `frontend/playwright-report/`.

### 3.5 Peer rooms z losowym ID powodowaly bledy UUID w Postgres

Problem:
- smoke runtime pokazal, ze pokoje peer typu `lW0H4UO8I1EDbZWoysSS6h` trafialy do `BoardYjsPersistence.isBoardRoom`,
- metoda sprawdzala takie ID w tabeli `boards.id`, ktora ma typ UUID,
- Postgres zwracal `invalid input syntax for type uuid`, a backend logowal blad przy lookup/hydration/persist.

Zmiana:
- `BoardYjsPersistence.isBoardRoom` od razu klasyfikuje non-UUID jako peer room i nie odpytuje bazy,
- dodany test regresji potwierdzajacy brak lookupu DB dla non-UUID oraz zachowanie lookupu dla UUID.

Efekt:
- peer rooms nie generuja juz bledow UUID w warstwie Yjs persistence.

## 4. Najwazniejsze aktywne problemy

### P1 - CSP nadal dopuszcza `unsafe-eval` i `unsafe-inline`

Dowod:
- `server/src/httpApp.ts:71-72`

Ryzyko:
- CSP nie daje realnej twardej bariery przed XSS, jesli w frontendzie pojawi sie bypass sanitizacji albo wstrzykniecie HTML/JS.

Rekomendacja:
- usunac `unsafe-eval`,
- zastapic inline style/script nonce lub hashami,
- uruchomic smoke dla KaTeX, function-plot, Rough.js i kalkulatora po zaostrzeniu CSP.

### P1 - Globalny JSON body limit to 20 MB

Dowod:
- `server/src/httpApp.ts:98`

Ryzyko:
- wszystkie endpointy, nie tylko AI/screenshot, akceptuja duze payloady.

Rekomendacja:
- globalny limit 1 MB,
- osobny `express.json({ limit: '20mb' })` tylko dla endpointow AI/screenshot.

### P1 - Sekrety tokenow tablic maja fallback `change-me`

Dowod:
- `server/src/services/boardTokens.ts:12`
- `server/src/services/boardService.ts:20`

Ryzyko:
- w dev/test latwo wygenerowac kompatybilne tokeny miedzy srodowiskami,
- jesli produkcja wystartuje z niekompletnym env, ryzyko slabych tokenow zalezy od walidacji otoczenia.

Rekomendacja:
- w development generowac losowy sekret przy starcie i logowac warning bez wartosci sekretu,
- w production fail-fast dla `BOARD_WS_SECRET` i `STUDENT_TOKEN_SECRET`.

### P1 - WebSocket dla board room fail-open przy awarii DB

Dowod:
- `server/src/server.ts:280-293`

Ryzyko:
- jesli `boardPersistence.isBoardRoom(roomId)` rzuci blad, kod uznaje pokoj za nie-boardowy i nie wymaga `wsToken`.
- To chroni stare pokoje peer, ale dla prawdziwych board roomow awaria DB moze zdegradowac autoryzacje.
- Problem bledow `invalid input syntax for type uuid` dla peer rooms zostal naprawiony, ale polityka fail-open dla prawdziwych UUID pozostaje do decyzji.

Rekomendacja:
- fail-closed dla identyfikatorow wygladajacych jak board ID albo gdy request zawiera token boardowy,
- jawnie rozdzielic namespace peer rooms i teacher/student boards.

### P1 - `/api/ai/chat` pozwala na brak tokenu

Dowod:
- `server/src/httpApp.ts:277-291`

Ryzyko:
- endpoint sprawdza token tylko jesli naglowek `x-board-token` istnieje.
- Dla peer rooms oznacza to publiczny endpoint AI chroniony glownie rate limiterem.

Rekomendacja:
- zdecydowac produktowo, czy peer AI ma byc publiczne,
- jesli nie: wymagac room tokenu/sesji,
- jesli tak: dodac mocniejsze limity, quota i telemetryke kosztow.

### P1 - Admin UI nie wysyla `x-admin-secret`

Dowod:
- backend wymaga admin secret: `server/src/httpApp.ts:149`,
- frontendowe requesty bez naglowka: `frontend/src/views/AdminTeachersPanel.vue:156`, `171`, `187`, `210`, `225`.

Skutek:
- panel admina renderuje UI, ale realne operacje API sa 401/503 albo blad JSON parse.

Rekomendacja:
- dodac logowanie admina albo kontrolowany prompt/ustawienie sekretu,
- wszystkie requesty admina powinny dolaczac `x-admin-secret`,
- UI powinno pokazac blad autoryzacji zamiast pustego stanu.

### P2 - Admin UI maskuje bledy backendu jako puste dane

Dowod:
- smoke `/admin/teachers` bez poprawnej autoryzacji: response 500/401/503 konczy sie `Unexpected end of JSON input`, a ekran pokazuje `0 nauczycieli`.

Rekomendacja:
- sprawdzac `res.ok` przed `res.json()`,
- pokazac blad konfiguracji/autoryzacji,
- dodac test E2E admin route z mockiem 401/503.

### P2 - Nadal sa natywne `window.prompt` i `window.confirm`

Dowod:
- `frontend/src/components/RoomManagerModal.vue:259`
- `frontend/src/components/RoomManagerModal.vue:274`
- `frontend/src/components/RoomManagerModal.vue:327`

Skutek:
- niespojny UX, blokowanie main thread, slabe zachowanie na iPadzie.

Rekomendacja:
- zastapic istniejacym `Dialog.vue`.

### P2 - Manualny routing nie jest routerem

Dowod:
- `frontend/src/Root.vue:15-26`

Skutek:
- brak route guards,
- brak lazy loading per route,
- `pathname` nie jest reaktywny,
- admin i teacher widoki sa w bundle glownym.

Rekomendacja:
- Vue Router 4 + guards dla teacher/admin/student.

### P2 - Duze bundle i brak realnego code splittingu widokow

Dowod:
- frontend build: `index-*.js` ok. 1.35 MB minified, `pdf.worker` ok. 1.08 MB, `pdf` ok. 445 KB, `jspdf` ok. 388 KB.

Skutek:
- wolniejszy pierwszy load, szczegolnie na iPadach i slabszych szkolnych urzadzeniach.

Rekomendacja:
- lazy-load panel AI, PDF import/export, math/physics/chemistry, teacher/admin views.

### P2 - Testy unit sa w duzej czesci statyczne

Dowod:
- wiele testow czyta pliki i sprawdza `toContain`, np. `frontend/tests/unit/audit2.test.js`, `sections3-10.test.js`.

Skutek:
- lapia regresje tekstowe, ale nie gwarantuja zachowania runtime.

Rekomendacja:
- dodawac behavioral tests dla gumki touch, color picker iPad, export, admin auth flow, student AI block.

## 5. Wyniki `npm audit --omit=dev`

Frontend:
- 9 podatnosci: 3 critical, 2 high, 4 moderate.
- Najwazniejsze pakiety: `jspdf`, `math-codegen`, `mathjs`, `axios`, `dompurify`, `uuid`, `postcss`.
- Czesc napraw wymaga breaking upgrades (`jspdf`, `mathjs`).

Backend:
- 7 podatnosci: 3 high, 4 moderate.
- Najwazniejsze pakiety: `mathjs`, `path-to-regexp`, `lodash`, `ws`, `body-parser`, `qs`, `uuid`.

Rekomendacja:
- osobny task aktualizacji zaleznosci z testami eksportu PDF, solvera matematycznego, Express route matching i WebSocket.

## 6. Threat model security scan - skrot

Najwazniejsze aktywa:
- klucze OpenRouter i koszty AI,
- tokeny nauczycieli, studentow i WebSocket,
- dane tablic uczniow/nauczycieli,
- PostgreSQL i Yjs persisted state,
- admin import nauczycieli.

Glowne granice zaufania:
- anonimowy browser -> frontend,
- browser -> REST API,
- browser -> WebSocket Yjs,
- teacher session cookie -> teacher API,
- student public token -> board access,
- admin secret -> admin API,
- AI model output -> board patch/apply.

Najbardziej ryzykowne klasy:
- auth bypass na board WebSocket,
- naduzycie AI endpointow i kosztow,
- XSS przez LaTeX/Markdown/render HTML,
- path traversal/upload/PDF parsing,
- DoS przez duze payloady i zaleznosci parserow,
- niejawne fallbacki sekretow.

## 7. Priorytet nastepnych prac

1. Domknac security P1: CSP, body limit, fallback secrets, WebSocket fail-open, token policy dla `/api/ai/chat`.
2. Naprawic admin UI auth i obsluge bledow.
3. Zrobic dependency upgrade sprint po `npm audit`.
4. Dodac behavioral E2E: iPad gumka/kolor, export PDF, student board access, teacher login, admin import.
5. Dopiero potem wejsc w wieksza modernizacje: Vue Router, Pinia, dekompozycja `WhiteboardCanvas.vue` i `App.vue`.
