<template>
  <div class="dialog-overlay" v-if="show" @click.self="closeOnBackdrop ? $emit('close') : null" role="dialog" aria-modal="true" :aria-label="title">
    <div class="dialog glass-panel">
      <div class="dialog-header">
        <h4>{{ title }}</h4>
        <button class="close-btn" @click="$emit('close')" v-if="showCloseButton">
          <X :size="20" />
        </button>
      </div>

      <div class="dialog-content">
        <slot></slot>
      </div>

      <div class="dialog-actions" v-if="$slots.actions">
        <slot name="actions"></slot>
      </div>
      <div class="dialog-actions" v-else-if="actions && actions.length">
        <button 
          v-for="action in actions" 
          :key="action.text"
          class="action-button"
          :class="{ 'cancel': action.cancel }"
          @click="action.handler ? action.handler() : $emit(action.event || 'action', action.value)"
        >
          {{ action.text }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { X } from 'lucide-vue-next';

export default {
  name: 'Dialog',
  components: {
    X
  },
  props: {
    show: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: 'Dialog'
    },
    actions: {
      type: Array,
      default: () => []
    },
    closeOnBackdrop: {
      type: Boolean,
      default: true
    },
    showCloseButton: {
      type: Boolean,
      default: true
    }
  },
  mounted() {
    // Add keydown event listener for Escape key
    document.addEventListener('keydown', this.handleKeyDown);

    // Prevent body scrolling
    if (this.show) {
      document.body.style.overflow = 'hidden';
    }
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.handleKeyDown);
    document.body.style.overflow = '';
  },
  watch: {
    show(newVal) {
      // Update body overflow state when dialog visibility changes
      document.body.style.overflow = newVal ? 'hidden' : '';
    }
  },
  methods: {
    handleKeyDown(event) {
      if (this.show && event.key === 'Escape' && this.closeOnBackdrop) {
        this.$emit('close');
      }
    }
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6); /* Darker overlay */
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
  animation: fadeIn 0.2s ease-out;
}

.dialog {
  /* Global .glass-panel handles appearance */
  padding: 0;
  width: 90%;
  max-width: 500px;
  animation: slideUp 0.3s ease-out;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  /* Border handled by global style */
}

.dialog-header h4 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s;
}

.close-btn:hover {
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.1);
}

.dialog-content {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  color: var(--text-primary);
  font-size: 15px;
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  /* Removed background/borders to let glass show through */
  border-top: 1px solid var(--glass-border);
}

.action-button {
  padding: 10px 18px;
  background-color: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s;
}

.action-button:hover {
  background-color: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3);
}

.action-button:active {
  transform: translateY(0);
}

.action-button.cancel {
  background-color: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--glass-border);
}

.action-button.cancel:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  border-color: var(--text-primary);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (max-width: 600px) {
  .dialog {
    width: 95%;
    max-height: 95vh;
  }
}
</style>