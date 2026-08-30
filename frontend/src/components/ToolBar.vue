<template>
  <div
    class="toolbar-container"
    :class="orientation"
  >
    <!-- Main Toolbar -->
    <div
      class="toolbar glass-panel"
      @pointerenter="handleHoverEnter"
      @pointerleave="handleHoverLeave"
    >
      <!-- Tools Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <button
          v-for="tool in visibleMainTools"
          :key="tool.name"
          class="tool-btn"
          :data-tool-id="tool.feature"
          :class="{ active: currentTool === tool.name }"
          @click="selectTool(tool.name)"
          :title="tool.label"
        >
          <component :is="tool.icon" :size="20" />
        </button>
      </div>

      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Shapes Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <div class="dropdown-trigger" ref="dropdownTriggerRef" v-if="can('tool.shapes')">
          <button
            type="button"
            class="tool-btn"
            data-tool-id="tool.shapes"
            ref="shapesTriggerRef"
            :class="{ active: isShapeTool(currentTool) }"
            @click.stop="toggleShapesMenu"
            title="Kształty"
          >
            <component :is="currentShapeIcon" :size="20" />
            <ChevronDown :size="12" class="dropdown-arrow" />
          </button>
          
          <!-- Shapes Dropdown -->
          <Teleport to="body">
            <div
              v-if="showShapesMenu"
              class="toolbar-popover glass-panel shapes-popover"
              :style="shapesMenuStyle"
              ref="shapesMenuRef"
            >
              <div class="popover-section">
                <div class="section-title">Shapes</div>
                <div class="shapes-grid">
                    <button
                      v-for="shape in shapeOptions"
                      :key="shape.tool"
                      class="shape-btn"
                      :class="{ active: isShapeActive(shape) }"
                      @click="selectShape(shape)"
                      :title="shape.label"
                    >
                    <component :is="shape.icon" :size="18" />
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Line style</div>
                <div class="option-row">
                  <button
                    v-for="style in lineStyleOptions"
                    :key="style.value"
                    class="option-pill"
                    :class="{ active: currentLineStyle === style.value }"
                    @click="selectLineStyle(style.value)"
                  >
                    {{ style.label }}
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Roughness</div>
                <div class="option-row">
                  <button
                    v-for="option in roughnessOptions"
                    :key="option.value"
                    class="option-pill"
                    :class="{ active: currentRoughness === option.value }"
                    @click="selectRoughness(option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Arrowheads</div>
                <div class="option-row">
                  <button
                    v-for="style in arrowStyleOptions"
                    :key="style.value"
                    class="option-pill"
                    :class="{ active: currentArrowStyle === style.value }"
                    @click="selectArrowStyle(style.value)"
                  >
                    {{ style.label }}
                  </button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Quick colors</div>
                <div class="color-row">
                  <button
                    v-for="swatch in colorSwatches"
                    :key="swatch"
                    class="color-swatch"
                    :style="{ backgroundColor: swatch }"
                    :class="{ active: currentColor === swatch }"
                    @click="selectColorSwatch(swatch)"
                  ></button>
                </div>
              </div>

              <div class="popover-section">
                <div class="section-title">Fill color</div>
                <div class="color-row">
                  <button
                    class="color-swatch fill-none"
                    :class="{ active: currentFillColor === null }"
                    @click="selectFillColor(null)"
                    title="No fill"
                  >
                    <span class="no-fill-x">✕</span>
                  </button>
                  <button
                    v-for="swatch in fillColorSwatches"
                    :key="swatch"
                    class="color-swatch"
                    :style="{ backgroundColor: swatch }"
                    :class="{ active: currentFillColor === swatch }"
                    @click="selectFillColor(swatch)"
                  ></button>
                </div>
              </div>
            </div>
          </Teleport>
        </div>
      </div>

      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Actions Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <button v-if="can('tool.undo')" class="tool-btn" data-tool-id="tool.undo" @click="$emit('undo')" title="Cofnij (Ctrl+Z)">
          <Undo2 :size="20" />
        </button>
        <button v-if="can('tool.redo')" class="tool-btn" data-tool-id="tool.redo" @click="$emit('redo')" title="Ponów (Ctrl+Y)">
          <Redo2 :size="20" />
        </button>
        <button v-if="can('tool.clearBoard')" class="tool-btn danger" data-tool-id="tool.clearBoard" @click="$emit('clear')" title="Wyczyść tablicę">
          <Trash2 :size="20" />
        </button>
      </div>

      <div class="divider" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Features Group -->
      <div class="tool-group" :class="{ vertical: orientation === 'vertical' }">
        <!-- Rendered in PilotAvailability manifest order (VVE-100): the UI
             enumeration test asserts this group equals manifest.tools. -->
        <button
          v-if="can('panel.calculator')"
          class="tool-btn"
          data-tool-id="panel.calculator"
          @click="$emit('toggle-calculator')"
          title="Kalkulator naukowy"
        >
          <Calculator :size="20" />
        </button>
        <button
          v-if="can('panel.mathGraph')"
          class="tool-btn"
          data-tool-id="panel.mathGraph"
          :class="{ active: isMathPanelOpen }"
          @click="$emit('toggle-math-panel')"
          title="Wykres funkcji"
        >
          <LineChart :size="20" />
        </button>
        <button
          v-if="can('panel.physicsGraph')"
          class="tool-btn"
          data-tool-id="panel.physicsGraph"
          :class="{ active: isPhysicsPanelOpen }"
          @click="$emit('toggle-physics-panel')"
          title="Wykres fizyczny"
        >
          <Activity :size="20" />
        </button>
        <button
          v-if="can('experiment.ai')"
          class="tool-btn"
          data-tool-id="experiment.ai"
          :class="{ active: isDiagramPanelOpen }"
          @click="$emit('toggle-diagram-panel')"
          title="Diagram (AI)"
        >
          <GitBranch :size="20" />
        </button>
        <button
          v-if="can('experiment.chemistry')"
          class="tool-btn"
          data-tool-id="experiment.chemistry"
          @click="$emit('toggle-chemistry-panel')"
          title="Chemia (pH)"
        >
          <FlaskConical :size="20" />
        </button>
        <div v-if="can('panel.coordinateSystem')" class="dropdown-trigger coordinate-trigger" ref="coordinateTriggerRef">
          <button
            class="tool-btn"
            data-tool-id="panel.coordinateSystem"
            :class="{ active: showCoordinateMenu }"
            @click.stop="toggleCoordinateMenu"
            title="Dodaj układ współrzędnych"
          >
            <Axis3d :size="20" />
            <ChevronDown :size="12" class="dropdown-arrow" />
          </button>
          <Teleport to="body">
            <div
              v-if="showCoordinateMenu"
              class="toolbar-popover glass-panel coordinate-menu"
              :style="coordinateMenuStyle"
              ref="coordinateMenuRef"
            >
              <button
                v-for="option in coordinateOptions"
                :key="option.type"
                class="shape-btn coordinate-btn"
                @click="selectCoordinateSystem(option.type)"
              >
                {{ option.label }}
              </button>
            </div>
          </Teleport>
        </div>
      </div>
      
      <div class="divider" v-if="can('dev.debugControls')" :class="{ horizontal: orientation === 'vertical' }"></div>

      <!-- Settings Group -->
      <div v-if="can('dev.debugControls')" class="tool-group" :class="{ vertical: orientation === 'vertical' }">
          <button class="tool-btn" data-tool-id="dev.debugControls" @click="$emit('toggle-debug')" title="Debug Info">
            <Bug :size="20" />
          </button>
      </div>
    </div>

    <!-- Properties Bar (Contextual) -->
    <div
      class="properties-bar glass-panel"
      v-if="shouldShowProperties"
      :class="orientation"
      @pointerenter="handleHoverEnter"
      @pointerleave="handleHoverLeave"
    >
      <!-- Color Picker + Quick Swatches -->
      <div class="property-group color-group">
        <div
          class="color-preview"
          :style="{ backgroundColor: currentColor }"
          @click="toggleColorPicker"
        ></div>
        <input
          type="color"
          ref="colorInput"
          v-model="currentColor"
          @input="updateColor"
          class="hidden-color-input"
        >
        <div class="quick-swatches">
          <button
            v-for="swatch in quickSwatches"
            :key="swatch"
            class="quick-swatch"
            :style="{ backgroundColor: swatch }"
            :class="{ active: currentColor === swatch }"
            @click="selectColorSwatch(swatch)"
          ></button>
        </div>
      </div>

      <!-- Line Width Slider -->
      <div class="property-group slider-group">
        <Circle :size="12" :fill="currentColor" :stroke-width="0" />
        <input 
          type="range" 
          min="1" 
          max="20" 
          v-model.number="currentLineWidth" 
          @input="updateLineWidth"
          class="width-slider"
        >
        <Circle :size="20" :fill="currentColor" :stroke-width="0" />
      </div>
      
      <!-- Eraser Size (if eraser selected) -->
       <div class="property-group" v-if="currentTool === 'eraser'">
          <span class="label">Size:</span>
           <input 
            type="range" 
            min="10" 
            max="100" 
            v-model.number="currentEraserSize" 
            @input="updateEraserSize"
            class="width-slider"
          >
       </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { featureAvailable } from '../services/pilotSurface';
import {
  Pencil,
  Eraser,
  Type,
  MousePointer2,
  Hand,
  Square,
  Circle as CircleIcon,
  Triangle,
  Minus,
  Undo2,
  Redo2,
  Trash2,
  ChevronDown,
  Calculator,
  Activity,
  Axis3d,
  LineChart,
  Diamond,
  Octagon,
  GitBranch,
  Bug,
  Circle,
  Box,
  Cylinder,
  Cone,
  Pyramid,
  Globe,
  FlaskConical
} from 'lucide-vue-next';

const props = defineProps({
  activeTool: { type: String, default: 'pen' },
  role: { type: String, default: 'developer' },
  color: { type: String, default: '#000000' },
  fillColor: { type: null, default: null },
  lineWidth: { type: Number, default: 2 },
  lineStyle: { type: String, default: 'solid' },
  arrowStyle: { type: String, default: 'none' },
  roughness: { type: Number, default: 1 },
  currentShape: { type: String, default: 'rectangle' },
  isMathPanelOpen: Boolean,
  isPhysicsPanelOpen: Boolean,
  isDiagramPanelOpen: Boolean,
  orientation: { type: String, default: 'vertical' } // 'vertical' or 'horizontal'
});

const emit = defineEmits([
  'update:activeTool',
  'update:color',
  'update:fillColor',
  'update:lineWidth',
  'update:lineStyle',
  'update:arrowStyle',
  'update:roughness',
  'update:eraserSize',
  'update:shape',
  'undo',
  'redo',
  'clear',
  'toggle-math-panel',
  'toggle-physics-panel',
  'toggle-diagram-panel',
  'add-coordinate-system',
  'toggle-calculator',
  'toggle-chemistry-panel',
  'toggle-debug'
]);

// Tool visibility is decided by the shared PilotAvailability manifest
// (VVE-100): the rendered buttons are exactly the manifest's visible tools
// for the current role and environment.
const can = (featureId) => featureAvailable(featureId, props.role);

const mainTools = [
  { name: 'select', label: 'Zaznaczanie (V)', icon: MousePointer2, feature: 'tool.select' },
  { name: 'pan', label: 'Przesuwanie (H)', icon: Hand, feature: 'tool.pan' },
  { name: 'pen', label: 'Pióro (P)', icon: Pencil, feature: 'tool.pen' },
  { name: 'text', label: 'Tekst (T)', icon: Type, feature: 'tool.text' },
  { name: 'eraser', label: 'Gumka (E)', icon: Eraser, feature: 'tool.eraser' }
];
const visibleMainTools = computed(() => mainTools.filter((tool) => can(tool.feature)));

const shapeOptions = [
  { tool: 'rectangle', label: 'Rectangle', icon: Square },
  { tool: 'circle', label: 'Circle', icon: CircleIcon },
  { tool: 'triangle', label: 'Triangle', icon: Triangle },
  { tool: 'square', label: 'Square', icon: Square },
  { tool: 'trapezoid', label: 'Trapezoid', icon: Diamond },
  { tool: 'parallelogram', label: 'Parallelogram', icon: Diamond },
  { tool: 'deltoid', label: 'Kite', icon: Diamond },
  { tool: 'cube', label: 'Cube', icon: Box },
  { tool: 'cuboid', label: 'Cuboid', icon: Box },
  { tool: 'sphere', label: 'Sphere', icon: Globe },
  { tool: 'cylinder', label: 'Cylinder', icon: Cylinder },
  { tool: 'cone', label: 'Cone', icon: Cone },
  { tool: 'pyramid', label: 'Pyramid', icon: Pyramid },
  { tool: 'tetrahedron', label: 'Tetrahedron', icon: Pyramid },
  { tool: 'line', label: 'Line', icon: Minus, toolType: 'lines' }
];

const lineStyleOptions = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' }
];

const roughnessOptions = [
  { value: 0, label: 'Clean' },
  { value: 1, label: 'Sketchy' },
  { value: 2, label: 'Rough' }
];

const arrowStyleOptions = [
  { value: 'none', label: 'None' },
  { value: 'start', label: 'Start' },
  { value: 'end', label: 'End' },
  { value: 'both', label: 'Both' }
];

const colorSwatches = [
  '#000000',
  '#4b5563',
  '#ffffff',
  '#2563eb',
  '#3b82f6',
  '#06b6d4',
  '#14b8a6',
  '#16a34a',
  '#84cc16',
  '#f59e0b',
  '#f97316',
  '#dc2626',
  '#ec4899',
  '#7c3aed',
  '#8b5cf6',
  '#a855f7'
];

const fillColorSwatches = [
  '#fef3c7', // amber-100
  '#dbeafe', // blue-100
  '#dcfce7', // green-100
  '#fee2e2', // red-100
  '#ede9fe', // violet-100
  '#ccfbf1', // teal-100
  '#f3f4f6', // gray-100
  '#ffffff'  // white
];

// Quick color swatches shown inline in the properties bar (subset of full palette)
const quickSwatches = [
  '#000000', '#dc2626', '#2563eb', '#16a34a',
  '#f59e0b', '#7c3aed', '#ec4899', '#ffffff'
];

const coordinateOptions = [
  { type: '2d', label: '2D Coordinate System' },
  { type: '3d', label: '3D Coordinate System' }
];

const currentTool = ref(props.activeTool);
const currentColor = ref(props.color);
const currentFillColor = ref(props.fillColor);
const currentLineWidth = ref(props.lineWidth);
const currentLineStyle = ref(props.lineStyle);
const currentArrowStyle = ref(props.arrowStyle);
const currentRoughness = ref(props.roughness);
const currentEraserSize = ref(30);
const propertiesVisible = ref(false);
const isTouchDevice = ref(false);
let hideTimer = null;

const showShapesMenu = ref(false);
const showCoordinateMenu = ref(false);
const shapesMenuStyle = ref({});
const coordinateMenuStyle = ref({});

const dropdownTriggerRef = ref(null);
const shapesTriggerRef = ref(null);
const shapesMenuRef = ref(null);
const coordinateTriggerRef = ref(null);
const coordinateMenuRef = ref(null);
const colorInput = ref(null);

watch(() => props.activeTool, (val) => { currentTool.value = val; });
watch(() => props.color, (val) => { currentColor.value = val; });
watch(() => props.fillColor, (val) => { currentFillColor.value = val; });
watch(() => props.lineWidth, (val) => { currentLineWidth.value = val; });
watch(() => props.lineStyle, (val) => { currentLineStyle.value = val; });
watch(() => props.arrowStyle, (val) => { currentArrowStyle.value = val; });
watch(() => props.roughness, (val) => { currentRoughness.value = val; });

const showProperties = computed(() =>
  ['pen', 'text', 'eraser', 'shapes', 'lines'].includes(currentTool.value)
);

// Keep the properties bar visible for pen to allow changing width without hover
const shouldShowProperties = computed(() =>
  showProperties.value && propertiesVisible.value
);

const startHideTimer = () => {
  if (isTouchDevice.value) return; // P0-FIX: Never auto-hide properties on touch devices
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    propertiesVisible.value = false;
  }, 2000);
};

const showPropertiesBar = () => {
  clearTimeout(hideTimer);
  propertiesVisible.value = true;
};

watch(currentTool, () => {
  if (showProperties.value) {
    showPropertiesBar();
    startHideTimer();
  }
});

const currentShapeIcon = computed(() => {
  if (currentTool.value === 'lines') {
    const lineOption = shapeOptions.find(opt => opt.toolType === 'lines');
    return lineOption?.icon || Minus;
  }
  const activeShape = shapeOptions.find(opt => opt.tool === props.currentShape);
  return activeShape?.icon || Square;
});

const selectTool = (tool) => {
  currentTool.value = tool;
  emit('update:activeTool', tool);
  showShapesMenu.value = false;
};

const isShapeTool = (tool) => tool === 'shapes' || tool === 'lines';

const isShapeActive = (shape) => {
  if (shape.toolType === 'lines') {
    return currentTool.value === 'lines';
  }
  return props.currentShape === shape.tool && currentTool.value === 'shapes';
};

const toggleShapesMenu = () => {
  showShapesMenu.value = !showShapesMenu.value;
  if (showShapesMenu.value) {
    nextTick(() => positionShapesMenu());
  }
};

const positionShapesMenu = () => {
  const trigger = shapesTriggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  if (props.orientation === 'vertical') {
    shapesMenuStyle.value = {
      top: `${rect.top}px`,
      left: `${rect.right + 8}px`
    };
  } else {
    shapesMenuStyle.value = {
      top: `${rect.bottom + 8}px`,
      left: `${rect.left}px`
    };
  }
};

const selectShape = (shape) => {
  const nextTool = shape.toolType === 'lines' ? 'lines' : 'shapes';
  currentTool.value = nextTool;
  emit('update:activeTool', nextTool);
  if (shape.toolType !== 'lines') {
    emit('update:shape', shape.tool);
  }
  showShapesMenu.value = false;
};

const selectLineStyle = (style) => {
  currentLineStyle.value = style;
  emit('update:lineStyle', style);
};

const selectRoughness = (value) => {
  currentRoughness.value = value;
  emit('update:roughness', value);
};

const selectArrowStyle = (style) => {
  currentArrowStyle.value = style;
  emit('update:arrowStyle', style);
};

const selectColorSwatch = (swatch) => {
  currentColor.value = swatch;
  emit('update:color', swatch);
};

const selectFillColor = (color) => {
  currentFillColor.value = color;
  emit('update:fillColor', color);
};

const toggleCoordinateMenu = () => {
  showCoordinateMenu.value = !showCoordinateMenu.value;
  if (showCoordinateMenu.value) {
    nextTick(() => positionCoordinateMenu());
  }
};

const positionCoordinateMenu = () => {
  const trigger = coordinateTriggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  if (props.orientation === 'vertical') {
    coordinateMenuStyle.value = {
      top: `${rect.top}px`,
      left: `${rect.right + 8}px`
    };
  } else {
    coordinateMenuStyle.value = {
      top: `${rect.bottom + 8}px`,
      left: `${rect.left}px`
    };
  }
};

const selectCoordinateSystem = (type) => {
  emit('add-coordinate-system', type);
  showCoordinateMenu.value = false;
};

const toggleColorPicker = () => {
  colorInput.value?.click();
};

const updateColor = () => {
  emit('update:color', currentColor.value);
};

const updateLineWidth = () => {
  emit('update:lineWidth', currentLineWidth.value);
};

const updateEraserSize = () => {
  emit('update:eraserSize', currentEraserSize.value);
};

const handleHoverEnter = () => {
  showPropertiesBar();
};

const handleHoverLeave = (event) => {
  const related = event?.relatedTarget;
  const movedIntoShapesMenu = related && shapesMenuRef.value?.contains(related);
  const movedIntoCoordinateMenu = related && coordinateMenuRef.value?.contains(related);
  if (movedIntoShapesMenu || movedIntoCoordinateMenu) return;
  startHideTimer();
};

const handleClickOutside = (event) => {
  const target = event.target;
  if (
    showShapesMenu.value &&
    !shapesTriggerRef.value?.contains(target) &&
    !shapesMenuRef.value?.contains(target)
  ) {
    showShapesMenu.value = false;
  }

  if (
    showCoordinateMenu.value &&
    !coordinateTriggerRef.value?.contains(target) &&
    !coordinateMenuRef.value?.contains(target)
  ) {
    showCoordinateMenu.value = false;
  }
};

const handleResize = () => {
  if (showShapesMenu.value) positionShapesMenu();
  if (showCoordinateMenu.value) positionCoordinateMenu();
};

watch(() => props.orientation, () => {
  nextTick(() => {
    if (showShapesMenu.value) positionShapesMenu();
    if (showCoordinateMenu.value) positionCoordinateMenu();
  });
});

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  window.addEventListener('resize', handleResize);
  // P0-FIX: Detect touch device and keep properties bar always visible
  isTouchDevice.value = window.matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0;
  if (isTouchDevice.value) {
    propertiesVisible.value = true;
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('resize', handleResize);
});

</script>

<style scoped>
.toolbar-container {
  display: flex;
  align-items: flex-start; /* Align to top */
  gap: 12px;
  z-index: 100;
  pointer-events: none;
}

.toolbar-container.vertical {
  flex-direction: row; /* Toolbar | Properties */
}

.toolbar-container.horizontal {
  flex-direction: column-reverse; /* Properties ^ Toolbar */
  align-items: center;
}

.toolbar {
  pointer-events: auto;
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.toolbar-container.vertical .toolbar {
  flex-direction: column;
  min-width: 56px;
  padding: 12px 6px;
}

.toolbar-container.horizontal .toolbar {
  flex-direction: row;
  min-height: 56px;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-group.vertical {
  flex-direction: column;
}

.divider {
  background-color: var(--glass-border);
  margin: 0 4px;
}

.divider:not(.horizontal) {
  width: 1px;
  height: 24px;
}

.divider.horizontal {
  width: 24px;
  height: 1px;
  margin: 4px 0;
}

.tool-btn {
  /* Base styles matching icon-btn global class but specific to toolbar sizing */
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s var(--ease-fluid);
  position: relative;
}

.tool-btn:hover {
  background: var(--glass-highlight);
  color: var(--text-primary);
  transform: scale(1.05);
}

.tool-btn.active {
  background: rgba(59, 130, 246, 0.2);
  color: var(--accent-primary);
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.2);
}

.tool-btn.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  color: var(--danger-color);
  border-color: rgba(239, 68, 68, 0.3);
}

.dropdown-trigger {
  position: relative;
}

.dropdown-arrow {
  position: absolute;
  bottom: 2px;
  right: 2px;
  opacity: 0.6;
  font-size: 10px;
}

/* Popovers */
.toolbar-popover {
  position: fixed;
  padding: 16px;
  min-width: 240px;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Global glass-panel style applies background/blur */
}

.shapes-popover {
  min-width: 280px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}

.coordinate-menu {
  min-width: 200px;
  gap: 8px;
}

.popover-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  font-weight: 600;
}

.option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.option-pill {
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 9999px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.option-pill:hover {
  border-color: var(--accent-primary);
  color: var(--text-primary);
  background: rgba(59, 130, 246, 0.1);
}

.option-pill.active {
  background: var(--accent-primary);
  color: white;
  border-color: var(--accent-primary);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
}

.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.color-swatch:hover {
  transform: scale(1.2);
  border-color: white;
}

.color-swatch.active {
  border-color: white;
  box-shadow: 0 0 0 2px var(--accent-primary);
  transform: scale(1.1);
}

.color-swatch.fill-none {
  background: linear-gradient(135deg, #fff 45%, #ef4444 45%, #ef4444 55%, #fff 55%);
  border: 2px solid var(--glass-border);
}

.color-swatch.fill-none .no-fill-x {
  display: none;
}

.shapes-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.shape-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.shape-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.shape-btn.active {
  background: rgba(59, 130, 246, 0.2);
  color: var(--accent-primary);
  border-color: rgba(59, 130, 246, 0.3);
}

.coordinate-btn {
  justify-content: flex-start;
  aspect-ratio: auto;
  padding: 8px 12px;
  font-size: 13px;
}

/* Properties Bar */
.properties-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  pointer-events: auto; /* allow interaction inside while container is non-interactive */
}

.property-group {
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
}

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  transition: transform 0.2s;
}
.color-preview:hover {
  transform: scale(1.1);
}

.hidden-color-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  /* pointer-events enabled so iOS Safari can open the native picker on tap */
}

.slider-group {
  color: var(--text-secondary);
}

.width-slider {
  width: 100px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  appearance: none;
  outline: none;
}

.width-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  background: var(--accent-primary);
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid var(--bg-color);
  box-shadow: 0 0 0 2px var(--glass-border);
  transition: transform 0.2s;
}

.width-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
}

/* Quick color swatches in properties bar */
.color-group {
  flex-wrap: wrap;
}

.quick-swatches {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.quick-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s;
  padding: 0;
}

.quick-swatch:hover {
  transform: scale(1.2);
  border-color: rgba(255, 255, 255, 0.5);
}

.quick-swatch.active {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary);
}
</style>







