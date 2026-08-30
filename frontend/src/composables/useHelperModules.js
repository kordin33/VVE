/**
 * useHelperModules - AI / helper module integration extracted from WhiteboardCanvas.
 *
 * Contains: getActiveModule, syncModulesWithYjs, alignToGrid, groupStrokes,
 * applyStyleTransformation, confirmStyleChanges, cancelStyleChanges,
 * recognizeEquation, applyMathAnswer, renderLatex.
 */
import * as Y from 'yjs';
import katex from 'katex';
import { computeGridSteps } from '../utils/canvasGrid.js';

export function useHelperModules({
  gridAlignModule,
  handwritingStylerModule,
  mathRecognizerModule,
  ydoc,
  yDrawings,
  yjsConnection,
  zoomLevel,
  undoManager,
  updateGlobalState,
  redrawCanvas,
  refreshMovableElements,
  getActiveFeature,
  getGridAlignOptions,
  emit,
  debugLog,
  debugWarn,
  showToast,
}) {

  // 6.5: Simple mutex/queue to serialize AI transactions
  let aiOperationQueue = Promise.resolve();
  const withAiMutex = (fn) => {
    const op = aiOperationQueue.then(fn, fn).catch((err) => {
      console.warn('[useHelperModules] AI operation failed:', err);
    });
    aiOperationQueue = op;
    return op;
  };

  // --- Module Access ---

  const getActiveModule = (featureOverride) => {
    const feature = featureOverride ?? getActiveFeature();
    switch (feature) {
      case 'gridAlign': return gridAlignModule.value;
      case 'styleHandwriting': return handwritingStylerModule.value;
      case 'mathRecognizer': return mathRecognizerModule.value;
      default: return null;
    }
  };

  const syncModulesWithYjs = () => {
    if (!yDrawings.value) return;
    const currentStrokes = yDrawings.value.toArray().map(m => ({ id: m.get('id'), ...m.toJSON() }));
    if (gridAlignModule.value?.enabled) gridAlignModule.value.setStrokes(currentStrokes);
    if (handwritingStylerModule.value?.enabled) handwritingStylerModule.value.setStrokes(currentStrokes);
    if (mathRecognizerModule.value?.enabled) mathRecognizerModule.value.setStrokes(currentStrokes);
  };

  // --- LaTeX Rendering ---

  const renderLatex = (latexString) => {
    const targetElement = document.getElementById('latex-render-output');
    if (targetElement) {
      try {
        katex.render(latexString || '', targetElement, {
          throwOnError: false,
          displayMode: false,
        });
      } catch (error) {
        console.error('Error rendering LaTeX:', error);
        targetElement.textContent = `Error: ${error.message}`;
      }
    } else {
      debugWarn?.('LaTeX render target element #latex-render-output not found.');
    }
  };

  // --- Math Answer ---

  const applyMathAnswer = (newStrokeData) => {
    if (!newStrokeData || !ydoc.value || !yDrawings.value) return;
    return withAiMutex(() => {

    try {
      ydoc.value.transact(() => {
        const yElementMap = new Y.Map();
        for (const [key, value] of Object.entries(newStrokeData)) {
          yElementMap.set(key, value);
        }
        yDrawings.value.push([yElementMap]);
      }, 'ai-math');

      import('vue').then(({ nextTick }) => {
        nextTick(() => {
          updateGlobalState();
          emit('update:recognition-status', '');
          emit('update:latex-equation', '');
          emit('update:solution', '');
          redrawCanvas(true);
        });
      });
    } catch (error) {
      console.error('Error applying math answer:', error);
      showToast?.('Failed to apply math answer.', 'error');
    }
    }); // end withAiMutex
  };

  // --- Align To Grid ---

  const alignToGrid = () => {
    if (!ydoc.value || !yDrawings.value) {
      debugWarn?.('[alignToGrid] Yjs not ready.');
      return;
    }
    return withAiMutex(() => {
    const { worldGridStep } = computeGridSteps(zoomLevel.value);
    if (!worldGridStep || Number.isNaN(worldGridStep)) {
      debugWarn?.('[alignToGrid] Invalid grid size');
      return;
    }
    const gridAlignOptions = getGridAlignOptions();
    const axisMode = gridAlignOptions.showBaselines ? 'y' : 'both';

    const wrapMod = (v, size) => {
      const r = v % size;
      return Number.isFinite(r) ? (r + size) % size : 0;
    };
    const nearestGridShift = (meanR, size) => {
      const option1 = -meanR;
      const option2 = size - meanR;
      return Math.abs(option1) <= Math.abs(option2) ? option1 : option2;
    };

    let sumRx = 0;
    let sumRy = 0;
    let count = 0;

    const accumulatePoint = (x, y) => {
      if (Number.isFinite(x) && axisMode !== 'y') {
        sumRx += wrapMod(x, worldGridStep);
      }
      if (Number.isFinite(y)) {
        sumRy += wrapMod(y, worldGridStep);
      }
      count++;
    };

    // Pass 1: measure mean residuals
    yDrawings.value.forEach((yMap) => {
      const type = yMap.get('type');
      if (type === 'pen') {
        const pts = yMap.get('points');
        if (Array.isArray(pts)) {
          pts.forEach((p) => {
            const px = typeof p.x === 'number' ? p.x : Array.isArray(p) ? p[0] : null;
            const py = typeof p.y === 'number' ? p.y : Array.isArray(p) ? p[1] : null;
            accumulatePoint(px, py);
          });
        }
      } else if (type === 'line' || (yMap.get('start') && yMap.get('end'))) {
        const start = yMap.get('start');
        const end = yMap.get('end');
        if (start && end) {
          accumulatePoint(start.get('x'), start.get('y'));
          accumulatePoint(end.get('x'), end.get('y'));
        }
      } else {
        const px = yMap.get('x');
        const py = yMap.get('y');
        if (Number.isFinite(px) || Number.isFinite(py)) {
          accumulatePoint(px, py);
        }
      }
    });

    if (!count) {
      debugLog?.('[alignToGrid] No points to align.');
      return;
    }

    const meanRx = axisMode === 'y' ? 0 : sumRx / count;
    const meanRy = sumRy / count;
    const shiftX = axisMode === 'y' ? 0 : nearestGridShift(meanRx, worldGridStep);
    const shiftY = nearestGridShift(meanRy, worldGridStep);

    const recomputeBounds = (points) => {
      if (!points || !points.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      points.forEach(p => {
        const px = typeof p.x === 'number' ? p.x : Array.isArray(p) ? p[0] : 0;
        const py = typeof p.y === 'number' ? p.y : Array.isArray(p) ? p[1] : 0;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      });
      return {
        x: minX,
        y: minY,
        width: Math.max(0, maxX - minX),
        height: Math.max(0, maxY - minY),
      };
    };

    const shiftPoint = (p) => {
      if (Array.isArray(p)) {
        return [p[0] + shiftX, p[1] + shiftY, p[2]];
      }
      return { ...p, x: (p.x ?? 0) + shiftX, y: (p.y ?? 0) + shiftY };
    };

    const changedIds = [];

    // Pass 2: apply shift
    ydoc.value.transact(() => {
      for (let i = 0; i < yDrawings.value.length; i++) {
        const yMap = yDrawings.value.get(i);
        const type = yMap.get('type');
        let updated = false;

        if (type === 'pen') {
          const pts = yMap.get('points');
          if (Array.isArray(pts) && pts.length) {
            const shiftedPts = pts.map(shiftPoint);
            yMap.set('points', shiftedPts);
            const rawPts = yMap.get('rawPoints');
            if (Array.isArray(rawPts) && rawPts.length) {
              yMap.set('rawPoints', rawPts.map(shiftPoint));
            }
            const bounds = recomputeBounds(shiftedPts);
            if (bounds) {
              yMap.set('x', bounds.x);
              yMap.set('y', bounds.y);
              yMap.set('width', bounds.width);
              yMap.set('height', bounds.height);
            }
            updated = true;
          }
        } else if (type === 'line' || (yMap.get('start') && yMap.get('end'))) {
          const startMap = yMap.get('start');
          const endMap = yMap.get('end');
          if (startMap && endMap) {
            const start = shiftPoint({ x: startMap.get('x'), y: startMap.get('y') });
            const end = shiftPoint({ x: endMap.get('x'), y: endMap.get('y') });
            const startY = new Y.Map();
            startY.set('x', start.x);
            startY.set('y', start.y);
            const endY = new Y.Map();
            endY.set('x', end.x);
            endY.set('y', end.y);
            yMap.set('start', startY);
            yMap.set('end', endY);
            yMap.set('x', Math.min(start.x, end.x));
            yMap.set('y', Math.min(start.y, end.y));
            yMap.set('width', Math.abs(start.x - end.x));
            yMap.set('height', Math.abs(start.y - end.y));
            updated = true;
          }
        } else {
          let px = yMap.get('x');
          let py = yMap.get('y');
          const hasX = Number.isFinite(px);
          const hasY = Number.isFinite(py);
          if (hasX) {
            px += shiftX;
            yMap.set('x', px);
            updated = true;
          }
          if (hasY) {
            py += shiftY;
            yMap.set('y', py);
            updated = true;
          }
        }

        if (updated) {
          changedIds.push(yMap.get('id'));
          yMap.set('aligned', true);
        }
      }
    }, 'ai-align');

    if (changedIds.length) {
      import('vue').then(({ nextTick }) => {
        nextTick(() => {
          debugLog?.(`[alignToGrid] Shifted ${changedIds.length} elements by (${shiftX.toFixed(2)}, ${shiftY.toFixed(2)}).`);
          updateGlobalState();
          syncModulesWithYjs();
          redrawCanvas();
        });
      });
    } else {
      debugLog?.('[alignToGrid] No elements needed snapping.');
      redrawCanvas();
    }
    }); // end withAiMutex
  };

  // --- Handwriting Styler Actions ---

  const groupStrokes = () => {
    if (!handwritingStylerModule.value) return;
    handwritingStylerModule.value.groupStrokes();
    emit('update:has-char-groups', handwritingStylerModule.value.hasCharGroups());
    emit('update:has-stylized-strokes', false);
    redrawCanvas();
  };

  const applyStyleTransformation = () => {
    if (!handwritingStylerModule.value) return;
    handwritingStylerModule.value.applyStyleTransformation();
    emit('update:has-stylized-strokes', handwritingStylerModule.value.hasStylizedStrokes());
    redrawCanvas();
  };

  const confirmStyleChanges = () => {
    if (!handwritingStylerModule.value || !ydoc.value || !yDrawings.value) {
      debugWarn?.('[confirmStyleChanges] Module or Yjs not ready.');
      return;
    }
    return withAiMutex(() => {
    debugLog?.('[confirmStyleChanges] Calling module.confirmStyleChanges()');
    const updatedStrokes = handwritingStylerModule.value.confirmStyleChanges();

    if (updatedStrokes && updatedStrokes.length > 0) {
      debugLog?.(`[confirmStyleChanges] Module returned ${updatedStrokes.length} updated strokes. Applying to Yjs...`);
      ydoc.value.transact(() => {
        for (let i = 0; i < yDrawings.value.length; i++) {
          const yMap = yDrawings.value.get(i);
          const strokeId = yMap.get('id');
          const updatedStroke = updatedStrokes.find(s => s.id === strokeId);
          if (updatedStroke) {
            debugLog?.(`[confirmStyleChanges] Updating Y.Map for stroke ID: ${strokeId}`);
            yMap.set('points', updatedStroke.points);
          }
        }
      }, 'ai-style');

      import('vue').then(({ nextTick }) => {
        nextTick(() => {
          debugLog?.('[confirmStyleChanges] Yjs transaction complete. Updating global state and redrawing.');
          updateGlobalState();
          emit('update:has-stylized-strokes', false);
          emit('update:has-char-groups', false);
          redrawCanvas();
        });
      });
    } else {
      debugLog?.('[confirmStyleChanges] Module returned no updated strokes. Resetting state.');
      emit('update:has-stylized-strokes', false);
      emit('update:has-char-groups', false);
      redrawCanvas();
    }
    }); // end withAiMutex
  };

  const cancelStyleChanges = () => {
    if (!handwritingStylerModule.value) return;
    handwritingStylerModule.value.cancelStyleChanges();
    emit('update:has-stylized-strokes', false);
    redrawCanvas();
  };

  // --- Math Recognizer ---

  const recognizeEquation = async () => {
    if (!mathRecognizerModule.value) return;
    emit('update:recognition-status', 'Recognizing...');
    emit('update:latex-equation', '');
    emit('update:solution', '');
    try {
      const result = await mathRecognizerModule.value.recognizeEquation();
      emit('update:recognition-status', mathRecognizerModule.value.getRecognitionStatus());
      if (result) {
        emit('update:solution', result.solution || '');
      }
    } catch (error) {
      emit('update:recognition-status', `Error: ${error.message}`);
    } finally {
      redrawCanvas();
    }
  };

  return {
    getActiveModule,
    syncModulesWithYjs,
    renderLatex,
    applyMathAnswer,
    alignToGrid,
    groupStrokes,
    applyStyleTransformation,
    confirmStyleChanges,
    cancelStyleChanges,
    recognizeEquation,
  };
}
