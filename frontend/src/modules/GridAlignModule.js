// GridAlignModule.js
// Moduł do wyrównywania tekstu pisanego ręcznie do kratki

const toPointObject = (point) => {
  if (Array.isArray(point)) {
    const [x, y, pressure] = point;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y, pressure } : null;
  }
  if (point && typeof point === 'object') {
    const { x, y, pressure, p, t } = point;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const normalized = { x, y };
    if (pressure !== undefined) normalized.pressure = pressure;
    if (p !== undefined && normalized.pressure === undefined) normalized.pressure = p;
    if (t !== undefined) normalized.t = t;
    return normalized;
  }
  return null;
};

const normalizePoints = (points = []) => points.map(toPointObject).filter(Boolean);
const getStrokePoints = (stroke) => {
  if (!stroke) return [];
  if (Array.isArray(stroke.rawPoints) && stroke.rawPoints.length) {
    return normalizePoints(stroke.rawPoints);
  }
  return normalizePoints(stroke.points);
};
const toStoredPoints = (points = []) => points.map((p) => {
  const stored = { x: p.x, y: p.y };
  if (p.pressure !== undefined) stored.pressure = p.pressure;
  if (p.t !== undefined) stored.t = p.t;
  return stored;
});

export default class GridAlignModule {
  constructor(canvasContext, options = {}) {
    // Zapisz kontekst canvas
    this.ctx = canvasContext;

    // Opcje modułu z wartościami domyślnymi
    this.options = {
      gridSize: options.gridSize || 20,
      snapStrength: options.snapStrength || 50,
      showBaselines: options.showBaselines || false,
      ...options
    };

    // Stan modułu
    this.strokes = []; // Wszystkie ścieżki
    this.baselines = []; // Wykryte linie bazowe
    this.enabled = false; // Czy moduł jest aktywny
  }

  // Aktywacja/deaktywacja modułu
  enable() {
    this.enabled = true;
    // console.log('[Aligner] Enabled'); // DEBUG
    return this;
  }

  disable() {
    this.enabled = false;
    // console.log('[Aligner] Disabled'); // DEBUG
    // Reset state if needed when disabled
    this.baselines = [];
    return this;
  }

  // Ustawienie opcji
  setOptions(options) {
    this.options = { ...this.options, ...options };
    // console.log('[Aligner] Options updated:', this.options); // DEBUG
    return this;
  }

  // Dodanie ścieżki do modułu
  addStroke(stroke) {
    if (!this.enabled) return this;
    // console.log(`[Aligner] addStroke called with stroke ID: ${stroke.id}`); // DEBUG
    const normalizedPoints = toStoredPoints(getStrokePoints(stroke));
    const normalizedRaw = stroke.rawPoints ? toStoredPoints(stroke.rawPoints) : null;
    this.strokes.push({
      ...stroke,
      points: normalizedPoints,
      rawPoints: normalizedRaw || undefined,
      aligned: false
    });
    // Reset baselines when a new stroke is added, as they might change
    this.baselines = [];
    return this;
  }

  // Ustawienie wszystkich ścieżek
  setStrokes(strokes) {
    // console.log(`[Aligner] setStrokes called with ${strokes.length} strokes.`); // DEBUG
    this.strokes = strokes.map(stroke => {
      const normalizedPoints = toStoredPoints(getStrokePoints(stroke));
      const normalizedRaw = stroke.rawPoints ? toStoredPoints(stroke.rawPoints) : null;
      return {
        ...stroke,
        points: normalizedPoints,
        rawPoints: normalizedRaw || undefined,
        aligned: stroke.aligned || false // Preserve existing aligned status if available
      };
    });
    // Reset baselines when strokes are completely replaced
    this.baselines = [];
    return this;
  }

  // Wykrywanie linii bazowych
  detectBaselines() {
    if (!this.enabled) {
        // console.log('[Aligner] detectBaselines skipped: disabled');
        return this;
    }
    // console.log(`[Aligner] detectBaselines called with ${this.strokes.length} strokes.`); // DEBUG

    // Resetuj linie bazowe
    this.baselines = [];

    if (!this.strokes.length) {
        // console.log('[Aligner] detectBaselines skipped: no strokes');
        return this;
    }

    // Dla każdej ścieżki oblicz średnią pozycję Y
    const strokesWithY = this.strokes.map(stroke => {
      const points = getStrokePoints(stroke);
      if (!points.length) {
          console.warn(`[Aligner] Stroke ID ${stroke?.id} has no points.`);
          return { ...stroke, avgY: null }; // Handle strokes without points
      }
      const avgY = points.reduce((sum, pt) => sum + pt.y, 0) / points.length;
      return { ...stroke, avgY };
    }).filter(s => s.avgY !== null); // Filter out strokes without points

    if (!strokesWithY.length) {
        // console.log('[Aligner] detectBaselines skipped: no valid strokes with points found.');
        return this;
    }

    // Sortuj ścieżki według średniej pozycji Y
    strokesWithY.sort((a, b) => a.avgY - b.avgY);

    // Znajdź grupy ścieżek (potencjalne linie tekstu)
    const lineGroups = [];
    let currentGroup = [strokesWithY[0]];
    let currentY = strokesWithY[0].avgY;

    for (let i = 1; i < strokesWithY.length; i++) {
      const stroke = strokesWithY[i];

      // Jeżeli ścieżka jest blisko poprzedniej (w granicach 1.5 * gridSize), dodaj do bieżącej grupy
      if (Math.abs(stroke.avgY - currentY) < this.options.gridSize * 1.5) {
        currentGroup.push(stroke);
        // Aktualizuj średnią pozycję Y dla grupy
        currentY = currentGroup.reduce((sum, s) => sum + s.avgY, 0) / currentGroup.length;
      } else {
        // W przeciwnym razie utwórz nową grupę
        lineGroups.push(currentGroup);
        currentGroup = [stroke];
        currentY = stroke.avgY;
      }
    }

    // Dodaj ostatnią grupę
    if (currentGroup.length) {
      lineGroups.push(currentGroup);
    }
    // console.log(`[Aligner] Found ${lineGroups.length} potential line groups.`); // DEBUG

    // Dla każdej grupy oblicz linię bazową
    lineGroups.forEach(group => {
      // Użyj średniej pozycji Y jako linii bazowej
      const baselineY = group.reduce((sum, stroke) => sum + stroke.avgY, 0) / group.length;

      this.baselines.push({
        y: baselineY,
        strokes: group.map(s => s.id)
      });
    });
    // console.log(`[Aligner] Detected ${this.baselines.length} baselines.`); // DEBUG
    return this;
  }

  // Wyrównywanie do siatki
  alignToGrid() {
    if (!this.enabled || !this.strokes.length) {
        // console.log('[Aligner] alignToGrid skipped: disabled or no strokes');
        return []; // Return empty array if skipped
    }
    // console.log('[Aligner] alignToGrid called.'); // DEBUG

    // Najpierw wykryj linie bazowe jeżeli jeszcze nie zostały wykryte
    if (!this.baselines.length) {
      // console.log('[Aligner] No baselines found, detecting...'); // DEBUG
      this.detectBaselines();
    }

    if (!this.baselines.length) {
        // console.log('[Aligner] alignToGrid skipped: no baselines detected');
        return []; // Return empty array if no baselines
    }

    // Zmienione ścieżki
    const changedStrokes = [];

    // Dla każdej linii bazowej znajdź najbliższą linię siatki
    this.baselines.forEach(baseline => {
      // Znajdź najbliższą linię siatki
      const nearestGridLine = Math.round(baseline.y / this.options.gridSize) * this.options.gridSize;

      // Oblicz przesunięcie
      const offsetY = nearestGridLine - baseline.y;

      // Zastosuj przesunięcie do każdej ścieżki w linii bazowej
      // Siła przesunięcia zależy od ustawionej siły przyciągania
      const effectiveOffset = offsetY * (this.options.snapStrength / 100);
      if (Math.abs(effectiveOffset) < 0.1) return; // Skip if offset is negligible

      // console.log(`[Aligner] Baseline Y: ${baseline.y}, Nearest Grid: ${nearestGridLine}, Offset: ${offsetY}, Effective Offset: ${effectiveOffset}`); // DEBUG

      baseline.strokes.forEach(strokeId => {
        const strokeIndex = this.strokes.findIndex(s => s.id === strokeId);
        if (strokeIndex === -1) {
            console.warn(`[Aligner] Stroke ID ${strokeId} not found in internal strokes array.`);
            return;
        }

        const sourcePoints = getStrokePoints(this.strokes[strokeIndex]);
        if (!sourcePoints.length) {
            console.warn(`[Aligner] Stroke ID ${strokeId} has no points to align.`);
            return;
        }

        // Klonuj punkty i zastosuj przesunięcie
        const updatedPoints = sourcePoints.map(point => ({
          ...point,
          y: point.y + effectiveOffset
        }));

        // Aktualizuj ścieżkę w lokalnym stanie modułu
        const updatedStroke = {
          ...this.strokes[strokeIndex],
          points: toStoredPoints(updatedPoints),
          aligned: true
        };
        if (this.strokes[strokeIndex].rawPoints) {
          updatedStroke.rawPoints = toStoredPoints(updatedPoints);
        }
        this.strokes[strokeIndex] = updatedStroke;

        // Dodaj do listy zmienionych ścieżek, które zostaną zwrócone
        changedStrokes.push(updatedStroke);
      });
    });

    // Nie aktualizujemy this.baselines tutaj, ponieważ drawBaselines je przelicza
    // console.log(`[Aligner] alignToGrid finished. Returning ${changedStrokes.length} changed strokes.`); // DEBUG
    return changedStrokes;
  }

  // Rysowanie linii bazowych
  drawBaselines(ctx = this.ctx) {
    if (!this.enabled || !this.options.showBaselines || !this.baselines.length) return this;
    if (!ctx) return this;

    const tr = ctx.getTransform ? ctx.getTransform() : { a: 1, e: 0 };
    const scaleX = tr.a || 1;
    const translateX = tr.e || 0;
    const worldStartX = -translateX / scaleX;
    const worldWidth = ctx.canvas.width / scaleX;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.lineWidth = 1;

    this.baselines.forEach(baseline => {
      // Recalculate baseline Y based on potentially aligned strokes for accurate drawing
      let currentBaselineY = 0;
      let count = 0;
      baseline.strokes.forEach(strokeId => {
          const stroke = this.strokes.find(s => s.id === strokeId);
          const points = getStrokePoints(stroke);
          if (points.length > 0) {
              currentBaselineY += points.reduce((sum, pt) => sum + pt.y, 0) / points.length;
              count++;
          }
      });
      if (count > 0) {
          currentBaselineY /= count;
          // Draw the line at the *intended* grid line position after alignment
          const nearestGridLine = Math.round(currentBaselineY / this.options.gridSize) * this.options.gridSize;

          ctx.beginPath();
          ctx.moveTo(worldStartX, nearestGridLine);
          ctx.lineTo(worldStartX + worldWidth, nearestGridLine); // Adjust line length for zoom/pan
          ctx.stroke();
      }
    });

    ctx.restore();

    return this;
  }

  // Wyczyść wszystkie dane
  clear() {
    // console.log('[Aligner] clear called'); // DEBUG
    this.strokes = [];
    this.baselines = [];
    return this;
  }
}
