<template>
  <div 
    class="draggable-panel glass-panel" 
    :style="panelStyle"
    ref="panelRef"
  >
    <div 
      class="panel-header" 
      @pointerdown="startDrag"
    >
      <div class="header-content">
        <slot name="header"></slot>
      </div>
      <button class="close-btn" @click="$emit('close')">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    
    <div class="panel-body">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  initialX: { type: Number, default: 100 },
  initialY: { type: Number, default: 100 },
  width: { type: String, default: '320px' }
});

const emit = defineEmits(['close']);

const panelRef = ref(null);
const x = ref(props.initialX);
const y = ref(props.initialY);
const isDragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });

const panelStyle = computed(() => ({
  left: `${x.value}px`,
  top: `${y.value}px`,
  width: props.width,
  // Removed fixed height or max-height to allow auto-grow
}));

const startDrag = (event) => {
  // Only left click triggers drag
  if (event.button !== 0) return;
  
  isDragging.value = true;
  const rect = panelRef.value.getBoundingClientRect();
  dragOffset.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  
  document.addEventListener('pointermove', handleDrag);
  document.addEventListener('pointerup', stopDrag);
  event.preventDefault(); // Prevent text selection
};

const handleDrag = (event) => {
  if (!isDragging.value) return;
  
  let newX = event.clientX - dragOffset.value.x;
  let newY = event.clientY - dragOffset.value.y;
  
  // Optional: Constraint to viewport
  const maxX = window.innerWidth - (panelRef.value?.offsetWidth || 300);
  const maxY = window.innerHeight - (panelRef.value?.offsetHeight || 200);
  
  x.value = Math.max(0, Math.min(newX, maxX));
  y.value = Math.max(0, Math.min(newY, maxY));
};

const stopDrag = () => {
  isDragging.value = false;
  document.removeEventListener('pointermove', handleDrag);
  document.removeEventListener('pointerup', stopDrag);
};

onUnmounted(() => {
  stopDrag();
});
</script>

<style scoped>
.draggable-panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  z-index: 2000; /* High z-index to float above canvas */
  /* Glass styles are inherited from global .glass-panel */
  padding: 0; /* Content handles padding */
}

.panel-header {
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: grab;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
  user-select: none;
}

.panel-header:active {
  cursor: grabbing;
}

.header-content {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  cursor: pointer;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-primary);
}

.panel-body {
  padding: 16px;
  /* No fixed height, allow content to dictate size */
  overflow: visible; /* No scrollbars */
}
</style>
