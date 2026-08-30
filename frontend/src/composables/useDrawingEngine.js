/**
 * useDrawingEngine - core drawing logic extracted from WhiteboardCanvas.
 *
 * Contains: pen smoothing, grid snapping, startDrawing, draw, finishDrawing,
 * eraseElement, and the Ramer-Douglas-Peucker simplification algorithm.
 */
import { ref, computed, nextTick } from 'vue';
import * as Y from 'yjs';
import { createNewElement } from '../utils/canvasTools.js';
import { computeGridSteps } from '../utils/canvasGrid.js';
import { DEFAULT_PEN_PRESETS } from '../utils/penStyles.js';

const PEN_SMOOTHING_WINDOW = 4;
const PEN_COORD_PRECISION = 2;

// Tools that behave like shapes (use start/end points)
const SHAPE_TOOLS = new Set([
  'rectangle', 'diamond', 'circle', 'square', 'triangle',
  'trapezoid', 'parallelogram', 'deltoid',
  'cube', 'cuboid', 'sphere', 'cylinder', 'cone', 'pyramid', 'tetrahedron',
]);

const LINE_TOOLS = new Set(['line']);

export { SHAPE_TOOLS };

export function useDrawingEngine({
  // Refs (shared)
  isDrawing,
  currentTool,
  currentColor,
  currentLineWidth,
  zoomLevel,
  panOffset,
  ydoc,
  yDrawings,
  yjsConnection,
  undoManager,
  smoothingFactor,
  debugModeEnabled,
  // Props getters
  getCurrentShape,
  getCurrentLineStyle,
  getCurrentRoughness,
  getCurrentFillColor,
  getCurrentArrowStyle,
  getActiveFeature,
  getHandwritingStylerOptions,
  // Functions
  updateGlobalState,
  redrawCanvas,
  scheduleRedraw,
  refreshMovableElements,
  openConfigPanel,
  startInlineText,
  attachBindingsToLineDraft,
  getActiveModule,
  emit,
  debugLog,
  debugWarn,
  showToast,
}) {

  // --- Internal state ---
  const currentElementPreview = ref(null);
  const pointsBuffer = ref([]);
  const snapIndicator = ref(null);
  const shiftPressedAtStart = ref(false);
  const startCoordsForShiftLine = ref(null);

  const activePenPresetKey = computed(() => {
    const opts = getHandwritingStylerOptions();
    return opts?.preset || 'gel';
  });

  const activePenPreset = computed(() => {
    const options = getHandwritingStylerOptions() || {};
    return (options.presets && options.presets[activePenPresetKey.value])
      || DEFAULT_PEN_PRESETS[activePenPresetKey.value]
      || {};
  });

  // --- Pen Smoothing ---

  const addSmoothedPenPoint = (coords) => {
    const stamped = {
      ...coords,
      t: coords.t ?? (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    };
    pointsBuffer.value.push(stamped);
    if (pointsBuffer.value.length > PEN_SMOOTHING_WINDOW) {
      pointsBuffer.value.shift();
    }
    const len = pointsBuffer.value.length;
    if (!len) return stamped;
    const averaged = pointsBuffer.value.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 }
    );
    return {
      x: parseFloat((averaged.x / len).toFixed(PEN_COORD_PRECISION)),
      y: parseFloat((averaged.y / len).toFixed(PEN_COORD_PRECISION)),
      t: stamped.t,
    };
  };

  const computePenWidthFromPreset = (presetConfig, requestedWidth) => {
    const base = presetConfig?.baseWidth
      || presetConfig?.lineWidth
      || presetConfig?.width
      || requestedWidth
      || 2;
    const scale = Math.max(0.5, (requestedWidth || 2) / 2);
    return parseFloat((base * scale).toFixed(2));
  };

  // --- Grid Snapping ---

  // Will be set by setGridAlignOptionsGetter
  let _gridAlignOptionsGetter = () => ({});
  const setGridAlignOptionsGetter = (fn) => { _gridAlignOptionsGetter = fn; };

  const getSnapSettings = () => {
    const strengthRaw = _gridAlignOptionsGetter()?.snapStrength ?? 0;
    const strength = Math.max(0, Math.min(1, strengthRaw / 100));
    const showBaselines = !!_gridAlignOptionsGetter()?.showBaselines;
    const { worldGridStep, screenGridSize } = computeGridSteps(zoomLevel.value);
    return { strength, showBaselines, gridSizeWorld: worldGridStep, gridSizeScreen: screenGridSize };
  };

  const applySoftGridSnap = (point, prevRawPoint = null) => {
    if (getActiveFeature() !== 'gridAlign') {
      snapIndicator.value = null;
      return point;
    }

    const { strength, showBaselines, gridSizeWorld, gridSizeScreen } = getSnapSettings();
    if (strength <= 0 || !gridSizeWorld) {
      snapIndicator.value = null;
      return point;
    }

    const snapRadiusPx = 2 + strength * gridSizeScreen * 0.8;
    const snapRadiusWorld = snapRadiusPx / zoomLevel.value;

    const gx = Math.round(point.x / gridSizeWorld) * gridSizeWorld;
    const gy = Math.round(point.y / gridSizeWorld) * gridSizeWorld;

    const dx = showBaselines ? 0 : gx - point.x;
    const dy = gy - point.y;
    const dist = showBaselines ? Math.abs(dy) : Math.hypot(dx, dy);

    if (dist < snapRadiusWorld && dist > 0.0001) {
      const proximity = 1 - dist / snapRadiusWorld;
      let alpha = proximity * strength;

      if (prevRawPoint && typeof prevRawPoint.t === 'number') {
        const dt = Math.max(1, point.t - prevRawPoint.t);
        const v = Math.hypot(point.x - prevRawPoint.x, point.y - prevRawPoint.y) / dt;
        const speedFactor = 1 / (1 + v * 0.02);
        alpha *= speedFactor;
      }

      const snappedX = showBaselines ? point.x : point.x + alpha * dx;
      const snappedY = point.y + alpha * dy;
      snapIndicator.value = {
        x: showBaselines ? point.x : gx,
        y: gy,
        axis: showBaselines ? 'y' : 'both',
        radius: snapRadiusWorld,
      };
      return { ...point, x: snappedX, y: snappedY };
    }

    snapIndicator.value = null;
    return point;
  };

  const applyGridSnapHard = (point, gridSize, axisMode = 'both') => {
    if (!point || !gridSize) return point;
    const x = point.x ?? point[0];
    const y = point.y ?? point[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return point;
    const snappedX = axisMode === 'y' ? x : Math.round(x / gridSize) * gridSize;
    const snappedY = Math.round(y / gridSize) * gridSize;
    if (Array.isArray(point)) {
      return [snappedX, snappedY, point[2]];
    }
    return { ...point, x: snappedX, y: snappedY };
  };

  // --- Cancel Active Drawing ---

  const cancelActiveDrawing = () => {
    if (!isDrawing.value && !currentElementPreview.value) return false;
    isDrawing.value = false;
    currentElementPreview.value = null;
    pointsBuffer.value = [];
    snapIndicator.value = null;
    redrawCanvas(false);
    return true;
  };

  // --- Start Drawing ---

  const startDrawing = (event, getCoordinates, transformCoordinates) => {
    if (!ydoc.value) return;
    if (currentTool.value === 'select') return;
    const graphTools = ['mathPlot', 'physicsPlot', 'coordSystem2D', 'coordSystem3D'];
    if (graphTools.includes(currentTool.value)) return;

    const coords = getCoordinates(event);
    const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);

    // Handle text tool inline
    if (currentTool.value === 'text') {
      startInlineText(transformedCoords);
      isDrawing.value = false;
      currentElementPreview.value = null;
      return;
    }

    isDrawing.value = true;
    pointsBuffer.value = [];

    let toolType = currentTool.value;
    let elementData = {};
    let lineWidthForElement = currentLineWidth.value;
    let colorForElement = currentColor.value;

    // Handle Shift+Pen
    if (toolType === 'pen' && shiftPressedAtStart.value) {
      if (debugModeEnabled.value) {
        debugLog?.('[startDrawing] Shift+Pen detected, storing start point.');
      }
      startCoordsForShiftLine.value = transformedCoords;
    } else if (toolType === 'shapes') {
      toolType = getCurrentShape();
      if (debugModeEnabled.value) {
        debugLog?.(`[startDrawing] Starting shape drawing with type: ${toolType}`);
      }
    } else if (toolType === 'lines') {
      toolType = 'line';
    }

    if (toolType === 'pen') {
      elementData.penStyle = activePenPresetKey.value;
      elementData.penConfig = { ...activePenPreset.value };
      lineWidthForElement = computePenWidthFromPreset(activePenPreset.value, currentLineWidth.value);
      const presetColor = activePenPreset.value?.color;
      const prefersPreset = !currentColor.value || ['#000000', '#000', 'black'].includes(String(currentColor.value).toLowerCase());
      colorForElement = prefersPreset ? (presetColor || currentColor.value || '#000000') : currentColor.value;
    }

    // Apply styles to all shapes and lines
    if (SHAPE_TOOLS.has(toolType) || toolType === 'line') {
      elementData.lineStyle = getCurrentLineStyle();
      elementData.roughness = getCurrentRoughness();
      const fillColor = getCurrentFillColor();
      if (fillColor) elementData.fillColor = fillColor;
      if (toolType === 'line') {
        elementData.arrowStyle = getCurrentArrowStyle();
      }
      if (debugModeEnabled.value) {
        debugLog?.(`[startDrawing] Style set: ${elementData.lineStyle}, Roughness: ${elementData.roughness}, Fill: ${elementData.fillColor}`);
      }
    }

    currentElementPreview.value = createNewElement(toolType, transformedCoords, colorForElement, lineWidthForElement, elementData);

    if (currentElementPreview.value) {
      const localClientId = yjsConnection.value?.awareness?.clientID || 'unknown';
      currentElementPreview.value.id = `temp_${localClientId}_${Date.now()}`;
      const startTime = event.timeStamp ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (toolType === 'pen') {
        const stampedStart = { ...transformedCoords, t: startTime };
        const snappedStart = applySoftGridSnap(stampedStart, null);
        currentElementPreview.value.rawPoints = [stampedStart];
        currentElementPreview.value.points = [{ x: snappedStart.x, y: snappedStart.y, t: snappedStart.t ?? startTime }];
        currentElementPreview.value.snappedPoints = currentElementPreview.value.points;
      } else if (SHAPE_TOOLS.has(toolType) || toolType === 'line') {
        const snappedStart = applySoftGridSnap({ ...transformedCoords, t: startTime }, null);
        currentElementPreview.value.start = { x: snappedStart.x, y: snappedStart.y };
      }
      if (debugModeEnabled.value) {
        debugLog?.('[startDrawing] Preview element created:', JSON.stringify(currentElementPreview.value));
      }
    } else {
      isDrawing.value = false;
      return;
    }
  };

  // --- Draw (continuous) ---

  const draw = (coords, isShiftPressed, inputTime) => {
    if (!isDrawing.value || !currentElementPreview.value) return;
    if (currentTool.value === 'eraser') return;

    const preview = currentElementPreview.value;
    const resolvedTool = currentTool.value === 'shapes'
      ? getCurrentShape()
      : currentTool.value === 'lines'
        ? 'line'
        : currentTool.value;
    const previewType = preview.type || resolvedTool;
    const timestamp = typeof inputTime === 'number'
      ? inputTime
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const stampedCoords = { ...coords, t: timestamp };

    if (resolvedTool === 'pen') {
      if (shiftPressedAtStart.value && startCoordsForShiftLine.value) {
        preview.type = 'line';
        const baseStart = preview.rawPoints?.[0] || { ...startCoordsForShiftLine.value, t: timestamp };
        if (!preview.rawPoints) preview.rawPoints = [baseStart];
        const snappedStart = applySoftGridSnap(baseStart, null);
        // Angle snapping to nearest 45°
        const dx = stampedCoords.x - snappedStart.x;
        const dy = stampedCoords.y - snappedStart.y;
        const dist = Math.hypot(dx, dy);
        const ANGLE_STEP = Math.PI / 4;
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
        const angleSnappedEnd = {
          x: snappedStart.x + dist * Math.cos(snappedAngle),
          y: snappedStart.y + dist * Math.sin(snappedAngle),
        };
        preview.start = { x: snappedStart.x, y: snappedStart.y };
        preview.end = { x: angleSnappedEnd.x, y: angleSnappedEnd.y };
        delete preview.points;
      } else if (!shiftPressedAtStart.value) {
        preview.type = 'pen';
        if (!preview.points) preview.points = [];
        if (!preview.rawPoints) preview.rawPoints = [];
        const prevRaw = preview.rawPoints[preview.rawPoints.length - 1] || null;
        preview.rawPoints.push(stampedCoords);
        const smoothedPoint = addSmoothedPenPoint(stampedCoords);
        const snappedPoint = applySoftGridSnap(smoothedPoint, prevRaw);

        // Throttling: distance check
        const MIN_DIST_SQ = 2.25; // 1.5^2
        let shouldAdd = true;
        if (preview.points.length > 0) {
          const last = preview.points[preview.points.length - 1];
          const ddx = snappedPoint.x - last.x;
          const ddy = snappedPoint.y - last.y;
          if (ddx * ddx + ddy * ddy < MIN_DIST_SQ) shouldAdd = false;
        }
        if (shouldAdd) {
          preview.points.push({
            x: snappedPoint.x,
            y: snappedPoint.y,
            t: snappedPoint.t ?? smoothedPoint.t,
          });
          preview.snappedPoints = preview.points;
        }
      }
    } else if (SHAPE_TOOLS.has(previewType) || LINE_TOOLS.has(previewType)) {
      const snappedCoords = applySoftGridSnap(stampedCoords, preview.start ? { ...preview.start, t: timestamp } : null);
      preview.end = { x: snappedCoords.x, y: snappedCoords.y };

      // Angle snapping for lines when Shift is held
      if (preview.type === 'line' && isShiftPressed && preview.start) {
        const dx = snappedCoords.x - preview.start.x;
        const dy = snappedCoords.y - preview.start.y;
        const dist = Math.hypot(dx, dy);
        const ANGLE_STEP = Math.PI / 4;
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
        preview.end = {
          x: preview.start.x + dist * Math.cos(snappedAngle),
          y: preview.start.y + dist * Math.sin(snappedAngle),
        };
      }

      // Square aspect ratio constraint
      if (preview.type === 'square') {
        const dx = Math.abs(snappedCoords.x - preview.start.x);
        const dy = Math.abs(snappedCoords.y - preview.start.y);
        const size = Math.max(dx, dy);
        preview.end = {
          x: preview.start.x + size * Math.sign(snappedCoords.x - preview.start.x),
          y: preview.start.y + size * Math.sign(snappedCoords.y - preview.start.y),
        };
      }

      // Live binding snap for lines
      if (preview.type === 'line' && !isShiftPressed) {
        attachBindingsToLineDraft(preview);
      }
    }

    scheduleRedraw(false); // Dynamic only
  };

  // --- Finish Drawing ---

  // Ramer-Douglas-Peucker simplification
  const getSqSegDist = (p, p1, p2) => {
    let x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = p2.x; y = p2.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.x - x; dy = p.y - y;
    return dx * dx + dy * dy;
  };

  const simplifyPoints = (points, epsilon) => {
    if (points.length <= 2) return points;
    const sqTolerance = epsilon * epsilon;
    let maxSqDist = 0;
    let index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
      const sqDist = getSqSegDist(points[i], points[0], points[end]);
      if (sqDist > maxSqDist) { maxSqDist = sqDist; index = i; }
    }
    if (maxSqDist > sqTolerance) {
      const res1 = simplifyPoints(points.slice(0, index + 1), epsilon);
      const res2 = simplifyPoints(points.slice(index), epsilon);
      return [...res1.slice(0, res1.length - 1), ...res2];
    }
    return [points[0], points[end]];
  };

  const finishDrawing = () => {
    const wasShiftPressed = shiftPressedAtStart.value;
    const shiftStartPoint = startCoordsForShiftLine.value;
    const originalTool = currentTool.value;
    shiftPressedAtStart.value = false;
    startCoordsForShiftLine.value = null;
    snapIndicator.value = null;

    if (!isDrawing.value || !currentElementPreview.value || !ydoc.value || !yDrawings.value) {
      isDrawing.value = false;
      currentElementPreview.value = null;
      return;
    }

    isDrawing.value = false;

    let elementToAdd = null;
    const preview = currentElementPreview.value;

    const isValidElement = preview.start && preview.end && (preview.start.x !== preview.end.x || preview.start.y !== preview.end.y);
    // 1.5: Allow single-point pen strokes (dots) — ensure min 1 point even after throttling
    const isValidPen = preview.type === 'pen' && preview.points && preview.points.length >= 1 && !wasShiftPressed;
    // If pen has rawPoints but no points survived throttling, add the first rawPoint
    if (preview.type === 'pen' && !wasShiftPressed && preview.rawPoints?.length > 0 && (!preview.points || preview.points.length === 0)) {
      const firstRaw = preview.rawPoints[0];
      preview.points = [{ x: firstRaw.x, y: firstRaw.y, t: firstRaw.t }];
    }
    const isValidShiftPen = originalTool === 'pen' && wasShiftPressed && shiftStartPoint && preview.end && (shiftStartPoint.x !== preview.end.x || shiftStartPoint.y !== preview.end.y);

    if (isValidPen || (preview.type !== 'pen' && isValidElement) || isValidShiftPen) {
      if (wasShiftPressed && originalTool === 'pen' && isValidShiftPen) {
        if (debugModeEnabled.value) {
          debugLog?.('[finishDrawing] Shift held with Pen, creating Line element.');
        }
        elementToAdd = {
          type: 'line',
          start: preview.start || shiftStartPoint,
          end: preview.end,
          color: preview.color,
          lineWidth: preview.lineWidth,
          timestamp: Date.now(),
          lineStyle: 'solid',
          rawPoints: preview.rawPoints || [],
        };
      } else {
        elementToAdd = { ...preview };
        delete elementToAdd.id;

        // RDP simplification for pen strokes
        if (elementToAdd.type === 'pen' && elementToAdd.points && elementToAdd.points.length > 2) {
          elementToAdd.points = simplifyPoints(elementToAdd.points, 0.15);
        }

        // Ensure lineStyle for lines tool
        if (originalTool === 'lines' && elementToAdd.type === 'line') {
          const styleFromProps = getCurrentLineStyle() || 'solid';
          if (debugModeEnabled.value) {
            debugLog?.(`[finishDrawing] lineStyle setting from prop: ${styleFromProps}`);
          }
          elementToAdd.lineStyle = styleFromProps;
        }
      }

      if (elementToAdd) {
        if (elementToAdd.type === 'line') {
          attachBindingsToLineDraft(elementToAdd);
        }
        elementToAdd.id = `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`;

        if (debugModeEnabled.value) {
          debugLog?.('[finishDrawing] Final elementToAdd before Yjs transaction:', JSON.stringify(elementToAdd));
        }

        try {
          ydoc.value.transact(() => {
            const yElementMap = new Y.Map();
            yElementMap.set('id', elementToAdd.id);
            yElementMap.set('type', elementToAdd.type);
            yElementMap.set('color', elementToAdd.color);
            yElementMap.set('lineWidth', elementToAdd.lineWidth);
            yElementMap.set('timestamp', Date.now());
            yElementMap.set('rotation', 0);

            const shapeOrLine = SHAPE_TOOLS.has(elementToAdd.type) || elementToAdd.type === 'line';
            const resolvedLineStyle = elementToAdd.lineStyle ?? (shapeOrLine ? getCurrentLineStyle() || 'solid' : undefined);
            const resolvedRoughness = elementToAdd.roughness ?? (shapeOrLine ? getCurrentRoughness() ?? 1 : undefined);
            const resolvedFillColor = elementToAdd.fillColor ?? (shapeOrLine ? getCurrentFillColor() : undefined);
            if (resolvedLineStyle != null) yElementMap.set('lineStyle', resolvedLineStyle);
            if (resolvedRoughness != null) yElementMap.set('roughness', resolvedRoughness);
            if (resolvedFillColor != null) yElementMap.set('fillColor', resolvedFillColor);

            if (elementToAdd.type === 'pen') {
              if (elementToAdd.penStyle) yElementMap.set('penStyle', elementToAdd.penStyle);
              // 1.7: Explicit property extraction for penConfig (Y.Map cannot store raw objects)
              if (elementToAdd.penConfig) {
                const pc = elementToAdd.penConfig;
                const penConfigMap = new Y.Map();
                for (const [key, val] of Object.entries(pc)) {
                  if (val !== undefined && val !== null && typeof val !== 'function') {
                    penConfigMap.set(key, val);
                  }
                }
                yElementMap.set('penConfig', penConfigMap);
              }
              yElementMap.set('points', elementToAdd.points);
              if (elementToAdd.rawPoints) yElementMap.set('rawPoints', elementToAdd.rawPoints);
              if (elementToAdd.points && elementToAdd.points.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                elementToAdd.points.forEach(p => {
                  const px = typeof p.x === 'number' ? p.x : Array.isArray(p) ? p[0] : 0;
                  const py = typeof p.y === 'number' ? p.y : Array.isArray(p) ? p[1] : 0;
                  minX = Math.min(minX, px); minY = Math.min(minY, py);
                  maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
                });
                // 1.8: Validate coordinates before Yjs save
                if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
                  console.warn('[finishDrawing] Invalid bounding box — skipping element');
                  currentElementPreview.value = null;
                  pointsBuffer.value = [];
                  return;
                }
                yElementMap.set('x', minX);
                yElementMap.set('y', minY);
                yElementMap.set('width', Math.max(0, maxX - minX));
                yElementMap.set('height', Math.max(0, maxY - minY));
              } else {
                yElementMap.set('x', 0); yElementMap.set('y', 0);
                yElementMap.set('width', 0); yElementMap.set('height', 0);
              }
            } else if (elementToAdd.type === 'line' || (elementToAdd.start && elementToAdd.end)) {
              const startX = elementToAdd.start.x;
              const startY = elementToAdd.start.y;
              const endX = elementToAdd.end.x;
              const endY = elementToAdd.end.y;
              const x = Math.min(startX, endX);
              const y = Math.min(startY, endY);
              const width = Math.abs(startX - endX);
              const height = Math.abs(startY - endY);
              yElementMap.set('x', x); yElementMap.set('y', y);
              yElementMap.set('width', width); yElementMap.set('height', height);

              if (elementToAdd.type === 'line') {
                const linePoints = [
                  { x: startX - x, y: startY - y },
                  { x: endX - x, y: endY - y },
                ];
                yElementMap.set('points', linePoints);
                const arrowStyle = elementToAdd.arrowStyle || getCurrentArrowStyle() || 'none';
                yElementMap.set('arrowStyle', arrowStyle);
              }

              const startMap = new Y.Map();
              startMap.set('x', startX); startMap.set('y', startY);
              yElementMap.set('start', startMap);
              const endMap = new Y.Map();
              endMap.set('x', endX); endMap.set('y', endY);
              yElementMap.set('end', endMap);

              if (elementToAdd.startBinding) yElementMap.set('startBinding', elementToAdd.startBinding);
              if (elementToAdd.endBinding) yElementMap.set('endBinding', elementToAdd.endBinding);
            }

            if (elementToAdd.type !== 'text' && elementToAdd.type !== 'image') {
              yDrawings.value.push([yElementMap]);
              refreshMovableElements();
            }

            if (debugModeEnabled.value) {
              debugLog?.('[finishDrawing] Successfully pushed Y.Map to yDrawings');
            }
          }, 'local-drawing');

          // Notify helper modules
          if (getActiveFeature() && elementToAdd.type !== 'text' && elementToAdd.type !== 'image') {
            const module = getActiveModule();
            if (module && module.addStroke) {
              module.addStroke({ ...elementToAdd });
              if (getActiveFeature() === 'styleHandwriting') {
                emit('update:has-char-groups', false);
                emit('update:has-stylized-strokes', false);
              }
            }
          }

          undoManager.value?.stopCapturing();

          nextTick(() => {
            if (undoManager.value) {
              updateGlobalState();
            }
          });
        } catch (error) {
          console.error('[finishDrawing] Error during Yjs transaction:', error);
          showToast?.('Error saving drawing element.', 'error');
        }
      }
    } else {
      if (debugModeEnabled.value) {
        debugLog?.('Drawing finished but element was too small or invalid, not adding.');
      }
    }

    currentElementPreview.value = null;
    pointsBuffer.value = [];
    redrawCanvas();
  };

  // --- Eraser ---

  const eraseElement = (indexOrId) => {
    if (!ydoc.value || !yDrawings.value) return;

    let elementIndex = -1;
    if (typeof indexOrId === 'string') {
      elementIndex = yDrawings.value.toArray().findIndex(elMap => elMap.get('id') === indexOrId);
    } else if (typeof indexOrId === 'number') {
      const elemAtIndex = indexOrId >= 0 && indexOrId < yDrawings.value.length
        ? yDrawings.value.get(indexOrId) : null;
      if (elemAtIndex) {
        const id = elemAtIndex.get('id');
        if (id) {
          elementIndex = yDrawings.value.toArray().findIndex(elMap => elMap.get('id') === id);
        } else {
          elementIndex = indexOrId;
        }
      }
    }

    if (elementIndex !== -1 && elementIndex >= 0 && elementIndex < yDrawings.value.length) {
      debugLog?.(`[eraseElement] Removing element at index: ${elementIndex}`);

      ydoc.value.transact(() => {
        yDrawings.value.delete(elementIndex, 1);
      }, 'local-erase');
      refreshMovableElements();

      undoManager.value?.stopCapturing();

      nextTick(() => {
        if (undoManager.value) {
          updateGlobalState();
        }
      });
    } else {
      debugWarn?.(`[eraseElement] Element not found for index/ID: ${indexOrId}`);
    }
  };

  return {
    // State
    currentElementPreview,
    pointsBuffer,
    snapIndicator,
    shiftPressedAtStart,
    startCoordsForShiftLine,
    activePenPresetKey,
    activePenPreset,
    // Constants
    SHAPE_TOOLS,
    LINE_TOOLS,
    // Methods
    addSmoothedPenPoint,
    computePenWidthFromPreset,
    applySoftGridSnap,
    applyGridSnapHard,
    cancelActiveDrawing,
    startDrawing,
    draw,
    finishDrawing,
    eraseElement,
    setGridAlignOptionsGetter,
  };
}
