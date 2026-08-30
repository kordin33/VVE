<template>
  <div
    ref="containerRef"
    class="whiteboard-container"
    :class="{ 'dark-mode': darkMode }"
  >
    <div v-if="debugMode" style="position: absolute; top: 5px; left: 5px; z-index: 9999;
     background: rgba(0,0,0,0.7); color: white; padding: 5px; border-radius: 4px; font-size: 12px;">
  UndoManager: CanUndo={{canUndo}}, CanRedo={{canRedo}}
</div>
    <canvas 
      ref="staticCanvas" 
      class="whiteboard-canvas static-layer"
      style="position: absolute; top: 0; left: 0; pointer-events: none; z-index: 0;"
    ></canvas>
    <canvas 
      ref="drawCanvas" 
      class="whiteboard-canvas draw-layer"
      style="position: absolute; top: 0; left: 0; z-index: 1;"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      @wheel="handleZoom"
      @contextmenu.prevent
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @touchcancel="handleTouchEnd"
    ></canvas>

    <!-- Cursor overlays for other users -->
    <Collaborators
      v-if="yjsConnection?.awareness"
      ref="collaborators"
      :awareness="yjsConnection.awareness"
      :zoom-level="zoomLevel"
      :pan-offset="panOffset"
      :local-client-id="yjsConnection.awareness.clientID"
    />

    <!-- Render MovableObject components -->
    <movable-object
      v-for="elementMap in movableElements"
      :key="elementMap.get('id') || elementMap._tempKey || `fallback-${elementMap.doc?.clientID || 'u'}-${Date.now()}`"
      :object="elementMap"
      :zoom-level="zoomLevel"
      :pan-offset="panOffset"
      :is-selected="elementMap.get('id') === selectedObjectId"
      :interaction-enabled="currentTool === 'select'"
      @update:object="handleObjectUpdate"
      @request-select="handleObjectSelectionRequest"
      @clone-object="handleCloneObject"
      @update:snap-guides="handleSnapGuidesUpdate"
      @interaction-start="handleInteractionStart"
      @interaction-end="handleInteractionEnd"
      :snap-targets="snapTargets"
    ></movable-object>
    
    <!-- Snap Guides -->
    <svg v-if="snapGuides.length > 0" class="snap-guides-layer" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1000;">
      <line v-for="(guide, i) in snapGuides" :key="i"
        :x1="transformX(guide.x1)" :y1="transformY(guide.y1)"
        :x2="transformX(guide.x2)" :y2="transformY(guide.y2)"
        stroke="#ff0000" stroke-width="1" stroke-dasharray="4"
      />
    </svg>

    <!-- Inline Text Editor -->
    <textarea
      v-if="inlineTextEditor.visible"
      ref="inlineTextRef"
      v-model="inlineTextEditor.value"
      class="inline-text-editor"
      autofocus
      :style="inlineTextStyle"
      @blur="finalizeInlineText"
      @keydown.enter.stop="handleInlineTextEnter"
      @keydown.stop
      @mousedown.stop
      placeholder="Type here..."
    ></textarea>

    <!-- Zoom and pan controls -->
    <ZoomPanControls 
      :zoomLevel="zoomLevel"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-zoom="resetZoom"
    />

    <!-- Eraser mode controls -->
    <EraserModeControls 
      v-if="currentTool === 'eraser'"
      :mode="eraserMode"
      @update:mode="setEraserMode"
    />

    <!-- Connection loading indicator -->
    <div v-if="isConnecting" class="connection-loading">
      <div class="connection-spinner"></div>
      <span>Connecting...</span>
    </div>

    <!-- Status message -->
    <StatusMessage :message="statusMessage" />

    <!-- Clipboard handler -->
    <input 
      ref="clipboardInput"
      type="text" 
      class="clipboard-input"
      @paste="handlePaste"
    />
    <!-- Toast notifications -->
    <div class="notifications">
      <transition-group name="fade">
        <div
          v-for="notification in notifications"
          :key="notification.id"
          class="notification"
          :class="notification.type"
        >
          {{ notification.message }}
        </div>
      </transition-group>
    </div>
    <button v-if="debugMode"
      style="position: absolute; bottom: 10px; left: 10px; z-index: 9999;
             background: #2196F3; color: white; border: none; padding: 5px 10px;
             border-radius: 4px; cursor: pointer;"
      @click="testUndoManager">
      Test UndoManager
    </button>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, shallowRef, reactive, computed, toRaw } from 'vue';
import rough from 'roughjs';
import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
// jsPDF loaded dynamically only when PDF export is triggered (code splitting)
import 'katex/dist/katex.min.css';
// undoRedoState moved to useUndoRedo composable
import Collaborators from './Collaborators.vue';
import ZoomPanControls from './ZoomPanControls.vue';
import EraserModeControls from './EraserModeControls.vue';
import StatusMessage from './StatusMessage.vue';
// Helper modules
import GridAlignModule from '../modules/GridAlignModule.js';
import HandwritingStylerModule from '../modules/HandwritingStylerModule.js';
import MathRecognizerModule from '../modules/MathRecognizerModule.js';
// DEFAULT_PEN_PRESETS moved to useDrawingEngine composable
// Utils and Services
import { resolveBackendBaseUrl } from '../services/backendUrl';
import { connectToYjs } from '../services/connectToYjs';
import { drawElement, throttle, isPointInElement, distanceToSegment } from '../utils/canvasDrawing.js';
import { isPointInRotatedRectangle } from '../utils/geometry.js';
import {
  createImageElement,
  getCursorStyle,
  createCoordinateSystem2DElement,
  createCoordinateSystem3DElement
} from '../utils/canvasTools.js';
import { drawGrid as drawUtilGrid, computeGridSteps } from '../utils/canvasGrid.js';
import MovableObject from './MovableObject.vue';
import { useNotifications } from '../composables/useNotifications';
import { useUndoRedo } from '../composables/useUndoRedo';
import { useLineBindings } from '../composables/useLineBindings';
import { usePdfExport } from '../composables/usePdfExport';
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts';
import { useHelperModules } from '../composables/useHelperModules';
import { useDrawingEngine } from '../composables/useDrawingEngine';


// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const MAX_DEVICE_PIXEL_RATIO = 3;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

const clampDevicePixelRatio = () => {
  if (typeof window === 'undefined' || typeof window.devicePixelRatio === 'undefined') {
    return 1;
  }
  const ratio = window.devicePixelRatio || 1;
  return Math.min(Math.max(ratio, 1), MAX_DEVICE_PIXEL_RATIO);
};

const clampZoom = (value) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

const getTouchDistance = (touchA, touchB) => {
  const dx = touchA.clientX - touchB.clientX;
  const dy = touchA.clientY - touchB.clientY;
  return Math.hypot(dx, dy);
};

const getTouchCenter = (touchA, touchB, rect) => ({
  x: ((touchA.clientX + touchB.clientX) / 2) - rect.left,
  y: ((touchA.clientY + touchB.clientY) / 2) - rect.top,
});


export default {
  name: 'WhiteboardCanvas',
  components: {
    Collaborators,
    ZoomPanControls,
    EraserModeControls,
    StatusMessage,
    MovableObject, // Register MovableObject
  },
  props: {
    debugMode: { type: Boolean, default: false },
    currentShape: { type: String, default: 'rectangle' },
    currentLineStyle: { type: String, default: 'solid' },
    currentArrowStyle: { type: String, default: 'none' },
    currentRoughness: { type: Number, default: 1 }, // 0 = clean, 1 = default/sloppy
    currentFillColor: { type: String, default: null },
    // Feature configuration
    activeFeature: { type: String, default: null },
    gridAlignOptions: { type: Object, default: () => ({}) },
    handwritingStylerOptions: { type: Object, default: () => ({}) },
    mathRecognizerOptions: { type: Object, default: () => ({}) },
    // Props from App.vue (already existed)
    roomId: { type: String, required: true },
    roomKey: { type: [String, Object], default: null },
    username: { type: String, default: 'Anonymous' },
    wsToken: { type: String, default: null },
    onConnectionStatus: { type: Function, default: null }
  },
  emits: [
    'state-updated',
    'update:recognition-status',
    'update:latex-equation',
    'update:solution',
    'update:has-char-groups',
    'update:has-stylized-strokes',
    'select-pen-preset'
  ],
  setup(props, { emit, expose }) {
    const devicePixelRatio = ref(clampDevicePixelRatio());
    
    // Canvas refs
    // Canvas refs
    const containerRef = ref(null);
    const staticCanvas = ref(null);
    const staticContext = ref(null);
    const drawCanvas = ref(null);
    const drawContext = ref(null);
    const canvasWidth = ref(0);
    const canvasHeight = ref(0);

    // Module refs
    const gridAlignModule = ref(null);
    const handwritingStylerModule = ref(null);
    const mathRecognizerModule = ref(null);

    // UI State Refs
    const activeConfigPanel = ref(null);
    const configPanelCoords = ref(null);
    const lastMouseCoords = ref(null); // Track mouse position for auto-text
    // Inline Text Editor State
    const inlineTextEditor = reactive({
      visible: false,
      value: '',
      x: 0,
      y: 0,
      width: 200,
      height: 50,
      fontSize: 24
    });
    const inlineTextRef = ref(null);
    const focusInlineEditor = () => {
      // Try multiple times in case of layout/nextTick timing
      const tryFocus = (attempt = 0) => {
        const el = inlineTextRef.value;
        if (el) {
          el.focus({ preventScroll: true });
          // Place caret at end to start typing immediately
          const len = el.value?.length ?? 0;
          try { el.setSelectionRange(len, len); } catch (_) { /* Safari etc. */ }
          return;
        }
        if (attempt < 3) {
          requestAnimationFrame(() => tryFocus(attempt + 1));
        }
      };
      requestAnimationFrame(() => tryFocus());
    };

    // --- Computed ---
    const inlineTextStyle = computed(() => {
      const screenX = inlineTextEditor.x * zoomLevel.value + panOffset.value.x;
      const screenY = inlineTextEditor.y * zoomLevel.value + panOffset.value.y;
      const safeColor = currentColor.value || '#000000';
      return {
        position: 'absolute',
        left: `${screenX}px`,
        top: `${screenY}px`,
        fontSize: `${inlineTextEditor.fontSize * zoomLevel.value}px`,
        color: safeColor,
        minWidth: '50px',
        minHeight: '1.2em',
        zIndex: 2000,
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px dashed rgba(99, 102, 241, 0.4)',
        outline: 'none',
        borderRadius: '2px',
        resize: 'none',
        overflow: 'hidden',
        fontFamily: '"Kalam", cursive', // Hand-like font
        fontWeight: '400',
        lineHeight: '1.2',
        padding: '0',              // Remove padding to match text render
        margin: '0'
      };
    });


    const isDrawing = ref(false);
    const currentTool = ref('pen'); // Default to pen (matches App.vue)
    const currentColor = ref('#000000');
    const currentLineWidth = ref(2);
    const zoomLevel = ref(1);
    const panOffset = ref({ x: 0, y: 0 });
    const isPanning = ref(false);
    const lastPanPoint = ref(null);
    // --- Composables ---
    const { statusMessage, notifications, showStatus, showToast } = useNotifications();
    const isConnecting = ref(false);
    const darkMode = ref(false);
    const eraserMode = ref('erase');
    const eraserSize = ref(30);
    const lastReleasedElementIndex = ref(-1);
    // currentElementPreview, pointsBuffer, snapIndicator, shiftPressedAtStart,
    // startCoordsForShiftLine moved to useDrawingEngine composable
    const smoothingFactor = ref(0.65);
    // notifications and notificationId moved to useNotifications composable
    const debugModeEnabled = ref(props.debugMode);
    const debugLog = (...args) => {
      if (debugModeEnabled.value) {
        console.log(...args);
      }
    };
    const debugWarn = (...args) => {
      if (debugModeEnabled.value) {
        console.warn(...args);
      }
    };
    const clipboardInput = ref(null);
    const imageCache = ref(new Map());

    // PDF Export Composable — moved after yDrawings/ydoc declaration (see below)
    // activePenPresetKey, activePenPreset moved to useDrawingEngine composable
    const movableElementTypes = new Set([
        'pen',
        'line',
        'rectangle',
        'diamond',
        'circle',
        'square',
        'triangle',
        'trapezoid',
        'parallelogram',
        'deltoid',
        'cube',
        'cuboid',
        'sphere',
        'cylinder',
        'cone',
        'pyramid',
        'tetrahedron',
        'text',
        'image',
        'coordinateSystem2D',
        'coordinateSystem3D',
        'mathFunctionPlot',
        'physicsDataPlot',
        'latex'
    ]);

    const CONTENT_RENDER_TYPES = new Set([
        'text', 
        'image', 
        'latex', 
        'functionPlot', 
        'mathFunctionPlot', 
        'physicsDataPlot', 
        'coordinateSystem2D', 
        'coordinateSystem3D'
    ]);

    // SHAPE_TOOLS moved to useDrawingEngine composable
    const movableElements = shallowRef([]);
    const hoveredElementIndex = ref(-1);
    const selectedObjectId = ref(null); // Added for selection state
    // Watch selection changes to update DOM elements (placed at setup root to avoid leak)
    watch(selectedObjectId, () => {
        refreshMovableElements();
    });
    const interactingElementId = ref(null); // Track which element is being interacted with (drag/resize/rotate)
    const spacePanActive = ref(false);
    const connectorsVisible = computed(() => currentTool.value === 'lines' || (isDrawing.value && currentElementPreview.value?.type === 'line'));
    const panStartedWithSpace = ref(false);
    const pinchGesture = ref(null);
    let resizeObserver = null;
    let clipboardFocusHandler = null;

    const handleInteractionStart = (id) => {
        interactingElementId.value = id;
        redrawCanvas(); // Force redraw to show ghost
    };

    const handleInteractionEnd = (id) => {
        if (interactingElementId.value === id) {
            interactingElementId.value = null;
            redrawCanvas(); // Force redraw to hide ghost (if selected) or show normal
        }
    };

    // Helper module instances
    const yjsConnection = shallowRef(null);
    const ydoc = shallowRef(null);
    const yDrawings = shallowRef(null);
    const activeRoomId = ref(null);
    const latestUsername = ref(props.username);

    // --- PDF Export Composable (after yDrawings/ydoc are declared) ---
    const {
      exportBoardAsPdf, exportBoardAsPdfPaged,
      getSnapshot, getSerializableState, loadState, exportAsText, importFromText,
    } = usePdfExport({ yDrawings, ydoc, smoothingFactor, imageCache, showToast, debugLog, debugWarn });

    // --- Undo/Redo Composable (initialized after redrawCanvas is available) ---
    // Undo/redo composable needs to be called here, but undo/redo methods
    // will be wrapped later to include redrawCanvas callback.
    const {
      undoManager, canUndo, canRedo,
      updateGlobalState, initializeUndoManager,
      undo: undoCore, redo: redoCore,
      teardownUndoManager,
    } = useUndoRedo({ ydoc, yDrawings });
    
            
    // --- Line Bindings Composable ---
    const {
      BINDABLE_ELEMENT_TYPES,
      BINDING_DISTANCE_THRESHOLD,
      getConnectorAnchors,
      findElementMapById,
      getRectFromElementMap,
      findBindingTargetNearPoint,
      attachBindingsToLineDraft,
      updateBindingsForTarget,
      refreshLineBindings,
      detachLineBindings,
    } = useLineBindings(yDrawings, ydoc);

    // Line binding functions (getConnectorAnchors, findElementMapById, getRectFromElementMap,
    // distanceToRect, clampVectorToRotatedRect, makeBindingPayload, resolveBindingPoint,
    // getLineEndpoints, setLineEndpoints, findBindingTargetNearPoint, attachBindingsToLineDraft,
    // updateBindingsForTarget, refreshLineBindings, detachLineBindings)
    // moved to useLineBindings composable
    // updateGlobalState, initializeUndoManager, undo, redo moved to useUndoRedo composable
    // Wrap undo/redo with redrawCanvas callback (redrawCanvas is defined later via closure)
    const undo = () => undoCore(() => redrawCanvas(true));
    const redo = () => redoCore(() => redrawCanvas(true));

    // --- Helper Modules Composable (must be before useDrawingEngine because it provides getActiveModule) ---
    const {
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
    } = useHelperModules({
      gridAlignModule,
      handwritingStylerModule,
      mathRecognizerModule,
      ydoc,
      yDrawings,
      yjsConnection,
      zoomLevel,
      undoManager,
      updateGlobalState,
      redrawCanvas: (...args) => redrawCanvas(...args),
      refreshMovableElements: () => refreshMovableElements(),
      getActiveFeature: () => props.activeFeature,
      getGridAlignOptions: () => props.gridAlignOptions,
      emit,
      debugLog,
      debugWarn,
      showToast,
    });

    // --- Drawing Engine Composable ---
    const {
      currentElementPreview,
      pointsBuffer,
      snapIndicator,
      shiftPressedAtStart,
      startCoordsForShiftLine,
      activePenPresetKey,
      activePenPreset,
      cancelActiveDrawing,
      startDrawing,
      draw,
      finishDrawing,
      eraseElement,
    } = useDrawingEngine({
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
      getActiveModule,
      emit,
      debugLog,
      debugWarn,
      showToast,
    });

    // --- Methods ---

    // renderLatex moved to useHelperModules composable


    // Method to open a configuration panel
    const openConfigPanel = (panelType, coords) => {
      configPanelCoords.value = coords; // Store transformed coords
      activeConfigPanel.value = panelType;
      // Prevent drawing while config panel is open
      isDrawing.value = false;
      currentElementPreview.value = null;
    };

    // Method to close the active configuration panel
    const closeConfigPanel = () => {
      activeConfigPanel.value = null;
    };

    // Method to add a plot/coord system from panel data
    const addElementFromPanel = (elementData) => {
      if (!ydoc.value || !yDrawings.value || !elementData || !elementData.type) {
        console.error("Invalid data received from panel or Yjs not ready", elementData);
        closeConfigPanel();
        return;
      }

      try {
        // Ensure ID exists
        if (!elementData.id) {
            elementData.id = uuidv4();
        }

        ydoc.value.transact(() => {
          const yElementMap = new Y.Map();

          // Convert JS object/array properties to Yjs types
          for (const [key, value] of Object.entries(elementData)) {
            if (key === 'position' && typeof value === 'object' && value !== null) {
              const posMap = new Y.Map();
              posMap.set('x', value.x);
              posMap.set('y', value.y);
              yElementMap.set(key, posMap);
            } else if (Array.isArray(value)) {
              // Store plain arrays directly for data points (simpler for now)
              yElementMap.set(key, value);
            } else {
              yElementMap.set(key, value);
            }
          }

          // Normalize geometry for MovableObject overlays
          const hasPosition = elementData.position && typeof elementData.position.x === 'number' && typeof elementData.position.y === 'number';
          if (hasPosition) {
            yElementMap.set('x', elementData.position.x);
            yElementMap.set('y', elementData.position.y);
          }
          if (typeof elementData.width === 'number') {
            yElementMap.set('width', elementData.width);
          }
          if (typeof elementData.height === 'number') {
            yElementMap.set('height', elementData.height);
          }
          if (elementData.type === 'coordinateSystem3D' && typeof elementData.size === 'number') {
            const planeSize = elementData.size * 1.2;
            yElementMap.set('width', planeSize);
            yElementMap.set('height', planeSize);
          }

          // Apply default arrow style for lines if missing
          if (elementData.type === 'line' && !elementData.arrowStyle) {
              yElementMap.set('arrowStyle', props.currentArrowStyle || 'none');
          }

          yDrawings.value.push([yElementMap]);
          refreshMovableElements();
        }, 'local-plot'); // Origin

        nextTick(() => {
          if (undoManager.value) {
            updateGlobalState();
          }
          redrawCanvas(true); // Redraw to show the new element
        });

      } catch (error) {
        console.error('[addElementFromPanel] Error during Yjs transaction:', error);
        showToast("Error saving element.", "error");
      } finally {
        closeConfigPanel(); // Close panel after adding
      }
    };

    // applyMathAnswer moved to useHelperModules composable


    // Local scene cache to avoid expensive Yjs toJSON calls
    let localScene = [];
    const ELEMENT_COUNT_WARNING = 500;
    let elementCountWarningShown = false;

    const updateLocalScene = (overrideObject = null) => {
        if (!yDrawings.value) {
            localScene = [];
            return;
        }
        // Map Yjs elements to local plain objects once
        const rawArray = yDrawings.value.toArray();
        localScene = rawArray.map(map => {
            const json = map.toJSON();
            if (overrideObject && json.id === overrideObject.id) {
                return { ...json, ...overrideObject };
            }
            return json;
        });

        // UX-006: Warn user when element count is getting high
        if (rawArray.length >= ELEMENT_COUNT_WARNING && !elementCountWarningShown) {
            elementCountWarningShown = true;
            showToast(`Board has ${rawArray.length}+ elements. Performance may degrade.`, "warning");
        } else if (rawArray.length < ELEMENT_COUNT_WARNING) {
            elementCountWarningShown = false;
        }
        
        // Also sync with helper modules if needed
        if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value?.hasStylizedStrokes()) {
             // If styler is active, we might need to merge or replace strokes. 
             // For simplicity, let's assume styler handles its own data or we overlay it.
             // But the original code replaced strokesToDraw.
             // Let's keep the original logic but use localScene as base.
        }
    };

    const isElementVisible = (element, viewRect) => {
        let minX, minY, maxX, maxY;

        if (element.type === 'line' && element.start && element.end) {
            minX = Math.min(element.start.x, element.end.x);
            minY = Math.min(element.start.y, element.end.y);
            maxX = Math.max(element.start.x, element.end.x);
            maxY = Math.max(element.start.y, element.end.y);
            const padding = (element.lineWidth || 2) / 2;
            minX -= padding; minY -= padding; maxX += padding; maxY += padding;
        } else if (typeof element.x === 'number' && typeof element.y === 'number'
                   && typeof element.width === 'number' && typeof element.height === 'number') {
            // Use stored bounds (x, y, width, height) - works for pen, shapes, images, text
            minX = element.x;
            minY = element.y;
            maxX = element.x + element.width;
            maxY = element.y + element.height;
            // Add padding for pen strokes that may extend beyond bounds
            const padding = (element.lineWidth || 2);
            minX -= padding; minY -= padding; maxX += padding; maxY += padding;
        } else if (element.points && element.points.length > 0) {
            // Compute bounds from points on the fly (cached via _bounds)
            if (element._bounds) {
                ({ minX, minY, maxX, maxY } = element._bounds);
            } else {
                minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
                for (const pt of element.points) {
                    const px = typeof pt.x === 'number' ? pt.x : (Array.isArray(pt) ? pt[0] : 0);
                    const py = typeof pt.y === 'number' ? pt.y : (Array.isArray(pt) ? pt[1] : 0);
                    if (px < minX) minX = px;
                    if (py < minY) minY = py;
                    if (px > maxX) maxX = px;
                    if (py > maxY) maxY = py;
                }
                const padding = (element.lineWidth || 2);
                minX -= padding; minY -= padding; maxX += padding; maxY += padding;
                // Cache computed bounds on the element for subsequent frames
                element._bounds = { minX, minY, maxX, maxY };
            }
        } else {
            return true; // Default to visible if bounds unknown
        }

        return !(maxX < viewRect.x || minX > viewRect.x + viewRect.width ||
                 maxY < viewRect.y || minY > viewRect.y + viewRect.height);
    };

    const redrawStatic = () => {
      if (!staticContext.value) return;
      const ctx = staticContext.value;
      const ratio = devicePixelRatio.value || 1;
      
      // Ensure base HiDPI transform before clearing
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
      
      const rc = rough.canvas(ctx.canvas);

      // Draw utility grid
      // Optimization: Grid is drawn on every static redraw. 
      // If grid is heavy, it should be on a separate canvas, but for now it's okay here as it's static.
      drawUtilGrid(ctx, zoomLevel.value, panOffset.value, canvasWidth.value, canvasHeight.value, darkMode.value);

      ctx.save();
      ctx.setTransform(
        zoomLevel.value * ratio, 0,
        0, zoomLevel.value * ratio,
        panOffset.value.x * ratio, panOffset.value.y * ratio
      );

      // Determine strokes to draw
      let strokesToDraw = localScene;
      // debugLog(`[WhiteboardCanvas] redrawStatic: drawing ${strokesToDraw.length} strokes`);
      if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value?.hasStylizedStrokes()) {
          strokesToDraw = handwritingStylerModule.value.getStrokes();
      }

      // Calculate view rect in world coordinates for culling
      const viewRect = {
          x: -panOffset.value.x / zoomLevel.value,
          y: -panOffset.value.y / zoomLevel.value,
          width: canvasWidth.value / zoomLevel.value,
          height: canvasHeight.value / zoomLevel.value
      };

      // Draw visible elements
      strokesToDraw.forEach((element) => {
        // Skip elements that are currently rendered by the DOM layer (MovableObject)
        // This prevents double-rendering (e.g. bold text) and ensures complex plots are only in DOM
        const isContentRenderedInDom = CONTENT_RENDER_TYPES.has(element.type);
        const hasDomOverlay = ALWAYS_DOM_TYPES.has(element.type) || element.id === selectedObjectId.value;
        const isInteracting = element.id === interactingElementId.value;
        
        // Skip canvas drawing if it has a DOM overlay (MovableObject)
        // This prevents double rendering since MovableObject renders it (either via content or local canvas)
        if (hasDomOverlay) {
            return;
        }
        
        // Also skip ALL objects (including shapes) that are selected or being interacted with
        // because MovableObject now renders them locally during interaction for smooth manipulation
        if (isInteracting || element.id === selectedObjectId.value) {
            return;
        }
        
        if (!isElementVisible(element, viewRect)) {
            return;
        }

        drawElement(
          ctx,
          element,
          false, // isHighlighted - handled in dynamic layer
          smoothingFactor.value,
          imageCache.value,
          () => invalidate(true), // callback for image load - triggers static redraw
          props.handwritingStylerOptions || {},
          rc
        );
      });
      
      ctx.restore();
    };

    const redrawDynamic = () => {
      if (!drawContext.value) return;
      const ctx = drawContext.value;
      const ratio = devicePixelRatio.value || 1;
      const gridMetrics = computeGridSteps(zoomLevel.value);
      const rc = rough.canvas(ctx.canvas); // Reuse single rc for all dynamic draws

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);

      ctx.save();
      ctx.setTransform(
        zoomLevel.value * ratio, 0,
        0, zoomLevel.value * ratio,
        panOffset.value.x * ratio, panOffset.value.y * ratio
      );

      // 1. Draw Highlighted Element (Eraser Hover)
      if (hoveredElementIndex.value !== -1 && currentTool.value === 'eraser' && yDrawings.value) {
         const elementMap = yDrawings.value.get(hoveredElementIndex.value);
         if (elementMap) {
             const element = elementMap.toJSON();
             drawElement(
                ctx,
                element,
                true, // isHighlighted
                smoothingFactor.value,
                imageCache.value,
                undefined,
                props.handwritingStylerOptions || {},
                rc
             );
         }
      }

      // 2. Connector handles
      const drawCircle = (x, y, r, fill = 'rgba(99,102,241,0.28)', stroke = 'rgba(99,102,241,0.9)') => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1 / (zoomLevel.value * (devicePixelRatio.value || 1));
        ctx.fill();
        ctx.stroke();
      };

      const drawConnectorDotsForElement = (element) => {
        const rect = getRectFromElementMap({
          get: (k) => element[k],
        });
        if (!rect) return;
        const anchors = getConnectorAnchors(rect);
        anchors.forEach(({ anchorWorld }) => {
          drawCircle(anchorWorld.x, anchorWorld.y, Math.max(4, 6 / zoomLevel.value));
        });
      };

      // Reuse localScene for connector dots (avoid expensive toArray().toJSON() on every dynamic redraw)
      const strokesToDraw = localScene;

      if (connectorsVisible.value) {
        const connectorElementIds = new Set();
        const collectNearbyElements = (point) => {
          if (!point) return;
          const hits = findBindingTargetNearPoint(point, null, BINDING_DISTANCE_THRESHOLD * 1.1, true);
          hits.forEach((hit) => {
            const elementId = hit?.map?.get?.('id');
            if (elementId) connectorElementIds.add(elementId);
          });
        };

        if (lastMouseCoords.value) collectNearbyElements(lastMouseCoords.value);
        if (isDrawing.value && currentElementPreview.value?.type === 'line') {
          if (currentElementPreview.value.start) collectNearbyElements(currentElementPreview.value.start);
          if (currentElementPreview.value.end) collectNearbyElements(currentElementPreview.value.end);
        }

        if (connectorElementIds.size > 0) {
          strokesToDraw.forEach((element) => {
            const elementId = element.id;
            if (elementId && connectorElementIds.has(elementId) && BINDABLE_ELEMENT_TYPES.has(element.type)) {
              drawConnectorDotsForElement(element);
            }
          });
        }

        if (isDrawing.value && currentElementPreview.value?.type === 'line' && currentElementPreview.value.start && currentElementPreview.value.end) {
          drawCircle(currentElementPreview.value.start.x, currentElementPreview.value.start.y, Math.max(4, 6 / zoomLevel.value), 'rgba(147,197,253,0.35)', 'rgba(37,99,235,0.9)');
          drawCircle(currentElementPreview.value.end.x, currentElementPreview.value.end.y, Math.max(4, 6 / zoomLevel.value), 'rgba(147,197,253,0.35)', 'rgba(37,99,235,0.9)');
        }
      }

      // 3. Draw current preview
      if (isDrawing.value && currentElementPreview.value) {
        drawElement(
          ctx,
          currentElementPreview.value,
          false,
          smoothingFactor.value,
          undefined,
          undefined,
          props.handwritingStylerOptions || {},
          rc
        );
      }

      // 4. Helper overlays
      if (props.activeFeature === 'gridAlign' && gridAlignModule.value) {
        if (props.gridAlignOptions.showBaselines) {
          gridAlignModule.value.setOptions({ ...props.gridAlignOptions, gridSize: gridMetrics.worldGridStep });
          gridAlignModule.value.detectBaselines();
          gridAlignModule.value.drawBaselines(ctx);
        }
      } else if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value) {
        handwritingStylerModule.value.drawCharGroups(ctx);
      } else if (props.activeFeature === 'mathRecognizer' && mathRecognizerModule.value) {
        mathRecognizerModule.value.drawGhostAnswer(ctx);
      }

      // 5. Snap Indicator
      if (snapIndicator.value && props.activeFeature === 'gridAlign') {
        const indicator = snapIndicator.value;
        const scale = zoomLevel.value * ratio;
        const worldWidth = canvasWidth.value / zoomLevel.value;
        const worldStartX = -panOffset.value.x / zoomLevel.value;
        ctx.save();
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = 'rgba(33, 150, 243, 0.9)';
        ctx.fillStyle = 'rgba(33, 150, 243, 0.15)';

        if (indicator.axis === 'y') {
          const y = indicator.y;
          ctx.beginPath();
          ctx.moveTo(worldStartX, y);
          ctx.lineTo(worldStartX + worldWidth, y);
          ctx.stroke();
          const r = Math.min(indicator.radius || 4, 8 / zoomLevel.value);
          ctx.beginPath();
          ctx.arc(indicator.x ?? worldStartX, y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const fallbackRadius = gridMetrics.worldGridStep * 0.35;
          const r = indicator.radius || fallbackRadius;
          ctx.beginPath();
          ctx.arc(indicator.x, indicator.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(indicator.x, indicator.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      
      ctx.restore();
    };

    // --- Render Loop Optimization ---
    let redrawStaticNeeded = false;
    let redrawDynamicNeeded = false;
    let rafId = null;

    const invalidate = (full = false) => {
        redrawDynamicNeeded = true;
        if (full) redrawStaticNeeded = true;
    };

    const redrawCanvas = (full = true) => {
        invalidate(full);
    };

    const scheduleRedraw = (full = false) => {
        invalidate(full);
    };

    const renderLoop = () => {
        rafId = requestAnimationFrame(renderLoop);
        
        if (!redrawStaticNeeded && !redrawDynamicNeeded) return;

        if (redrawStaticNeeded) {
            redrawStatic();
            redrawStaticNeeded = false;
        }
        
        if (redrawDynamicNeeded) {
            redrawDynamic();
            redrawDynamicNeeded = false;
        }
    };

    // syncModulesWithYjs moved to useHelperModules composable

    // Types that MUST be rendered in DOM (interactive elements with MovableObject overlays)
    // Matching commit 60e77346 - ALL shapes need overlays for interaction
    const ALWAYS_DOM_TYPES = new Set([
        // 'text', // Removed to avoid double rendering (Canvas + DOM)
        // 'image', // Removed to avoid double rendering
        'latex', // Kept because Canvas does not render latex
        'functionPlot', 
        'mathFunctionPlot', 
        'physicsDataPlot', 
        'coordinateSystem2D', 
        'coordinateSystem3D',
        // ALL shapes - they are drawn on canvas but need DOM overlays for interaction
        'rectangle',
        'circle',
        'square',
        'triangle',
        'diamond',
        'trapezoid',
        'parallelogram',
        'deltoid',
        'cube',
        'cuboid',
        'sphere',
        'cylinder',
        'cone',
        'pyramid',
        'tetrahedron',
        'line'
    ]);

    const refreshMovableElements = () => {
        const beforeCount = movableElements.value.length;
        if (!yDrawings.value) {
            movableElements.value = [];
            return;
        }
        
        // Optimization: Only render DOM elements for complex types or the currently selected object.
        // Simple shapes (pen, rect, circle, line) are drawn on canvas and don't need a DOM element unless selected.
        const filtered = yDrawings.value
            .toArray()
            .filter(map => {
                const type = map.get('type');
                const id = map.get('id');
                // Include if it's a complex type OR if it's the currently selected object
                return ALWAYS_DOM_TYPES.has(type) || id === selectedObjectId.value;
            })
            .map(map => {
                if (!map.get('id')) {
                    if (!map._tempKey) {
                        const clientId = map.doc?.clientID ?? 'local';
                        map._tempKey = `temp-${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    }
                } else if (map._tempKey) {
                    delete map._tempKey;
                }
                return map;
            });
            
        movableElements.value = filtered;
        // debugLog(`[refreshMovableElements] Updated: before=${beforeCount}, after=${filtered.length}, yDrawings=${yDrawings.value.length}`);
    };

    const findMovableElementIdAtPoint = (coords) => {
        if (!yDrawings.value) return null;
        const elements = yDrawings.value.toArray().slice().reverse();
        for (const elementMap of elements) {
            const type = elementMap.get('type');
            if (!movableElementTypes.has(type)) continue;
            const x = elementMap.get('x');
            const y = elementMap.get('y');
            const width = elementMap.get('width');
            const height = elementMap.get('height');
            if (![x, y, width, height].every(value => typeof value === 'number' && !Number.isNaN(value))) {
                continue;
            }
            const rotation = elementMap.get('rotation') || 0;
            if (isPointInRotatedRectangle(coords, x, y, width, height, rotation)) {
                return elementMap.get('id');
            }
        }
        return null;
    };

    const updateAwarenessUser = (name = latestUsername.value) => {
        if (!yjsConnection.value?.awareness) {
            return;
        }
        const existingUser = yjsConnection.value.awareness.getLocalState()?.user || {};
        const normalizedName = (name && name.trim().length > 0 ? name.trim() : existingUser.name) || 'Anonymous';
        yjsConnection.value.awareness.setLocalStateField('user', {
            ...existingUser,
            name: normalizedName,
            color: existingUser.color || currentColor.value || '#000000'
        });
    };

    // Setup awareness listener to track other users
    let awarenessRedrawScheduled = false;
    const setupAwarenessListener = () => {
        debugLog('[WhiteboardCanvas] setupAwarenessListener called');
        if (!yjsConnection.value?.awareness) {
            console.warn('[WhiteboardCanvas] No awareness available!');
            return;
        }

        const awareness = yjsConnection.value.awareness;
        debugLog('[WhiteboardCanvas] Setting up awareness listener, clientID:', awareness.clientID);

        // Listen for awareness changes (cursors, online users)
        // Throttled via rAF to avoid full dynamic redraw on every cursor move from every user
        awareness.on('change', () => {
            if (!awarenessRedrawScheduled) {
                awarenessRedrawScheduled = true;
                requestAnimationFrame(() => {
                    awarenessRedrawScheduled = false;
                    redrawCanvas(false); // Cursors are dynamic
                });
            }
        });
    };

    const teardownYjsConnection = () => {
        if (yDrawings.value) {
            yDrawings.value.unobserveDeep(handleYjsUpdate);
        }
        teardownUndoManager();
        if (yjsConnection.value) {
            yjsConnection.value.disconnect();
        }
        yjsConnection.value = null;
        ydoc.value = null;
        yDrawings.value = null;
        activeRoomId.value = null;
        movableElements.value = [];
    };

    const handleYjsUpdate = (event) => {
        // debugLog('[WhiteboardCanvas] Yjs update received', event);
        updateLocalScene(); // Sync local cache
        refreshMovableElements();
        syncModulesWithYjs();
        redrawCanvas(true); // Remote update -> static update
        
        nextTick(() => {
             if (undoManager.value) {
                 updateGlobalState();
             }
        });
    };

    const connectToRoom = async (targetRoomId) => {
        const normalizedRoomId = targetRoomId?.trim();
        if (!normalizedRoomId) {
            showToast("Room ID missing. Collaboration disabled.", "error");
            return;
        }
        if (normalizedRoomId === activeRoomId.value) {
            return;
        }

        teardownYjsConnection();
        selectedObjectId.value = null;
        isConnecting.value = true;

        try {
            // Pass roomKey to connectToYjs for E2E encryption
            const connection = await connectToYjs(normalizedRoomId, {
              wsToken: props.wsToken || undefined,
              onStatus: (status) => {
                if (typeof props.onConnectionStatus === 'function') {
                  props.onConnectionStatus(status);
                }
              }
            });
            yjsConnection.value = connection;
            ydoc.value = connection.ydoc;
            yDrawings.value = connection.yDrawings;

            if (!yDrawings.value) {
                throw new Error('Yjs shared drawings array is unavailable.');
            }

            yDrawings.value.observeDeep(handleYjsUpdate);
            setupAwarenessListener(); // Enable cursor tracking and online count
            activeRoomId.value = normalizedRoomId;
            updateLocalScene(); // Initial sync
            refreshMovableElements();

            // Ensure modules and undo manager sync with the new document
            syncModulesWithYjs();
            setTimeout(() => {
                initializeUndoManager();
                redrawCanvas(true);
            }, 100);

            updateAwarenessUser(latestUsername.value);
        } catch (error) {
            console.error("Failed to connect Yjs provider:", error);
            showToast("Error connecting to collaboration session.", "error");
        } finally {
            isConnecting.value = false;
        }
    };




    const initCanvas = () => {
      if (staticCanvas.value) {
        staticContext.value = staticCanvas.value.getContext('2d');
        staticContext.value.lineCap = 'round';
        staticContext.value.lineJoin = 'round';
      }
      if (drawCanvas.value) {
        drawContext.value = drawCanvas.value.getContext('2d');
        drawContext.value.lineCap = 'round';
        drawContext.value.lineJoin = 'round';
        drawContext.value.strokeStyle = currentColor.value;
        drawContext.value.lineWidth = currentLineWidth.value;
      }
      
      darkMode.value = document.body.classList.contains('dark-mode');
      redrawCanvas(true);
      updateCursor();
      nextTick(() => {
        const activeEl = document.activeElement;
        if (
          clipboardInput.value &&
          (!activeEl || activeEl === document.body)
        ) {
          clipboardInput.value.focus({ preventScroll: true });
        }
      });
    };

    const initClipboardHandler = () => {
      if (clipboardFocusHandler) return;
      clipboardFocusHandler = (event) => {
        if (!clipboardInput.value) return;

        const target = event?.target;
        const tagName = target?.tagName?.toUpperCase?.() || '';
        const isInteractive =
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          target?.isContentEditable;

        // Do not steal focus while typing in any input (including inline text)
        if (isInteractive || inlineTextEditor.visible) return;

        clipboardInput.value.focus({ preventScroll: true });
      };
      document.addEventListener('click', clipboardFocusHandler);
    };

    const applyHiDPIScaling = (ratio = devicePixelRatio.value) => {
      const displayWidth = canvasWidth.value;
      const displayHeight = canvasHeight.value;
      if (!displayWidth || !displayHeight) return;

      const scaledWidth = Math.floor(displayWidth * ratio);
      const scaledHeight = Math.floor(displayHeight * ratio);

      [staticCanvas.value, drawCanvas.value].forEach(cvs => {
        if (!cvs) return;
        cvs.width = scaledWidth;
        cvs.height = scaledHeight;
        cvs.style.width = `${displayWidth}px`;
        cvs.style.height = `${displayHeight}px`;
      });

      [staticContext.value, drawContext.value].forEach(ctx => {
        if (!ctx) return;
        if (typeof ctx.resetTransform === 'function') {
           ctx.resetTransform();
           ctx.scale(ratio, ratio);
        } else {
           ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      });
      
      if (drawContext.value) {
        drawContext.value.strokeStyle = currentColor.value;
        drawContext.value.lineWidth = currentLineWidth.value;
      }
    };

    const updateCanvasSize = (width, height) => {
      if (!staticCanvas.value || !drawCanvas.value) return;
      const logicalWidth = Math.floor(width);
      const logicalHeight = Math.floor(height);
      if (logicalWidth <= 0 || logicalHeight <= 0) return;

      const nextRatio = clampDevicePixelRatio();
      const sizeChanged = logicalWidth !== canvasWidth.value || logicalHeight !== canvasHeight.value;
      const ratioChanged = nextRatio !== devicePixelRatio.value;

      if (!sizeChanged && !ratioChanged) {
        return;
      }

      if (sizeChanged) {
        canvasWidth.value = logicalWidth;
        canvasHeight.value = logicalHeight;
      }

      if (ratioChanged) {
        devicePixelRatio.value = nextRatio;
      }

      applyHiDPIScaling(nextRatio);
      redrawCanvas(true);
    };

    const handleResize = () => {
      const container = containerRef.value;
      if (!container) return;
      updateCanvasSize(container.clientWidth, container.clientHeight);
    };

    const initResizeObserver = () => {
      if (resizeObserver || typeof ResizeObserver === 'undefined') return;
      const target = containerRef.value;
      if (!target) return;
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        updateCanvasSize(width, height);
      });
      resizeObserver.observe(target);
    };

    // cancelActiveDrawing moved to useDrawingEngine composable

    const resetSpacePanState = (shouldRedraw = false) => {
      spacePanActive.value = false;
      if (panStartedWithSpace.value) {
        isPanning.value = false;
        panStartedWithSpace.value = false;
        lastPanPoint.value = null;
        if (shouldRedraw) redrawCanvas(true);
      }
      updateCursor();
    };

    const startPinchGesture = (touches) => {
      if (touches.length < 2 || !drawCanvas.value) return;
      const rect = drawCanvas.value.getBoundingClientRect();
      const touchA = touches[0];
      const touchB = touches[1];
      if (!touchA || !touchB) return;
      pinchGesture.value = {
        startDistance: getTouchDistance(touchA, touchB),
        initialZoom: zoomLevel.value,
        lastCanvasCenter: getTouchCenter(touchA, touchB, rect),
      };
      if (isDrawing.value) {
        finishDrawing();
      }
      isPanning.value = true;
      panStartedWithSpace.value = false;
      updateCursor();
    };

    const updatePinchGesture = (touches) => {
      if (!pinchGesture.value || touches.length < 2 || !drawCanvas.value) return;
      const rect = drawCanvas.value.getBoundingClientRect();
      const touchA = touches[0];
      const touchB = touches[1];
      if (!touchA || !touchB) return;
      const canvasCenter = getTouchCenter(touchA, touchB, rect);
      const gesture = pinchGesture.value;
      const prevCenter = gesture.lastCanvasCenter || canvasCenter;

      panOffset.value.x += canvasCenter.x - prevCenter.x;
      panOffset.value.y += canvasCenter.y - prevCenter.y;

      const distance = getTouchDistance(touchA, touchB);
      const scale = gesture.startDistance ? distance / gesture.startDistance : 1;
      const targetZoom = clampZoom(gesture.initialZoom * scale);
      const prevZoom = zoomLevel.value;

      const worldX = (canvasCenter.x - panOffset.value.x) / prevZoom;
      const worldY = (canvasCenter.y - panOffset.value.y) / prevZoom;

      zoomLevel.value = targetZoom;
      panOffset.value.x = canvasCenter.x - worldX * zoomLevel.value;
      panOffset.value.y = canvasCenter.y - worldY * zoomLevel.value;
      gesture.lastCanvasCenter = canvasCenter;

      redrawCanvas();
      showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
    };

    const endTouchGesture = () => {
      pinchGesture.value = null;
      if (!panStartedWithSpace.value) {
        isPanning.value = false;
      }
      lastPanPoint.value = null;
      updateCursor();
    };

    const handleDarkModeChange = () => {
       const newDarkMode = document.body.classList.contains('dark-mode');
       if (darkMode.value !== newDarkMode) {
         darkMode.value = newDarkMode;
         redrawCanvas(true);
       }
    };

    const darkModeObserver = new MutationObserver(handleDarkModeChange);

    // --- Input Handlers ---

    const getCoordinates = (event) => {
      if (!drawCanvas.value) return { offsetX: 0, offsetY: 0 };
      const rect = drawCanvas.value.getBoundingClientRect();
      if (event.touches && event.touches[0]) {
        return {
          offsetX: event.touches[0].clientX - rect.left,
          offsetY: event.touches[0].clientY - rect.top
        };
      }
      return {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
    };

    const transformCoordinates = (x, y) => {
      return {
        x: (x - panOffset.value.x) / zoomLevel.value,
        y: (y - panOffset.value.y) / zoomLevel.value
      };
    };

    // addSmoothedPenPoint, computePenWidthFromPreset, getSnapSettings,
    // applySoftGridSnap, applyGridSnapHard moved to useDrawingEngine composable

    const updateLocalAwarenessCursor = throttle((coords) => {
        if (yjsConnection.value?.awareness) {
            const userState = yjsConnection.value.awareness.getLocalState()?.user || { name: 'Anonymous', color: '#000000' };
            yjsConnection.value.awareness.setLocalStateField('cursor', {
                x: coords.x,
                y: coords.y,
            });
            yjsConnection.value.awareness.setLocalStateField('user', userState);
        }
    }, 50);

    const handleMouseMove = (e) => {
      const coords = getCoordinates(e);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
      lastMouseCoords.value = transformedCoords; // Store for keydown events
      updateLocalAwarenessCursor(transformedCoords);

      // Don't handle drawing/panning if a config panel is active
      if (activeConfigPanel.value) return;

      if (isPanning.value && lastPanPoint.value) {
        const currentPanPoint = transformCoordinates(coords.offsetX, coords.offsetY);
        panOffset.value.x += coords.offsetX - lastPanPoint.value.screenX;
        panOffset.value.y += coords.offsetY - lastPanPoint.value.screenY;
        lastPanPoint.value = { ...currentPanPoint, screenX: coords.offsetX, screenY: coords.offsetY };
        redrawCanvas(true); // Pan requires full redraw
        return;
      }

      if (isDrawing.value && currentTool.value !== 'eraser') {
        draw(transformedCoords, e.shiftKey, e.timeStamp); // Pass shift key state
      } else if (currentTool.value === 'eraser') {
        let foundIndex = -1;
        if (yDrawings.value) {
            const elementsArray = yDrawings.value.toArray(); // Get a JS array
            for (let i = elementsArray.length - 1; i >= 0; i--) {
                const elementMap = elementsArray[i];
                try {
                    // Convert Y.Map to plain object for hit testing
                    const element = {};
                    for (const [key, value] of elementMap.entries()) {
                        element[key] = (value instanceof Y.Map || value instanceof Y.Array) ? value.toJSON() : value;
                    }
                    const hitPadding = Math.max((element.lineWidth || 2) / 2 + 5, eraserSize.value / 2);
                    if (isPointInElement(transformedCoords, element, hitPadding)) {
                        foundIndex = i;
                        break;
                    }
                } catch (error) {
                    // console.error("Error processing element for eraser hover:", elementMap, error); // Commented out
                }
            }
        }
        if (hoveredElementIndex.value !== foundIndex) {
            hoveredElementIndex.value = foundIndex;
            redrawCanvas(false); // Dynamic only (highlight)
        }
        if (isDrawing.value && foundIndex !== -1) {
           eraseElement(foundIndex);
        }
      } else {
         if (hoveredElementIndex.value !== -1) {
             hoveredElementIndex.value = -1;
             redrawCanvas(false); // Dynamic only
         }
      }
    };

    const handleMouseDown = (event) => {
      shiftPressedAtStart.value = event.shiftKey; 
      startCoordsForShiftLine.value = null; 

      if (activeConfigPanel.value) return;

      const coords = getCoordinates(event);
      const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);

      if (event.button === 2) { // Right-click
        event.preventDefault();
        if (isDrawing.value) return; // Don't select if in the middle of drawing a new shape

        const clickedObjectFoundId = findMovableElementIdAtPoint(transformedCoords);
        selectedObjectId.value = clickedObjectFoundId;
        debugLog('[WhiteboardCanvas] Right-click selected:', selectedObjectId.value);
        redrawCanvas(false); // Selection is dynamic (overlay/MovableObject) - wait, MovableObject is DOM.
        // But if we have selection logic in canvas (e.g. highlight), we need redraw.
        // MovableObject handles its own rendering.
        // redrawCanvas() calls drawElement with isHighlighted=false for static.
        // But wait, MovableObject is a component.
        // Does redrawCanvas draw selection box? No.
        // So redrawCanvas might not be needed for selection if it's purely DOM.
        // But let's keep it safe.
        return;
      }

      const shouldSpacePan = event.button === 0 && spacePanActive.value;
      const shouldToolPan = event.button === 0 && currentTool.value === 'pan';
      if (event.button === 1 || (event.button === 0 && event.altKey) || shouldSpacePan || shouldToolPan) { // Middle mouse, Alt+Left, Space+Left, or Pan tool
        isPanning.value = true;
        lastPanPoint.value = { ...transformedCoords, screenX: coords.offsetX, screenY: coords.offsetY };
        panStartedWithSpace.value = shouldSpacePan;
        event.preventDefault();
        updateCursor();
        return;
      }
      
      if (event.button === 0) { // Left-click
        if (currentTool.value === 'select') {
            const hitObjectId = findMovableElementIdAtPoint(transformedCoords);
            if (hitObjectId) {
                if (event.altKey) {
                    const map = findElementMapById(hitObjectId);
                    if (map && map.get('type') === 'line') {
                        detachLineBindings(hitObjectId);
                        redrawCanvas(true); // Line binding change -> static update
                        return;
                    }
                }
                handleObjectSelectionRequest(hitObjectId);
            } else if (selectedObjectId.value) {
                selectedObjectId.value = null;
                redrawCanvas(false);
            }
            return;
        }

        if (selectedObjectId.value) {
            selectedObjectId.value = null;
        }

        if (currentTool.value === 'eraser') {
            // Eraser logic (hover and click to erase is handled in mouseMove)
            isDrawing.value = true; // Allow dragging eraser over elements
        } else if (currentTool.value === 'mathPlot') {
          openConfigPanel('math', transformedCoords);
        } else if (currentTool.value === 'physicsPlot') {
          openConfigPanel('physics', transformedCoords);
        } else if (currentTool.value === 'coordSystem2D') {
          const elementData = createCoordinateSystem2DElement(transformedCoords);
          addElementFromPanel(elementData);
        } else if (currentTool.value === 'coordSystem3D') {
          const elementData = createCoordinateSystem3DElement(transformedCoords);
          addElementFromPanel(elementData);
        } else {
          startDrawing(event, getCoordinates, transformCoordinates);
        }
        return; 
      }
    };


    const handleMouseUp = (event) => {
      // Don't handle mouse up if a config panel is active
      if (activeConfigPanel.value) return;

      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
        panStartedWithSpace.value = false;
        updateCursor();
        return;
      }
      if (isDrawing.value) {
         if (currentTool.value === 'eraser') {
             isDrawing.value = false;
         } else {
             finishDrawing();
         }
      }
      snapIndicator.value = null;
      redrawCanvas(true); // Mouse up -> finish drawing -> static update
    };

    const handleWindowMouseUp = (event) => {
      if (isDrawing.value || isPanning.value) {
        handleMouseUp(event);
      }
    };

    const handleMouseLeave = (event) => {
      // Don't handle mouse leave if a config panel is active
      if (activeConfigPanel.value) return;

      if (isPanning.value) {
        isPanning.value = false;
        lastPanPoint.value = null;
        panStartedWithSpace.value = false;
        updateCursor();
      }
      if (isDrawing.value) {
        finishDrawing();
      }
       if (yjsConnection.value?.awareness) {
           yjsConnection.value.awareness.setLocalStateField('cursor', null);
           const userState = yjsConnection.value.awareness.getLocalState()?.user;
       if (userState) {
               yjsConnection.value.awareness.setLocalStateField('user', userState);
           }
       }
       snapIndicator.value = null;
       redrawCanvas(false); // Mouse leave -> clear dynamic
    };

    const handleTouchStart = (event) => {
        if (event.touches.length >= 2) {
            event.preventDefault();
            startPinchGesture(event.touches);
            return;
        }

        if (event.touches.length === 1 && !pinchGesture.value) {
            event.preventDefault();
            const syntheticMouseEvent = {
                clientX: event.touches[0].clientX,
                clientY: event.touches[0].clientY,
                button: 0,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                preventDefault: () => event.preventDefault(),
            };
            handleMouseDown(syntheticMouseEvent);
        }
    };

    const handleTouchMove = (event) => {
        if (pinchGesture.value && event.touches.length >= 2) {
            event.preventDefault();
            updatePinchGesture(event.touches);
            return;
        }

        if (event.touches.length === 1 && !pinchGesture.value) {
            event.preventDefault();
            const coords = getCoordinates(event);
            const transformedCoords = transformCoordinates(coords.offsetX, coords.offsetY);
            updateLocalAwarenessCursor(transformedCoords);

            // P1-FIX: Pan tool panning via touch
            if (isPanning.value && lastPanPoint.value) {
                panOffset.value.x += coords.offsetX - lastPanPoint.value.screenX;
                panOffset.value.y += coords.offsetY - lastPanPoint.value.screenY;
                lastPanPoint.value = { ...transformedCoords, screenX: coords.offsetX, screenY: coords.offsetY };
                redrawCanvas(true);
                return;
            }

            // P0-FIX: Eraser must work on touch (iPad) - replicate handleMouseMove eraser logic
            if (currentTool.value === 'eraser') {
                let foundIndex = -1;
                if (yDrawings.value) {
                    const elementsArray = yDrawings.value.toArray();
                    for (let i = elementsArray.length - 1; i >= 0; i--) {
                        const elementMap = elementsArray[i];
                        try {
                            const element = {};
                            for (const [key, value] of elementMap.entries()) {
                                element[key] = (value instanceof Y.Map || value instanceof Y.Array) ? value.toJSON() : value;
                            }
                            const hitPadding = Math.max((element.lineWidth || 2) / 2 + 5, eraserSize.value / 2);
                            if (isPointInElement(transformedCoords, element, hitPadding)) {
                                foundIndex = i;
                                break;
                            }
                        } catch (_) { /* ignore */ }
                    }
                }
                if (hoveredElementIndex.value !== foundIndex) {
                    hoveredElementIndex.value = foundIndex;
                    redrawCanvas(false);
                }
                if (isDrawing.value && foundIndex !== -1) {
                    eraseElement(foundIndex);
                }
            } else if (isDrawing.value) {
                draw(transformedCoords, false, event.timeStamp);
            }
        }
    };

    const handleTouchEnd = (event) => {
        event.preventDefault();

        if (pinchGesture.value && event.touches.length < 2) {
            endTouchGesture();
        }

        if (event.touches.length === 0) {
            const syntheticMouseEvent = {
                button: 0,
            };
            handleMouseUp(syntheticMouseEvent);
        }

        if (yjsConnection.value?.awareness && event.touches.length === 0) {
            yjsConnection.value.awareness.setLocalStateField('cursor', null);
            const userState = yjsConnection.value.awareness.getLocalState()?.user;
            if (userState) {
                yjsConnection.value.awareness.setLocalStateField('user', userState);
            }
        }
        snapIndicator.value = null;
    };

    // --- Drawing Logic (Yjs Integration) ---

    // --- Inline Text Methods ---
    const addTextElement = (coords, text, fontSize = 24) => {
      if (!ydoc.value || !yDrawings.value) return;

      const id = `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`;

      try {
        ydoc.value.transact(() => {
          const yTextMap = new Y.Map();
          yTextMap.set('id', id);
          yTextMap.set('type', 'text');
          yTextMap.set('x', coords.x);
          yTextMap.set('y', coords.y);
          yTextMap.set('text', text);
          yTextMap.set('fontSize', fontSize);
          yTextMap.set('color', currentColor.value);
          yTextMap.set('timestamp', Date.now());
          yTextMap.set('rotation', 0);
          
          // Estimate size
          if (drawContext.value) {
            drawContext.value.save();
            drawContext.value.font = `${fontSize}px "Kalam", cursive`;
            const metrics = drawContext.value.measureText(text);
            drawContext.value.restore();
            yTextMap.set('width', metrics.width);
            yTextMap.set('height', fontSize * 1.2);
          } else {
             yTextMap.set('width', text.length * fontSize * 0.6);
             yTextMap.set('height', fontSize * 1.2);
          }

          yDrawings.value.push([yTextMap]);
          refreshMovableElements();
        }, 'local-add-text');

        nextTick(() => {
            if (undoManager.value) {
                updateGlobalState();
            }
            redrawCanvas(true);
        });
      } catch (error) {
        console.error("Error adding text element:", error);
        showToast("Failed to add text", "error");
      }
    };

    const startInlineText = (coords) => {
      inlineTextEditor.x = coords.x;
      inlineTextEditor.y = coords.y;
      inlineTextEditor.value = '';
      inlineTextEditor.visible = true;
      // Heuristic for font size based on line width or default
      inlineTextEditor.fontSize = currentLineWidth.value * 10 > 20 ? currentLineWidth.value * 10 : 24; 

      // Move focus away from the hidden clipboard input so typing goes to the editor
      if (clipboardInput.value) {
        clipboardInput.value.blur();
      }
      
      nextTick(focusInlineEditor);
    };

    const finalizeInlineText = () => {
      if (!inlineTextEditor.visible) return;
      
      const text = inlineTextEditor.value.trim();
      if (text) {
        addTextElement({ x: inlineTextEditor.x, y: inlineTextEditor.y }, text, inlineTextEditor.fontSize);
      }
      
      inlineTextEditor.visible = false;
      inlineTextEditor.value = '';
    };

    const handleInlineTextEnter = (e) => {
      if (!e.shiftKey) {
        e.preventDefault();
        finalizeInlineText();
      }
    };



    // startDrawing, eraseElement moved to useDrawingEngine composable

    // LINE_TOOLS, draw, finishDrawing moved to useDrawingEngine composable

    const handleObjectUpdate = (updatedYMap) => {
      if (!updatedYMap) return;

      // Check if it's a Y.Map (committed update) or plain object (local drag override)
      const isYMap = updatedYMap instanceof Y.Map;
      
      if (isYMap) {
          const type = updatedYMap.get('type');
          const id = updatedYMap.get('id');
          if (type === 'line') {
            refreshLineBindings(updatedYMap);
          } else if (BINDABLE_ELEMENT_TYPES.has(type) && id) {
            updateBindingsForTarget(id);
          }
          debugLog('[WhiteboardCanvas] MovableObject updated (Yjs):', updatedYMap.toJSON());
          updateLocalScene(); // Standard sync
      } else {
          // It's a plain object override from dragging
          // We skip binding updates here for performance/correctness during drag
          // debugLog('[WhiteboardCanvas] MovableObject updated (Local Override):', updatedYMap);
          updateLocalScene(updatedYMap); // Update with override
      }

      redrawCanvas();
    };

    const cloneYValue = (value) => {
      if (value instanceof Y.Map) {
        const nested = new Y.Map();
        value.forEach((nestedValue, nestedKey) => {
          nested.set(nestedKey, cloneYValue(nestedValue));
        });
        return nested;
      }
      if (value instanceof Y.Array) {
        return value.toArray().map(item => cloneYValue(item));
      }
      if (Array.isArray(value)) {
        return value.map(item => (item && typeof item === 'object' ? { ...item } : item));
      }
      if (value && typeof value === 'object') {
        return { ...value };
      }
      return value;
    };

    const handleCloneObject = (objectData) => {
      if (!ydoc.value || !yDrawings.value) return;
      const sourceId = objectData?.id;
      const sourceMap = yDrawings.value.toArray().find(map => map.get('id') === sourceId);
      if (!sourceMap) {
        debugWarn('[handleCloneObject] Source element not found for id:', sourceId);
        return;
      }

      const offset = 20;
      const addOffset = (val) => (typeof val === 'number' && !Number.isNaN(val) ? val + offset : offset);
      const cloneMap = new Y.Map();
      sourceMap.forEach((value, key) => {
        cloneMap.set(key, cloneYValue(value));
      });

      const shiftPointLike = (pointLike) => {
        if (!pointLike || typeof pointLike !== 'object') return { x: offset, y: offset };
        const baseX = typeof pointLike.x === 'number' && !Number.isNaN(pointLike.x) ? pointLike.x : 0;
        const baseY = typeof pointLike.y === 'number' && !Number.isNaN(pointLike.y) ? pointLike.y : 0;
        return { ...pointLike, x: baseX + offset, y: baseY + offset };
      };

      const shiftNestedPoint = (key) => {
        const nested = cloneMap.get(key);
        if (nested instanceof Y.Map) {
          nested.set('x', addOffset(nested.get('x')));
          nested.set('y', addOffset(nested.get('y')));
          cloneMap.set(key, nested);
        } else if (nested && typeof nested === 'object') {
          cloneMap.set(key, shiftPointLike(nested));
        }
      };

      if (cloneMap.has('x')) cloneMap.set('x', addOffset(cloneMap.get('x')));
      if (cloneMap.has('y')) cloneMap.set('y', addOffset(cloneMap.get('y')));
      shiftNestedPoint('start');
      shiftNestedPoint('end');
      shiftNestedPoint('position');

      const points = cloneMap.get('points');
      if (Array.isArray(points)) {
        cloneMap.set('points', points.map(shiftPointLike));
      }
      const rawPoints = cloneMap.get('rawPoints');
      if (Array.isArray(rawPoints)) {
        cloneMap.set('rawPoints', rawPoints.map(shiftPointLike));
      }

      const newId = `${yjsConnection.value?.awareness?.clientID || 'local'}-${uuidv4()}`;
      cloneMap.set('id', newId);
      cloneMap.set('timestamp', Date.now());

      ydoc.value.transact(() => {
        yDrawings.value.push([cloneMap]);
      }, 'clone-object');

      refreshMovableElements();
      redrawCanvas();
      nextTick(() => {
        if (undoManager.value) {
          updateGlobalState();
        }
      });
      debugLog('[handleCloneObject] Cloned element', sourceId, '->', newId);
    };

    const selectObject = (objectId) => {
      // This was the old @select handler from MovableObject.
      // Its primary selection role is now handled by handleObjectSelectionRequest or right-click.
      debugLog('[WhiteboardCanvas] selectObject (old handler) called with ID:', objectId);
    };


    // --- Tool and Style Setters ---
    const setTool = (tool) => { currentTool.value = tool; updateCursor(); };
    const setColor = (color) => { currentColor.value = color; updateCursor(); };
    const setLineWidth = (width) => { currentLineWidth.value = Number(width) || 2; updateCursor(); };
    const setEraserMode = (mode) => { eraserMode.value = mode; updateCursor(); };
    const setEraserSize = (size) => { eraserSize.value = Number(size) || 30; };

    const updateCursor = () => {
      if (!drawCanvas.value) return;

      if (activeConfigPanel.value) {
        drawCanvas.value.style.cursor = 'default';
        return;
      }

      if (spacePanActive.value || currentTool.value === 'pan') {
        drawCanvas.value.style.cursor = isPanning.value ? 'grabbing' : 'grab';
        return;
      }

      if (isPanning.value) {
        drawCanvas.value.style.cursor = 'grabbing';
        return;
      }

      let toolForCursor = currentTool.value;
      if (toolForCursor === 'shapes') {
          toolForCursor = props.currentShape;
      } else if (toolForCursor === 'lines') {
          toolForCursor = 'line';
      }
      drawCanvas.value.style.cursor = getCursorStyle(toolForCursor, currentColor.value, eraserMode.value);
    };

    // --- Zoom/Pan ---
    const handleZoom = (event) => {
      event.preventDefault();
      if (!drawCanvas.value) return;
      const rect = drawCanvas.value.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const delta = event.deltaY < 0 ? 1.1 : 0.9;
      const prevZoom = zoomLevel.value;
      const newZoom = clampZoom(prevZoom * delta);
      const zoomRatio = newZoom / prevZoom;

      panOffset.value.x = mouseX - (mouseX - panOffset.value.x) * zoomRatio;
      panOffset.value.y = mouseY - (mouseY - panOffset.value.y) * zoomRatio;
      zoomLevel.value = newZoom;
      redrawCanvas();
      showStatus(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
    };

    const zoomIn = () => {
        const prevZoom = zoomLevel.value;
        zoomLevel.value = clampZoom(zoomLevel.value * 1.2);
        const centerX = canvasWidth.value / 2;
        const centerY = canvasHeight.value / 2;
        const zoomRatio = zoomLevel.value / prevZoom;
        panOffset.value.x = centerX - (centerX - panOffset.value.x) * zoomRatio;
        panOffset.value.y = centerY - (centerY - panOffset.value.y) * zoomRatio;
        redrawCanvas();
    };

    const zoomOut = () => {
        const prevZoom = zoomLevel.value;
        zoomLevel.value = clampZoom(zoomLevel.value / 1.2);
        const centerX = canvasWidth.value / 2;
        const centerY = canvasHeight.value / 2;
        const zoomRatio = zoomLevel.value / prevZoom;
        panOffset.value.x = centerX - (centerX - panOffset.value.x) * zoomRatio;
        panOffset.value.y = centerY - (centerY - panOffset.value.y) * zoomRatio;
        redrawCanvas();
    };

    const resetZoom = () => {
        zoomLevel.value = 1;
        panOffset.value = { x: 0, y: 0 };
        redrawCanvas();
    };

    // --- Keyboard Handlers (inline, using useKeyboardShortcuts logic) ---
    const { handleKeyDown, handleKeyUp, handleWindowBlur } = useKeyboardShortcuts({
      currentTool,
      inlineTextEditor,
      spacePanActive,
      activeConfigPanel,
      pinchGesture,
      getActiveFeature: () => props.activeFeature,
      mathRecognizerModule,
      zoomIn,
      zoomOut,
      resetZoom,
      setTool,
      cancelActiveDrawing,
      closeConfigPanel,
      undo,
      redo,
      updateCursor,
      resetSpacePanState,
      endTouchGesture,
      applyMathAnswer,
      selectPenPreset: (presetKey) => emit('select-pen-preset', presetKey),
    });

    // --- Other Actions ---
    const handlePaste = (event) => {
       event.preventDefault();
       const items = (event.clipboardData || window.clipboardData).items;
       if (!items || !ydoc.value) return;

       for (let i = 0; i < items.length; i++) {
         if (items[i].type.indexOf('image') !== -1) {
           const blob = items[i].getAsFile();
           const reader = new FileReader();
           reader.onload = (e) => addImageFromDataUrl(e.target.result);
           reader.readAsDataURL(blob);
           return;
         }
       }

       const text = (event.clipboardData || window.clipboardData).getData('text');
       if (text) {
         const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
         const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;
         addTextElement({ x: centerX, y: centerY }, text);
       }
    };

    const MAX_IMAGE_DATAURL_BYTES = 5 * 1024 * 1024; // 5 MB limit for base64 dataUrl

    const addImageFromDataUrl = (dataUrl) => {
        if (!ydoc.value || !yDrawings.value) {
            console.error("[addImageFromDataUrl] Error: ydoc or yDrawings not available!");
            showToast("Cannot add image - connection issue", "error");
            return;
        }

        // SEC-003: Validate image size before syncing via Yjs
        if (typeof dataUrl === 'string' && dataUrl.length > MAX_IMAGE_DATAURL_BYTES) {
            const sizeMB = (dataUrl.length / (1024 * 1024)).toFixed(1);
            showToast(`Image too large (${sizeMB} MB). Maximum is 5 MB.`, "error");
            return;
        }

        const centerX = (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value;
        const centerY = (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value;

        createImageElement(dataUrl, centerX, centerY)
            .then(imageData => {
                imageData.id = `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`; // Assign ID

                try {
                    ydoc.value.transact(() => {
                        const imageMap = new Y.Map();

                        // Set basic properties
                        imageMap.set('id', imageData.id); // Store ID
                        imageMap.set('type', 'image');
                        imageMap.set('timestamp', Date.now());

                        // Set position (x,y), dimensions, and rotation
                        imageMap.set('x', imageData.x); // Already top-left
                        imageMap.set('y', imageData.y); // Already top-left
                        // The 'position' Y.Map can be removed if x,y are at root, or kept for consistency
                        const posMap = new Y.Map();
                        posMap.set('x', imageData.x);
                        posMap.set('y', imageData.y);
                        imageMap.set('position', posMap); // Keep for now if other parts use it

                        imageMap.set('dataUrl', imageData.dataUrl);
                        imageMap.set('src', imageData.dataUrl);
                        imageMap.set('width', imageData.width);
                        imageMap.set('height', imageData.height);
                        imageMap.set('rotation', 0); // Default rotation

                        yDrawings.value.push([imageMap]);
                        refreshMovableElements();
                    }, 'local-image'); // Specify origin

                    nextTick(() => {
                        redrawCanvas();

                        // Update undo state
                        if (undoManager.value) {
                            updateGlobalState();
                        }
                    });

                    // Show success message
                    showToast("Image added successfully", "success");
                }
                catch (error) {
                    console.error("[addImageFromDataUrl] Error adding image:", error);
                    showToast("Failed to add image", "error");
                }
            })
            .catch(error => {
                console.error("[addImageFromDataUrl] Error creating image:", error);
                showToast("Failed to process image", "error");
            });
    };

    // --- Undo/Redo Methods --- (Replaced by Fragment 1)

    // showStatus and showToast moved to useNotifications composable

    // --- Public methods exposed via ref ---
    const clearCanvas = (options = {}) => {
        const skipConfirm = options?.skipConfirm === true;
        if (!ydoc.value || !yDrawings.value) {
            showToast("Canvas is not ready to clear yet.", "warning");
            return;
        }
        if (!skipConfirm && !confirm('Are you sure you want to clear the canvas?')) {
            return;
        }
        // debugLog('[clearCanvas] Clearing all elements'); // Commented out

        try {
            ydoc.value.transact(() => {
              // Store current length for better performance
              const length = yDrawings.value.length;
              if (length > 0) {
                yDrawings.value.delete(0, length);
              }
            }, 'local-clear'); // Add origin
            selectedObjectId.value = null;
            snapGuides.value = [];
            refreshMovableElements();
            redrawCanvas();

            // P0-FIX: Stop capturing so clear is a separate undo step
            undoManager.value?.stopCapturing();

            showStatus('Canvas cleared');

            // After each transaction make sure global state and helpers are reset
            nextTick(() => {
               if (undoManager.value) {
                  updateGlobalState(); // Use the shared function
               }
               // Reset helper module states as well
               gridAlignModule.value?.clear();
               handwritingStylerModule.value?.clear();
               mathRecognizerModule.value?.clear();
               emit('update:has-char-groups', false);
               emit('update:has-stylized-strokes', false);
               emit('update:recognition-status', '');
               emit('update:latex-equation', '');
               emit('update:solution', '');
            });
        } catch (error) {
            // console.error('[clearCanvas] Error clearing canvas:', error); // Commented out
            showToast("Error clearing canvas.", "error");
        }
    };

    // PDF export helpers (normalizePointForBounds, getElementBounds, getSceneBounds,
    // preloadImagesForExport, EXPORT_DPI, PAGE_PX, PDF_IMAGE_COMPRESSION,
    // drawGridForExport) moved to usePdfExport composable

    // exportBoardAsPdf, exportBoardAsPdfPaged, getSnapshot, getSerializableState,
    // loadState, exportAsText, importFromText moved to usePdfExport composable

    const toggleDebug = (enabled) => {
        debugModeEnabled.value = enabled;
        redrawCanvas();
    };

    const getViewportCenter = () => ({
        x: (canvasWidth.value / 2 - panOffset.value.x) / zoomLevel.value,
        y: (canvasHeight.value / 2 - panOffset.value.y) / zoomLevel.value,
    });
    const testUndoManager = () => {
      // debugLog("=== TEST UNDOMANAGER ==="); // Commented out

      try {
        if (!ydoc.value || !yDrawings.value) {
          alert("Brak ydoc lub yDrawings!");
          return;
        }

        // debugLog("Dodaję testowy element..."); // Commented out

        ydoc.value.transact(() => {
          const testElement = new Y.Map();
          testElement.set('type', 'test');
          testElement.set('timestamp', Date.now());
          testElement.set('color', '#ff0000');

          const startMap = new Y.Map();
          startMap.set('x', 100);
          startMap.set('y', 100);
          testElement.set('start', startMap);

          const endMap = new Y.Map();
          endMap.set('x', 200);
          endMap.set('y', 200);
          testElement.set('end', endMap);

          yDrawings.value.push([testElement]);
        }, 'local-drawing');

        nextTick(() => {
          alert(`Test wykonany. canUndo = ${canUndo.value}`);
        });
      } catch (error) {
        // console.error("Błąd testu:", error); // Commented out
        alert("Błąd testu: " + error.message);
      }
    };

    // --- Helper module integration (moved to useHelperModules composable) ---

    // alignToGrid, groupStrokes, applyStyleTransformation, confirmStyleChanges, cancelStyleChanges, recognizeEquation moved to useHelperModules composable
    // --- Watchers ---
    watch(() => props.debugMode, (newDebug) => {
        debugModeEnabled.value = newDebug;
        redrawCanvas();
    });

    watch(() => props.currentShape, (newShape) => {
        if (debugModeEnabled.value) {
            debugLog(`[Watch] currentShape changed to: ${newShape}`);
        }
        if (currentTool.value === 'shapes') {
            updateCursor();
        }
    });

    watch(() => props.currentLineStyle, (newLineStyle) => {
        if (debugModeEnabled.value) {
            debugLog(`[Watch] currentLineStyle changed to: ${newLineStyle}`);
        }
        if (currentTool.value === 'lines') {
            updateCursor();
        }
    });

    // Feature activation watcher
    watch(() => props.activeFeature, (newFeature, oldFeature) => {
        debugLog(`[Watch] Active feature changed from ${oldFeature} to ${newFeature}`);
        snapIndicator.value = null;
        // Disable old module
        const oldModule = getActiveModule(oldFeature); // Pass old feature name
        if (oldModule?.disable) {
            oldModule.disable();
            debugLog(`Disabled module: ${oldFeature}`);
        }

        // Enable new module and sync strokes
        const newModule = getActiveModule(newFeature); // Pass new feature name
        if (newModule?.enable) {
            newModule.enable();
            debugLog(`Enabled module: ${newFeature}`);
            // Sync strokes from Yjs
            if (yDrawings.value) {
                 const currentStrokes = yDrawings.value.toArray().map(m => ({ id: m.get('id'), ...m.toJSON() }));
                 if (newModule.setStrokes) {
                     newModule.setStrokes(currentStrokes);
                     debugLog(`Synced ${currentStrokes.length} strokes to module: ${newFeature}`);
                 }
            }
             // Reset specific UI states when activating a module
             if (newFeature === 'styleHandwriting') {
                 emit('update:has-char-groups', false);
                 emit('update:has-stylized-strokes', false);
             } else if (newFeature === 'mathRecognizer') {
                 emit('update:recognition-status', '');
                 emit('update:latex-equation', '');
                 emit('update:solution', '');
             }
        }
        redrawCanvas(); // Redraw to reflect module state change (e.g., hide/show overlays)
    });

    // Watchers for module options
    watch(() => props.gridAlignOptions, (newOptions) => {
        gridAlignModule.value?.setOptions(newOptions);
        if (props.activeFeature === 'gridAlign') redrawCanvas(); // Redraw if active
    }, { deep: true });

    watch(() => props.handwritingStylerOptions, (newOptions) => {
        const sanitized = newOptions ? {
            angleNormalization: newOptions.angleNormalization,
            heightNormalization: newOptions.heightNormalization,
            widthNormalization: newOptions.widthNormalization,
            smoothingFactor: newOptions.smoothingFactor,
            groupingTimeThreshold: newOptions.groupingTimeThreshold,
            groupingDistanceThreshold: newOptions.groupingDistanceThreshold
        } : {};
        handwritingStylerModule.value?.setOptions(sanitized);
        // Re-apply style preview if options change while preview is active
        if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value?.hasStylizedStrokes()) {
            applyStyleTransformation();
        }
    }, { deep: true });

    watch(() => props.mathRecognizerOptions, (newOptions) => {
        mathRecognizerModule.value?.setOptions(newOptions);
        if (props.activeFeature === 'mathRecognizer') redrawCanvas(); // Redraw ghost answer with new opacity
    }, { deep: true });

    watch(() => props.roomId, (newRoomId, oldRoomId) => {
        if (newRoomId && newRoomId !== oldRoomId) {
            connectToRoom(newRoomId);
        }
    });

    watch(() => props.username, (newUsername) => {
        latestUsername.value = newUsername;
        updateAwarenessUser(newUsername);
    });


    // --- Lifecycle Hooks ---
    onMounted(() => {
      renderLoop();
      initCanvas();
      initClipboardHandler();
      initResizeObserver();
      window.addEventListener('resize', handleResize);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('paste', handlePaste);
      window.addEventListener('blur', handleWindowBlur);
      window.addEventListener('mouseup', handleWindowMouseUp);
      darkModeObserver.observe(document.body, { attributes: true });
      handleResize(); // Initial resize call

      // Initialize helper modules after context is ready
      if (drawContext.value) {
          gridAlignModule.value = new GridAlignModule(drawContext.value, props.gridAlignOptions);
          const stylerOpts = props.handwritingStylerOptions ? {
              angleNormalization: props.handwritingStylerOptions.angleNormalization,
              heightNormalization: props.handwritingStylerOptions.heightNormalization,
              widthNormalization: props.handwritingStylerOptions.widthNormalization,
              smoothingFactor: props.handwritingStylerOptions.smoothingFactor,
              groupingTimeThreshold: props.handwritingStylerOptions.groupingTimeThreshold,
              groupingDistanceThreshold: props.handwritingStylerOptions.groupingDistanceThreshold
          } : {};
          handwritingStylerModule.value = new HandwritingStylerModule(drawContext.value, stylerOpts);
          mathRecognizerModule.value = new MathRecognizerModule(drawContext.value, {
              ...props.mathRecognizerOptions,
              renderLatexFn: renderLatex, // Pass the render function
              backendUrl: resolveBackendBaseUrl()
          });
          debugLog("Helper modules initialised");
      } else {
          console.error("Failed to initialize helper modules: Canvas context not available.");
      }


      const urlParams = new URLSearchParams(window.location.search);
      const initialRoomId = props.roomId || urlParams.get('room'); // Prefer prop, fallback to URL

      if (initialRoomId) {
        connectToRoom(initialRoomId);
      } else {
        // console.error("WhiteboardCanvas: 'room' parameter missing in URL!"); // Commented out
        showToast("Room ID missing. Collaboration disabled.", "error");
      }
  });

    onBeforeUnmount(() => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      darkModeObserver.disconnect();
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (clipboardFocusHandler) {
        document.removeEventListener('click', clipboardFocusHandler);
        clipboardFocusHandler = null;
      }
      teardownYjsConnection();
    });

    const snapGuides = ref([]);
    
    const handleSnapGuidesUpdate = (guides) => {
        snapGuides.value = guides;
    };
    
    const transformX = (x) => x * zoomLevel.value + panOffset.value.x;
    const transformY = (y) => y * zoomLevel.value + panOffset.value.y;

    const snapTargets = computed(() => {
      if (!selectedObjectId.value || !yDrawings.value) return { vertical: [], horizontal: [] };
      
      const targets = { vertical: [], horizontal: [] };
      yDrawings.value.forEach(el => {
        if (el.get('id') === selectedObjectId.value) return; // Skip self
        
        const x = el.get('x');
        const y = el.get('y');
        const w = el.get('width');
        const h = el.get('height');
        
        if (x === undefined || y === undefined || w === undefined || h === undefined) return;
        
        targets.vertical.push(x, x + w/2, x + w);
        targets.horizontal.push(y, y + h/2, y + h);
      });
      return targets;
    });

    const handleObjectSelectionRequest = (id) => {
      selectedObjectId.value = id;
      redrawCanvas();
    };

    const publicApi = {
      // Refs
      containerRef,
      staticCanvas,
      drawCanvas,

      // State
      roomId: props.roomId, // Expose roomId for AI Panel
      canvasWidth,
      canvasHeight,
      isDrawing,
      currentTool,
      currentColor,
      currentLineWidth,
      zoomLevel,
      panOffset,
      darkMode,
      eraserMode,
      notifications,
      statusMessage,
      yjsConnection,
      canUndo,
      canRedo,
      selectedObjectId,
      movableElements,

      // Methods
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleMouseLeave,
      handleZoom,
      handlePaste,
      handleResize,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
      handleObjectSelectionRequest,
      handleCloneObject,

      // Public API
      setTool,
      setColor,
      setLineWidth,
      setEraserMode,
      zoomIn,
      zoomOut,
      resetZoom,
      undo,
      redo,
      clearCanvas,
      showToast,
      getSnapshot,
      getSerializableState,
      loadState,
      exportAsText,
      importFromText,
      exportBoardAsPdf,
      exportBoardAsPdfPaged,
      addImageFromDataUrl,
      getViewportCenter,
      toggleDebug,
      redrawCanvas,
      testUndoManager,

      // Graph/Coord System Panel State & Handlers
      activeConfigPanel,
      configPanelCoords,
      closeConfigPanel,
      addElementFromPanel,

      // MovableObject handlers & selection state
      handleObjectUpdate,
      handleInteractionStart,
      handleInteractionEnd,
      selectObject, 

      // Inline Text Editor
      inlineTextEditor,
      inlineTextRef,
      inlineTextStyle,
      finalizeInlineText,
      handleInlineTextEnter,

      // Helper action methods (also exposed)
      alignToGrid,
      groupStrokes,
      applyStyleTransformation,
      confirmStyleChanges,
      cancelStyleChanges,
      recognizeEquation,
      // Snap guides
      snapTargets,
      snapGuides,
      handleSnapGuidesUpdate,
      transformX,
      transformY,

      // Connection state
      isConnecting,
      
      applyGhostAnswer: (payload) => { 
            const stroke = mathRecognizerModule.value?.applyGhostAnswer();
            if (stroke) applyMathAnswer(stroke);
      }
    };

    expose(publicApi);
    return publicApi;
  }
};

// detachLineBindings moved to useLineBindings composable (was incorrectly outside setup scope)

</script>

<style scoped>
.whiteboard-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #f8f9fa;
  touch-action: none;
  user-select: none;
}

.whiteboard-container.dark-mode {
  background-color: #121212;
}

.whiteboard-canvas {
  position: absolute;
  top: 0;
  left: 0;
  cursor: crosshair;
  touch-action: none;
}

.inline-text-editor {
  position: absolute;
  background: transparent;
  border: 1px dashed #007bff;
  outline: none;
  padding: 0;
  margin: 0;
  resize: none;
  overflow: hidden;
  font-family: 'Kalam', cursive;
  line-height: 1.2;
  z-index: 100;
  color: black;
}

.clipboard-input {
  position: absolute;
  top: -9999px;
  left: -9999px;
  opacity: 0;
}

.notifications {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 2000;
  pointer-events: none;
}

.notification {
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px 20px;
  border-radius: 4px;
  font-size: 14px;
  pointer-events: auto;
  transition: all 0.3s ease;
}

.notification.info { background: rgba(33, 150, 243, 0.9); }
.notification.success { background: rgba(76, 175, 80, 0.9); }
.notification.warning { background: rgba(255, 152, 0, 0.9); }
.notification.error { background: rgba(244, 67, 54, 0.9); }

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.ai-assistant-toggle {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: white;
  border: 1px solid #ddd;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  z-index: 1000;
  transition: transform 0.2s;
}

.ai-assistant-toggle:hover {
  transform: scale(1.1);
}

.dark-mode .ai-assistant-toggle {
  background: #333;
  border-color: #555;
}

.connection-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  z-index: 3000;
  font-size: 14px;
  pointer-events: none;
}

.connection-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

<style>
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 20px;
  border-radius: 6px;
  background-color: #333;
  color: white;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  z-index: 9999;
  font-size: 14px;
  opacity: 0;
  transform: translateY(-20px);
  transition: all 0.3s ease;
  max-width: 300px;
  text-align: center;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}

.toast-default { background-color: #333; }
.toast-info { background-color: #2196F3; }
.toast-success { background-color: #4CAF50; }
.toast-warning { background-color: #FF9800; }
.toast-error { background-color: #F44336; }

.inline-text-editor {
  color: #0f172a;
  background: #ffffff;
  border: 1px dashed #94a3b8;
}

.inline-text-editor::placeholder {
  color: #94a3b8;
}
</style>

