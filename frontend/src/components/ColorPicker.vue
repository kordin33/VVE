<template>
  <div class="color-picker-container" ref="container">
    <div class="tool-btn color-picker-btn" :title="colorName" @click="toggleGrid"> <!-- Click toggles grid -->
      <div
        class="color-preview"
        :style="{ backgroundColor: selectedColor }"
      ></div>

      <!-- Color Grid (Conditional display via v-if) -->
      <div v-if="showGrid" class="colors-grid" @click.stop> <!-- Added @click.stop -->
        <div
          v-for="(color, index) in basicColors"
          :key="'palette-' + index"
          class="color-option"
          :style="{ backgroundColor: color }"
          :class="{ active: selectedColor === color }"
          @click="selectColor(color)"
          :title="basicColorNames[index]"
        ></div>

        <!-- Ostatnio użyte kolory -->
        <div
          v-for="(color, index) in recentColors.slice(0, 6)"
          :key="'recent-' + index"
          class="color-option recent"
          :style="{ backgroundColor: color }"
          :class="{ active: selectedColor === color }"
          @click="selectColor(color)"
          :title="'Ostatnio używany'"
        ></div>

        <!-- Kolor własny -->
        <div class="custom-color-container">
          <input
            type="color"
            v-model="customColor"
            @input="selectColor(customColor)"
            class="custom-color-picker"
            title="Własny kolor"
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';

export default {
  name: 'ColorPicker',
  props: {
    modelValue: { // Changed prop name to modelValue for v-model compatibility
      type: String,
      default: '#000000'
    }
  },
  emits: ['update:modelValue'], // Emit update:modelValue for v-model
  setup(props, { emit }) {
    const selectedColor = ref(props.modelValue);
    const customColor = ref(props.modelValue);
    const recentColors = ref([]);
    const showGrid = ref(false); // Reactive variable for grid visibility

    const basicColors = [
      '#000000', '#434343', '#666666', '#999999', '#CCCCCC', '#FFFFFF',
      '#F44336', '#E91E63', '#9C27B0', '#673AB7',
      '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
      '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
      '#FFEB3B', '#FFC107', '#FF9800', '#FF5722',
      '#795548', '#607D8B'
    ];
    const basicColorNames = [
      'Czarny', 'Ciemnoszary', 'Szary', 'Jasnoszary', 'Srebrny', 'Biały',
      'Czerwony', 'Różowy', 'Fioletowy', 'Głęboki fiolet',
      'Indygo', 'Niebieski', 'Jasnoniebieski', 'Cyjan',
      'Morski', 'Zielony', 'Jasnozielony', 'Limonkowy',
      'Żółty', 'Bursztynowy', 'Pomarańczowy', 'Głęboki pomarańcz',
      'Brązowy', 'Szaroniebieski'
    ];
    const colorPalette = basicColors;
    const colorNames = basicColorNames;

    const colorName = computed(() => {
      const index = colorPalette.findIndex(c =>
        c.toUpperCase() === selectedColor.value.toUpperCase()
      );
      return index !== -1 ? colorNames[index] : 'Własny';
    });

    const isHexColor = (value) => /^#[0-9A-F]{6}$/i.test(value);

    const addToRecent = (color) => {
      if (!color || !isHexColor(color)) return;
      const index = recentColors.value.indexOf(color);
      if (index !== -1) {
        recentColors.value.splice(index, 1);
      }
      recentColors.value.unshift(color);
      if (recentColors.value.length > 6) {
        recentColors.value.pop();
      }
      if (window.localStorage) {
        try {
          localStorage.setItem('recentColors', JSON.stringify(recentColors.value));
        } catch (e) {
          console.error('Nie można zapisać ostatnich kolorów:', e);
        }
      }
    };

    const loadRecentColors = () => {
      try {
        const saved = localStorage.getItem('recentColors');
        if (saved) {
          recentColors.value = JSON.parse(saved);
        }
      } catch (e) {
        console.error('Błąd wczytywania ostatnich kolorów:', e);
      }
    };

    const selectColor = (color) => {
      selectedColor.value = color;
      customColor.value = color; // Keep custom picker synced
      addToRecent(color);
      emit('update:modelValue', color); // Emit for v-model
      showGrid.value = false; // Close grid after selection
    };

    const container = ref(null);

    const toggleGrid = () => {
      showGrid.value = !showGrid.value;
    };

    // 3.5: Click-outside handler to close color grid
    const handleClickOutside = (event) => {
      if (container.value && !container.value.contains(event.target)) {
        showGrid.value = false;
      }
    };

    onMounted(() => {
      loadRecentColors();
      document.addEventListener('pointerdown', handleClickOutside);
    });

    onBeforeUnmount(() => {
      document.removeEventListener('pointerdown', handleClickOutside);
    });

    watch(() => props.modelValue, (newValue) => {
      selectedColor.value = newValue;
      customColor.value = newValue;
    });

    return {
      container,
      selectedColor,
      customColor,
      recentColors,
      basicColors,
      basicColorNames,
      colorName,
      selectColor,
      showGrid,
      toggleGrid
    };
  }
}
</script>

<style scoped>
.color-picker-container {
  position: relative;
  margin: 8px 0;
  width: 100%;
  display: flex; /* Center button */
  justify-content: left;
}

.color-picker-btn {
  position: relative;
  width: 40px;
  height: 40px;
  /* margin: 0 auto; Removed, handled by container */
  background-color: var(--btn-bg);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}

.color-picker-btn:hover {
  background-color: var(--btn-hover-bg);
}

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--border-color);
  margin: 0 auto;
}

/* 2.1: Viewport-aware positioning — auto-flip if grid overflows viewport */
.colors-grid {
  position: absolute;
  left: 100%;
  top: 0;
  background-color: var(--toolbar-bg);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  padding: 8px;
  margin-left: 8px;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 5px;
  width: 198px;
  border: 1px solid var(--border-color);
}

/* On narrow screens / touch devices, position grid above/below instead of right */
@media (max-width: 768px), (hover: none) {
  .colors-grid {
    left: 50%;
    top: auto;
    bottom: 100%;
    transform: translateX(-50%);
    margin-left: 0;
    margin-bottom: 8px;
  }
}

/* Removed hover style for grid */
/* .color-picker-btn:hover .colors-grid {
  display: grid;
} */

.custom-color-container {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  background: linear-gradient(to right, red, yellow, green, cyan, blue, magenta);
  border: 2px solid var(--border-color);
}

.custom-color-picker {
  position: absolute;
  top: -5px;
  left: -5px;
  width: 34px;
  height: 34px;
  border: none;
  opacity: 0;
  cursor: pointer;
}

.color-option {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.color-option:hover {
  transform: scale(1.2);
}

.color-option.active {
  border-color: white;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.3);
}
</style>
