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
      :key="elementMap.get('id') || elementMap._tempKey || Math.random()"
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
    <AIStatusOverlay />
    <AICommandPalette
      ref="aiCommandPaletteRef"
      :roomId="roomId"
      :getContext="getAiContext"
    />
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, shallowRef, reactive, computed, toRaw } from 'vue';
import rough from 'roughjs';
import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
import katex from 'katex';
import { jsPDF } from 'jspdf';
import 'katex/dist/katex.min.css';
import { undoRedoState } from '../utils/undoRedoState';
import Collaborators from './Collaborators.vue';
import ZoomPanControls from './ZoomPanControls.vue';
import EraserModeControls from './EraserModeControls.vue';
import StatusMessage from './StatusMessage.vue';
import AIStatusOverlay from './AIStatusOverlay.vue';
import AICommandPalette from './AICommandPalette.vue';
// Helper modules
import GridAlignModule from '../modules/GridAlignModule.js';
import HandwritingStylerModule from '../modules/HandwritingStylerModule.js';
import MathRecognizerModule from '../modules/MathRecognizerModule.js';
import { DEFAULT_PEN_PRESETS } from '../utils/penStyles.js';
// Utils and Services
import { resolveBackendBaseUrl } from '../services/backendUrl';
import { connectToYjs } from '../services/connectToYjs';
import { drawElement, throttle, isPointInElement, distanceToSegment } from '../utils/canvasDrawing.js';
import { isPointInRotatedRectangle } from '../utils/geometry.js';
import {
  createNewElement,
  createImageElement,
  getCursorStyle,
  createCoordinateSystem2DElement,
  createCoordinateSystem3DElement
} from '../utils/canvasTools.js';
import { drawGrid as drawUtilGrid, computeGridSteps } from '../utils/canvasGrid.js';
import MovableObject from './MovableObject.vue';


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
    AIStatusOverlay,
    AICommandPalette,
  },
  props: {
    debugMode: { type: Boolean, default: false },
    currentShape: { type: String, default: 'rectangle' },
    currentLineStyle: { type: String, default: 'solid' },
    currentArrowStyle: { type: String, default: 'none' },
    currentRoughness: { type: Number, default: 1 }, // 0 = clean, 1 = default/sloppy
    // Feature configuration
    activeFeature: { type: String, default: null },
    gridAlignOptions: { type: Object, default: () => ({}) },
    handwritingStylerOptions: { type: Object, default: () => ({}) },
    mathRecognizerOptions: { type: Object, default: () => ({}) },
    // Props from App.vue (already existed)
    roomId: { type: String, required: true },
    roomKey: { type: [String, Object], default: null },
    username: { type: String, default: 'Anonymous' }
  },
  emits: [
    'state-updated',
    'update:recognition-status',
    'update:latex-equation',
    'update:solution',
    'update:has-char-groups',
    'update:has-stylized-strokes'
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
        background: 'transparent', // Transparent for "on board" feel
        border: 'none',            // No border
        outline: 'none',
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
    const statusMessage = ref('');
    const statusTimeout = ref(null);
    const darkMode = ref(false);
    const eraserMode = ref('erase');
    const eraserSize = ref(30);
    const lastReleasedElementIndex = ref(-1);
    const currentElementPreview = ref(null);
    const pointsBuffer = ref([]);
    const snapIndicator = ref(null);
    const smoothingFactor = ref(0.65);
    const PEN_SMOOTHING_WINDOW = 4;
    const PEN_COORD_PRECISION = 2;
    const shiftPressedAtStart = ref(false); // Track shift key state at mousedown
    const startCoordsForShiftLine = ref(null); // Store start coords specifically for Shift+Pen
    const notifications = ref([]);
    const notificationId = ref(0);
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
    const activePenPresetKey = computed(() => props.handwritingStylerOptions?.preset || 'gel');
    const activePenPreset = computed(() => {
      const options = props.handwritingStylerOptions || {};
      return (options.presets && options.presets[activePenPresetKey.value]) || DEFAULT_PEN_PRESETS[activePenPresetKey.value] || {};
    });
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

    const SHAPE_TOOLS = new Set([
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
        'tetrahedron'
    ]);
    const movableElements = shallowRef([]);
    const hoveredElementIndex = ref(-1);
    const selectedObjectId = ref(null); // Added for selection state
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
    const undoManager = ref(null);
    const canUndo = ref(false);
    const canRedo = ref(false);
    
            
    const BINDABLE_ELEMENT_TYPES = new Set([
      'rectangle',
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
      'physicsDataPlot'
    ]);
    const BINDING_PADDING = 8;
    const BINDING_DISTANCE_THRESHOLD = 18;
    const BINDING_GAP_DEFAULT = 4;

    const getConnectorAnchors = (rect) => {
      if (!rect) return [];
      const rot = (rect.rotation || 0) * Math.PI / 180;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const anchorsLocal = [
        { x: -rect.width / 2, y: 0, normalLocal: { x: -1, y: 0 } }, // left
        { x: rect.width / 2, y: 0, normalLocal: { x: 1, y: 0 } }, // right
        { x: 0, y: -rect.height / 2, normalLocal: { x: 0, y: -1 } }, // top
        { x: 0, y: rect.height / 2, normalLocal: { x: 0, y: 1 } }, // bottom
        { x: 0, y: 0, normalLocal: null }, // center
      ];
      return anchorsLocal.map(({ x, y, normalLocal }) => {
        const anchorWorld = {
          x: cx + x * cosR - y * sinR,
          y: cy + x * sinR + y * cosR,
        };
        const ratioX = rect.width ? (x + rect.width / 2) / rect.width : 0.5;
        const ratioY = rect.height ? (y + rect.height / 2) / rect.height : 0.5;
        return {
          anchorLocal: { x, y },
          anchorWorld,
          ratioX,
          ratioY,
          normalLocal,
        };
      });
    };
    
    const findElementMapById = (id) => {
      if (!id || !yDrawings.value) return null;
      return yDrawings.value.toArray().find((el) => el.get('id') === id) || null;
    };
    
    const getRectFromElementMap = (map) => {
      if (!map) return null;
      const x = Number(map.get('x'));
      const y = Number(map.get('y'));
      const width = Math.abs(Number(map.get('width'))) || 0;
      const height = Math.abs(Number(map.get('height'))) || 0;
      const rotation = Number(map.get('rotation')) || 0;
      if ([x, y, width, height].every((v) => Number.isFinite(v))) {
        return { x, y, width, height, rotation };
      }
      const start = map.get('start');
      const end = map.get('end');
      const sx = start?.get?.('x');
      const sy = start?.get?.('y');
      const ex = end?.get?.('x');
      const ey = end?.get?.('y');
      if ([sx, sy, ex, ey].every((v) => Number.isFinite(v))) {
        return {
          x: Math.min(sx, ex),
          y: Math.min(sy, ey),
          width: Math.abs(ex - sx),
          height: Math.abs(ey - sy),
          rotation,
        };
      }
      return null;
    };
    
    const distanceToRect = (point, rect, padding = BINDING_PADDING) => {
      const padded = {
        x: rect.x - padding,
        y: rect.y - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      };
      const withinX = point.x >= padded.x && point.x <= padded.x + padded.width;
      const withinY = point.y >= padded.y && point.y <= padded.y + padded.height;
      if (withinX && withinY) return 0;
      const dx = Math.max(padded.x - point.x, 0, point.x - (padded.x + padded.width));
      const dy = Math.max(padded.y - point.y, 0, point.y - (padded.y + padded.height));
      return Math.hypot(dx, dy);
    };
    
    const clampVectorToRotatedRect = (rect, reference) => {
      const rot = (rect.rotation || 0) * Math.PI / 180;
      const cosR = Math.cos(-rot);
      const sinR = Math.sin(-rot);
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const toLocal = (pt) => {
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        return { x: dx * cosR - dy * sinR, y: dx * sinR + dy * cosR };
      };
      const toWorld = (pt) => {
        const cosF = Math.cos(rot);
        const sinF = Math.sin(rot);
        return {
          x: cx + pt.x * cosF - pt.y * sinF,
          y: cy + pt.x * sinF + pt.y * cosF,
        };
      };
    
      const refLocal = toLocal(reference);
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;
      let dx = refLocal.x;
      let dy = refLocal.y;
      if (dx === 0 && dy === 0) dx = halfW;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      let anchorLocal;
      if (absDx * halfH > absDy * halfW) {
        const scale = absDx === 0 ? 1 : halfW / absDx;
        anchorLocal = { x: Math.sign(dx) * halfW, y: dy * scale };
      } else {
        const scale = absDy === 0 ? 1 : halfH / absDy;
        anchorLocal = { x: dx * scale, y: Math.sign(dy) * halfH };
      }
      const anchorWorld = toWorld(anchorLocal);
      return { anchorLocal, anchorWorld, toWorld };
    };
    
    const makeBindingPayload = (targetMap, rect, referencePoint, fallbackPoint, lineWidth = 2, anchorOverride = null) => {
      if (!targetMap || !rect) return { binding: null, point: null };
      const rot = (rect.rotation || 0) * Math.PI / 180;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const cosInv = Math.cos(-rot);
      const sinInv = Math.sin(-rot);
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const ref = referencePoint || fallbackPoint || { x: rect.x + rect.width, y: rect.y + rect.height / 2 };

      const anchorLocal = anchorOverride?.anchorLocal
        ? { ...anchorOverride.anchorLocal }
        : clampVectorToRotatedRect(rect, ref).anchorLocal;
      const ratioX = anchorOverride?.ratioX ?? (rect.width ? (anchorLocal.x + rect.width / 2) / rect.width : 0.5);
      const ratioY = anchorOverride?.ratioY ?? (rect.height ? (anchorLocal.y + rect.height / 2) / rect.height : 0.5);

      const refLocal = {
        x: (ref.x - cx) * cosInv - (ref.y - cy) * sinInv,
        y: (ref.x - cx) * sinInv + (ref.y - cy) * cosInv,
      };

      let normalLocal = anchorOverride?.normalLocal || null;
      if (!normalLocal) {
        const vectorLocal = { x: refLocal.x - anchorLocal.x, y: refLocal.y - anchorLocal.y };
        const len = Math.hypot(vectorLocal.x, vectorLocal.y);
        if (!len || len < 1e-6) {
          normalLocal = { x: 1, y: 0 };
        } else {
          normalLocal = { x: vectorLocal.x / len, y: vectorLocal.y / len };
        }
      }

      const gap = Math.max(BINDING_GAP_DEFAULT, (lineWidth || 2) * 1.1);
      const normalWorld = {
        x: normalLocal.x * cosR - normalLocal.y * sinR,
        y: normalLocal.x * sinR + normalLocal.y * cosR,
      };
      const normalLen = Math.hypot(normalWorld.x, normalWorld.y) || 1;
      const anchorWorld = {
        x: cx + anchorLocal.x * cosR - anchorLocal.y * sinR,
        y: cy + anchorLocal.x * sinR + anchorLocal.y * cosR,
      };
      const point = {
        x: anchorWorld.x + (normalWorld.x / normalLen) * gap,
        y: anchorWorld.y + (normalWorld.y / normalLen) * gap,
      };
      const binding = {
        elementId: targetMap.get('id'),
        ratioX,
        ratioY,
        normalLocal,
        gap,
      };
      return { binding, point };
    };
    
    const resolveBindingPoint = (binding) => {
      if (!binding) return null;
      const target = findElementMapById(binding.elementId);
      const rect = getRectFromElementMap(target);
      if (!rect) return null;
      const rot = (rect.rotation || 0) * Math.PI / 180;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const anchorLocal = {
        x: (binding.ratioX ?? 0.5) * rect.width - rect.width / 2,
        y: (binding.ratioY ?? 0.5) * rect.height - rect.height / 2,
      };
      const anchorWorld = {
        x: cx + anchorLocal.x * cosR - anchorLocal.y * sinR,
        y: cy + anchorLocal.x * sinR + anchorLocal.y * cosR,
      };
      const normalLocal = binding.normalLocal ?? binding.normal ?? { x: 1, y: 0 };
      const gap = binding.gap ?? BINDING_GAP_DEFAULT;
      const normalWorld = {
        x: normalLocal.x * cosR - normalLocal.y * sinR,
        y: normalLocal.x * sinR + normalLocal.y * cosR,
      };
      const len = Math.hypot(normalWorld.x, normalWorld.y) || 1;
      return {
        x: anchorWorld.x + (normalWorld.x / len) * gap,
        y: anchorWorld.y + (normalWorld.y / len) * gap,
      };
    };
    
    const getLineEndpoints = (lineMap) => {
      const startMap = lineMap?.get?.('start');
      const endMap = lineMap?.get?.('end');
      const start = startMap?.get ? { x: Number(startMap.get('x')), y: Number(startMap.get('y')) } : null;
      const end = endMap?.get ? { x: Number(endMap.get('x')), y: Number(endMap.get('y')) } : null;
      return { start, end };
    };
    
    const setLineEndpoints = (lineMap, start, end) => {
      if (!lineMap || !start || !end) return;
      let startMap = lineMap.get('start');
      let endMap = lineMap.get('end');
      if (!(startMap instanceof Y.Map)) {
        startMap = new Y.Map();
        lineMap.set('start', startMap);
      }
      if (!(endMap instanceof Y.Map)) {
        endMap = new Y.Map();
        lineMap.set('end', endMap);
      }
      startMap.set('x', start.x);
      startMap.set('y', start.y);
      endMap.set('x', end.x);
      endMap.set('y', end.y);
      lineMap.set('x', Math.min(start.x, end.x));
      lineMap.set('y', Math.min(start.y, end.y));
      lineMap.set('width', Math.abs(end.x - start.x));
      lineMap.set('height', Math.abs(end.y - start.y));
    };
    
    const findBindingTargetNearPoint = (point, excludeId = null, maxDistance = BINDING_DISTANCE_THRESHOLD, collectAll = false) => {
      if (!yDrawings.value || !point) return collectAll ? [] : null;
      const elements = yDrawings.value.toArray();
      let best = null;
      let bestDistance = Infinity;
      const hits = [];
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        const id = el.get('id');
        if (excludeId && id === excludeId) continue;
        const type = el.get('type');
        if (!BINDABLE_ELEMENT_TYPES.has(type)) continue;
        const rect = getRectFromElementMap(el);
        if (!rect) continue;
        const anchors = getConnectorAnchors(rect);
        anchors.forEach((anchor) => {
          const dist = Math.hypot(anchor.anchorWorld.x - point.x, anchor.anchorWorld.y - point.y);
          if (dist <= maxDistance) {
            const payload = { map: el, rect, anchor, distance: dist };
            if (collectAll) hits.push(payload);
            if (dist < bestDistance) {
              bestDistance = dist;
              best = payload;
            }
          }
        });
      }
      return collectAll ? hits : best;
    };
    
    const attachBindingsToLineDraft = (lineDraft) => {
      if (!lineDraft || lineDraft.type !== 'line' || !lineDraft.start || !lineDraft.end || !yDrawings.value) return;
      const lineWidth = lineDraft.lineWidth || 2;
      const startTarget = findBindingTargetNearPoint(lineDraft.start, lineDraft.id);
      if (startTarget) {
        const { binding, point } = makeBindingPayload(startTarget.map, startTarget.rect, lineDraft.end, lineDraft.start, lineWidth, startTarget.anchor);
        if (binding && point) {
          lineDraft.startBinding = binding;
          lineDraft.start = point;
        }
      }
      const endTarget = findBindingTargetNearPoint(lineDraft.end, lineDraft.id);
      if (endTarget) {
        const { binding, point } = makeBindingPayload(endTarget.map, endTarget.rect, lineDraft.start, lineDraft.end, lineWidth, endTarget.anchor);
        if (binding && point) {
          lineDraft.endBinding = binding;
          lineDraft.end = point;
        }
      }
      lineDraft.x = Math.min(lineDraft.start.x, lineDraft.end.x);
      lineDraft.y = Math.min(lineDraft.start.y, lineDraft.end.y);
      lineDraft.width = Math.abs(lineDraft.start.x - lineDraft.end.x);
      lineDraft.height = Math.abs(lineDraft.start.y - lineDraft.end.y);
    };
    
    const updateBindingsForTarget = (targetId) => {
      if (!targetId || !yDrawings.value || !ydoc.value) return;
      const target = findElementMapById(targetId);
      const rect = getRectFromElementMap(target);
      if (!rect) return;
      const lines = yDrawings.value.toArray().filter((el) => el.get('type') === 'line');
      if (!lines.length) return;
      ydoc.value.transact(() => {
        lines.forEach((line) => {
          const { start, end } = getLineEndpoints(line);
          if (!start || !end) return;
          let nextStart = start;
          let nextEnd = end;
          let changed = false;
          const startBinding = line.get('startBinding');
          if (startBinding?.elementId === targetId) {
            const point = resolveBindingPoint(startBinding);
            if (point) {
              nextStart = point;
              changed = true;
            }
          }
          const endBinding = line.get('endBinding');
          if (endBinding?.elementId === targetId) {
            const point = resolveBindingPoint(endBinding);
            if (point) {
              nextEnd = point;
              changed = true;
            }
          }
          if (changed) {
            setLineEndpoints(line, nextStart, nextEnd);
          }
        });
      }, 'auto-binding');
    };
    
    const refreshLineBindings = (lineMap) => {
      if (!lineMap || lineMap.get('type') !== 'line' || !ydoc.value) return;
      const lineId = lineMap.get('id');
      const { start, end } = getLineEndpoints(lineMap);
      if (!start || !end) return;
      const lineWidth = lineMap.get('lineWidth') || 2;
      ydoc.value.transact(() => {
        let nextStart = start;
        let nextEnd = end;
        let changed = false;
    
        const startBinding = lineMap.get('startBinding');
        if (startBinding?.elementId) {
          const point = resolveBindingPoint(startBinding);
          if (point) {
            nextStart = point;
            changed = true;
          } else {
            lineMap.delete('startBinding');
            changed = true;
          }
        } else {
          const target = findBindingTargetNearPoint(start, lineId);
          if (target) {
            const { binding, point } = makeBindingPayload(target.map, target.rect, end, start, lineWidth, target.anchor);
            if (binding && point) {
              lineMap.set('startBinding', binding);
              nextStart = point;
              changed = true;
            }
          }
        }
    
        const endBinding = lineMap.get('endBinding');
        if (endBinding?.elementId) {
          const point = resolveBindingPoint(endBinding);
          if (point) {
            nextEnd = point;
            changed = true;
          } else {
            lineMap.delete('endBinding');
            changed = true;
          }
        } else {
          const target = findBindingTargetNearPoint(end, lineId);
          if (target) {
            const { binding, point } = makeBindingPayload(target.map, target.rect, start, end, lineWidth, target.anchor);
            if (binding && point) {
              lineMap.set('endBinding', binding);
              nextEnd = point;
              changed = true;
            }
          }
        }
    
        if (changed && nextStart && nextEnd) {
          setLineEndpoints(lineMap, nextStart, nextEnd);
        }
      }, 'auto-binding');
    };
// Define updateGlobalState outside initializeUndoManager to make it accessible in onBeforeUnmount
    const updateGlobalState = () => {
      if (undoManager.value) {
        const hasUndo = undoManager.value.canUndo();
        const hasRedo = undoManager.value.canRedo();

        // Aktualizuj stan lokalny (nadal potrzebny dla debug panelu w tym komponencie)
        canUndo.value = hasUndo;
        canRedo.value = hasRedo;

        // Aktualizuj stan globalny
        undoRedoState.update(hasUndo, hasRedo);

        // debugLog(`[Canvas] UndoManager stan: canUndo=${hasUndo}, canRedo=${hasRedo}`); // Commented out
      } else {
        canUndo.value = false;
        canRedo.value = false;
        undoRedoState.update(false, false);
      }
    };

    // 2. Zastąp całą implementację UndoManager
    const initializeUndoManager = () => {
      // debugLog("[Canvas] Inicjalizacja UndoManager..."); // Commented out

      if (undoManager.value) {
        try {
          undoManager.value.destroy();
        } catch (e) {
          // console.error("Błąd podczas czyszczenia UndoManagera:", e); // Commented out
        }
        undoManager.value = null;
      }

      if (!ydoc.value || !yDrawings.value) {
        // console.error("initializeUndoManager: Brak ydoc lub yDrawings"); // Commented out
        return;
      }

      // Konfiguracja UndoManager ze śledzeniem origin
      undoManager.value = new Y.UndoManager(yDrawings.value, {
        trackedOrigins: new Set([
          null, undefined,
          'local-drawing', 'local-erase', 'local-clear', 'local-text', 'local-add-text', 'local-image', 'local-plot', 'local-coordsys',
          'local-movable-drag', 'local-movable-rotate', 'local-movable-resize',
          'ai-align', 'ai-style', 'ai-math'
        ])
      });

      // Use the externally defined updateGlobalState function
      undoManager.value.on('stack-item-added', updateGlobalState);
      undoManager.value.on('stack-item-popped', updateGlobalState);

      // Inicjalne ustawienie stanu
      updateGlobalState();

      // debugLog("[Canvas] UndoManager zainicjalizowany"); // Commented out
    };

    // 3. Zastąp metody undo/redo
    const undo = () => {
      // debugLog("[Canvas] Undo - próba wykonania"); // Commented out

      try {
        if (undoManager.value && undoManager.value.canUndo()) {
          undoManager.value.undo();
          // debugLog("[Canvas] Undo wykonane"); // Commented out

          // Dodatkowa aktualizacja globalnego stanu (już obsłużona przez listener 'stack-item-popped')
          // undoRedoState.update(undoManager.value.canUndo(), undoManager.value.canRedo());

          // Wymuś redraw
          nextTick(() => {
            redrawCanvas(true);
            updateGlobalState();
          });
        } else {
          // debugLog("[Canvas] Undo niemożliwe"); // Commented out
        }
      } catch (error) {
        // console.error("[Canvas] Błąd podczas undo:", error); // Commented out
      }
    };

    const redo = () => {
      // debugLog("[Canvas] Redo - próba wykonania"); // Commented out

      try {
        if (undoManager.value && undoManager.value.canRedo()) {
          undoManager.value.redo();
          // debugLog("[Canvas] Redo wykonane"); // Commented out

          // Dodatkowa aktualizacja globalnego stanu (już obsłużona przez listener 'stack-item-added')
          // undoRedoState.update(undoManager.value.canUndo(), undoManager.value.canRedo());

          // Wymuś redraw
          nextTick(() => {
            redrawCanvas(true);
          });
        } else {
          // debugLog("[Canvas] Redo niemożliwe"); // Commented out
        }
      } catch (error) {
        // console.error("[Canvas] Błąd podczas redo:", error); // Commented out
      }
    };

    // --- Methods ---

    // Method to render LaTeX using KaTeX
    const renderLatex = (latexString) => {
      // Find the target element within App.vue's template (or create if needed)
      // This assumes App.vue has <span id="latex-render-output"></span> inside the math panel
      const targetElement = document.getElementById('latex-render-output');
      if (targetElement) {
        try {
          katex.render(latexString || '', targetElement, { // Render empty string if null/undefined
            throwOnError: false, // Don't throw errors, display them in the output
            displayMode: false // Render inline
          });
          // No need to emit here, App.vue already has latexEquation ref
        } catch (error) {
          console.error('Error rendering LaTeX:', error);
          targetElement.textContent = `Error: ${error.message}`;
          // Emit the error message? Or let the module handle status?
          // emit('update:latex-equation', `Error: ${error.message}`);
        }
      } else {
        debugWarn('LaTeX render target element #latex-render-output not found.');
      }
    };


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

    const applyMathAnswer = (newStrokeData) => {
        if (!newStrokeData || !ydoc.value || !yDrawings.value) return;

        try {
            ydoc.value.transact(() => {
                const yElementMap = new Y.Map();
                for (const [key, value] of Object.entries(newStrokeData)) {
                    yElementMap.set(key, value);
                }
                yDrawings.value.push([yElementMap]);
            }, 'ai-math'); // Origin

            nextTick(() => {
                updateGlobalState();
                // Reset math state in App.vue via emits
                emit('update:recognition-status', '');
                emit('update:latex-equation', '');
                emit('update:solution', '');
                redrawCanvas(true);
            });
        } catch (error) {
            console.error("Error applying math answer:", error);
            showToast("Failed to apply math answer.", "error");
        }
    };


    // Local scene cache to avoid expensive Yjs toJSON calls
    let localScene = [];

    const updateLocalScene = (overrideObject = null) => {
        if (!yDrawings.value) {
            localScene = [];
            return;
        }
        // Map Yjs elements to local plain objects once
        const rawArray = yDrawings.value.toArray();
        console.log(`[WhiteboardCanvas] updateLocalScene: processing ${rawArray.length} elements`);
        localScene = rawArray.map(map => {
            const json = map.toJSON();
            if (overrideObject && json.id === overrideObject.id) {
                return { ...json, ...overrideObject };
            }
            return json;
        });
        
        // Also sync with helper modules if needed
        if (props.activeFeature === 'styleHandwriting' && handwritingStylerModule.value?.hasStylizedStrokes()) {
             // If styler is active, we might need to merge or replace strokes. 
             // For simplicity, let's assume styler handles its own data or we overlay it.
             // But the original code replaced strokesToDraw.
             // Let's keep the original logic but use localScene as base.
        }
    };

    const isElementVisible = (element, viewRect) => {
        // Simple bounding box check
        // Assuming element has x, y, width, height or start/end
        let minX, minY, maxX, maxY;

        if (element.type === 'line' && element.start && element.end) {
            minX = Math.min(element.start.x, element.end.x);
            minY = Math.min(element.start.y, element.end.y);
            maxX = Math.max(element.start.x, element.end.x);
            maxY = Math.max(element.start.y, element.end.y);
            // Add line width padding
            const padding = (element.lineWidth || 2) / 2;
            minX -= padding; minY -= padding; maxX += padding; maxY += padding;
        } else if (typeof element.x === 'number' && typeof element.y === 'number') {
            minX = element.x;
            minY = element.y;
            maxX = element.x + (element.width || 0);
            maxY = element.y + (element.height || 0);
        } else if (element.points && element.points.length > 0) {
             // For freehand strokes
             // This might be expensive to iterate points every time. 
             // Ideally bounds should be stored on the element.
             // If not present, we skip culling or calculate once.
             // Let's assume for now we skip culling for complex paths without bounds
             return true; 
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
      console.log(`[WhiteboardCanvas] redrawStatic: drawing ${strokesToDraw.length} strokes`);
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
                props.handwritingStylerOptions || {}
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

      // Need strokes for connectors
      let strokesToDraw = [];
      if (yDrawings.value) {
          strokesToDraw = yDrawings.value.toArray().map(map => map.toJSON());
      }

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
          props.handwritingStylerOptions || {}
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

    // Helper to sync module state from Yjs
    const syncModulesWithYjs = () => {
        if (!yDrawings.value) return;
        const currentStrokes = yDrawings.value.toArray().map(m => ({ id: m.get('id'), ...m.toJSON() }));
        if (gridAlignModule.value?.enabled) gridAlignModule.value.setStrokes(currentStrokes);
        if (handwritingStylerModule.value?.enabled) handwritingStylerModule.value.setStrokes(currentStrokes);
        if (mathRecognizerModule.value?.enabled) mathRecognizerModule.value.setStrokes(currentStrokes);
    };

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
    const setupAwarenessListener = () => {
        debugLog('[WhiteboardCanvas] setupAwarenessListener called');
        if (!yjsConnection.value?.awareness) {
            console.warn('[WhiteboardCanvas] No awareness available!');
            return;
        }
        
        const awareness = yjsConnection.value.awareness;
        debugLog('[WhiteboardCanvas] Setting up awareness listener, clientID:', awareness.clientID);
        
        // Listen for awareness changes (cursors, online users)
        awareness.on('change', (changes) => {
            debugLog('[WhiteboardCanvas] Awareness changed:', changes);
            // Trigger redraw to show updated cursors
            redrawCanvas(false); // Cursors are dynamic
        });
    };

    const teardownYjsConnection = () => {
        if (yDrawings.value) {
            yDrawings.value.unobserveDeep(handleYjsUpdate);
        }
        if (undoManager.value) {
            undoManager.value.off('stack-item-added', updateGlobalState);
            undoManager.value.off('stack-item-popped', updateGlobalState);
            undoManager.value.destroy();
            undoManager.value = null;
            updateGlobalState();
        }
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
        console.log('[WhiteboardCanvas] Yjs update received', event);
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

        // Watch selection changes to update DOM elements
        watch(selectedObjectId, () => {
             refreshMovableElements();
        });

        try {
            // Pass roomKey to connectToYjs for E2E encryption
            const connection = await connectToYjs(normalizedRoomId);
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
        }
    };




    const initCanvas = () => {
      if (staticCanvas.value) {
        staticContext.value = staticCanvas.value.getContext('2d', { willReadFrequently: true });
        staticContext.value.lineCap = 'round';
        staticContext.value.lineJoin = 'round';
      }
      if (drawCanvas.value) {
        drawContext.value = drawCanvas.value.getContext('2d', { willReadFrequently: true });
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

    const cancelActiveDrawing = () => {
      if (!isDrawing.value && !currentElementPreview.value) return false;
      isDrawing.value = false;
      currentElementPreview.value = null;
      pointsBuffer.value = [];
      snapIndicator.value = null;
      redrawCanvas(false); // Dynamic only
      return true;
    };

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

    const addSmoothedPenPoint = (coords) => {
      const stamped = {
        ...coords,
        t: coords.t ?? (typeof performance !== 'undefined' ? performance.now() : Date.now())
      };
      pointsBuffer.value.push(stamped);
      if (pointsBuffer.value.length > PEN_SMOOTHING_WINDOW) {
        pointsBuffer.value.shift();
      }
      const len = pointsBuffer.value.length;
      if (!len) {
        return stamped;
      }
      const averaged = pointsBuffer.value.reduce(
        (acc, point) => ({
          x: acc.x + point.x,
          y: acc.y + point.y,
        }),
        { x: 0, y: 0 }
      );
      return {
        x: parseFloat((averaged.x / len).toFixed(PEN_COORD_PRECISION)),
        y: parseFloat((averaged.y / len).toFixed(PEN_COORD_PRECISION)),
        t: stamped.t
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

    const getSnapSettings = () => {
      const strengthRaw = props.gridAlignOptions?.snapStrength ?? 0;
      const strength = Math.max(0, Math.min(1, strengthRaw / 100));
      const showBaselines = !!props.gridAlignOptions?.showBaselines;
      const { worldGridStep, screenGridSize } = computeGridSteps(zoomLevel.value);
      return {
        strength,
        showBaselines,
        gridSizeWorld: worldGridStep,
        gridSizeScreen: screenGridSize
      };
    };

    const applySoftGridSnap = (point, prevRawPoint = null) => {
      if (props.activeFeature !== 'gridAlign') {
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
        const proximity = 1 - dist / snapRadiusWorld; // 0..1
        let alpha = proximity * strength; // 0..1

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
          radius: snapRadiusWorld
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
      if (event.button === 1 || (event.button === 0 && event.altKey) || shouldSpacePan) { // Middle mouse, Alt+Left, or Space+Left
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
          startDrawing(event);
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

            if (isDrawing.value) {
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



    // --- Drawing Logic (Yjs Integration) ---

    const startDrawing = (event) => {
      if (!ydoc.value) return;
      if (currentTool.value === 'select') return;
      // Don't start drawing if a graph tool is selected (handled by handleMouseDown)
      const graphTools = ['mathPlot', 'physicsPlot', 'coordSystem2D', 'coordSystem3D'];
      if (graphTools.includes(currentTool.value)) {
          return;
      }

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
      let elementData = {}; // Object to hold extra data like lineStyle
      let lineWidthForElement = currentLineWidth.value;
      let colorForElement = currentColor.value;

      // Handle Shift+Pen combination: Keep type 'pen' for now, store start point
      if (toolType === 'pen' && shiftPressedAtStart.value) {
          if (debugModeEnabled.value) {
              debugLog("[startDrawing] Shift+Pen detected, storing start point.");
          }
          startCoordsForShiftLine.value = transformedCoords; // Store the starting point
          // Preview element remains 'pen' type initially for simplicity
      } else if (toolType === 'shapes') {
          toolType = props.currentShape; // Use the specific shape from prop
          if (debugModeEnabled.value) {
              debugLog(`[startDrawing] Starting shape drawing with type: ${toolType}`);
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
          elementData.lineStyle = props.currentLineStyle;
          elementData.roughness = props.currentRoughness;
          if (toolType === 'line') {
             elementData.arrowStyle = props.currentArrowStyle;
          }
          if (debugModeEnabled.value) {
              debugLog(`[startDrawing] Style set: ${elementData.lineStyle}, Roughness: ${elementData.roughness}`);
          }
      }

      // Create preview element based on the determined toolType
      currentElementPreview.value = createNewElement(
        toolType,
        transformedCoords, 
        colorForElement,
        lineWidthForElement,
        elementData // Pass extra data
      );

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
              debugLog("[startDrawing] Preview element created:", JSON.stringify(currentElementPreview.value));
          }
      } else {
          // console.error(`[startDrawing] Failed to create preview element for tool type: ${toolType} with data:`, elementData); // Commented out
          isDrawing.value = false; // Stop drawing if preview failed
          return;
      }
    };

    const eraseElement = (indexOrId) => { // Can now accept index or ID
      if (!ydoc.value || !yDrawings.value) return;

      let elementIndex = -1;
      if (typeof indexOrId === 'number') {
        elementIndex = indexOrId;
      } else if (typeof indexOrId === 'string') {
        elementIndex = yDrawings.value.toArray().findIndex(elMap => elMap.get('id') === indexOrId);
      }
      
      if (elementIndex !== -1 && elementIndex >= 0 && elementIndex < yDrawings.value.length) {
        debugLog(`[eraseElement] Removing element at index: ${elementIndex}`);

        ydoc.value.transact(() => {
          yDrawings.value.delete(elementIndex, 1);
        }, 'local-erase'); 
        refreshMovableElements();

        nextTick(() => {
          if (undoManager.value) {
             updateGlobalState(); 
          }
        });
      } else {
        debugWarn(`[eraseElement] Element not found for index/ID: ${indexOrId}`);
      }
    };

    // Tools that behave like shapes (use start/end points)
    // SHAPE_TOOLS moved to top of setup


    const LINE_TOOLS = new Set(['line']);

    // Elements that render via DOM overlays (MovableObject/PlotRenderer) and should not be drawn twice on the canvas
    // DOM_RENDERED_TYPES removed (unused)


    const draw = (coords, isShiftPressed, inputTime) => { // Accept shift key state
      if (!isDrawing.value || !currentElementPreview.value) return;
      if (currentTool.value === 'eraser') return;

      const preview = currentElementPreview.value;
      const resolvedTool = currentTool.value === 'shapes'
        ? props.currentShape
        : currentTool.value === 'lines'
          ? 'line'
          : currentTool.value;
      const previewType = preview.type || resolvedTool;
      const timestamp = typeof inputTime === 'number'
        ? inputTime
        : (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const stampedCoords = { ...coords, t: timestamp };

      // Update logic based on the actual tool and shift state
      if (resolvedTool === 'pen') {
          if (shiftPressedAtStart.value && startCoordsForShiftLine.value) {
              preview.type = 'line'; // Temporarily change type for drawElement
              const baseStart = preview.rawPoints?.[0] || { ...startCoordsForShiftLine.value, t: timestamp };
              if (!preview.rawPoints) {
                  preview.rawPoints = [baseStart];
              }
              const snappedStart = applySoftGridSnap(baseStart, null);
              const snappedEnd = applySoftGridSnap(stampedCoords, baseStart);
              preview.start = { x: snappedStart.x, y: snappedStart.y };
              preview.end = { x: snappedEnd.x, y: snappedEnd.y };
              delete preview.points; // Remove points array for line preview
          } else if (!shiftPressedAtStart.value) {
              // Normal pen drawing - ensure preview type is 'pen'
              preview.type = 'pen';
              if (!preview.points) preview.points = []; // Initialize if needed
              if (!preview.rawPoints) preview.rawPoints = [];
              const prevRaw = preview.rawPoints[preview.rawPoints.length - 1] || null;
              preview.rawPoints.push(stampedCoords);
              const smoothedPoint = addSmoothedPenPoint(stampedCoords);
              const snappedPoint = applySoftGridSnap(smoothedPoint, prevRaw);
              
              // Throttling: Check distance
              const MIN_DIST_SQ = 2.25; // 1.5 * 1.5
              let shouldAdd = true;
              if (preview.points.length > 0) {
                  const last = preview.points[preview.points.length - 1];
                  const dx = snappedPoint.x - last.x;
                  const dy = snappedPoint.y - last.y;
                  if (dx * dx + dy * dy < MIN_DIST_SQ) {
                      shouldAdd = false;
                  }
              }
              
              if (shouldAdd) {
                  preview.points.push({
                      x: snappedPoint.x,
                      y: snappedPoint.y,
                      t: snappedPoint.t ?? smoothedPoint.t
                  });
                  preview.snappedPoints = preview.points;
              }
          }
      } else if (SHAPE_TOOLS.has(previewType) || LINE_TOOLS.has(previewType)) {
          // Update end coordinates for shapes and regular lines
          const snappedCoords = applySoftGridSnap(stampedCoords, preview.start ? { ...preview.start, t: timestamp } : null);
          preview.end = { x: snappedCoords.x, y: snappedCoords.y };

          // Special handling for square aspect ratio during preview
          if (preview.type === 'square') {
              const dx = Math.abs(snappedCoords.x - preview.start.x); // Use coords directly here
              const dy = Math.abs(snappedCoords.y - preview.start.y);
              const size = Math.max(dx, dy);
              preview.end = {
                  x: preview.start.x + size * Math.sign(snappedCoords.x - preview.start.x),
                  y: preview.start.y + size * Math.sign(snappedCoords.y - preview.start.y)
              };
          }

          // Live binding snap for lines to mimic Excalidraw connectors
          if (preview.type === 'line') {
              attachBindingsToLineDraft(preview);
          }
      }
      // Redraw after updating preview element
      scheduleRedraw(false); // Dynamic only
    };

    const finishDrawing = () => {
      const wasShiftPressed = shiftPressedAtStart.value; // Capture state before resetting
      const shiftStartPoint = startCoordsForShiftLine.value; // Capture start point
      const originalTool = currentTool.value; // Capture the tool selected in the toolbar
      shiftPressedAtStart.value = false; // Reset shift state
      startCoordsForShiftLine.value = null; // Reset start point
      snapIndicator.value = null;

      if (!isDrawing.value || !currentElementPreview.value || !ydoc.value || !yDrawings.value) {
          isDrawing.value = false; // Ensure drawing state is reset
          currentElementPreview.value = null;
          return;
      }

      isDrawing.value = false;

      let elementToAdd = null;
      const preview = currentElementPreview.value;

      // Check if the element is valid (e.g., has size)
      const isValidElement = preview.start && preview.end && (preview.start.x !== preview.end.x || preview.start.y !== preview.end.y);
      // Pen needs at least two distinct points unless it was a Shift+Pen action
      const isValidPen = preview.type === 'pen' && preview.points && preview.points.length >= 2 && !wasShiftPressed;
      // Shift+Pen is valid if we have the start point and the preview end point
      const isValidShiftPen = originalTool === 'pen' && wasShiftPressed && shiftStartPoint && preview.end && (shiftStartPoint.x !== preview.end.x || shiftStartPoint.y !== preview.end.y);

      if (isValidPen || (preview.type !== 'pen' && isValidElement) || isValidShiftPen) {
          // If Shift was held with the pen tool, create a 'line' element
          if (wasShiftPressed && originalTool === 'pen' && isValidShiftPen) {
          if (debugModeEnabled.value) {
              debugLog("[finishDrawing] Shift held with Pen, creating Line element.");
          }
          elementToAdd = {
              type: 'line',
              start: preview.start || shiftStartPoint, // Use snapped start if available
                  end: preview.end, // Use the final end point from the preview
                  color: preview.color,
                  lineWidth: preview.lineWidth,
                  timestamp: Date.now(), // Use current timestamp
                  lineStyle: 'solid', // Force solid line style for Shift+Pen
                  rawPoints: preview.rawPoints || []
              };
          } else {
              // Otherwise, use the preview element as is
              elementToAdd = { ...preview };
              delete elementToAdd.id; // Remove temporary ID

              // --- OPTIMIZATION: Ramer-Douglas-Peucker Simplification ---
              // This block reduces the number of points in freehand strokes to improve performance.
              // To DISABLE this optimization: Comment out the entire 'if' block below.
              // To ADJUST sensitivity: Change the epsilon value (currently 0.5). Higher = more simplified.
              if (elementToAdd.type === 'pen' && elementToAdd.points && elementToAdd.points.length > 2) {
                  // Ramer-Douglas-Peucker simplification
                  const simplifyPoints = (points, epsilon) => {
                      if (points.length <= 2) return points;
                      const sqTolerance = epsilon * epsilon;
                      
                      let maxSqDist = 0;
                      let index = 0;
                      const end = points.length - 1;
                      
                      for (let i = 1; i < end; i++) {
                          const sqDist = getSqSegDist(points[i], points[0], points[end]);
                          if (sqDist > maxSqDist) {
                              maxSqDist = sqDist;
                              index = i;
                          }
                      }
                      
                      if (maxSqDist > sqTolerance) {
                          const res1 = simplifyPoints(points.slice(0, index + 1), epsilon);
                          const res2 = simplifyPoints(points.slice(index), epsilon);
                          return [...res1.slice(0, res1.length - 1), ...res2];
                      } else {
                          return [points[0], points[end]];
                      }
                  };

                  // Helper for point to segment distance squared
                  const getSqSegDist = (p, p1, p2) => {
                      let x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
                      if (dx !== 0 || dy !== 0) {
                          const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
                          if (t > 1) {
                              x = p2.x; y = p2.y;
                          } else if (t > 0) {
                              x += dx * t; y += dy * t;
                          }
                      }
                      dx = p.x - x; dy = p.y - y;
                      return dx * dx + dy * dy;
                  };

                  // Epsilon depends on zoom level, but we store in world coords.
                  // A value of 0.5 to 1.0 is usually good for freehand.
                  // REDUCED to 0.15 for smoother curves and less angularity.
                  const simplified = simplifyPoints(elementToAdd.points, 0.15);
                  // debugLog(`[finishDrawing] Simplified stroke: ${elementToAdd.points.length} -> ${simplified.length} points`);
                  elementToAdd.points = simplified;
              }
              // --- END OPTIMIZATION ---

              // Ensure lineStyle is included if the original tool was 'lines'
              if (originalTool === 'lines' && elementToAdd.type === 'line') {
                 // Always assign the style from props when the tool was 'lines'
                 const styleFromProps = props.currentLineStyle || 'solid';
                 if (debugModeEnabled.value) {
                     debugLog(`[finishDrawing] lineStyle missing or needs override, setting from prop: ${styleFromProps}`);
                 }
                 elementToAdd.lineStyle = styleFromProps;
              }
          }

          // Add only if elementToAdd is not null
          if (elementToAdd) {
              if (elementToAdd.type === 'line') {
                attachBindingsToLineDraft(elementToAdd);
              }
              // Assign a unique ID before adding to Yjs
              elementToAdd.id = `${yjsConnection.value?.awareness?.clientID || 'local'}-${Date.now()}`;

              if (debugModeEnabled.value) {
                  debugLog('[finishDrawing] Final elementToAdd before Yjs transaction:', JSON.stringify(elementToAdd));
              }

              try {
                  ydoc.value.transact(() => {
                      const yElementMap = new Y.Map();

                      // Set basic properties that all elements have
                      yElementMap.set('id', elementToAdd.id); // Store the ID
                      yElementMap.set('type', elementToAdd.type);
                      yElementMap.set('color', elementToAdd.color);
                      yElementMap.set('lineWidth', elementToAdd.lineWidth);
                      yElementMap.set('timestamp', Date.now());
                      yElementMap.set('rotation', 0); // Default rotation

                      const shapeOrLine = SHAPE_TOOLS.has(elementToAdd.type) || elementToAdd.type === 'line';
                      const resolvedLineStyle = elementToAdd.lineStyle ?? (shapeOrLine ? props.currentLineStyle || 'solid' : undefined);
                      const resolvedRoughness = elementToAdd.roughness ?? (shapeOrLine ? props.currentRoughness ?? 1 : undefined);
                      if (resolvedLineStyle !== undefined && resolvedLineStyle !== null) {
                        yElementMap.set('lineStyle', resolvedLineStyle);
                      }
                      if (resolvedRoughness !== undefined && resolvedRoughness !== null) {
                        yElementMap.set('roughness', resolvedRoughness);
                      }

                      // Handle type-specific properties and x, y, width, height
                      if (elementToAdd.type === 'pen') {
                          if (elementToAdd.penStyle) {
                              yElementMap.set('penStyle', elementToAdd.penStyle);
                          }
                          if (elementToAdd.penConfig) {
                              yElementMap.set('penConfig', elementToAdd.penConfig);
                          }
                          // Store points as an array (not a Y.Array)
                          yElementMap.set('points', elementToAdd.points);
                          if (elementToAdd.rawPoints) {
                              yElementMap.set('rawPoints', elementToAdd.rawPoints);
                          }
                          if (elementToAdd.points && elementToAdd.points.length > 0) {
                              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                              elementToAdd.points.forEach(p => {
                                  const px = typeof p.x === 'number' ? p.x : Array.isArray(p) ? p[0] : 0;
                                  const py = typeof p.y === 'number' ? p.y : Array.isArray(p) ? p[1] : 0;
                                  minX = Math.min(minX, px);
                                  minY = Math.min(minY, py);
                                  maxX = Math.max(maxX, px);
                                  maxY = Math.max(maxY, py);
                              });
                              yElementMap.set('x', minX);
                              yElementMap.set('y', minY);
                              yElementMap.set('width', Math.max(0, maxX - minX)); // Ensure non-negative
                              yElementMap.set('height', Math.max(0, maxY - minY)); // Ensure non-negative
                              // Points remain absolute to preserve compatibility with the renderer
                          } else {
                              yElementMap.set('x', 0);
                              yElementMap.set('y', 0);
                              yElementMap.set('width', 0);
                              yElementMap.set('height', 0);
                          }
                      }
                      else if (elementToAdd.type === 'line' || 
                               (elementToAdd.start && elementToAdd.end)) { // Covers shapes
                          const x = Math.min(elementToAdd.start.x, elementToAdd.end.x);
                          const y = Math.min(elementToAdd.start.y, elementToAdd.end.y);
                          const width = Math.abs(elementToAdd.start.x - elementToAdd.end.x);
                          const height = Math.abs(elementToAdd.start.y - elementToAdd.end.y);
                          yElementMap.set('x', x);
                          yElementMap.set('y', y);
                          yElementMap.set('width', width);
                          yElementMap.set('height', height);

                          // Store start/end as nested Y.Maps (can be kept for now)
                          const startMap = new Y.Map();
                          startMap.set('x', elementToAdd.start.x);
                          startMap.set('y', elementToAdd.start.y);
                          yElementMap.set('start', startMap);

                          const endMap = new Y.Map();
                          endMap.set('x', elementToAdd.end.x);
                          endMap.set('y', elementToAdd.end.y);
                          yElementMap.set('end', endMap);

                          if (elementToAdd.type === 'line') {
                            const arrowStyle = elementToAdd.arrowStyle || props.currentArrowStyle || 'none';
                            yElementMap.set('arrowStyle', arrowStyle);
                          }
                          if (elementToAdd.startBinding) {
                            yElementMap.set('startBinding', elementToAdd.startBinding);
                          }
                          if (elementToAdd.endBinding) {
                            yElementMap.set('endBinding', elementToAdd.endBinding);
                          }
                      }
                      // text and image types are handled in their respective functions (addTextElement, addImageFromDataUrl)
                      // and should already have x, y, width, height. We just need to ensure rotation is set.
                      // Plotting elements from addElementFromPanel also need this.

                      // Push to the shared array only if not text/image (handled elsewhere, but they are pushed there)
                      if (elementToAdd.type !== 'text' && elementToAdd.type !== 'image') {
                        yDrawings.value.push([yElementMap]);
                        refreshMovableElements();
                      }

                      if (debugModeEnabled.value) {
                          debugLog('[finishDrawing] Successfully pushed Y.Map to yDrawings');
                      }
                  }, 'local-drawing'); // Add origin

                  // Notify helper modules after element is committed
                  if (props.activeFeature && elementToAdd.type !== 'text' && elementToAdd.type !== 'image') {
                      const module = getActiveModule();
                      if (module && module.addStroke) {
                          // Pass the element with its new ID
                          module.addStroke({ ...elementToAdd });
                          // Update UI feedback state if needed (e.g., for styler)
                          if (props.activeFeature === 'styleHandwriting') {
                              emit('update:has-char-groups', false);
                              emit('update:has-stylized-strokes', false);
                          }
                      }
                  }

                  // Po każdej transakcji dodaj (inside try block):
                  nextTick(() => {
                     if (undoManager.value) {
                        updateGlobalState(); // Use the shared function
                     }
                  });
              } catch (error) {
                  console.error('[finishDrawing] Error during Yjs transaction:', error);
                  showToast("Error saving drawing element.", "error");
              }
          }
      } else {
          if (debugModeEnabled.value) {
              debugLog('Drawing finished but element was too small or invalid, not adding.');
          }
      }

      currentElementPreview.value = null;
      pointsBuffer.value = [];
      redrawCanvas(); // Redraw to remove the preview
    };

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

      if (spacePanActive.value) {
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

    // --- Keyboard handling ---
    const aiCommandPaletteRef = ref(null);

    const getAiContext = async () => {
      // Basic context provider for AI Command Palette
      const viewport = {
         x: panOffset.value.x,
         y: panOffset.value.y,
         width: canvasWidth.value,
         height: canvasHeight.value,
         zoom: zoomLevel.value
      };

      return { viewport };
    };

    const handleKeyDown = (event) => {
      const tagName = event.target.tagName.toUpperCase();

      // Allow Ctrl+Space even if focusing input
      if (event.ctrlKey && event.code === 'Space') {
          // It's handled by AICommandPalette's own listener
      } else if (tagName === 'INPUT' || tagName === 'TEXTAREA' || event.target.isContentEditable) {
          return;
      }

      // Double check if we are in the middle of editing text (e.g. focus lost momentarily)
      if (currentTool.value === 'text' && inlineTextEditor.visible) return;

      if (event.code === 'Space') {
        event.preventDefault();
        if (!spacePanActive.value) {
          spacePanActive.value = true;
          updateCursor();
        }
        return;
      }

      if (event.key === 'Escape') {
        let handled = false;
        if (activeConfigPanel.value) {
          closeConfigPanel();
          handled = true;
        }
        handled = cancelActiveDrawing() || handled;
        if (handled) {
          event.preventDefault();
          updateCursor();
          return;
        }
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === '+' || (event.key === '=' && event.shiftKey)) {
          event.preventDefault();
          zoomIn();
          return;
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          zoomOut();
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          resetZoom();
          return;
        }

        // Tool shortcuts
        const lowerKey = event.key.toLowerCase();
        // Check for single letter keys to avoid interfering with other inputs if any check failed
        if (lowerKey === 'v') {
            setTool('select');
            return;
        }
        if (lowerKey === 'p') {
            setTool('pen');
            return;
        }
        if (lowerKey === 't') {
            setTool('text');
            return;
        }
        if (lowerKey === 'e') {
            setTool('eraser');
            return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          redo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redo();
      }

      // Handle Tab or Shift+Enter for accepting ghost answer
      if (event.key === 'Tab' || (event.shiftKey && event.key === 'Enter')) {
          if (props.activeFeature === 'mathRecognizer' && mathRecognizerModule.value) {
              const newStroke = mathRecognizerModule.value.acceptGhostAnswer();
              if (newStroke) {
                  event.preventDefault(); // Prevent default Tab behavior
                  applyMathAnswer(newStroke);
                  return;
              }
          }
      }
    };

    const handleKeyUp = (event) => {
      if (event.code === 'Space' && spacePanActive.value) {
        event.preventDefault();
        resetSpacePanState(true);
      }
    };

    const handleWindowBlur = () => {
      resetSpacePanState(true);
      if (pinchGesture.value) {
        endTouchGesture();
      }
    };

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

    const addImageFromDataUrl = (dataUrl) => {
        if (!ydoc.value || !yDrawings.value) {
            console.error("[addImageFromDataUrl] Error: ydoc or yDrawings not available!");
            showToast("Cannot add image - connection issue", "error");
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

    // --- Status & Notifications ---
    const showStatus = (message, duration = 2000) => {
      statusMessage.value = message;
      if (statusTimeout.value) clearTimeout(statusTimeout.value);
      statusTimeout.value = setTimeout(() => { statusMessage.value = ''; }, duration);
    };

    const showToast = (message, type = 'default', duration = 3000) => {
      const id = ++notificationId.value;
      notifications.value.push({ id, message, type });
      setTimeout(() => {
        notifications.value = notifications.value.filter(n => n.id !== id);
      }, duration);
    };

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
            redrawCanvas(); // Ensure immediate visual update even if observer lags

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

    // --- PDF Export helpers ---
    const normalizePointForBounds = (pt) => {
      if (!pt) return null;
      if (Array.isArray(pt)) {
        const [x, y] = pt;
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
        return null;
      }
      const x = Number.isFinite(pt.x) ? pt.x : null;
      const y = Number.isFinite(pt.y) ? pt.y : null;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    };

    const getElementBounds = (element) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const addPoint = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      };
      const addRect = (x, y, w, h) => {
        if (![x, y, w, h].every(Number.isFinite)) return;
        addPoint(x, y);
        addPoint(x + w, y + h);
      };

      if (Array.isArray(element?.points)) {
        element.points.forEach((pt) => {
          const p = normalizePointForBounds(pt);
          if (p) addPoint(p.x, p.y);
        });
      }

      if (element?.start && element?.end) {
        const start = normalizePointForBounds(element.start);
        const end = normalizePointForBounds(element.end);
        if (start) addPoint(start.x, start.y);
        if (end) addPoint(end.x, end.y);
      }

      if (element?.position) {
        const { x, y } = element.position;
        const width = Number.isFinite(element.width)
          ? element.width
          : Number.isFinite(element.size) ? element.size : 0;
        const height = Number.isFinite(element.height)
          ? element.height
          : Number.isFinite(element.size) ? element.size : 0;
        addRect(x, y, width, height);
      }

      if (Number.isFinite(element?.x) && Number.isFinite(element?.y)) {
        const w = Number.isFinite(element.width) ? element.width : 0;
        const h = Number.isFinite(element.height) ? element.height : 0;
        addRect(element.x, element.y, w, h);
      }

      if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
        return null;
      }
      const padding = Math.max(2, Number.isFinite(element.lineWidth) ? element.lineWidth : 0);
      return { x1: minX - padding, y1: minY - padding, x2: maxX + padding, y2: maxY + padding };
    };

    const getSceneBounds = (elements) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      elements.forEach((el) => {
        const bounds = getElementBounds(el);
        if (!bounds) return;
        minX = Math.min(minX, bounds.x1);
        minY = Math.min(minY, bounds.y1);
        maxX = Math.max(maxX, bounds.x2);
        maxY = Math.max(maxY, bounds.y2);
      });
      if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
        return null;
      }
      return { x1: minX, y1: minY, x2: maxX, y2: maxY };
    };

    const preloadImagesForExport = async (elements) => {
      const loaders = [];
      elements.forEach((el) => {
        if (el.type !== 'image') return;
        const src = el.src || el.dataUrl;
        if (!src) return;
        const cached = imageCache.value?.get(src);
        if (cached && cached.complete) return;
        loaders.push(new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            imageCache.value?.set(src, img);
            resolve(true);
          };
          img.onerror = () => resolve(false);
          img.src = src;
        }));
      });
      if (loaders.length) {
        await Promise.all(loaders);
      }
    };

    // PDF export config
    const EXPORT_DPI = 600; // Very high DPI for crisp zoom (up to ~1000%)
    const PAGE_SIZE_INCH = { w: 8.27, h: 11.69 }; // A4 portrait in inches
    const PAGE_PX = {
      w: Math.round(PAGE_SIZE_INCH.w * EXPORT_DPI),
      h: Math.round(PAGE_SIZE_INCH.h * EXPORT_DPI),
    };
    const PDF_IMAGE_COMPRESSION = 'NONE'; // No extra compression to keep details sharp

    const drawGridForExport = (ctx, bounds, scale, marginPx, pagePx) => {
      const pan = {
        x: marginPx - bounds.x1 * scale,
        y: marginPx - bounds.y1 * scale,
      };
      // Use light grid in exports so the background stays printable even in dark mode.
      drawUtilGrid(ctx, scale, pan, pagePx.w, pagePx.h, false);
      return pan;
    };

    const exportBoardAsPdf = async () => {
      try {
        console.log('[WhiteboardCanvas] exportBoardAsPdf start');
        showToast('Preparing PDF...', 'info', 1500);
        if (!yDrawings.value || !yDrawings.value.length) {
          showToast('Nothing to export yet.', 'warning');
          return;
        }

        const elements = yDrawings.value.toArray().map(map => map.toJSON());
        const sceneBounds = getSceneBounds(elements);
        if (!sceneBounds) {
          showToast('Nothing to export yet.', 'warning');
          return;
        }
        console.log('[WhiteboardCanvas] exportBoardAsPdf scene bounds', sceneBounds);

        await preloadImagesForExport(elements);

        const marginPx = Math.round(0.2 * EXPORT_DPI); // ~0.2 inch margin
        const worldW = Math.max(1, sceneBounds.x2 - sceneBounds.x1);
        const worldH = Math.max(1, sceneBounds.y2 - sceneBounds.y1);
        const scale = Math.min(
          (PAGE_PX.w - 2 * marginPx) / worldW,
          (PAGE_PX.h - 2 * marginPx) / worldH
        );

        const offscreen = document.createElement('canvas');
        offscreen.width = PAGE_PX.w;
        offscreen.height = PAGE_PX.h;
        const ctx = offscreen.getContext('2d');
        if (!ctx) {
          showToast('Unable to prepare PDF canvas.', 'error');
          return;
        }

        const pan = drawGridForExport(
          ctx,
          sceneBounds,
          scale,
          marginPx,
          PAGE_PX
        );

        ctx.save();
        ctx.translate(pan.x, pan.y);
        ctx.scale(scale, scale);

        elements.forEach((element) => {
          drawElement(ctx, element, false, smoothingFactor.value, imageCache.value);
        });

        ctx.restore();

        const pdf = new jsPDF('portrait', 'pt', 'a4');
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        pdf.addImage(
          offscreen.toDataURL('image/png'),
          'PNG',
          0,
          0,
          pageW,
          pageH,
          undefined,
          PDF_IMAGE_COMPRESSION
        );
        const blob = pdf.output('blob');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'whiteboard.pdf';
        a.click();
        URL.revokeObjectURL(url);
        console.log('[WhiteboardCanvas] exportBoardAsPdf done');
        showToast('Exported to PDF', 'success');
      } catch (err) {
        console.error('[exportBoardAsPdf] failed', err);
        showToast('PDF export failed. Check console.', 'error');
      }
    };

    const tileIntersects = (tileRect, bounds) => {
      return !(bounds.x2 <= tileRect.x1 || bounds.x1 >= tileRect.x2 || bounds.y2 <= tileRect.y1 || bounds.y1 >= tileRect.y2);
    };

    const renderTileToImage = (tileRect, elements) => {
      const marginPx = Math.round(0.2 * EXPORT_DPI);
      const worldW = Math.max(1, tileRect.x2 - tileRect.x1);
      const worldH = Math.max(1, tileRect.y2 - tileRect.y1);
      const scale = Math.min(
        (PAGE_PX.w - 2 * marginPx) / worldW,
        (PAGE_PX.h - 2 * marginPx) / worldH
      );

      const off = document.createElement('canvas');
      off.width = PAGE_PX.w;
      off.height = PAGE_PX.h;
      const ctx = off.getContext('2d');
      if (!ctx) return null;

      const pan = drawGridForExport(
        ctx,
        tileRect,
        scale,
        marginPx,
        PAGE_PX
      );

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(scale, scale);

      elements.forEach((el) => {
        drawElement(ctx, el, false, smoothingFactor.value, imageCache.value);
      });

      ctx.restore();
      return off.toDataURL('image/png');
    };

    const exportBoardAsPdfPaged = async () => {
      try {
        console.log('[WhiteboardCanvas] exportBoardAsPdfPaged start');
        showToast('Preparing PDF...', 'info', 1500);
        if (!yDrawings.value || !yDrawings.value.length) {
          showToast('Nothing to export yet.', 'warning');
          return;
        }

        const elements = yDrawings.value.toArray().map(map => map.toJSON());
        const sceneBounds = getSceneBounds(elements);
        if (!sceneBounds) {
          showToast('Nothing to export yet.', 'warning');
          return;
        }

        await preloadImagesForExport(elements);

        const TILE_W = 2000;
        const TILE_H = 1400;
        const tilesX = Math.max(1, Math.ceil((sceneBounds.x2 - sceneBounds.x1) / TILE_W));
        const tilesY = Math.max(1, Math.ceil((sceneBounds.y2 - sceneBounds.y1) / TILE_H));

        const pdf = new jsPDF('portrait', 'pt', 'a4');
        let isFirst = true;

        for (let ty = 0; ty < tilesY; ty++) {
          for (let tx = 0; tx < tilesX; tx++) {
            const tileRect = {
              x1: sceneBounds.x1 + tx * TILE_W,
              y1: sceneBounds.y1 + ty * TILE_H,
              x2: sceneBounds.x1 + (tx + 1) * TILE_W,
              y2: sceneBounds.y1 + (ty + 1) * TILE_H,
            };

            const shapesInTile = elements.filter((el) => {
              const b = getElementBounds(el);
              if (!b) return false;
              return tileIntersects(tileRect, b);
            });

            if (!shapesInTile.length) continue;

            const imgData = renderTileToImage(tileRect, shapesInTile);
            if (!imgData) continue;

            if (!isFirst) pdf.addPage();
            isFirst = false;
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            pdf.addImage(
              imgData,
              'PNG',
              0,
              0,
              pageW,
              pageH,
              undefined,
              PDF_IMAGE_COMPRESSION
            );
            pdf.setFontSize(10);
            pdf.text(`Page ${pdf.getNumberOfPages()}`, pageW - 60, pageH - 20);
          }
        }

        if (isFirst) {
          showToast('Nothing to export yet.', 'warning');
          return;
        }

        const blob = pdf.output('blob');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'whiteboard-notes.pdf';
        a.click();
        URL.revokeObjectURL(url);
        console.log('[WhiteboardCanvas] exportBoardAsPdfPaged done');
        showToast('Exported to PDF (notes)', 'success');
      } catch (err) {
        console.error('[exportBoardAsPdfPaged] failed', err);
        showToast('PDF export failed. Check console.', 'error');
      }
    };

    const getSerializableState = () => { return {}; }; // Placeholder
    const loadState = (state) => { return false; }; // Placeholder
    const exportAsText = () => { return ''; }; // Placeholder
    const importFromText = (text) => { return false; }; // Placeholder

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
        });

        nextTick(() => {
          // debugLog("Test element dodany. canUndo =", undoManager.value?.canUndo()); // Commented out
          alert(`Test wykonany. canUndo = ${canUndo.value}`);
        });
      } catch (error) {
        // console.error("Błąd testu:", error); // Commented out
        alert("Błąd testu: " + error.message);
      }
    };

    // --- Helper module integration ---

    const getActiveModule = () => {
        switch (props.activeFeature) {
            case 'gridAlign': return gridAlignModule.value;
            case 'styleHandwriting': return handwritingStylerModule.value;
            case 'mathRecognizer': return mathRecognizerModule.value;
            default: return null;
        }
    };

    // --- Helper module actions (invoked via App.vue) ---

    const alignToGrid = () => {
        if (!ydoc.value || !yDrawings.value) {
            debugWarn('[alignToGrid] Yjs not ready.');
            return;
        }
        const { worldGridStep } = computeGridSteps(zoomLevel.value);
        if (!worldGridStep || Number.isNaN(worldGridStep)) {
            debugWarn('[alignToGrid] Invalid grid size');
            return;
        }
        const axisMode = props.gridAlignOptions.showBaselines ? 'y' : 'both';

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
            debugLog('[alignToGrid] No points to align.');
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
                height: Math.max(0, maxY - minY)
            };
        };

        const shiftPoint = (p) => {
            if (Array.isArray(p)) {
                return [p[0] + shiftX, p[1] + shiftY, p[2]];
            }
            return { ...p, x: (p.x ?? 0) + shiftX, y: (p.y ?? 0) + shiftY };
        };

        const changedIds = [];

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
            nextTick(() => {
                debugLog(`[alignToGrid] Shifted ${changedIds.length} elements by (${shiftX.toFixed(2)}, ${shiftY.toFixed(2)}).`);
                updateGlobalState();
                syncModulesWithYjs();
                redrawCanvas(); // Redraw to show aligned strokes
            });
        } else {
             debugLog('[alignToGrid] No elements needed snapping.');
             redrawCanvas();
        }
    };

    const groupStrokes = () => {
        if (!handwritingStylerModule.value) return;
        handwritingStylerModule.value.groupStrokes();
        emit('update:has-char-groups', handwritingStylerModule.value.hasCharGroups());
        emit('update:has-stylized-strokes', false); // Reset stylized state
        redrawCanvas(); // Redraw to show group bounds
    };

    const applyStyleTransformation = () => {
        if (!handwritingStylerModule.value) return;
        handwritingStylerModule.value.applyStyleTransformation();
        emit('update:has-stylized-strokes', handwritingStylerModule.value.hasStylizedStrokes());
        redrawCanvas(); // Redraw to show stylized preview
    };

    const confirmStyleChanges = () => {
        if (!handwritingStylerModule.value || !ydoc.value || !yDrawings.value) {
            debugWarn('[confirmStyleChanges] Module or Yjs not ready.');
             return;
        }
         debugLog('[confirmStyleChanges] Calling module.confirmStyleChanges()');
        const updatedStrokes = handwritingStylerModule.value.confirmStyleChanges(); // Module returns updated strokes and resets its internal state

        if (updatedStrokes && updatedStrokes.length > 0) {
             debugLog(`[confirmStyleChanges] Module returned ${updatedStrokes.length} updated strokes. Applying to Yjs...`);
             ydoc.value.transact(() => {
                 // Iterate through yDrawings directly
                 for (let i = 0; i < yDrawings.value.length; i++) {
                    const yMap = yDrawings.value.get(i);
                    const strokeId = yMap.get('id');
                    const updatedStroke = updatedStrokes.find(s => s.id === strokeId);

                    if (updatedStroke) {
                        debugLog(`[confirmStyleChanges] Updating Y.Map for stroke ID: ${strokeId}`);
                        yMap.set('points', updatedStroke.points); // Update points
                    } else {
                         // Log if a changed stroke ID wasn't found in yDrawings
                        // if (updatedStrokes.some(s => s.id === strokeId)) {
                        //    console.warn(`[confirmStyleChanges] Mismatch: Updated stroke ${strokeId} present but not found during Y.Map iteration?`);
                        // }
                    }
                }
            }, 'ai-style'); // Origin

            nextTick(() => {
                debugLog('[confirmStyleChanges] Yjs transaction complete. Updating global state and redrawing.');
                updateGlobalState();
                emit('update:has-stylized-strokes', false); // Update App state
                emit('update:has-char-groups', false);    // Update App state
                redrawCanvas();
            });
        } else {
            debugLog('[confirmStyleChanges] Module returned no updated strokes. Resetting state.');
            // If no strokes were updated (e.g., module error or nothing to confirm), just reset state and redraw
            emit('update:has-stylized-strokes', false);
            emit('update:has-char-groups', false);
            redrawCanvas();
        }
    };

    const cancelStyleChanges = () => {
        if (!handwritingStylerModule.value) return;
        handwritingStylerModule.value.cancelStyleChanges();
        emit('update:has-stylized-strokes', false);
        // Keep char groups? Or reset? Let's reset for now.
        // emit('update:has-char-groups', false);
        redrawCanvas(); // Redraw to show original strokes
    };

    const recognizeEquation = async () => {
        if (!mathRecognizerModule.value) return;
        emit('update:recognition-status', 'Recognizing...');
        emit('update:latex-equation', '');
        emit('update:solution', '');
        try {
            const result = await mathRecognizerModule.value.recognizeEquation();
            emit('update:recognition-status', mathRecognizerModule.value.getRecognitionStatus());
            if (result) {
                // renderLatex is called internally by the module if configured
                // emit('update:latex-equation', result.latex || ''); // Already handled by renderLatex emit
                emit('update:solution', result.solution || '');
            }
        } catch (error) {
             emit('update:recognition-status', `Error: ${error.message}`);
        } finally {
            redrawCanvas(); // Redraw to show ghost answer if generated
        }
    };



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
      
      applyGhostAnswer: (payload) => { 
            const stroke = mathRecognizerModule.value?.applyGhostAnswer();
            if (stroke) applyMathAnswer(stroke);
      }
    };

    expose(publicApi);
    return publicApi;
  }
};

const detachLineBindings = (lineId) => {
  if (!ydoc.value || !yDrawings.value) return;
  const map = findElementMapById(lineId);
  if (!map || map.get('type') !== 'line') return;
  ydoc.value.transact(() => {
    if (map.has('startBinding')) map.delete('startBinding');
    if (map.has('endBinding')) map.delete('endBinding');
  }, 'line-detach-binding');
};

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

