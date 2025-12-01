<template>
  <div v-if="isVisible" class="ai-status-overlay glass-panel">
    <div class="ai-status-content">
      <div class="spinner"></div>
      <span class="status-text">AI drawing...</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useAiStore } from '../composables/useAiStore';

const { state } = useAiStore();
const isVisible = computed(() => state.isRunning);
</script>

<style scoped>
.ai-status-overlay {
  position: absolute;
  top: 16px;
  right: 16px; /* Corner of whiteboard */
  padding: 8px 16px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 2000; /* Above canvas but below some modals */
  pointer-events: none; /* Let clicks pass through */
  transition: opacity 0.3s ease;
}

.dark-mode .ai-status-overlay {
  background: rgba(30, 41, 59, 0.9);
  border-color: rgba(255, 255, 255, 0.1);
}

.ai-status-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(99, 102, 241, 0.2);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.status-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.dark-mode .status-text {
  color: #e2e8f0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
