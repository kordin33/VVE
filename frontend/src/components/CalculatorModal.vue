<template>
  <div
    v-if="isVisible"
    class="calculator-modal-wrapper"
    :style="modalStyle"
    ref="modalRef"
    @pointerdown="startDrag"
  >
    <!-- Header removed entirely -->
    <div class="modal-content">
      <!-- Pass close event up -->
      <Calculator @close="closeModal" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import Calculator from './Calculator.vue';

const props = defineProps({
  isVisible: { type: Boolean, default: false }
});

const emit = defineEmits(['update:isVisible', 'close']);

const isVisible = ref(props.isVisible);
const position = ref({ x: 100, y: 100 }); // Initial position
const isDragging = ref(false);
const dragStartOffset = ref({ x: 0, y: 0 });
const modalRef = ref(null);

watch(() => props.isVisible, (newVal) => {
  isVisible.value = newVal;
  if (newVal) {
    // Reset position or load saved position if needed
    // position.value = { x: 100, y: 100 };
  }
});

const modalStyle = computed(() => ({
  transform: `translate(${position.value.x}px, ${position.value.y}px)`,
}));

const closeModal = () => {
  isVisible.value = false;
  emit('update:isVisible', false);
  emit('close');
};

const startDrag = (event) => {
  // Prevent dragging if clicking on any button (calculator's internal close button or operation buttons)
  if (event.target.closest('button')) {
      return;
  }
  // Allow dragging by clicking anywhere else on the wrapper (which contains the calculator)
  isDragging.value = true;
  dragStartOffset.value = {
    x: event.clientX - position.value.x,
    y: event.clientY - position.value.y,
  };
  document.addEventListener('pointermove', handleDrag);
  document.addEventListener('pointerup', stopDrag);
};

const handleDrag = (event) => {
  if (!isDragging.value) return;
  position.value = {
    x: event.clientX - dragStartOffset.value.x,
    y: event.clientY - dragStartOffset.value.y,
  };
};

const stopDrag = () => {
  if (isDragging.value) {
    isDragging.value = false;
    document.removeEventListener('pointermove', handleDrag);
    document.removeEventListener('pointerup', stopDrag);
  }
};

onBeforeUnmount(() => {
  document.removeEventListener('pointermove', handleDrag);
  document.removeEventListener('pointerup', stopDrag);
});

</script>

<style scoped>
.calculator-modal-wrapper {
  position: fixed; /* Use fixed to position relative to viewport */
  z-index: 1100; /* Ensure it's above other elements */
  background-color: transparent; /* Make wrapper transparent */
  border: none; /* Remove border */
  border-radius: 0; /* Remove border-radius if calculator has its own */
  box-shadow: none; /* Remove shadow if calculator has its own */
  cursor: grab; /* Default cursor indicates draggable */
  user-select: none; /* Prevent text selection during drag */
  /* Initial position is set by transform */
  left: 0;
  top: 0;
}

.calculator-modal-wrapper:active {
  cursor: grabbing;
}

/* .modal-header styles removed */

.modal-content {
  padding: 0; /* No padding needed, calculator component handles it */
  /* The calculator component itself should have the desired border-radius */
}
</style>
