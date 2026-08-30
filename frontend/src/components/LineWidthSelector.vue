<template>
  <div class="line-width-selector" ref="container">
    <div 
      class="line-width-preview"
      @click="toggleDropdown"
    >
      <div 
        class="line-preview" 
        :style="{ height: currentWidth + 'px', backgroundColor: previewColor }"
      ></div>
      <div class="dropdown-arrow">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </div>

    <div v-if="showDropdown" class="width-dropdown">
      <div class="width-options">
        <button 
          v-for="width in widthOptions" 
          :key="width.value"
          class="width-option"
          :class="{ active: currentWidth === width.value }"
          @click="selectWidth(width.value)"
        >
          <div 
            class="width-preview" 
            :style="{ height: width.value + 'px', backgroundColor: previewColor }"
          ></div>
          <span class="width-name">{{ width.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LineWidthSelector',
  props: {
    value: {
      type: Number,
      default: 2
    },
    color: {
      type: String,
      default: '#000000'
    }
  },
  data() {
    return {
      currentWidth: this.value,
      showDropdown: false,
      widthOptions: [
        { value: 1, name: 'Thin' },
        { value: 2, name: 'Medium' },
        { value: 3, name: 'Thick' },
        { value: 5, name: 'Extra Thick' },
        { value: 8, name: 'Super Thick' }
      ]
    }
  },
  computed: {
    previewColor() {
      return this.color || '#000000';
    }
  },
  mounted() {
    document.addEventListener('click', this.handleClickOutside);
  },
  // 9.3: Fix Vue 2 beforeDestroy → Vue 3 beforeUnmount
  beforeUnmount() {
    document.removeEventListener('click', this.handleClickOutside);
  },
  methods: {
    toggleDropdown() {
      this.showDropdown = !this.showDropdown;
    },

    selectWidth(width) {
      this.currentWidth = width;
      this.$emit('input', width);
      this.$emit('change', width);
      this.showDropdown = false;
    },

    handleClickOutside(event) {
      if (this.$refs.container && !this.$refs.container.contains(event.target)) {
        this.showDropdown = false;
      }
    }
  },
  watch: {
    value(newValue) {
      this.currentWidth = newValue;
    },
    color() {
      // Just to trigger a re-render of the preview
    }
  }
}
</script>

<style scoped>
.line-width-selector {
  position: relative;
  display: inline-block;
}

/* 3.3: Use dynamic color from prop instead of hardcoded #0b20ff */
.line-width-preview {
  width: 1px;
  height: 36px;
  background-color: var(--line-preview-color, currentColor);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  padding: 0 5px;
}

.line-width-preview:hover {
  background-color: #444;
}

.line-preview {
  width: 10px;
  min-height: 1px;
  border-radius: 2px;
}

.dropdown-arrow {
  position: absolute;
  right: 5px;
  bottom: 7px;
  color: #999;
}

.width-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  width: 100px;
  background-color: #333;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  margin-top: 5px;
  z-index: 100;
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

.width-dropdown::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 14px;
  width: 12px;
  height: 12px;
  background-color: #333;
  transform: rotate(45deg);
}

.width-options {
  padding: 5px;
}

.width-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: none;
  border: none;
  border-radius: 4px;
  color: #ccc;
  cursor: pointer;
  text-align: left;
}

.width-option:hover {
  background-color: #444;
}

.width-option.active {
  background-color: var(--accent-primary, #2563eb);
  color: white;
}

.width-preview {
  width: 20px;
  min-height: 1px;
  border-radius: 2px;
}

.width-name {
  font-size: 1x;
}
</style>