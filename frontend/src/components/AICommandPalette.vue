<template>
  <div v-if="isVisible" class="ai-command-palette-overlay" @click.self="close">
    <div class="ai-command-palette glass-panel">
      <div class="input-wrapper">
        <component :is="SparklesIcon" class="icon" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          placeholder="Ask AI to draw or edit..."
          @keydown.enter="submit"
          @keydown.esc="close"
        />
      </div>
      <div v-if="query.trim()" class="hint">
        Press Enter to submit
      </div>
      <div v-else class="suggestions">
        <div
          v-for="suggestion in suggestions"
          :key="suggestion"
          class="suggestion-item"
          @click="selectSuggestion(suggestion)"
        >
          {{ suggestion }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { Sparkles } from 'lucide-vue-next';
import { useAiStore } from '../composables/useAiStore';
// Helper to capture snapshot - assuming we can access it or duplicate logic
// Ideally AIChatPanel logic should be shared. For now, let's emit event or assume this component
// is used where we can pass the handler.
// Actually, `useAiStore` expects `runBoardAssistant` which needs viewport and snapshot.
// We might need to inject dependencies or emit an event to a parent that handles the context gathering.

const props = defineProps({
  roomId: {
    type: String,
    required: true
  },
  // Function to get current viewport and snapshot
  getContext: {
    type: Function,
    required: true
  }
});

const SparklesIcon = Sparkles;
const { runBoardAssistant } = useAiStore();

const isVisible = ref(false);
const query = ref('');
const inputRef = ref(null);

const suggestions = [
  "Narysuj wykres funkcji x^2",
  "Wyrównaj ten blok",
  "Przepisz notatki do LaTeX",
  "Stwórz diagram przepływu"
];

const open = () => {
  isVisible.value = true;
  query.value = '';
  nextTick(() => {
    inputRef.value?.focus();
  });
};

const close = () => {
  isVisible.value = false;
};

const submit = async () => {
  if (!query.value.trim()) return;
  const prompt = query.value;
  close();

  try {
    const context = await props.getContext();
    if (context) {
      await runBoardAssistant(props.roomId, prompt, context.viewport, context.snapshot);
    }
  } catch (e) {
    console.error("Command palette error:", e);
  }
};

const selectSuggestion = (text) => {
  query.value = text;
  inputRef.value?.focus();
};

const handleKeydown = (e) => {
  if (e.ctrlKey && e.code === 'Space') {
    e.preventDefault();
    if (isVisible.value) {
      close();
    } else {
      open();
    }
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.ai-command-palette-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 15vh;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.ai-command-palette {
  width: 600px;
  max-width: 90vw;
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dark-mode .ai-command-palette {
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.input-wrapper {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  gap: 12px;
}

.dark-mode .input-wrapper {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

.icon {
  color: #6366f1;
  width: 24px;
  height: 24px;
}

input {
  flex: 1;
  border: none;
  font-size: 18px;
  background: transparent;
  color: var(--text-primary);
  outline: none;
}

.suggestions {
  padding: 8px;
}

.suggestion-item {
  padding: 10px 16px;
  cursor: pointer;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  transition: all 0.2s;
}

.suggestion-item:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-primary);
}

.dark-mode .suggestion-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.hint {
  padding: 10px 20px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: right;
  background: rgba(0, 0, 0, 0.02);
}
</style>
