<template>
  <div class="top-menu-container" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">
    <!-- Explicit Hover Area -->
    <div class="hover-trigger-area"></div>

    <transition name="fade">
      <button v-if="showGear"
              class="gear-btn glass-panel"
              @click="toggleMenu"
              @mouseenter="cancelHide"
              @mouseleave="handleMouseLeave"
              title="Settings">
        <Settings :size="20" />
      </button>
    </transition>

    <!-- Actual Menu (Visible on gear click) -->
    <transition name="slide-fade">
      <div v-if="showMenu" class="top-menu glass-panel" @mouseenter="cancelHide" @mouseleave="handleMouseLeave">
        <button class="menu-btn" @click="toggleFullscreen" :title="isFullscreen ? 'Pełny ekran — wyłącz' : 'Pełny ekran'">
          <component :is="isFullscreen ? Minimize : Maximize" :size="18" />
          <span>{{ isFullscreen ? 'Zamknij pełny ekran' : 'Pełny ekran' }}</span>
        </button>
        <button v-if="can('tool.clearBoard')" class="menu-btn" @click="emitClear" title="Wyczyść tablicę">
          <Trash2 :size="18" />
          <span>Wyczyść</span>
        </button>
        <button class="menu-btn" @click="toggleShortcuts" title="Skróty klawiszowe">
           <Keyboard :size="18" />
          <span>Skróty</span>
        </button>
        <button v-if="can('dev.legacyPeerRooms')" class="menu-btn" @click="openRoomManager" title="Zarządzaj pokojami">
          <LayoutGrid :size="18" />
          <span>Pokoje</span>
        </button>
        <button v-if="can('dev.rawBoardTransfer')" class="menu-btn" @click="emit('export-whiteboard')" title="Eksportuj tablicę (JSON)">
          <Download :size="18" />
          <span>Eksport</span>
        </button>
        <button v-if="can('dev.rawBoardTransfer')" class="menu-btn" @click="emit('import-whiteboard')" title="Importuj tablicę (JSON)">
          <Upload :size="18" />
          <span>Import</span>
        </button>
        <button v-if="can('panel.pdfImport')" class="menu-btn" @click="triggerPdfImport" title="Zaimportuj PDF jako tło">
          <FileUp :size="18" />
          <span>PDF</span>
        </button>
        <input ref="pdfFileInput" type="file" accept=".pdf" style="display:none" @change="handlePdfFileSelected" />

        <div class="divider-vertical"></div>

        <!-- Feature Toggles -->
        <button
          v-if="can('panel.inputStyle')"
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'styleHandwriting' }"
          @click="emit('toggle-feature', 'styleHandwriting')"
          title="Styl pisania"
        >
          <Wand2 :size="18" />
          <span>Styl</span>
        </button>
        <button
          v-if="can('experiment.gridAlign')"
          class="menu-btn"
          :class="{ 'active-feature': props.activeFeature === 'gridAlign' }"
          @click="emit('toggle-feature', 'gridAlign')"
          title="Grid Align (eksperymentalne)"
        >
          <Grid3X3 :size="18" />
          <span>Wyrównaj</span>
        </button>
        <div v-if="can('panel.pdfExport')" class="menu-btn pdf-menu-wrapper" @mouseenter="showPdfMenu = true" @mouseleave="showPdfMenu = false">
          <button class="menu-btn" @click="emitPdfExport('single')" title="Eksportuj do PDF (A4)">
            <FileDown :size="18" />
            <span>PDF</span>
          </button>
          <div v-if="showPdfMenu" class="pdf-dropdown glass-panel">
            <button class="pdf-option" @click="emitPdfExport('single')">Cała tablica (1 strona)</button>
            <button class="pdf-option" @click="emitPdfExport('paged')">Notatki z lekcji (A4, wiele stron)</button>
          </div>
        </div>
      </div>
    </transition>

     <!-- Keyboard shortcuts info dialog -->
    <div v-if="showShortcutsInfo" class="shortcuts-dialog glass-panel">
       <div class="shortcuts-dialog-header">
        <h3>Keyboard Shortcuts</h3>
         <button class="close-btn" @click="toggleShortcuts">
            <X :size="20" />
         </button>
       </div>
       <div class="shortcuts-list">
          <div class="shortcut-item">
            <div class="shortcut-key">P</div>
            <div class="shortcut-desc">Pen Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">H</div>
            <div class="shortcut-desc">Hand/Pan Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">E</div>
            <div class="shortcut-desc">Eraser Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">S</div>
            <div class="shortcut-desc">Shapes Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">T</div>
            <div class="shortcut-desc">Text Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">I</div>
            <div class="shortcut-desc">Image Tool</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+Z</div>
            <div class="shortcut-desc">Undo</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+Y</div>
            <div class="shortcut-desc">Redo</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Delete</div>
            <div class="shortcut-desc">Delete Selected Element</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl+V</div>
            <div class="shortcut-desc">Paste Image from Clipboard</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Alt+Click+Drag</div>
            <div class="shortcut-desc">Pan Canvas</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Scroll Wheel</div>
            <div class="shortcut-desc">Zoom In/Out</div>
          </div>
        </div>
    </div>
  </div>
</template>

<script setup>
import { ref, defineProps, defineEmits, onMounted, onBeforeUnmount } from 'vue';
import {
  Settings,
  Trash2,
  Keyboard,
  LayoutGrid,
  Download,
  Upload,
  Wand2,
  Grid3X3,
  FileDown,
  FileUp,
  X,
  Maximize,
  Minimize
} from 'lucide-vue-next';
import { featureAvailable } from '../services/pilotSurface';

// Define props
const props = defineProps({
  activeFeature: {
    type: String,
    default: null
  },
  role: {
    type: String,
    default: 'developer'
  }
});

// Menu item visibility follows the shared PilotAvailability manifest (VVE-100).
const can = (featureId) => featureAvailable(featureId, props.role);

// Define emits
const emit = defineEmits(['clear-canvas', 'toggle-feature', 'open-room-manager', 'export-whiteboard', 'export-pdf-single', 'export-pdf-paged', 'import-whiteboard', 'import-pdf']);

// P0-FIX: Detect touch device and keep gear always visible on touch
const isTouchDevice = ref(false);
const showGear = ref(false); // Controls gear visibility
const showMenu = ref(false); // Controls menu visibility
const showShortcutsInfo = ref(false);
let hideTimeout = null; // Timeout for hiding gear/menu
const showPdfMenu = ref(false);
const isFullscreen = ref(false);

const emitPdfExport = (mode) => {
  if (mode === 'single') {
    emit('export-pdf-single');
  } else if (mode === 'paged') {
    emit('export-pdf-paged');
  }
  showPdfMenu.value = false;
};

const toggleFullscreen = async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.error(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`);
  }
};

const updateFullscreenState = () => {
  isFullscreen.value = !!document.fullscreenElement;
};

onMounted(() => {
  document.addEventListener('fullscreenchange', updateFullscreenState);
  // P0-FIX: On touch devices, always show gear icon (no hover available)
  isTouchDevice.value = window.matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0;
  if (isTouchDevice.value) {
    showGear.value = true;
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', updateFullscreenState);
});

// Show gear on hover, clear any pending hide actions
const handleMouseEnter = () => {
  if (hideTimeout) clearTimeout(hideTimeout);
  showGear.value = true;
};

// Hide gear and menu after a delay if mouse leaves container
const handleMouseLeave = () => {
  if (isTouchDevice.value) return; // P0-FIX: Never auto-hide on touch
  if (hideTimeout) clearTimeout(hideTimeout);
  if (!showShortcutsInfo.value) {
      hideTimeout = setTimeout(() => {
        showGear.value = false;
        showMenu.value = false;
      }, 500);
  }
};

// Keep gear/menu visible if mouse moves onto them
const cancelHide = () => {
  if (hideTimeout) clearTimeout(hideTimeout);
};

// Toggle menu visibility on gear click
const toggleMenu = () => {
  showMenu.value = !showMenu.value;
  if (showMenu.value) {
      cancelHide(); // Prevent hiding if menu is opened
  }
};

const emitClear = () => {
  emit('clear-canvas');
  showMenu.value = false; // Hide menu after action
  showGear.value = false; // Hide gear as well
};

const toggleShortcuts = () => {
  showShortcutsInfo.value = !showShortcutsInfo.value;
  // Keep menu/gear visible when shortcuts dialog is open
  if (showShortcutsInfo.value) {
      cancelHide();
      showMenu.value = true; // Ensure menu stays open
      showGear.value = true; // Ensure gear stays visible
  } else {
      // If closing shortcuts, allow normal hide behavior
      handleMouseLeave();
  }
};

const pdfFileInput = ref(null);
const triggerPdfImport = () => {
  pdfFileInput.value?.click();
};
const handlePdfFileSelected = (event) => {
  const file = event.target.files[0];
  if (file && file.type === 'application/pdf') {
    emit('import-pdf', file);
  }
  event.target.value = '';
  showMenu.value = false;
  showGear.value = false;
};

const openRoomManager = () => {
  emit('open-room-manager');
  showMenu.value = false;
  showGear.value = false;
};

</script>

<style scoped>
.top-menu-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 1001;
  display: flex;
  flex-direction: column; /* Stack trigger area, gear, menu */
  align-items: center;
  pointer-events: none; /* Let clicks pass through container */
}

/* Explicit hover area */
.hover-trigger-area {
    width: 100%;
    height: 25px; /* Height of the hover trigger zone */
    position: absolute; /* Position it at the very top */
    top: 0;
    left: 0;
    z-index: 1; /* Below gear/menu */
    pointer-events: auto; /* Capture mouse events */
}

.gear-btn {
  /* Uses global glass-panel class for bg/blur */
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s var(--ease-fluid);
  color: var(--text-secondary);
  position: relative; 
  z-index: 3; 
  pointer-events: auto; 
  margin-top: 10px; 
}

.gear-btn:hover, .gear-btn.active {
  background: var(--glass-highlight);
  color: var(--accent-primary);
  transform: scale(1.1) rotate(90deg);
  box-shadow: 0 0 15px rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.3);
}

.top-menu {
  margin-top: 8px;
  padding: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.menu-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s var(--ease-fluid);
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 500;
}

.menu-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  border-color: rgba(255, 255, 255, 0.1);
}

.divider-vertical {
  width: 1px;
  height: 24px;
  background: var(--glass-border);
  margin: 0 4px;
}

.pdf-menu-wrapper {
  position: relative;
}

.pdf-dropdown {
  position: absolute;
  top: 110%;
  left: 0;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  z-index: 5;
}

.pdf-option {
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
  background: rgba(255,255,255,0.04);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s var(--ease-fluid);
}

.pdf-option:hover {
  background: rgba(59, 130, 246, 0.15);
  color: var(--accent-primary);
  border-color: rgba(59, 130, 246, 0.4);
}

/* Active feature button */
.menu-btn.active-feature {
  background: rgba(59, 130, 246, 0.15);
  color: var(--accent-primary);
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.1);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-fade-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); /* Bouncy effect */
}
.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-20px) scale(0.95);
  opacity: 0;
}

/* Shortcuts Dialog */
.shortcuts-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2000; /* Higher than everything */
  max-width: 400px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  pointer-events: auto;
  /* Uses global glass-panel styles */
}

.shortcuts-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.shortcuts-dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.shortcuts-list {
  padding: 15px 20px;
}

.shortcut-item {
  display: flex;
  margin-bottom: 12px;
  font-size: 14px;
  align-items: center;
}

.shortcut-key {
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 8px;
  border-radius: 6px;
  margin-right: 12px;
  min-width: 80px;
  text-align: center;
  font-weight: 600;
  color: var(--accent-hover);
  font-family: monospace;
  font-size: 12px;
  border: 1px solid var(--glass-border);
}

.shortcut-desc {
  color: var(--text-secondary);
}
</style>
