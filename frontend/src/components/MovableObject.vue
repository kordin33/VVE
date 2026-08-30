<template>
  <div
    ref="movableObjectRef"
    class="movable-object"
    :class="{ 'is-selected': isSelected, 'is-line-type': isLineType }"
    :style="objectStyle"
    @pointerdown.stop="handleLeftClickOnObject" 
    @dblclick.stop="handleDoubleClick" touch-action="none"
  >
    <!-- Rotation Handle -->
    <div
      v-if="isSelected && !isLineType"
      class="rotation-handle"
      @pointerdown.stop="startRotate"
    ></div>

    <!-- Line Endpoint Handles -->
    <div v-if="isSelected && isLineType" class="line-handles">
      <div
        class="line-end-handle line-start-handle"
        :style="lineHandlePositions.start"
        @pointerdown.stop="startLineEndpointDrag($event, 'start')"
      ></div>
      <div
        class="line-end-handle line-terminal-handle"
        :style="lineHandlePositions.end"
        @pointerdown.stop="startLineEndpointDrag($event, 'end')"
      ></div>
    </div>

    <!-- Resize Handles -->
    <div v-else-if="isSelected" class="resize-handles">
      <div class="resize-handle nw-handle" @pointerdown.stop="startResize($event, 'nw')"></div>
      <div class="resize-handle n-handle" @pointerdown.stop="startResize($event, 'n')"></div>
      <div class="resize-handle ne-handle" @pointerdown.stop="startResize($event, 'ne')"></div>
      <div class="resize-handle w-handle" @pointerdown.stop="startResize($event, 'w')"></div>
      <div class="resize-handle e-handle" @pointerdown.stop="startResize($event, 'e')"></div>
      <div class="resize-handle sw-handle" @pointerdown.stop="startResize($event, 'sw')"></div>
      <div class="resize-handle s-handle" @pointerdown.stop="startResize($event, 's')"></div>
      <div class="resize-handle se-handle" @pointerdown.stop="startResize($event, 'se')"></div>
    </div>

    <!-- Object Content -->
    <div class="object-content" @pointerdown.prevent.stop="startDragIfSelectedOrRequestSelect">
      <template v-if="shouldRenderContent">
        <img
          v-if="objectData.type === 'image'"
          :src="objectData.src || objectData.dataUrl"
          :alt="'Object ' + objectData.id"
          draggable="false"
          style="width: 100%; height: 100%; user-select: none; object-fit: contain;"
        />
        <div v-else-if="objectData.type === 'text'"
             :style="{
               color: objectData.color || '#000000',
               fontSize: `${(objectData.fontSize || 16) * props.zoomLevel}px`, 
               fontFamily: '\'Kalam\', cursive',
               width: '100%',
               height: '100%',
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center',
               textAlign: 'center',
               overflowWrap: 'break-word',
               whiteSpace: 'pre-wrap',
               userSelect: 'none',
               cursor: 'grab'
             }"
             @mousedown.stop="startDragIfSelectedOrRequestSelect">
          {{ objectData.text }}
        </div>
        <div v-else-if="objectData.type === 'latex'"
             class="latex-content"
             v-html="latexHtml"
             :style="{
               width: '100%',
               height: '100%',
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center',
               padding: `${16 * props.zoomLevel}px`,
               overflow: 'hidden',
               userSelect: 'none',
               color: objectData.color || '#1e293b',
               backgroundColor: 'rgba(255, 255, 255, 0.95)',
               borderRadius: `${12 * props.zoomLevel}px`,
               boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
               border: '1px solid rgba(0,0,0,0.05)',
               fontSize: `${(objectData.fontSize || 24) * props.zoomLevel}px`
             }"
        ></div>
        <PlotRenderer
          v-else-if="['functionPlot', 'mathFunctionPlot', 'physicsDataPlot', 'coordinateSystem2D', 'coordinateSystem3D'].includes(objectData.type)"
          :type="objectData.type"
          :width="objectData.width"
          :height="objectData.height"
          :data="objectData"
        />
        <div v-else>
          Unknown Type: {{ objectData.type }}
        </div>
      </template>
      <canvas
        v-else-if="objectData.width > 0 && objectData.height > 0"
        ref="localCanvas"
        class="local-canvas"
        style="width: 100%; height: 100%; pointer-events: none;"
      ></canvas>

      <!-- Text Overlay for Shapes -->
      <div v-if="objectData.text && objectData.type !== 'text'"
           class="text-overlay"
           :style="{
             fontSize: `${(objectData.fontSize || 24) * props.zoomLevel}px`,
             fontFamily: '\'Kalam\', cursive',
             color: objectData.color || '#000000',
           }"
      >
        {{ objectData.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue';
import * as Y from 'yjs'; 
import PlotRenderer from './PlotRenderer.vue';
import rough from 'roughjs';
import { drawElement } from '../utils/canvasDrawing';
import katex from 'katex';
import DOMPurify from 'dompurify'; 

interface MovableObjectData {
  id: string | number;
  type: string; 
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  src?: string; 
  dataUrl?: string;
  color?: string; 
  lineWidth?: number; 
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  lineStyle?: string;
  roughness?: number; // 0 = clean, 1 = sketchy, 2 = rough
  arrowStyle?: string; // For line arrows: 'none', 'start', 'end', 'both'
  fillColor?: string; // Fill color for shapes
  fillStyle?: string; // Fill style: 'solid', 'hachure', etc.
  fillOpacity?: number; // Fill opacity 0-1
  seed?: number; // RoughJS seed for consistent rendering
  text?: string;
  fontSize?: number;
  latex?: string; // For LaTeX rendering
  expression?: string; // For math plot
  xRange?: number[]; // For math plot
  points?: {x: number, y: number}[]; // For physics plot
}

const props = withDefaults(defineProps<{
  object: Y.Map<any>; 
  isSelected: boolean; 
  zoomLevel: number; 
  panOffset: { x: number; y: number }; 
  snapTargets?: { vertical: number[], horizontal: number[] };
  interactionEnabled?: boolean;
}>(), {
  interactionEnabled: true,
  snapTargets: () => ({ vertical: [], horizontal: [] })
});

const emit = defineEmits<{
  (e: 'request-select', id: string | number): void;
  (e: 'update:object', object: Y.Map<any> | any): void;
  (e: 'clone-object', data: any): void;
  (e: 'update:snap-guides', guides: any[]): void;
  (e: 'double-click', id: string | number): void;
  (e: 'interaction-start', id: string | number): void;
  (e: 'interaction-end', id: string | number): void;
}>();

const CONTENT_RENDER_TYPES = new Set([
  'text', 
  'image', 
  'latex', // NEW
  'functionPlot', // NEW 
  'mathFunctionPlot', 
  'physicsDataPlot', 
  'coordinateSystem2D', 
  'coordinateSystem3D'
]);

const renderLatex = (latexCode: string) => {
  try {
    // Clean up common delimiters that LLMs might include
    let cleanLatex = latexCode
      .replace(/^\\\[/, '')
      .replace(/\\\]$/, '')
      .replace(/^\\\(/, '')
      .replace(/\\\)$/, '')
      .replace(/^\$\$/, '')
      .replace(/\$\$$/, '')
      .replace(/^\$/, '')
      .replace(/\$$/, '')
      .trim();

    return DOMPurify.sanitize(katex.renderToString(cleanLatex, {
      displayMode: true,
      throwOnError: false
    }));
  } catch (e) {
    const safeCode = DOMPurify.sanitize(latexCode);
    return `<span style="color: red;">LaTeX Error: ${safeCode}</span>`;
  }
};

const ensureNumber = (value: any, fallback = 0) => (Number.isFinite(value) ? Number(value) : fallback);

const extractPoint = (value: any) => {
  if (!value) {
    return { x: 0, y: 0 };
  }
  if (typeof value.get === 'function') {
    return {
      x: ensureNumber(value.get('x'), 0),
      y: ensureNumber(value.get('y'), 0),
    };
  }
  return {
    x: ensureNumber(value.x, 0),
    y: ensureNumber(value.y, 0),
  };
};

const deriveBoundsFromPoints = (start: { x: number; y: number }, end: { x: number; y: number }) => {
  const width = Math.max(1, Math.abs(end.x - start.x));
  const height = Math.max(1, Math.abs(end.y - start.y));
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width,
    height,
  };
};

const clonePointsArray = (pointsValue: any) => {
  if (!Array.isArray(pointsValue)) return null;
  return pointsValue.map((pt) => ({
    x: ensureNumber(pt.x, 0),
    y: ensureNumber(pt.y, 0),
  }));
};

const shiftPointsArray = (pointsValue: any, dx: number, dy: number) => {
  if (!Array.isArray(pointsValue)) return null;
  return pointsValue.map((pt) => ({
    x: ensureNumber(pt.x, 0) + dx,
    y: ensureNumber(pt.y, 0) + dy,
  }));
};

// Helper: Get line points in relative format for rendering
// Returns points relative to (0, 0) for the local canvas (normalized to bounding box origin)
const getLinePointsForRender = (data: MovableObjectData): { x: number, y: number }[] | null => {
  let rawPoints: { x: number, y: number }[] | null = null;
  
  // Check if we have points array (line or pen type)
  const linePoints = data.points;
  if (Array.isArray(linePoints) && linePoints.length >= 1 && (data.type === 'line' || data.type === 'pen')) {
    rawPoints = linePoints.map(p => ({ x: ensureNumber(p.x, 0), y: ensureNumber(p.y, 0) }));
  }
  // Fallback: Convert from old start/end format
  else if (data.startX !== undefined && data.startY !== undefined && 
      data.endX !== undefined && data.endY !== undefined) {
    const baseX = data.x || 0;
    const baseY = data.y || 0;
    rawPoints = [
      { x: (data.startX || 0) - baseX, y: (data.startY || 0) - baseY },
      { x: (data.endX || 0) - baseX, y: (data.endY || 0) - baseY }
    ];
  }
  
  if (!rawPoints) return null;
  
  // Normalize: shift points so min is at (0, 0)
  // This matches what displayFrame does with offsetX/offsetY
  const xs = rawPoints.map(p => p.x);
  const ys = rawPoints.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  
  return rawPoints.map(p => ({
    x: p.x - minX,
    y: p.y - minY
  }));
};

// Helper: Calculate bounding box from line points (relative to element x,y)
const getLineBoundsFromPoints = (points: { x: number, y: number }[]): { width: number, height: number, offsetX: number, offsetY: number } => {
  if (!points || points.length < 2) {
    return { width: 1, height: 1, offsetX: 0, offsetY: 0 };
  }
  
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  
  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    offsetX: minX,
    offsetY: minY
  };
};

const computeRatio = (value: number | undefined, axisStart: number, axisLength: number, fallback = 0) => {
  if (value === undefined || !Number.isFinite(value) || axisLength === 0) {
    return fallback;
  }
  return (value - axisStart) / axisLength;
};

const scalePointsFromSnapshot = (
  snapshot: { x: number; y: number }[] | null,
  initialState: { x: number; y: number; width: number; height: number },
  newFrame: { x: number; y: number; width: number; height: number }
) => {
  if (!snapshot) return null;
  const widthDenominator = initialState.width === 0 ? 1 : initialState.width;
  const heightDenominator = initialState.height === 0 ? 1 : initialState.height;
  return snapshot.map((pt) => {
    const normalizedX = (pt.x - initialState.x) / widthDenominator;
    const normalizedY = (pt.y - initialState.y) / heightDenominator;
    return {
      x: newFrame.x + normalizedX * newFrame.width,
      y: newFrame.y + normalizedY * newFrame.height,
    };
  });
};

const movableObjectRef = ref<HTMLElement | null>(null);
const internalIsSelected = ref(props.isSelected);
const isDragging = ref(false);
const isRotating = ref(false);
const isResizing = ref(false);
const currentResizeHandle = ref<string | null>(null);
const currentLineHandle = ref<'start' | 'end' | null>(null);
const localCanvas = ref<HTMLCanvasElement | null>(null);

const initialObjectState = reactive({ x: 0, y: 0, width: 0, height: 0, rotation: 0 });
const initialMousePos = reactive({ x: 0, y: 0 });
const initialGeometrySnapshot = reactive({
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
  startRatioX: 0 as number | null,
  startRatioY: 0 as number | null,
  endRatioX: 1 as number | null,
  endRatioY: 1 as number | null,
  points: null as { x: number; y: number }[] | null,
});
const initialLineSnapshot = reactive({
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
});

watch(() => props.isSelected, (newValue) => {
    internalIsSelected.value = newValue;
});

const bootstrapObjectData = () => {
    const startPoint = extractPoint(props.object.get('start'));
    const endPoint = extractPoint(props.object.get('end'));
    const positionPoint = extractPoint(props.object.get('position'));
    const fallbackBounds = deriveBoundsFromPoints(startPoint, endPoint);

    return {
        id: props.object.get('id'),
        type: props.object.get('type'),
        x: ensureNumber(props.object.get('x'), ensureNumber(positionPoint.x, fallbackBounds.x)),
        y: ensureNumber(props.object.get('y'), ensureNumber(positionPoint.y, fallbackBounds.y)),
        rotation: ensureNumber(props.object.get('rotation'), 0),
        width: ensureNumber(props.object.get('width'), fallbackBounds.width > 0 ? fallbackBounds.width : 100),
        height: ensureNumber(props.object.get('height'), fallbackBounds.height > 0 ? fallbackBounds.height : 80),
        src: props.object.get('src') || props.object.get('dataUrl'),
        dataUrl: props.object.get('dataUrl'),
        color: props.object.get('color'),
        lineWidth: props.object.get('lineWidth'),
        startX: startPoint.x,
        startY: startPoint.y,
        endX: endPoint.x,
        endY: endPoint.y,
        lineStyle: props.object.get('lineStyle'),
        roughness: props.object.get('roughness'),
        arrowStyle: props.object.get('arrowStyle'),
        fillColor: props.object.get('fillColor'),
        fillStyle: props.object.get('fillStyle'),
        fillOpacity: props.object.get('fillOpacity'),
        seed: props.object.get('seed'),
        text: props.object.get('text'),
        fontSize: props.object.get('fontSize'),
        expression: props.object.get('expression'),
        xRange: props.object.get('xRange'),
        points: props.object.get('points'),
    } as MovableObjectData;
};

const objectData = reactive<MovableObjectData>(bootstrapObjectData());
const isLineType = computed(() => objectData.type === 'line');

const syncDataFromYMap = () => {
    const startPoint = extractPoint(props.object.get('start'));
    const endPoint = extractPoint(props.object.get('end'));
    const positionPoint = extractPoint(props.object.get('position'));
    const fallbackBounds = deriveBoundsFromPoints(startPoint, endPoint);

    objectData.id = props.object.get('id');
    objectData.type = props.object.get('type');
    objectData.x = ensureNumber(props.object.get('x'), ensureNumber(positionPoint.x, fallbackBounds.x));
    objectData.y = ensureNumber(props.object.get('y'), ensureNumber(positionPoint.y, fallbackBounds.y));
    objectData.rotation = ensureNumber(props.object.get('rotation'), 0);
    objectData.width = ensureNumber(props.object.get('width'), fallbackBounds.width > 0 ? fallbackBounds.width : 100);
    objectData.height = ensureNumber(props.object.get('height'), fallbackBounds.height > 0 ? fallbackBounds.height : 80);
    objectData.src = props.object.get('src') || props.object.get('dataUrl');
    objectData.dataUrl = props.object.get('dataUrl');
    objectData.color = props.object.get('color');
    objectData.lineWidth = props.object.get('lineWidth');
    objectData.startX = startPoint.x;
    objectData.startY = startPoint.y;
    objectData.endX = endPoint.x;
    objectData.endY = endPoint.y;
    objectData.lineStyle = props.object.get('lineStyle');
    objectData.roughness = props.object.get('roughness');
    objectData.arrowStyle = props.object.get('arrowStyle');
    objectData.fillColor = props.object.get('fillColor');
    objectData.fillStyle = props.object.get('fillStyle');
    objectData.fillOpacity = props.object.get('fillOpacity');
    objectData.seed = props.object.get('seed');
    objectData.text = props.object.get('text');
    objectData.fontSize = props.object.get('fontSize');
    objectData.expression = props.object.get('expression');
    objectData.xRange = props.object.get('xRange');
    objectData.points = props.object.get('points');
    objectData.latex = props.object.get('latex');
};

const lineHitPadding = computed(() => {
  const lineWidth = ensureNumber(objectData.lineWidth, 2);
  // Minimal padding: just stroke + handle radius (8px) 
  const handleRadius = 8;
  return Math.max(handleRadius, lineWidth + 4);
});

// Padding needed for shapes to prevent stroke clipping
const shapeStrokePadding = computed(() => {
  const lineWidth = ensureNumber(objectData.lineWidth, 2);
  const roughness = ensureNumber(objectData.roughness, 1);
  const shapeType = objectData.type;
  
  // Base padding for stroke
  const roughnessExtra = roughness > 0 ? lineWidth * roughness * 0.5 : 0;
  let basePadding = Math.max(lineWidth + 2, lineWidth + roughnessExtra + 4);
  
  // 3D shapes have ellipses that extend beyond the bounding box
  // The ellipse vertical radius is typically width * 0.15 to 0.3
  const is3DShape = ['cone', 'cylinder', 'sphere', 'cube', 'cuboid', 'pyramid', 'tetrahedron'].includes(shapeType);
  if (is3DShape) {
    // Ellipse extends beyond bounding box by approximately width * 0.2
    const extraFor3D = Math.max(objectData.width, objectData.height) * 0.25;
    basePadding = Math.max(basePadding, extraFor3D + lineWidth);
  }
  
  return basePadding;
});

const displayFrame = computed(() => {
  if (isLineType.value) {
    // Lines: calculate bounding box from points
    const padding = lineHitPadding.value;
    const linePoints = getLinePointsForRender(objectData);
    
    if (linePoints && linePoints.length >= 2) {
      // Calculate bounds from points (points are relative to objectData.x, objectData.y)
      const bounds = getLineBoundsFromPoints(linePoints);
      
      // The frame starts at the element position minus padding
      return {
        x: ensureNumber(objectData.x, 0) + bounds.offsetX - padding,
        y: ensureNumber(objectData.y, 0) + bounds.offsetY - padding,
        width: Math.max(1, bounds.width + padding * 2),
        height: Math.max(1, bounds.height + padding * 2),
        padding,
      };
    }
    
    // Fallback to old format
    const baseWidth = Math.max(0, ensureNumber(objectData.width, 0));
    const baseHeight = Math.max(0, ensureNumber(objectData.height, 0));
    return {
      x: ensureNumber(objectData.x, 0) - padding,
      y: ensureNumber(objectData.y, 0) - padding,
      width: Math.max(1, baseWidth + padding * 2),
      height: Math.max(1, baseHeight + padding * 2),
      padding,
    };
  }
  
  // All shapes need padding to prevent stroke clipping
  const padding = shapeStrokePadding.value;
  return {
    x: ensureNumber(objectData.x, 0) - padding,
    y: ensureNumber(objectData.y, 0) - padding,
    width: Math.max(1, ensureNumber(objectData.width, 1) + padding * 2),
    height: Math.max(1, ensureNumber(objectData.height, 1) + padding * 2),
    padding,
  };
});

const objectStyle = computed(() => {
  const frame = displayFrame.value;
  const screenX = ensureNumber(frame.x, 0) * props.zoomLevel + props.panOffset.x;
  const screenY = ensureNumber(frame.y, 0) * props.zoomLevel + props.panOffset.y;
  const scaledWidth = Math.max(1, ensureNumber(frame.width, 1) * props.zoomLevel);
  const scaledHeight = Math.max(1, ensureNumber(frame.height, 1) * props.zoomLevel);

  return {
    position: 'absolute' as const,
    left: `${screenX}px`,
    top: `${screenY}px`,
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    transform: `rotate(${objectData.rotation}deg)`,
    cursor: props.interactionEnabled
      ? (isDragging.value ? 'grabbing' : (internalIsSelected.value ? 'grab' : 'pointer'))
      : 'default',
    pointerEvents: (props.interactionEnabled ? 'auto' : 'none') as 'auto' | 'none',
    // Lines don't get a rectangular border - only endpoint handles
    border: isLineType.value 
      ? 'none' 
      : (internalIsSelected.value ? '2px solid dodgerblue' : '1px solid transparent'),
    transformOrigin: 'top left', 
    userSelect: 'none' as const,
    boxSizing: 'border-box' as const,
    zIndex: internalIsSelected.value ? 10 : 1,
  };
});

const shouldRenderContent = computed(() => CONTENT_RENDER_TYPES.has(objectData.type));
const latexHtml = computed(() => renderLatex(objectData.latex || ''));

const lineHandlePositions = computed(() => {
  if (!isLineType.value) {
    return { start: {}, end: {} };
  }
  
  const frame = displayFrame.value;
  const padding = frame.padding || 0;
  
  // Get line points for positioning handles
  const linePoints = getLinePointsForRender(objectData);
  
  if (linePoints && linePoints.length >= 2) {
    // Points are already normalized (min at 0,0) - add padding offset
    return {
      start: {
        left: `${(linePoints[0].x + padding) * props.zoomLevel}px`,
        top: `${(linePoints[0].y + padding) * props.zoomLevel}px`,
        transform: 'translate(-50%, -50%)',
      },
      end: {
        left: `${(linePoints[1].x + padding) * props.zoomLevel}px`,
        top: `${(linePoints[1].y + padding) * props.zoomLevel}px`,
        transform: 'translate(-50%, -50%)',
      },
    };
  }
  
  // Fallback to old format
  const startX = ensureNumber(objectData.startX, objectData.x);
  const startY = ensureNumber(objectData.startY, objectData.y);
  const endX = ensureNumber(objectData.endX, objectData.x + objectData.width);
  const endY = ensureNumber(objectData.endY, objectData.y + objectData.height);
  return {
    start: {
      left: `${(startX - frame.x) * props.zoomLevel}px`,
      top: `${(startY - frame.y) * props.zoomLevel}px`,
      transform: 'translate(-50%, -50%)',
    },
    end: {
      left: `${(endX - frame.x) * props.zoomLevel}px`,
      top: `${(endY - frame.y) * props.zoomLevel}px`,
      transform: 'translate(-50%, -50%)',
    },
  };
});

const getStartMap = () => props.object.get('start');
const getEndMap = () => props.object.get('end');
const getPositionMap = () => props.object.get('position');

const shiftStartEndMaps = (dx: number, dy: number) => {
  const startMap = getStartMap();
  if (startMap instanceof Y.Map) {
    const newStartX = ensureNumber(startMap.get('x'), objectData.startX ?? objectData.x) + dx;
    const newStartY = ensureNumber(startMap.get('y'), objectData.startY ?? objectData.y) + dy;
    startMap.set('x', newStartX);
    startMap.set('y', newStartY);
    objectData.startX = newStartX;
    objectData.startY = newStartY;
  }
  const endMap = getEndMap();
  if (endMap instanceof Y.Map) {
    const newEndX = ensureNumber(endMap.get('x'), objectData.endX ?? (objectData.x + objectData.width)) + dx;
    const newEndY = ensureNumber(endMap.get('y'), objectData.endY ?? (objectData.y + objectData.height)) + dy;
    endMap.set('x', newEndX);
    endMap.set('y', newEndY);
    objectData.endX = newEndX;
    objectData.endY = newEndY;
  }
};

const updateStartEndMaps = (startX: number, startY: number, endX: number, endY: number) => {
  let startMap = getStartMap();
  if (!(startMap instanceof Y.Map)) {
    startMap = new Y.Map();
    props.object.set('start', startMap);
  }
  let endMap = getEndMap();
  if (!(endMap instanceof Y.Map)) {
    endMap = new Y.Map();
    props.object.set('end', endMap);
  }
  startMap.set('x', startX);
  startMap.set('y', startY);
  endMap.set('x', endX);
  endMap.set('y', endY);
  objectData.startX = startX;
  objectData.startY = startY;
  objectData.endX = endX;
  objectData.endY = endY;
};

const shiftPositionMap = (dx: number, dy: number) => {
  const positionMap = getPositionMap();
  if (positionMap instanceof Y.Map) {
    const newX = ensureNumber(positionMap.get('x'), objectData.x) + dx;
    const newY = ensureNumber(positionMap.get('y'), objectData.y) + dy;
    positionMap.set('x', newX);
    positionMap.set('y', newY);
  }
};

const updatePositionMap = (x: number, y: number) => {
  const positionMap = getPositionMap();
  if (positionMap instanceof Y.Map) {
    positionMap.set('x', x);
    positionMap.set('y', y);
  }
};

const shiftPointsInYMap = (dx: number, dy: number) => {
  const pointsValue = props.object.get('points');
  const shifted = shiftPointsArray(pointsValue, dx, dy);
  if (shifted) {
    props.object.set('points', shifted);
  }
};

const objectCenter = reactive({ x: 0, y: 0 }); 
const startAngle = ref(0); 

const handleLeftClickOnObject = (event: MouseEvent) => {
  if (event.button === 0) { 
    if (internalIsSelected.value) {
        startDrag(event);
    } else {
        emit('request-select', objectData.id);
    }
  }
};

const handleDoubleClick = (event: MouseEvent) => {
  emit('double-click', objectData.id);
};

const startDragIfSelectedOrRequestSelect = (event: MouseEvent) => {
  if (isLineType.value && !internalIsSelected.value) {
    emit('request-select', objectData.id);
    return;
  }
  if (!internalIsSelected.value) {
    emit('request-select', objectData.id);
    return;
  }
  startDrag(event);
};

const startDrag = (event: MouseEvent) => {
  if (!movableObjectRef.value || !internalIsSelected.value) return; 
  
  // Check for Alt key for duplication
  if (event.altKey) {
      emit('clone-object', objectData);
  }

  isDragging.value = true;
  emit('interaction-start', objectData.id); // Notify start of interaction
  initialMousePos.x = event.clientX;
  initialMousePos.y = event.clientY;
  initialObjectState.x = objectData.x;
  initialObjectState.y = objectData.y;
  document.addEventListener('pointermove', handleDrag);
  document.addEventListener('pointerup', stopDrag);
};

const handleDrag = (event: MouseEvent) => {
  if (!isDragging.value) return;
  const dx = (event.clientX - initialMousePos.x) / props.zoomLevel; 
  const dy = (event.clientY - initialMousePos.y) / props.zoomLevel; 
  let newX = initialObjectState.x + dx;
  let newY = initialObjectState.y + dy;
  
  // Snapping Logic
  const SNAP_THRESHOLD = 10 / props.zoomLevel;
  const guides = [];
  
  if (props.snapTargets) {
      const { vertical, horizontal } = props.snapTargets;
      const myW = objectData.width;
      const myH = objectData.height;
      
      // Vertical Snapping (X)
      // Check left, center, right edges
      const xPoints = [newX, newX + myW / 2, newX + myW];
      let snappedX = null;
      
      for (const targetX of vertical) {
          if (Math.abs(newX - targetX) < SNAP_THRESHOLD) { snappedX = targetX; break; }
          if (Math.abs((newX + myW / 2) - targetX) < SNAP_THRESHOLD) { snappedX = targetX - myW / 2; break; }
          if (Math.abs((newX + myW) - targetX) < SNAP_THRESHOLD) { snappedX = targetX - myW; break; }
      }
      
      if (snappedX !== null) {
          newX = snappedX;
          // Add guide
          // Find which edge snapped
          if (Math.abs(newX - snappedX) < 0.01) guides.push({ x1: newX, y1: -10000, x2: newX, y2: 10000 }); // Left
          else if (Math.abs((newX + myW/2) - (snappedX + myW/2)) < 0.01) guides.push({ x1: newX + myW/2, y1: -10000, x2: newX + myW/2, y2: 10000 }); // Center
          else guides.push({ x1: newX + myW, y1: -10000, x2: newX + myW, y2: 10000 }); // Right
      }

      // Horizontal Snapping (Y)
      const yPoints = [newY, newY + myH / 2, newY + myH];
      let snappedY = null;
      
      for (const targetY of horizontal) {
          if (Math.abs(newY - targetY) < SNAP_THRESHOLD) { snappedY = targetY; break; }
          if (Math.abs((newY + myH / 2) - targetY) < SNAP_THRESHOLD) { snappedY = targetY - myH / 2; break; }
          if (Math.abs((newY + myH) - targetY) < SNAP_THRESHOLD) { snappedY = targetY - myH; break; }
      }
      
      if (snappedY !== null) {
          newY = snappedY;
          // Add guide
           if (Math.abs(newY - snappedY) < 0.01) guides.push({ x1: -10000, y1: newY, x2: 10000, y2: newY }); // Top
          else if (Math.abs((newY + myH/2) - (snappedY + myH/2)) < 0.01) guides.push({ x1: -10000, y1: newY + myH/2, x2: 10000, y2: newY + myH/2 }); // Center
          else guides.push({ x1: -10000, y1: newY + myH, x2: 10000, y2: newY + myH }); // Bottom
      }
  }
  
  emit('update:snap-guides', guides);

  const deltaX = newX - objectData.x;
  const deltaY = newY - objectData.y;
  
  // Update local data only - defer Yjs update to stopDrag
  objectData.x = newX; 
  objectData.y = newY;
  emit('update:object', { ...props.object.toJSON(), ...objectData });
};

const stopDrag = () => {
  if (isDragging.value) {
    isDragging.value = false;
    emit('interaction-end', objectData.id); // Notify end of interaction
    emit('update:snap-guides', []); // Clear guides
    document.removeEventListener('pointermove', handleDrag);
    document.removeEventListener('pointerup', stopDrag);

    // Commit changes to Yjs
    const totalDeltaX = objectData.x - initialObjectState.x;
    const totalDeltaY = objectData.y - initialObjectState.y;

    props.object.doc?.transact(() => {
        props.object.set('x', objectData.x);
        props.object.set('y', objectData.y);
        shiftStartEndMaps(totalDeltaX, totalDeltaY);
        shiftPositionMap(totalDeltaX, totalDeltaY);
        shiftPointsInYMap(totalDeltaX, totalDeltaY);
    }, 'local-movable-drag');
    
    emit('update:object', props.object);
  }
};

const startRotate = (event: MouseEvent) => {
    if (!movableObjectRef.value || !internalIsSelected.value) return; 
    isRotating.value = true;
    
    const screenX = objectData.x * props.zoomLevel + props.panOffset.x;
    const screenY = objectData.y * props.zoomLevel + props.panOffset.y;
    const scaledWidth = objectData.width * props.zoomLevel;
    const scaledHeight = objectData.height * props.zoomLevel;

    objectCenter.x = screenX + scaledWidth / 2;
    objectCenter.y = screenY + scaledHeight / 2;

    startAngle.value = Math.atan2(event.clientY - objectCenter.y, event.clientX - objectCenter.x);
    initialObjectState.rotation = objectData.rotation;
    emit('interaction-start', objectData.id);
    document.addEventListener('pointermove', handleRotate);
    document.addEventListener('pointerup', stopRotate);
};

const handleRotate = (event: MouseEvent) => {
    if (!isRotating.value) return;
    const currentAngle = Math.atan2(event.clientY - objectCenter.y, event.clientX - objectCenter.x);
    let angleDiff = currentAngle - startAngle.value;
    let angleDiffDegrees = angleDiff * (180 / Math.PI);
    let newRotation = initialObjectState.rotation + angleDiffDegrees;

    // Update local data only
    objectData.rotation = newRotation; 
    emit('update:object', props.object);
};

const stopRotate = () => {
  if (isRotating.value) {
    isRotating.value = false;
    emit('interaction-end', objectData.id);
    document.removeEventListener('pointermove', handleRotate);
    document.removeEventListener('pointerup', stopRotate);

    props.object.doc?.transact(() => {
      props.object.set('rotation', objectData.rotation);
    }, 'local-movable-rotate');
    emit('update:object', { ...props.object.toJSON(), ...objectData });
  }
};

const startResize = (event: MouseEvent, handle: string) => {
  if (!movableObjectRef.value) return;
  if (isLineType.value) return; // Lines use dedicated endpoint handles
   if (!internalIsSelected.value) {
    emit('request-select', objectData.id);
     if(!props.isSelected) return; // Check prop after emit, as internalIsSelected watcher might not have run
  }

  isResizing.value = true;
  currentResizeHandle.value = handle;
  initialMousePos.x = event.clientX;
  initialMousePos.y = event.clientY;
  
  initialObjectState.x = objectData.x;
  initialObjectState.y = objectData.y;
  initialObjectState.width = objectData.width;
  initialObjectState.height = objectData.height;
  initialObjectState.rotation = objectData.rotation;
  initialGeometrySnapshot.startX = Number.isFinite(objectData.startX) ? objectData.startX! : objectData.x;
  initialGeometrySnapshot.startY = Number.isFinite(objectData.startY) ? objectData.startY! : objectData.y;
  initialGeometrySnapshot.endX = Number.isFinite(objectData.endX) ? objectData.endX! : objectData.x + objectData.width;
  initialGeometrySnapshot.endY = Number.isFinite(objectData.endY) ? objectData.endY! : objectData.y + objectData.height;
  initialGeometrySnapshot.startRatioX = Number.isFinite(objectData.startX)
    ? computeRatio(objectData.startX!, initialObjectState.x, initialObjectState.width, 0)
    : null;
  initialGeometrySnapshot.startRatioY = Number.isFinite(objectData.startY)
    ? computeRatio(objectData.startY!, initialObjectState.y, initialObjectState.height, 0)
    : null;
  initialGeometrySnapshot.endRatioX = Number.isFinite(objectData.endX)
    ? computeRatio(objectData.endX!, initialObjectState.x, initialObjectState.width, 1)
    : null;
  initialGeometrySnapshot.endRatioY = Number.isFinite(objectData.endY)
    ? computeRatio(objectData.endY!, initialObjectState.y, initialObjectState.height, 1)
    : null;
  initialGeometrySnapshot.points = clonePointsArray(props.object.get('points'));

  emit('interaction-start', objectData.id);
  document.addEventListener('pointermove', handleResize);
  document.addEventListener('pointerup', stopResize);
};

const startLineEndpointDrag = (event: MouseEvent, handle: 'start' | 'end') => {
  if (!internalIsSelected.value) {
    emit('request-select', objectData.id);
    return;
  }
  isResizing.value = true;
  currentLineHandle.value = handle;
  initialMousePos.x = event.clientX;
  initialMousePos.y = event.clientY;
  
  // Get absolute positions of line endpoints
  const linePoints = getLinePointsForRender(objectData);
  if (linePoints && linePoints.length >= 2) {
    // New format: points are relative to (x, y)
    initialLineSnapshot.startX = objectData.x + linePoints[0].x;
    initialLineSnapshot.startY = objectData.y + linePoints[0].y;
    initialLineSnapshot.endX = objectData.x + linePoints[1].x;
    initialLineSnapshot.endY = objectData.y + linePoints[1].y;
  } else {
    // Old format fallback
    initialLineSnapshot.startX = Number.isFinite(objectData.startX) ? objectData.startX! : objectData.x;
    initialLineSnapshot.startY = Number.isFinite(objectData.startY) ? objectData.startY! : objectData.y;
    initialLineSnapshot.endX = Number.isFinite(objectData.endX) ? objectData.endX! : objectData.x + objectData.width;
    initialLineSnapshot.endY = Number.isFinite(objectData.endY) ? objectData.endY! : objectData.y + objectData.height;
  }
  
  emit('interaction-start', objectData.id);
  document.addEventListener('pointermove', handleLineResize);
  document.addEventListener('pointerup', stopLineResize);
};

const handleLineResize = (event: MouseEvent) => {
  if (!currentLineHandle.value) return;
  const dx = (event.clientX - initialMousePos.x) / props.zoomLevel;
  const dy = (event.clientY - initialMousePos.y) / props.zoomLevel;

  let newStartX = initialLineSnapshot.startX;
  let newStartY = initialLineSnapshot.startY;
  let newEndX = initialLineSnapshot.endX;
  let newEndY = initialLineSnapshot.endY;

  if (currentLineHandle.value === 'start') {
    newStartX += dx;
    newStartY += dy;
  } else if (currentLineHandle.value === 'end') {
    newEndX += dx;
    newEndY += dy;
  }

  // Calculate new bounding box
  const newX = Math.min(newStartX, newEndX);
  const newY = Math.min(newStartY, newEndY);
  const newWidth = Math.max(1, Math.abs(newEndX - newStartX));
  const newHeight = Math.max(1, Math.abs(newEndY - newStartY));

  // Update local objectData (for immediate visual feedback)
  objectData.x = newX;
  objectData.y = newY;
  objectData.width = newWidth;
  objectData.height = newHeight;
  objectData.startX = newStartX;
  objectData.startY = newStartY;
  objectData.endX = newEndX;
  objectData.endY = newEndY;
  
  // Update points in new format (relative to x, y)
  objectData.points = [
    { x: newStartX - newX, y: newStartY - newY },
    { x: newEndX - newX, y: newEndY - newY }
  ];

  emit('update:object', { ...props.object.toJSON(), ...objectData });
};

const stopLineResize = () => {
  if (!isResizing.value || !currentLineHandle.value) return;
  
  isResizing.value = false;
  emit('interaction-end', objectData.id);
  document.removeEventListener('pointermove', handleLineResize);
  document.removeEventListener('pointerup', stopLineResize);

  // Commit to Yjs with new point-based format
  props.object.doc?.transact(() => {
    props.object.set('x', objectData.x);
    props.object.set('y', objectData.y);
    props.object.set('width', objectData.width);
    props.object.set('height', objectData.height);
    
    // Save points in new format
    props.object.set('points', [
      { x: objectData.startX! - objectData.x, y: objectData.startY! - objectData.y },
      { x: objectData.endX! - objectData.x, y: objectData.endY! - objectData.y }
    ]);
    
    // Also update start/end maps for backwards compatibility
    const startMap = props.object.get('start');
    if (startMap && typeof startMap.set === 'function') {
      startMap.set('x', objectData.startX);
      startMap.set('y', objectData.startY);
    }
    const endMap = props.object.get('end');
    if (endMap && typeof endMap.set === 'function') {
      endMap.set('x', objectData.endX);
      endMap.set('y', objectData.endY);
    }
  }, 'local-line-resize');

  currentLineHandle.value = null;
  emit('update:object', props.object);
};

const renderLocalCanvas = () => {
  if (!localCanvas.value || shouldRenderContent.value) return;
  console.log(`[MovableObject] Rendering local canvas for ${objectData.id} (${objectData.type})`);
  
  const canvas = localCanvas.value;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const frame = displayFrame.value;
  
  // Don't render if frame has zero dimensions (prevents html2canvas errors)
  if (frame.width <= 0 || frame.height <= 0) return;
  
  const pixelRatio = window.devicePixelRatio || 1;
  const width = frame.width * props.zoomLevel;
  const height = frame.height * props.zoomLevel;

  // Resize canvas if needed (handling DPI)
  if (canvas.width !== width * pixelRatio || canvas.height !== height * pixelRatio) {
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
  }

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  
  // Scale for zoom
  ctx.scale(props.zoomLevel, props.zoomLevel);
  
  // Handle padding
  const padding = frame.padding || 0;
  ctx.translate(padding, padding);

  // Construct local element relative to (0,0) - NO CLIPPING for lines
  let localElement: any;
  
  if (isLineType.value || objectData.type === 'pen') {
    // For lines and pen strokes: use point-based rendering with normalization
    const linePoints = getLinePointsForRender(objectData);

    if (linePoints && linePoints.length >= 1) {
      localElement = {
        ...objectData,
        x: 0,
        y: 0,
        points: linePoints,
        start: undefined,
        end: undefined
      };
    } else if (isLineType.value) {
      // Fallback to old format (lines only)
      localElement = {
        ...objectData,
        x: 0,
        y: 0,
        start: { x: (objectData.startX || 0) - objectData.x, y: (objectData.startY || 0) - objectData.y },
        end: { x: (objectData.endX || 0) - objectData.x, y: (objectData.endY || 0) - objectData.y }
      };
    } else {
      // Pen with no points - shouldn't happen, but fallback
      localElement = { ...objectData, x: 0, y: 0 };
    }
  } else {
    // For shapes: use standard bounding box
    localElement = {
      ...objectData,
      x: 0,
      y: 0,
      start: { x: 0, y: 0 },
      end: { x: objectData.width, y: objectData.height }
    };
  }

  // For selected lines: add a glow effect
  if (isLineType.value && internalIsSelected.value) {
    ctx.save();
    ctx.shadowColor = '#3b82f6';
    ctx.shadowBlur = 8 * props.zoomLevel;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // Draw WITHOUT clipping - just render the element
  drawElement(ctx, localElement, false, 1, undefined, undefined, {}, rough.canvas(canvas) as any);
  
  if (isLineType.value && internalIsSelected.value) {
    ctx.restore();
  }
};

watch(
  [() => objectData, () => props.zoomLevel, () => displayFrame.value, () => internalIsSelected.value],
  () => {
    // Use requestAnimationFrame to avoid layout thrashing
    requestAnimationFrame(renderLocalCanvas);
  },
  { deep: true, immediate: true }
);

onMounted(() => {
  renderLocalCanvas();
});

const handleResize = (event: MouseEvent) => {
  if (!isResizing.value) return;

  if (isLineType.value && currentLineHandle.value) {
    handleLineResize(event);
    return;
  }

  if (!currentResizeHandle.value) return;

  const dxScreen = (event.clientX - initialMousePos.x) / props.zoomLevel;
  const dyScreen = (event.clientY - initialMousePos.y) / props.zoomLevel;

  let newX = objectData.x; // Use current objectData as base for this turn's adjustments
  let newY = objectData.y;
  let newWidth = objectData.width;
  let newHeight = objectData.height;
  
  const minSize = 10; // Minimum width/height for resizing

  // Deltas in the object's local coordinate system
  const rad = -initialObjectState.rotation * (Math.PI / 180); // Rotation to transform screen delta to object's local
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  
  // Mouse movement in the object's local coordinate system
  const dxLocal = dxScreen * cosR - dyScreen * sinR;
  const dyLocal = dxScreen * sinR + dyScreen * cosR;

  // Original center point (for repositioning calculations)
  const originalCenterX = initialObjectState.x + initialObjectState.width / 2;
  const originalCenterY = initialObjectState.y + initialObjectState.height / 2;


  if (currentResizeHandle.value.includes('e')) {
    newWidth = Math.max(minSize, initialObjectState.width + dxLocal);
  }
  if (currentResizeHandle.value.includes('w')) {
    newWidth = Math.max(minSize, initialObjectState.width - dxLocal);
    // Adjust X based on width change, considering rotation
    const widthDiff = initialObjectState.width - newWidth;
    newX = initialObjectState.x + widthDiff * Math.cos(initialObjectState.rotation * Math.PI / 180);
    newY = initialObjectState.y + widthDiff * Math.sin(initialObjectState.rotation * Math.PI / 180);
  }

  if (currentResizeHandle.value.includes('s')) {
    newHeight = Math.max(minSize, initialObjectState.height + dyLocal);
  }
  if (currentResizeHandle.value.includes('n')) {
    newHeight = Math.max(minSize, initialObjectState.height - dyLocal);
    // Adjust Y based on height change, considering rotation
    const heightDiff = initialObjectState.height - newHeight;
    newX = initialObjectState.x - heightDiff * Math.sin(initialObjectState.rotation * Math.PI / 180); // Sign flipped for X based on Y axis change
    newY = initialObjectState.y + heightDiff * Math.cos(initialObjectState.rotation * Math.PI / 180);
  }
  
  // Update local reactive data for immediate feedback
  objectData.x = newX;
  objectData.y = newY;
  objectData.width = newWidth;
  objectData.height = newHeight;

  // Update derived properties locally
  if (initialGeometrySnapshot.startRatioX !== null || initialGeometrySnapshot.endRatioX !== null) {
      const ratioStartX = initialGeometrySnapshot.startRatioX ?? 0;
      const ratioEndX = initialGeometrySnapshot.endRatioX ?? 1;
      const ratioStartY = initialGeometrySnapshot.startRatioY ?? 0;
      const ratioEndY = initialGeometrySnapshot.endRatioY ?? 1;
      const newStartX = newX + ratioStartX * newWidth;
      const newEndX = newX + ratioEndX * newWidth;
      const newStartY = newY + ratioStartY * newHeight;
      const newEndY = newY + ratioEndY * newHeight;
      
      objectData.startX = newStartX;
      objectData.startY = newStartY;
      objectData.endX = newEndX;
      objectData.endY = newEndY;
  }

  const scaledPoints = scalePointsFromSnapshot(initialGeometrySnapshot.points, initialObjectState, {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight,
  });
  if (scaledPoints) {
      objectData.points = scaledPoints;
  }
  emit('update:object', { ...props.object.toJSON(), ...objectData });
};


const stopResize = () => {
  if (!isResizing.value) return;
  isResizing.value = false;
  emit('interaction-end', objectData.id);
  currentResizeHandle.value = null;
  currentLineHandle.value = null;

  document.removeEventListener('pointermove', handleResize);
  document.removeEventListener('pointerup', stopResize);

  props.object.doc?.transact(() => {
    props.object.set('x', objectData.x);
    props.object.set('y', objectData.y);
    props.object.set('width', objectData.width);
    props.object.set('height', objectData.height);
    updatePositionMap(objectData.x, objectData.y);

    if (objectData.startX !== undefined) {
        updateStartEndMaps(objectData.startX, objectData.startY!, objectData.endX!, objectData.endY!);
    }

    if (objectData.points) {
        props.object.set('points', objectData.points);
    }

    if (typeof props.object.get('size') === 'number') {
        props.object.set('size', Math.max(objectData.width, objectData.height));
    }
  }, 'local-movable-resize');
  
  emit('update:object', props.object);
};


let ymapObserver: ((event: Y.YMapEvent<any>, transaction: Y.Transaction) => void) | null = null;

onMounted(() => {
  syncDataFromYMap(); 
  ymapObserver = (event, transaction) => { 
    if (transaction.local && (
        transaction.origin === 'local-movable-drag' || 
        transaction.origin === 'local-movable-rotate' ||
        transaction.origin === 'local-movable-resize' ||
        transaction.origin === 'local-line-resize'
        )) {
      return;
    }
    syncDataFromYMap(); 
  };
  props.object.observe(ymapObserver);
});

// 2.4: Use pointer events for touch support (cleanup)
onUnmounted(() => {
  document.removeEventListener('pointermove', handleDrag);
  document.removeEventListener('pointerup', stopDrag);
  document.removeEventListener('pointermove', handleRotate);
  document.removeEventListener('pointerup', stopRotate);
  document.removeEventListener('pointermove', handleResize);
  document.removeEventListener('pointerup', stopResize);
  document.removeEventListener('pointermove', handleLineResize);
  document.removeEventListener('pointerup', stopLineResize);
  if (ymapObserver) props.object.unobserve(ymapObserver);
});

</script>

<style scoped>
.movable-object {
  position: absolute;
  box-sizing: border-box;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

/* Subtle Glass Selection */
.movable-object.is-selected {
  border: 1px solid rgba(148, 163, 184, 0.9);
  background-color: rgba(148, 163, 184, 0.06);
  box-shadow: 0 0 0 6px rgba(148, 163, 184, 0.22);
  border-radius: 12px;
}

/* Lines: no box selection - only endpoint handles */
.movable-object.is-line-type {
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
}

.movable-object.is-line-type.is-selected {
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.object-content {
  width: 100%;
  height: 100%;
  cursor: grab;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
}

.object-content img,
.object-content svg {
    display: block;
    pointer-events: none; 
    user-select: none;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.movable-object:active .object-content {
    cursor: grabbing;
}

/* Rotation Handle - Modern Stick Style */
.rotation-handle {
  position: absolute;
  top: -24px; 
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 10px;
  background-color: white;
  border: 1px solid #2563eb;
  border-radius: 50%;
  cursor: alias; 
  z-index: 12; 
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* Connector line for rotation handle */
.rotation-handle::after {
  content: '';
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  height: 12px;
  background-color: #2563eb;
  pointer-events: none;
}

.resize-handles {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none; 
}

.line-handles {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.line-end-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background-color: white;
  border: 2px solid #2563eb;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  pointer-events: all;
  cursor: crosshair;
  transition: background-color 0.1s ease, box-shadow 0.1s ease;
  z-index: 12;
}

.line-end-handle:hover {
  background-color: #2563eb;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
}

/* Circular Handles */
.resize-handle {
  position: absolute;
  width: 10px; /* Smaller */
  height: 10px;
  background-color: white;
  border: 1px solid #2563eb; /* Blue border */
  border-radius: 50%; /* Circular */
  z-index: 11; 
  pointer-events: all; 
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  transition: transform 0.1s;
}

.text-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none; /* Let clicks pass through to object */
  white-space: pre-wrap;
  overflow-wrap: break-word;
  line-height: 1.2;
  user-select: none;
}

.resize-handle:hover {
  transform: scale(1.2);
  background-color: #2563eb; /* Fill on hover */
}

/* Positioning offsets adjusted for circular handles */
.nw-handle { top: -5px; left: -5px; cursor: nwse-resize; }
.n-handle { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.ne-handle { top: -5px; right: -5px; cursor: nesw-resize; }
.w-handle { top: 50%; left: -5px; transform: translateY(-50%); cursor: ew-resize; }
.e-handle { top: 50%; right: -5px; transform: translateY(-50%); cursor: ew-resize; }
.sw-handle { bottom: -5px; left: -5px; cursor: nesw-resize; }
.s-handle { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.se-handle { bottom: -5px; right: -5px; cursor: nwse-resize; }

</style>

