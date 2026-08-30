# WhiteVue - indeks audytu, feedbacku i dokumentacji technicznej

Data zebrania: 2026-05-18
Branch: `fix/deep-audit-and-fixes`

Ten plik spina w jednym miejscu nowe i istniejace materialy `.md`, feedback uzytkownikow, analizy architektoniczne, raporty audytowe oraz najwazniejsze poprawki runtime/testowe. Najnowszym punktem odniesienia jest `CODEBASE_REAUDIT_2026-05-18.md`; starsze raporty sa nadal wartosciowe jako zrodla szczegolowych obserwacji, ale moga zawierac problemy juz naprawione albo zduplikowane.

## Sugerowana kolejnosc czytania

1. `PROJECT_OPERATION_AND_REQUIREMENTS.md` - opis tego, jak projekt dziala i jakie wymagania wynikaja z kodu.
2. `CODEBASE_REAUDIT_2026-05-18.md` - najnowszy re-audyt, testy, poprawki wykonane teraz i aktywne ryzyka.
3. `feedback.md` - surowy feedback nauczycieli/uzytkownikow.
4. `FULL_AUDIT_REPORT.md` - duzy walidowany raport tematyczny, szczegolnie UI, iPad, drawing engine, security, performance.
5. `ARCHITECTURE_REVIEW.md` - analiza architektury i dlugu technicznego.
6. `MODERNIZATION_TASKS.md` - backlog modernizacji i checklisty.
7. `AUDIT_REPORT.md`, `AUDIT_REQUIREMENTS.md`, `fixex.md`, `AI_DRAWING_ENGINEERING_ANALYSIS.md` - dodatkowe raporty, wymagania, lista napraw i analiza AI drawing.

## Materialy glowne

| Plik | Rola |
|---|---|
| `PROJECT_OPERATION_AND_REQUIREMENTS.md` | Aktualny opis produktu, przeplywow, backendu, frontendu, danych i wymagan odtworzonych z kodu. |
| `CODEBASE_REAUDIT_2026-05-18.md` | Najswiezszy raport: co sprawdzono, testy, runtime smoke, naprawione bugi, npm audit, ryzyka P1/P2. |
| `AUDIT_DOCUMENTATION_INDEX.md` | Ten indeks/handoff dla GitHuba. |
| `feedback.md` | Surowe uwagi nauczycieli: iPad, toolbar, kolory, gumka, eksport, PDF, kalkulator, AI/RAG, pH/chemia. |
| `README.md` | Ogolny opis projektu i architektury local-first. |
| `frontend/README.md` | Dodatkowy opis frontendu. |

## Raporty i analizy istniejace

| Plik | Co wnosi |
|---|---|
| `FULL_AUDIT_REPORT.md` | Szeroki audyt w dzialach: drawing engine, iPad/mobile, UI, backend security, performance, sync, AI/export/import, CSS, dlug techniczny, feedback nauczycieli. |
| `AUDIT_REPORT.md` | Wczesniejszy kompleksowy audyt projektu z lista krytycznych problemow performance i architektury. |
| `AUDIT_REQUIREMENTS.md` | Wymagania/audytowe kryteria akceptacji i manualne testy do weryfikacji. |
| `ARCHITECTURE_REVIEW.md` | Ocena architektury, komponentow, antywzorcow i planu refaktoryzacji. |
| `MODERNIZATION_TASKS.md` | Backlog techniczny z fazami prac, checklistami i definicja "nie psuc dalej". |
| `fixex.md` | Lista konkretnych bledow i propozycji napraw w UI/drawing/undo/export/iPad. |
| `AI_DRAWING_ENGINEERING_ANALYSIS.md` | Analiza systemu AI drawing, walidacji tool calls, deterministycznosci i template-based drawing. |

## Najwazniejsze rzeczy spakowane na branchu

- Dokumentacja projektu i wymagan: `PROJECT_OPERATION_AND_REQUIREMENTS.md`.
- Najnowszy re-audyt z wynikami testow: `CODEBASE_REAUDIT_2026-05-18.md`.
- Indeks/handoff dla GitHuba: `AUDIT_DOCUMENTATION_INDEX.md`.
- Istniejace raporty audytu i architektury pozostawione jako kontekst: `FULL_AUDIT_REPORT.md`, `AUDIT_REPORT.md`, `ARCHITECTURE_REVIEW.md`, `MODERNIZATION_TASKS.md`, `fixex.md`.
- Feedback uzytkownikow/nauczycieli pozostawiony jako zrodlo wymagan produktowych: `feedback.md`.
- Poprawki runtime/build:
  - backend startuje z aktualnego `dist/src/server.js`,
  - TypeScript backendu przechodzi build,
  - AI chat nie wysyla screenshot/requestu na samym mount,
  - peer roomy non-UUID nie generuja juz bledow UUID w Postgres/Yjs persistence,
  - artefakty Playwright sa ignorowane przez `.gitignore`.
- Test regresji dla `BoardYjsPersistence` w `server/tests/boardYjsPersistence.test.ts`.

## Aktualne wyniki weryfikacji

| Obszar | Wynik |
|---|---|
| Frontend build | PASS |
| Frontend unit | PASS, 76 testow |
| Backend build | PASS |
| Backend unit | PASS, 19 testow |
| Playwright E2E | PASS, 5 testow |
| Manual smoke desktop/iPad | PASS |
| Backend smoke | `/health`, `/api/rooms`, WS peer room PASS |
| Dependency audit | Wykryte podatnosci w frontendzie i backendzie; szczegoly w `CODEBASE_REAUDIT_2026-05-18.md`. |

## Priorytety po wrzuceniu na GitHub

1. Domknac security P1: CSP, global body limit, fallback secrets, WS fail-open, polityka `/api/ai/chat`.
2. Naprawic admin UI: `x-admin-secret`, obsluga `res.ok`, jasne komunikaty bledow.
3. Zrobic dependency upgrade sprint po `npm audit --omit=dev`.
4. Rozszerzyc E2E o realne scenariusze z feedbacku: iPad gumka/kolor/export, PDF import, toolbar, custom pen presets, student board access.
5. Dopiero potem robic wieksza modernizacje: Vue Router, Pinia, podzial `WhiteboardCanvas.vue` i `App.vue`.

## Uwaga o starszych plikach

Czesc starszych dokumentow ma widoczne problemy z kodowaniem polskich znakow. Nie zmienialem ich mechanicznie, zeby nie mieszac tresci historycznych raportow z aktualnym audytem. W razie potrzeby warto zrobic osobny commit tylko na normalizacje kodowania dokumentow.
