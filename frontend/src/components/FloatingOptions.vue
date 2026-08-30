<template>
  <div class="floating-options" :style="positionStyle" @click.stop>
    <div class="options-content">
      <!-- Shape Selector (Conditional) -->
      <ShapeSelector
        v-if="showShapeSelector"
        :current-shape="internalShape"
        @shape-changed="updateShape"
      />

      <!-- Line Style Selector (Conditional) -->
      <LineStyleSelector
        v-if="showLineStyleSelector"
        :current-line-style="internalLineStyle"
        @line-style-changed="updateLineStyle"
      />

      <!-- Common Options (Color/Width) - Show unless Advanced is active -->
      <template v-if="!showAdvancedOptions">
        <ColorPicker
          :modelValue="internalColor"
          @update:modelValue="updateColor"
        />
        <div class="line-width-selector">
          <div class="line-width-preview">
            <div
              class="line-preview"
              :style="{ height: internalWidth + 'px', backgroundColor: internalColor }"
            ></div>
          </div>
          <select
            v-model="internalWidth"
            @change="updateWidth"
            class="line-width-select">
            <option value="1">Thin</option>
            <option value="2">Medium</option>
            <option value="3">Thick</option>
            <option value="5">Extra Thick</option>
          </select>
        </div>
      </template>

      <!-- Advanced Options Section (Conditional) -->
      <div v-if="showAdvancedOptions" class="advanced-options-section">
        <h4>Advanced Tools</h4>
        <button class="adv-option-btn" @click="emit('toggle-calculator')">
           <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="10" x2="16" y2="14"></line><line x1="12" y1="10" x2="12" y2="14"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="8" y1="18" x2="16" y2="18"></line></svg>
          Calculator
        </button>

        <!-- Math Graph -->
        <button @click="emit('select-math-plot')" class="adv-option-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="w-5 h-5 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path d="M4 20L20 4M4 4l16 16" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Math Graph
        </button>

        <!-- Physics Graph -->
        <button @click="emit('select-physics-plot')" class="adv-option-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="w-5 h-5 mr-2 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Physics Graph
        </button>

        <!-- 2D Coordinate System -->
        <button @click="emit('select-coord-2d')" class="adv-option-btn">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <line x1="4" y1="12" x2="20" y2="12"></line>
             <line x1="12" y1="4" x2="12" y2="20"></line>
             <polyline points="18 10 20 12 18 14"></polyline>
             <polyline points="14 6 12 4 10 6"></polyline>
           </svg>
          2D Coord Sys
        </button>

        <!-- 3D Coordinate System -->
        <button @click="emit('select-coord-3d')" class="adv-option-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="12" x2="20" y2="12"></line> <!-- X -->
            <line x1="12" y1="12" x2="12" y2="4"></line> <!-- Y -->
            <line x1="12" y1="12" x2="6" y2="18"></line> <!-- Z -->
            <polyline points="18 10 20 12 18 14"></polyline> <!-- X arrow -->
            <polyline points="14 6 12 4 10 6"></polyline> <!-- Y arrow -->
            <polyline points="8 16 6 18 8 20"></polyline> <!-- Z arrow -->
          </svg>
          3D Coord Sys
        </button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import ColorPicker from './ColorPicker.vue';
import ShapeSelector from './ShapeSelector.vue';
import LineStyleSelector from './LineStyleSelector.vue';
// Calculator is now in CalculatorModal, no direct import needed here

const props = defineProps({
  initialColor: { type: String, default: '#000000' },
  initialWidth: { type: Number, default: 2 },
  top: { type: Number, default: 0 },
  left: { type: Number, default: 0 },
  showShapeSelector: { type: Boolean, default: false },
  currentShape: { type: String, default: 'rectangle' },
  showLineStyleSelector: { type: Boolean, default: false },
  currentLineStyle: { type: String, default: 'solid' },
  showAdvancedOptions: { type: Boolean, default: false } // Prop to show advanced section
});

// Add new emits for graph/coord selection
const emit = defineEmits([
    'color-changed',
    'line-width-changed',
    'shape-changed',
    'line-style-changed',
    'advanced-option-changed',
    'toggle-calculator',
    'select-math-plot',      // New
    'select-physics-plot',   // New
    'select-coord-2d',       // New
    'select-coord-3d'        // New
]);

const internalColor = ref(props.initialColor);
const internalWidth = ref(props.initialWidth);
const internalShape = ref(props.currentShape);
const internalLineStyle = ref(props.currentLineStyle);

// Watch for prop changes to update internal state
watch(() => props.initialColor, (newVal) => { internalColor.value = newVal; });
watch(() => props.initialWidth, (newVal) => { internalWidth.value = newVal; });
watch(() => props.currentShape, (newVal) => { internalShape.value = newVal; });
watch(() => props.currentLineStyle, (newVal) => { internalLineStyle.value = newVal; });

const updateColor = (color) => {
  internalColor.value = color;
  emit('color-changed', color);
};

const updateWidth = () => {
  const width = parseInt(internalWidth.value);
  emit('line-width-changed', width);
};

const updateShape = (shape) => {
  internalShape.value = shape;
  emit('shape-changed', shape);
};

const updateLineStyle = (style) => {
  internalLineStyle.value = style;
  emit('line-style-changed', style);
};

// Placeholder for handling changes within the advanced section if needed
// const handleAdvancedChange = (payload) => {
//   emit('advanced-option-changed', payload);
// };

const positionStyle = computed(() => ({
  top: `${props.top}px`,
  left: `${props.left}px`,
}));

</script>

<style scoped>
.floating-options {
  position: absolute;
  z-index: var(--z-floating-options, 1001);
  background-color: var(--toolbar-bg, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 18px; /* Increased padding */
  display: flex;
  flex-direction: column;
  min-width: 180px;
  /* 3.2: Responsive max-width to prevent viewport overflow */
  max-width: min(400px, 95vw);
  /* max-width: 300px; /* Allow it to grow but not excessively - Removed for calculator */
  gap: 10px;
}

.options-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.advanced-options-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px; /* Space between advanced components */
  border-top: 1px solid var(--border-color-light, #eee); /* Corrected border */
  padding-top: 10px; /* Corrected padding */
  margin-top: 10px;
}

.advanced-options-section h4 {
  margin: 0 0 5px 0; /* Corrected margin */
  font-size: 15px;
  font-weight: 500;
  color: var(--text-color-secondary);
  text-align: center;
}

.adv-option-btn {
  display: flex;
  align-items: center;
  gap: 8px; /* Increased gap */
  width: 100%;
  padding: 8px 12px;
  border: none;
  background-color: var(--btn-secondary-bg);
  color: var(--text-color-secondary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  transition: background-color 0.2s ease;
}
.adv-option-btn svg {
  flex-shrink: 0; /* Prevent icon shrinking */
  width: 18px; /* Ensure consistent icon size */
  height: 18px;
}
.adv-option-btn:hover {
  background-color: var(--btn-secondary-hover-bg);
}


/* Styles for Shape Selector and Line Style Selector are now in their respective components */
/* Keep common styles for ColorPicker and LineWidthSelector */


.floating-btn {
  display: flex;
  align-items: center;
  padding: 5px 10px;
  background-color: var(--btn-secondary-bg);
  border-radius: 12px;
  color: var(--text-color-secondary);
  font-size: 14px;
  transition: background-color 0.2s ease;
  width: 100%;
  text-align: left;
}

.line-width-selector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center; /* Centered items */
  width: 100%;
}
.line-width-preview {
  width: 40px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--btn-bg, #f0f0f0);
  border-radius: 4px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.line-preview {
  width: 20px;
  background-color: currentColor;
  border-radius: 4px;
}

.line-width-select {
  width: 90%;
  padding: 4px;
  border-radius: 4px;
  background-color: var(--btn-bg, #f0f0f0);
  color: var(--btn-color, #333);
  border: 1px solid var(--border-color, #e0e0e0);
  font-size: 12px;
}
</style>
