# Fixex – analiza uwag z testów i plan napraw

Poniżej spisałem problemy zgłoszone przez nauczycieli, ich **najbardziej prawdopodobne przyczyny w kodzie WhiteVue** oraz **konkretne kroki wdrożenia** (co zmienić, gdzie i jak sprawdzić).

> Założenie: priorytetem jest UX na lekcji (zero „znikających” elementów, przewidywalne cofanie, pełna obsługa iPada) oraz rozsądna waga eksportów (np. pod Discord/DSC).

---

## P0 (krytyczne) – rzeczy psujące lekcję tu i teraz

### 1) „Znikająca zębatka” (menu ustawień) – mega uciążliwe

**Objaw:** ikona zębatki i menu pojawiają się tylko czasami; łatwo je „zgubić”, szczególnie na dotyku.

**Przyczyna w kodzie:**
- `frontend/src/components/TopMenu.vue` pokazuje zębatkę *tylko na hover* (`showGear` sterowane `mouseenter/mouseleave` + `hideTimeout`).
- Na iPadzie nie ma klasycznego hover, więc UX jest losowy lub wymaga „trafienia” w `hover-trigger-area`.

**Jak naprawić (kierunek):**
- Zrobić tryb „menu zawsze widoczne” + przełącznik „auto-hide”.
- Wykrywać urządzenia dotykowe i domyślnie **wyłączyć auto-hide** (lub pokazywać zębatkę stale).

**Jak wdrożyć (kroki):**
1. W `frontend/src/components/TopMenu.vue` dodać stan `autoHideEnabled` (z `localStorage`).
2. Jeśli `matchMedia('(hover: none)')` lub `navigator.maxTouchPoints > 0` → `autoHideEnabled = false` (default).
3. UI: dodać przycisk „Pin” w menu (np. obok fullscreen) przełączający `autoHideEnabled`.
4. Zmienić logikę `handleMouseLeave` tak, aby nie chowała elementów gdy `autoHideEnabled === false`.

**Kryteria akceptacji:**
- Na iPadzie zębatka jest zawsze dostępna bez „hover sztuczek”.
- Nauczyciel może włączyć/wyłączyć auto-hide jednym kliknięciem.

---

### 2) iPad: nie działa gumka (eraser)

**Objaw:** gumka nie usuwa elementów na iPadzie.

**Przyczyna w kodzie (konkret):**
- `frontend/src/components/WhiteboardCanvas.vue`: logika gumki (hit-test + `eraseElement`) jest w `handleMouseMove`.
- Dla dotyku `handleTouchMove` nie wywołuje `handleMouseMove`, tylko przy `isDrawing` woła `draw(...)`, które ma guard: `if (currentTool.value === 'eraser') return;`.
- Efekt: na dotyku gumka nie przechodzi przez ścieżkę kodu, która faktycznie usuwa obiekty.

**Jak naprawić (kierunek):**
- Ujednolicić input pod **Pointer Events** (najlepsza opcja: `pointerdown/move/up` + `pointerType`).
- Minimalny fix: w `handleTouchMove` dla gumki wykonywać tę samą logikę co `handleMouseMove` (hit-test + erase).

**Jak wdrożyć (minimalny fix):**
1. W `handleTouchMove` w `WhiteboardCanvas.vue` dodać gałąź:
   - jeśli `currentTool.value === 'eraser'`:
     - policzyć `transformedCoords`,
     - wykonać to samo co w `handleMouseMove` dla gumki (ustawienie `hoveredElementIndex` + `eraseElement(foundIndex)`).
2. Dodać test manualny: gumka usuwa pen/shape/line na iPadzie jednym palcem i Apple Pencil.

**Kryteria akceptacji:**
- Eraser działa na iPadzie i usuwa elementy tak samo jak na desktopie.

---

### 3) iPad: nie działa zmiana koloru pena z paska narzędzi

**Objaw:** nie da się zmienić koloru pióra (lub wybór „nie przesuwa się”/nie reaguje).

**Najbardziej prawdopodobne przyczyny (w kodzie):**
- `frontend/src/components/ToolBar.vue`: „properties bar” auto-ukrywa się po 2s (`startHideTimer()`), a podtrzymanie widoczności opiera się o `@pointerenter/@pointerleave` (na dotyku bywa nieprzewidywalne).
- `input[type="color"]` jest „ukryty” (`pointer-events: none`) i otwierany przez `colorInput.value?.click()`. iOS Safari często blokuje otwieranie pickera, gdy klik jest pośredni albo element jest niewidoczny/niefocusowalny.

**Jak naprawić (kierunek):**
- Na dotyku: properties bar **nie chowa się automatycznie** (albo chowa się dopiero po jawnej akcji).
- Zmiana koloru: pozwolić użytkownikowi tapnąć bezpośrednio w `input[type=color]` (niewidoczne, ale faktycznie klikane).

**Jak wdrożyć (kroki):**
1. `ToolBar.vue`: dodać wykrycie touch i wtedy:
   - nie uruchamiać `startHideTimer()` albo zwiększyć timeout (np. 30s),
   - lub wprowadzić „pin properties bar” (zgodne z uwagą nauczycieli o przycisku decydującym czy UI ma się chować).
2. Zmienić CSS `.hidden-color-input`:
   - zamiast `pointer-events: none`, zrobić input absolutnie na wierzchu mini podglądu (opacity 0, ale dotyk działa).

**Kryteria akceptacji:**
- Na iPadzie można zawsze zmienić kolor pióra bez ścigania uciekającego panelu.

---

### 4) iPad: nie działa eksport

**Objaw:** eksport nic nie robi / nie zapisuje pliku / wywala błąd na iPadzie.

**Przyczyny (są tu co najmniej 3):**
1. **Eksport „stanu tablicy” jest podpięty do metody, której nie ma**:
   - `frontend/src/App.vue` woła `whiteboard.value.getSnapshot()`,
   - `frontend/src/components/WhiteboardCanvas.vue` nie expose’uje `getSnapshot` (i w ogóle nie ma takiej metody).
   - Skutek: „Export Whiteboard” jest funkcjonalnie zepsuty na każdej platformie (na desktopie widać w konsoli, na iPadzie użytkownik widzi „nic”).
2. PDF eksport generuje ogromny obraz:
   - `WhiteboardCanvas.vue`: `EXPORT_DPI = 600`, PNG, `PDF_IMAGE_COMPRESSION = 'NONE'`.
   - Na iPadzie łatwo o OOM / crash / brak pamięci.
3. iOS Safari ma ograniczenia downloadów przez „kliknięcie w `<a download>`” + Blob URL.

**Jak naprawić (kierunek):**
- Naprawić eksport stanu (Yjs update → base64) + opcjonalna kompresja.
- Dla PDF: obniżyć DPI + użyć JPEG + kompresji + fallback na `navigator.share()` lub `window.open(blobUrl)`.

**Jak wdrożyć (kroki):**
1. `frontend/src/components/WhiteboardCanvas.vue`:
   - dodać i expose’ować metodę `getSnapshotBase64()` (np. `Y.encodeStateAsUpdate(ydoc)` → base64),
   - opcjonalnie `getSnapshotCompressedBase64()` (np. gzip/deflate).
2. `frontend/src/App.vue`: zmienić `handleExportRequest` aby wołało nową expose’owaną metodę.
3. `exportBoardAsPdf*`:
   - zmniejszyć `EXPORT_DPI` (np. 150–300) + dodać ustawienie „Jakość eksportu”,
   - użyć `toDataURL('image/jpeg', quality)` + `PDF_IMAGE_COMPRESSION` na `FAST/MEDIUM`,
   - na iOS: jeśli `navigator.share` wspiera pliki → share PDF; inaczej `window.open(url)`.

**Kryteria akceptacji:**
- „Export Whiteboard” zawsze daje działający plik (także na iPadzie).
- PDF eksport działa na iPadzie bez crashy i ma rozsądny rozmiar.

---

### 5) Komputer: przesuwanie narysowanych obiektów sprawia, że znikają

**Objaw:** po zaznaczeniu/przesunięciu obiektu (zwłaszcza pen stroke) obiekt znika podczas interakcji.

**Przyczyna w kodzie (konkret):**
- `WhiteboardCanvas.vue` podczas rysowania warstwy statycznej **pomija** obiekty z overlayem DOM (`hasDomOverlay`) oraz obiekt zaznaczony (`selectedObjectId`).
- `MovableObject.vue` renderuje kształty/linie na swoim `localCanvas`, ale **nie normalizuje** punktów typu `pen` (w Yjs punkty są absolutne w world coords).
- Efekt: gdy `pen` trafia do `MovableObject`, jego punkty są rysowane poza lokalnym canvasem → znika. Podczas drag sytuacja jest jeszcze gorsza, bo `x/y` zmieniają się, a `points` nie są przesuwane lokalnie aż do commit w `stopDrag`.

**Jak naprawić (kierunek):**
- W `MovableObject.vue` dodać poprawne renderowanie `pen`:
  - przeliczyć `points` z absolutnych na lokalne (`point - origin`),
  - w czasie drag uwzględniać delta (albo aktualizować `objectData.points` lokalnie w `handleDrag`).

**Jak wdrożyć (kroki):**
1. `frontend/src/components/MovableObject.vue`:
   - w `renderLocalCanvas()` wykryć `objectData.type === 'pen'` i budować `localElement.points` jako `points.map(p => ({x: p.x - originX, y: p.y - originY}))`,
   - `originX/originY`:
     - normalnie: `objectData.x/objectData.y`,
     - w trakcie drag: użyć `initialObjectState.x/y` (żeby stroke „jechał” razem z ramką zanim punkty zostaną przesunięte w Yjs).
2. (Opcjonalnie lepsze UX) W `handleDrag` aktualizować `objectData.points` lokalnie (shift), a commit zostawić na `stopDrag`.
3. Dodać test manualny:
   - zaznacz pen stroke → przeciągnij → nie znika,
   - zaznacz shape/line → przeciągnij → nie znika.

**Kryteria akceptacji:**
- Żaden obiekt nie znika w trakcie przesuwania/skalowania/rotacji.

---

### 6) Komputer: Ctrl+Z usuwa więcej niż oczekiwane

**Objaw:** cofanie „łyka” kilka akcji naraz.

**Przyczyny w kodzie (najczęstsze):**
- `WhiteboardCanvas.vue` używa `Y.UndoManager` bez kontroli „grupowania” akcji (Yjs łączy zmiany w jednym stack-item w oknie czasu `captureTimeout`).
- `trackedOrigins` zawiera `null/undefined` → UndoManager może łapać transakcje, które nie są realną akcją użytkownika (potencjalnie także z internal/remote).

**Jak naprawić (kierunek):**
- Usunąć `null/undefined` z `trackedOrigins` i wymusić jawne origin dla wszystkich „user actions”.
- Po każdej zakończonej akcji użytkownika wywołać `undoManager.stopCapturing()` aby odciąć grupowanie.
- (Opcjonalnie) ustawić `captureTimeout` na małą wartość lub 0.

**Jak wdrożyć (kroki):**
1. `initializeUndoManager()` w `WhiteboardCanvas.vue`:
   - usunąć `null, undefined` z `trackedOrigins`,
   - dodać `captureTimeout` (np. `0` lub `50`).
2. Po commitach:
   - `finishDrawing` (po transakcji),
   - `eraseElement`,
   - `local-clear`,
   - `stopDrag/stopResize/stopRotate` (w `MovableObject.vue`),
   wywołać `undoManager.value?.stopCapturing()`.

**Kryteria akceptacji:**
- Ctrl+Z cofa dokładnie „jedną” intuicyjną akcję (jeden stroke / jedno przesunięcie / jedno dodanie).

---

## P1 (ważne) – ergonomia rysowania i nawigacji

### 7) Shift + prosta linia: snap do 0/45/90 (i ogólnie do kątów)

**Objaw:** prosta linia z Shift nie „łapie” równych kątów, tylko idzie dokładnie po ruchu ręki.

**Stan w kodzie:**
- `WhiteboardCanvas.vue` w `draw()` obsługuje `Shift+Pen` jako „tymczasowy line”, ale robi tylko grid-snap, bez angle-snap (`isShiftPressed` nie jest używany do kątów).

**Jak naprawić:**
- Dodać angle snapping (np. co 45°):
  - policzyć `angle = atan2(dy, dx)`,
  - `snapped = round(angle / step) * step`,
  - zachować długość (hypot) i wyznaczyć nowy end.

**Gdzie wdrożyć:**
- `frontend/src/components/WhiteboardCanvas.vue` w `draw()` dla:
  - `shiftPressedAtStart && preview.type === 'line'`,
  - oraz opcjonalnie dla normalnego `line` gdy `event.shiftKey === true`.

---

### 8) Pojedyncze kliknięcia nie rysują (brak kropek)

**Objaw:** trudno postawić kropkę; „tap” nic nie zostawia.

**Przyczyna w kodzie:**
- `finishDrawing()` uznaje pen za valid tylko gdy `points.length >= 2` (`isValidPen`).
- `drawElement()` w `frontend/src/utils/canvasDrawing.js` dla `pen` wymaga `points.length >= 2`.

**Jak naprawić (warianty):**
- Wariant A (szybki i UX-friendly): przy `points.length === 1` tworzyć kropkę jako mini-okrąg (nowy typ `dot` albo `pen` z flagą).
- Wariant B: gdy `points.length === 1` automatycznie dodać drugi punkt minimalnie odsunięty o epsilon.

**Gdzie wdrożyć:**
- `WhiteboardCanvas.vue`: dopuścić `points.length === 1` jako valid i zapisać element,
- `canvasDrawing.js`: renderować kropkę dla `pen` z 1 punktem (np. `arc` z promieniem `lineWidth/2`).

---

### 9) „Łapka” do przesuwania tablicy (panning tool)

**Objaw:** potrzeba prostego narzędzia do przesuwania widoku; skróty (Alt/Spacja/środkowy) są za trudne w lekcji.

**Stan w kodzie:**
- Panning działa przez: środkowy przycisk, Alt+LMB lub Space+LMB (`WhiteboardCanvas.vue`).
- ToolBar nie ma „hand/pan” toola.

**Jak naprawić:**
- Dodać nowy tool `pan` (ikona „hand”) w `ToolBar.vue`.
- W `handleMouseDown/TouchStart` jeśli `currentTool === 'pan'` → zawsze start panning na LMB/1 touch.

**Gdzie wdrożyć:**
- `frontend/src/components/ToolBar.vue` (dodanie przycisku + emit),
- `frontend/src/components/WhiteboardCanvas.vue` (obsługa toola).

---

### 10) iPad: pasek narzędzi zasłania zoom (lewy dół)

**Objaw:** UI elementy nachodzą na siebie na iPadzie.

**Przyczyna:**
- `ZoomPanControls.vue` jest zawsze `bottom:20px; left:20px`.
- `ToolBar` jest po lewej i ma stałe pozycjonowanie (`App.vue` `.floating-toolbar { left:20px; top:50% }`) – na mniejszych ekranach może schodzić do dołu i kolidować.

**Jak naprawić:**
- Responsywnie przenosić zoom controls (np. prawy dół) dla `max-width`/`max-height` lub gdy toolbar jest w wersji pionowej.
- Alternatywnie: zrobić toolbar „kompaktowy” na tablet (mniej przycisków na raz) lub umożliwić jego przeciąganie.

**Gdzie wdrożyć:**
- CSS: `frontend/src/components/ZoomPanControls.vue` + media queries,
- albo: przenieść pozycjonowanie do globalnego layoutu i wyliczać offset od toolbar.

---

## P1/P2 – kolory i presety (ważne dla chemii)

### 11) „Każdy ma te same kolory” + potrzeba dużej palety „od razu”

**Objaw:** za mało szybkich kolorów; dla chemii potrzeba wielu i natychmiastowego dostępu.

**Stan w kodzie:**
- `ToolBar.vue` ma stałe `colorSwatches` (8 kolorów).
- `ColorPicker.vue` ma małą bazową paletę i 4 ostatnie.
- Brak „slotów” pióra (kolor+grubość+styl) pod skrótami 1/2/3…

**Jak naprawić (kierunek):**
- Wprowadzić „Quick Presets” (np. 1–9): każdy preset = kolor + grubość + styl pióra.
- Dodać per-subject palety (Chemia/Matma/Fizyka) jako gotowe presety.
- Umożliwić nauczycielowi edycję i zapis w `localStorage` (lub w profilu na backendzie w przyszłości).

**Jak wdrożyć (kroki):**
1. Dodać model presetów (np. w `frontend/src/store` albo prosty composable) i persystencję `localStorage`.
2. UI:
   - w `ToolBar.vue` dodać sekcję „Presety 1–9” (mini przyciski),
   - dodać tryb edycji (prawy klik / dłuższe przytrzymanie).
3. `WhiteboardCanvas.vue` w `handleKeyDown`: cyfry 1–9 → przełącz preset.

**Kryteria akceptacji:**
- Nauczyciel w 1 klik/tap przełącza kolor (i opcjonalnie grubość) bez wchodzenia w pickery.

---

## P2 (rozwojowe) – funkcje „miłe do mieć”, ale z dużą wartością

### 12) Import PDF do pisania po nim

**Propozycja implementacji (realistyczna):**
- Wariant A (szybki, ciężki): klient renderuje PDF (pdf.js) → zamienia strony na obrazy → dodaje jako `image` elementy na tablicę.
  - Minus: duży rozmiar danych (dataURL), słabe pod Discord.
- Wariant B (docelowy, lekki): upload PDF na backend/S3 → tablica przechowuje tylko referencję (URL + page transforms), a klient renderuje strony lokalnie.

**Gdzie wdrożyć:**
- UI: dodać opcję w `TopMenu.vue` „Import PDF”.
- Front: dodać `pdfjs-dist` i moduł renderowania.
- Back (wariant B): endpoint upload + storage + ACL dla boardId.

---

### 13) Chemia: automatyczne obliczenia (np. pH = -log10([H+]))

**Najprostsza ścieżka:**
- Skorzystać z `mathjs` (już jest w projekcie) i dodać mały „Chemistry helper”:
  - panel: wpisujesz `[H+] = 1e-3` → pokazuje `pH = 3`,
  - opcja „wstaw wynik na tablicę” jako text/latex.

**Gdzie wdrożyć:**
- Nowy panel obok istniejących (Math/Physics/Diagram) lub jako tryb w kalkulatorze.

---

### 14) Kalkulator: UI jak fizyczny naukowy + udostępnianie uczniom podglądu

**Stan:**
- Jest `CalculatorModal.vue` + `Calculator.vue` (UI raczej „modal”, nie „naukowy”).

**Jak poprawić UI:**
- Layout klawiszy jak Casio/TI (sekcje: trig, log, exp, nawiasy, pamięć).
- Tryb RPN lub klasyczny (opcjonalnie).

**Udostępnianie uczniom:**
- Dodać „broadcast state” kalkulatora do Yjs:
  - `Y.Map('sharedUI')` z polami: `calculatorVisible`, `expression`, `result`, `ownerRole`.
  - Uczeń widzi read-only panel, gdy `calculatorVisible` i teacher włączył sharing.

---

### 15) Nauczyciel decyduje, czy AI panel jest dostępny dla ucznia

**Stan dziś:**
- `AIChatPanel` w `frontend/src/App.vue` pokazuje się zawsze gdy jest `roomId`.
- Backend `POST /api/ai/board-assistant` nie ma autoryzacji roli (każdy z `boardId` może zawołać).
- System tokenów już istnieje (`server/src/services/boardTokens.ts`) i niesie rolę teacher/student.

**Jak naprawić (bezpiecznie):**
1. Backend:
   - wymagać `wsToken` w żądaniu AI i weryfikować `verifyBoardWsToken`,
   - dopuścić rolę `teacher` zawsze,
   - dla `student` dopuścić tylko jeśli ustawienie tablicy `ai_for_students=true`.
2. Front:
   - przekazać `wsToken` do AI requestów,
   - ukryć `AIChatPanel` dla ucznia, jeśli teacher wyłączył (ustawienie z backendu lub współdzielone w Yjs).

**Gdzie przechować ustawienie:**
- Szybko: w Yjs (np. `ydoc.getMap('boardSettings')`) ustawiane przez teacher.
- Docelowo: w DB kolumna w `BoardRecord` (wymaga migracji) i zwracane w `/api/board/:slug`.

---

## Proponowana kolejność wdrożeń (żeby szybko odblokować testy)

1. Naprawa iPada: gumka + kolor + menu (TopMenu/ToolBar/WhiteboardCanvas).
2. Naprawa znikających obiektów przy przesuwaniu (`MovableObject` dla `pen`).
3. Stabilizacja undo (trackedOrigins bez null + `stopCapturing`).
4. Dots + angle snapping + hand tool (jakość rysowania).
5. Eksport: naprawa „Export Whiteboard” + odchudzenie PDF.
6. PDF import, kalkulator sharing, kontrola AI dla uczniów, chemia/pH.

