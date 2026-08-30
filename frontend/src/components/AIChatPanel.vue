<template>
  <div class="ai-chat-panel glass-panel" :class="{ minimized: isMinimized }">
    <div class="chat-header" @click="toggleMinimize">
      <div class="header-title">
        <component :is="SparklesIcon" class="icon" />
        <span>AI Assistant</span>
      </div>
      <div class="header-controls">
        <button @click.stop="toggleMinimize" class="control-btn">
          <component :is="isMinimized ? MaximizeIcon : MinimizeIcon" class="icon-sm" />
        </button>
      </div>
    </div>

    <div v-if="!isMinimized" class="chat-body">
      <!-- Tabs -->
      <div class="tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'chat' }"
          @click="activeTab = 'chat'"
        >
          Chat
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'agent' }"
          @click="activeTab = 'agent'"
        >
          Board Agent
        </button>
      </div>

      <!-- Chat Tab -->
      <div v-if="activeTab === 'chat'" class="tab-content chat-tab">
        <div class="messages-container" ref="messagesContainer">
          <div v-if="messages.length === 0 && !isLoading" class="empty-state">
            <p>Otwórz panel i zapytaj o to, co widzisz na tablicy.</p>
            <p class="sub-text">Pierwsza wiadomość użyje screena tablicy.</p>
          </div>

          <div
            v-for="(msg, index) in messages"
            :key="index"
            class="message"
            :class="msg.role"
          >
            <div class="message-content">
              <div v-if="msg.image" class="message-image">
                <img :src="msg.image" alt="Snapshot" />
              </div>
              <div class="message-text" v-html="renderMarkdown(msg.content)"></div>
            </div>
          </div>

          <div v-if="isLoading" class="message assistant loading">
            <div class="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>

        <div class="chat-input-area">
          <label class="screenshot-toggle">
            <input type="checkbox" v-model="includeScreenshot" />
            Dołącz screenshot tablicy
          </label>

          <div v-if="pendingSnapshot" class="snapshot-preview">
            <img :src="pendingSnapshot" alt="Preview" />
            <button class="remove-snapshot" @click="pendingSnapshot = null">×</button>
          </div>

          <div class="input-row">
            <button
              class="snap-btn"
              @click="captureSnapshot"
              :disabled="isLoading"
              title="Zrób screenshot"
            >
              <component :is="CameraIcon" class="icon" />
            </button>

            <div class="input-wrapper">
              <textarea
                v-model="userInput"
                @keydown="onKeyDown"
                placeholder="Napisz wiadomość..."
                rows="2"
                ref="inputRef"
              ></textarea>
              <div v-if="suggestionTail" class="ghost" aria-hidden="true">
                <span>{{ userInput }}</span
                ><span class="ghost-tail">{{ suggestionTail }}</span>
              </div>
            </div>

            <button
              class="send-btn"
              @click="sendMessage('normal_chat')"
              :disabled="isLoading || (!userInput.trim() && !pendingSnapshot)"
            >
              <component :is="SendIcon" class="icon" />
            </button>
          </div>
        </div>
      </div>

      <!-- Board Agent Tab -->
      <div v-if="activeTab === 'agent'" class="tab-content agent-tab">
        <div class="agent-content">
          <div v-if="agentLastReply" class="agent-reply">
            <div class="reply-bubble" v-html="renderMarkdown(agentLastReply)"></div>
          </div>

          <div v-if="agentLoading" class="agent-status-panel">
            <div class="status-row">
              <div class="typing-indicator">
                <span></span><span></span><span></span>
              </div>
              <span class="status-text">{{ aiState.currentStatus }}</span>
            </div>
            <div class="elapsed-time">{{ formatElapsed(aiState.elapsedMs) }}</div>
          </div>

          <div v-else-if="!agentLastReply" class="empty-state">
            <p>Wybierz akcję lub wpisz polecenie dla agenta.</p>
          </div>

          <div class="quick-actions">
            <button
              @click="triggerAgentAction('Narysuj wykres funkcji sin(x) w zakresie od -2π do 2π')"
              :disabled="agentLoading"
              title="Wykres sin(x)"
            >
              📈 Wykres sin(x)
            </button>
            <button
              @click="triggerAgentAction('Wklej na tablicę wzory na twierdzenie sinusów i cosinusów w LaTeX')"
              :disabled="agentLoading"
              title="Wzory trygonometryczne"
            >
              📝 Wzory trig.
            </button>
            <button
              @click="triggerAgentAction('Znajdź równanie na tablicy i rozwiąż je, pokaż kroki rozwiązania')"
              :disabled="agentLoading"
              title="Rozwiąż równanie z tablicy"
            >
              🧮 Rozwiąż
            </button>
          </div>
        </div>

        <div class="chat-input-area">
          <div class="model-selector">
            <select v-model="selectedModel" class="model-select">
              <option value="x-ai/grok-4.1-fast">🚀 High (Grok 4.1)</option>
              <option value="deepseek/deepseek-v3.2">⚡ Medium (DeepSeek)</option>
              <option value="openai/gpt-oss-120b:exacto">🧠 GPT-120B (Exacto)</option>
              <option value="kwaipilot/kat-coder-pro:free">💡 Low (Kat Coder)</option>
            </select>
            <label
              class="screenshot-toggle-mini"
              title="Dołącz widok tablicy (dla modeli wizyjnych)"
            >
              <input type="checkbox" v-model="includeScreenshotAgent" />
              <component :is="ImageIcon" class="icon-small" />
            </label>
          </div>

          <div class="input-row">
            <div class="input-wrapper">
              <textarea
                v-model="agentInput"
                @keydown.enter.prevent="submitAgent"
                placeholder="Np. 'Wyrównaj te klocki'..."
                rows="2"
              ></textarea>
            </div>
            <button
              class="send-btn"
              @click="submitAgent"
              :disabled="agentLoading || !agentInput.trim()"
            >
              <component :is="SendIcon" class="icon" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, computed } from 'vue';
import {
  Sparkles,
  Minus,
  Maximize2,
  Camera,
  Send,
  Image as ImageIconRaw,
} from 'lucide-vue-next';
import html2canvas from 'html2canvas';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { resolveBackendBaseUrl } from '../services/backendUrl';
import { useAiStore } from '../composables/useAiStore';

const API_BASE = resolveBackendBaseUrl();
const REQUEST_TIMEOUT_MS =
  Number(import.meta?.env?.VITE_AI_CHAT_TIMEOUT_MS) || 60000;

// Icons
const SparklesIcon = Sparkles;
const MinimizeIcon = Minus;
const MaximizeIcon = Maximize2;
const CameraIcon = Camera;
const SendIcon = Send;
const ImageIcon = ImageIconRaw;

const props = defineProps({
  whiteboardRef: {
    type: [Object, null],
    default: null,
  },
  roomId: {
    type: String,
    required: true,
  },
  wsToken: {
    type: String,
    default: null,
  },
});

const isMinimized = ref(false);
const activeTab = ref('agent'); // 'agent' | 'chat' - Board Agent is default

// Chat state
const isLoading = ref(false);
const includeScreenshot = ref(true);
const messages = ref([]);
const userInput = ref('');
const assistantSuggestion = ref('');
const suggestionTail = ref('');
const pendingSnapshot = ref(null);
const messagesContainer = ref(null);
const inputRef = ref(null);
const sentIntro = ref(false);

// Agent state
const agentInput = ref('');
const selectedModel = ref('x-ai/grok-4.1-fast'); // Default to Grok 4.1 (High)
const includeScreenshotAgent = ref(true);

const boardId = computed(() => props.roomId || '');
const { state: aiState, runBoardAssistant } = useAiStore();
const agentLoading = computed(() => aiState.isRunning);
const agentLastReply = computed(() => aiState.lastReply);

// Format elapsed time as "X.Xs" or "Xm Xs"
const formatElapsed = (ms) => {
  if (!ms) return '';
  const seconds = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  if (seconds < 60) {
    return `${seconds}.${tenths}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const toggleMinimize = () => {
  isMinimized.value = !isMinimized.value;
  if (!isMinimized.value && !sentIntro.value && activeTab.value === 'chat') {
    sendMessage('screenshot_intro');
  }
};

// --- Chat logic ---

const renderMarkdown = (text) => {
  if (!text) return '';

  let withLatex = text;

  // \[ ... \] display
  withLatex = withLatex.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) =>
    katex.renderToString(expr, { displayMode: true, throwOnError: false }),
  );

  // \( ... \) inline
  withLatex = withLatex.replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) =>
    katex.renderToString(expr, { displayMode: false, throwOnError: false }),
  );

  // $$ ... $$ display
  withLatex = withLatex.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) =>
    katex.renderToString(expr, { displayMode: true, throwOnError: false }),
  );

  // $ ... $ inline
  withLatex = withLatex.replace(/\$([^$\n]+?)\$/g, (_, expr) =>
    katex.renderToString(expr, { displayMode: false, throwOnError: false }),
  );

  const html = marked.parse(withLatex);
  return DOMPurify.sanitize(html);
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

const captureSnapshot = async () => {
  const targetEl =
    props.whiteboardRef?.containerRef ||
    document.querySelector('.whiteboard-container');
  if (!targetEl) return null;

  // 7.2: Use finally block to guarantee opacity restore
  const panel = document.querySelector('.ai-chat-panel');
  try {
    if (panel) panel.style.opacity = '0';

    const canvas = await html2canvas(targetEl, { useCORS: true, scale: 1 });

    const dataUrl = canvas.toDataURL('image/png');
    pendingSnapshot.value = dataUrl;
    return dataUrl;
  } catch (error) {
    console.error('Snapshot failed:', error);
    return null;
  } finally {
    if (panel) panel.style.opacity = '1';
  }
};

const buildHistory = () =>
  messages.value
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

const updateSuggestion = (answer) => {
  assistantSuggestion.value = answer || '';
  const prefix = userInput.value;
  if (assistantSuggestion.value.startsWith(prefix)) {
    suggestionTail.value = assistantSuggestion.value.slice(prefix.length);
  } else {
    suggestionTail.value = assistantSuggestion.value;
  }
};

const fetchWithTimeout = async (url, options = {}, timeout = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

const sendMessage = async (mode = 'normal_chat') => {
  const text = userInput.value.trim();
  const attachingScreenshot = includeScreenshot.value || mode === 'screenshot_intro';

  if (!text && !pendingSnapshot.value && mode === 'normal_chat') return;

  // 7.1: Save user message data but push to messages AFTER successful pre-checks
  const userMsg = mode === 'normal_chat' ? {
    role: 'user',
    content: text,
    image: pendingSnapshot.value,
  } : null;
  if (userMsg) messages.value.push(userMsg);

  const history = buildHistory();
  const screenshotDataUrl =
    attachingScreenshot && pendingSnapshot.value
      ? pendingSnapshot.value
      : attachingScreenshot
      ? await captureSnapshot()
      : null;

  userInput.value = '';
  pendingSnapshot.value = null;
  isLoading.value = true;
  scrollToBottom();

  try {
    const payload = {
      history,
      message: mode === 'normal_chat' ? text : '',
      includeScreenshot: Boolean(attachingScreenshot && screenshotDataUrl),
      screenshotDataUrl: attachingScreenshot ? screenshotDataUrl : null,
      mode,
    };

    const headers = { 'Content-Type': 'application/json' };
    if (props.wsToken) headers['X-Board-Token'] = props.wsToken;

    const response = await fetchWithTimeout(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errText = await response.text();
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.fallback) {
          messages.value.push({
            role: 'assistant',
            content: parsed.fallback,
          });
          return;
        }
        errText = parsed?.error || errText;
      } catch {
        // ignore JSON parse error
      }
      throw new Error(`API ${response.status}: ${errText}`);
    }

    const data = await response.json();
    messages.value.push({
      role: 'assistant',
      content: data.answer || data.fallback || 'Brak odpowiedzi',
    });
    updateSuggestion(data.answer || '');
    sentIntro.value = true;
  } catch (error) {
    console.error('AI Chat Error:', error);
    // 7.1: Remove user message on error to avoid orphaned messages
    if (userMsg) {
      const idx = messages.value.indexOf(userMsg);
      if (idx !== -1) messages.value.splice(idx, 1);
    }
    const fallbackMessage =
      error && error.name === 'AbortError'
        ? 'AI nie odpowiedziało na czas. Spróbuj ponownie.'
        : 'Wystąpił błąd po stronie AI.';
    messages.value.push({ role: 'assistant', content: fallbackMessage });
    assistantSuggestion.value = '';
    suggestionTail.value = '';
  } finally {
    isLoading.value = false;
    scrollToBottom();
    nextTick(() => inputRef.value?.focus());
  }
};

const onKeyDown = (e) => {
  if (e.key === 'Tab' && suggestionTail.value) {
    e.preventDefault();
    userInput.value = assistantSuggestion.value;
    assistantSuggestion.value = '';
    suggestionTail.value = '';
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage('normal_chat');
  }
};

// --- Agent logic ---

const getViewport = () => {
  if (!props.whiteboardRef) return undefined;

  const { panOffset, zoomLevel, canvasWidth, canvasHeight } = props.whiteboardRef;
  if (!panOffset || !zoomLevel) return undefined;

  return {
    x: panOffset.x,
    y: panOffset.y,
    width: canvasWidth,
    height: canvasHeight,
    zoom: zoomLevel,
  };
};

const submitAgent = async () => {
  if (!agentInput.value.trim()) return;

  const msg = agentInput.value;
  agentInput.value = '';

  try {
    const snapshot = includeScreenshotAgent.value ? await captureSnapshot() : null;
    await runBoardAssistant(
      boardId.value,
      msg,
      getViewport(),
      snapshot,
      selectedModel.value,
      props.wsToken,
    );
  } catch (e) {
    console.error(e);
  }
};

const triggerAgentAction = async (prompt) => {
  try {
    const snapshot = includeScreenshotAgent.value ? await captureSnapshot() : null;
    await runBoardAssistant(
      boardId.value,
      prompt,
      getViewport(),
      snapshot,
      selectedModel.value,
      props.wsToken,
    );
  } catch (e) {
    console.error(e);
  }
};

</script>

<style scoped>
.ai-chat-panel {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 380px;
  height: 600px;
  max-height: 80vh;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 10px 40px -10px rgba(0, 0, 0, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.2);
  display: flex;
  flex-direction: column;
  z-index: 1050;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  border-radius: 24px;
}

.dark-mode .ai-chat-panel {
  background: rgba(30, 41, 59, 0.85);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow:
    0 10px 40px -10px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.05);
}

.ai-chat-panel.minimized {
  height: 40px;
  width: 180px;
  border-radius: 20px;
  cursor: pointer;
}

.chat-header {
  height: 40px;
  padding: 0 16px;
  background: transparent;
  color: var(--text-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.ai-chat-panel.minimized .chat-header {
  border-bottom: none;
}

.dark-mode .chat-header {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.header-title .icon {
  color: #8b5cf6;
}

.header-controls {
  display: flex;
  gap: 8px;
}

.control-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.control-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-primary);
}

.dark-mode .control-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.tabs {
  display: flex;
  padding: 8px 16px 0;
  gap: 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.tab-btn {
  background: none;
  border: none;
  padding: 8px 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-btn.active {
  color: #6366f1;
  border-bottom-color: #6366f1;
}

.dark-mode .tab-btn.active {
  color: #818cf8;
  border-bottom-color: #818cf8;
}

.chat-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(248, 250, 252, 0.5);
}

.dark-mode .chat-body {
  background: rgba(15, 23, 42, 0.3);
}

.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-behavior: smooth;
}

.agent-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-state {
  text-align: center;
  color: var(--text-secondary);
  margin-top: 60px;
  font-size: 14px;
  padding: 0 20px;
}

.sub-text {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 8px;
}

.message {
  display: flex;
  flex-direction: column;
  max-width: 88%;
  animation: slideIn 0.3s ease-out forwards;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message.user {
  align-self: flex-end;
}

.message.assistant {
  align-self: flex-start;
}

.message-content {
  padding: 12px 16px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
}

.message.user .message-content {
  background: #6366f1;
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
  background: white;
  color: var(--text-primary);
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-bottom-left-radius: 4px;
}

.dark-mode .message.assistant .message-content {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.05);
}

.message-content :deep(p) {
  margin: 0 0 8px 0;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(pre) {
  background: rgba(0, 0, 0, 0.1);
  padding: 10px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-content :deep(code) {
  font-family: 'Fira Code', monospace;
  background: rgba(0, 0, 0, 0.1);
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}

/* KaTeX */
.message-content :deep(.katex) {
  font-size: 1.1em;
}

.message.user .message-content :deep(.katex) {
  color: white;
}

.message.assistant .message-content :deep(.katex) {
  color: inherit;
}

.message-image {
  margin-bottom: 8px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.message-image img {
  display: block;
  max-width: 100%;
  height: auto;
}

.chat-input-area {
  padding: 16px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

.dark-mode .chat-input-area {
  background: rgba(30, 41, 59, 0.8);
  border-top-color: rgba(255, 255, 255, 0.05);
}

.model-selector {
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-select {
  flex: 1;
  padding: 8px 12px;
  padding-right: 32px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: all 0.2s;
}

.model-select:hover {
  border-color: #cbd5e1;
  background-color: #f8fafc;
}

.model-select:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.model-select option {
  padding: 10px;
  background: #fff;
  color: #1e293b;
}

.dark-mode .model-select {
  background-color: #1e293b;
  border-color: #334155;
  color: #f1f5f9;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
}

.dark-mode .model-select:hover {
  border-color: #475569;
  background-color: #334155;
}

.dark-mode .model-select:focus {
  border-color: #818cf8;
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.15);
}

.dark-mode .model-select option {
  background: #1e293b;
  color: #f1f5f9;
}

.screenshot-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  cursor: pointer;
  user-select: none;
}

.screenshot-toggle input {
  accent-color: #6366f1;
}

.screenshot-toggle-mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.screenshot-toggle-mini input {
  accent-color: #6366f1;
}

.icon-small {
  width: 16px;
  height: 16px;
}

.snapshot-preview {
  position: relative;
  display: inline-block;
  margin-bottom: 12px;
}

.snapshot-preview img {
  height: 80px;
  border-radius: 8px;
  border: 1px solid var(--glass-border, rgba(148, 163, 184, 0.3));
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.remove-snapshot {
  position: absolute;
  top: -8px;
  right: -8px;
  background: #ef4444;
  color: white;
  border: 2px solid white;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.input-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  background: white;
  padding: 8px;
  border-radius: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.dark-mode .input-row {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.05);
}

.input-wrapper {
  position: relative;
  flex: 1;
}

textarea {
  width: 100%;
  padding: 8px 0;
  border: none;
  background: transparent;
  resize: none;
  font-family: inherit;
  font-size: 14px;
  color: var(--text-primary);
  outline: none;
  max-height: 100px;
}

.ghost {
  display: none; /* jeśli chcesz podgląd, zmień na position:absolute i ustaw przez CSS */
}

.ghost-tail {
  color: rgba(148, 163, 184, 0.5);
}

.snap-btn,
.send-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  color: var(--text-secondary);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.snap-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
}

.send-btn {
  background: #6366f1;
  color: white;
}

.send-btn:hover {
  background: #4f46e5;
  transform: scale(1.05);
}

.send-btn:disabled {
  background: #e2e8f0;
  color: #94a3b8;
  cursor: not-allowed;
  transform: none;
}

.dark-mode .send-btn:disabled {
  background: #334155;
  color: #64748b;
}

.typing-indicator span {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #94a3b8;
  border-radius: 50%;
  margin: 0 2px;
  animation: bounce 1.4s infinite ease-in-out both;
}

.typing-indicator span:nth-child(1) {
  animation-delay: -0.32s;
}
.typing-indicator span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
  }

  40% {
    transform: scale(1);
  }
}

/* Agent styles */
.agent-reply {
  margin-bottom: 8px;
}

.reply-bubble {
  background: #f0f7ff;
  padding: 10px;
  border-radius: 8px;
  font-size: 14px;
  color: #333;
  border-left: 3px solid #6366f1;
}

.dark-mode .reply-bubble {
  background: #1e293b;
  color: #ddd;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-actions button {
  font-size: 12px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.05);
  border: none;
  border-radius: 16px;
  cursor: pointer;
  transition: background 0.2s;
  color: var(--text-primary);
}

.quick-actions button:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
}

.dark-mode .quick-actions button {
  background: rgba(255, 255, 255, 0.05);
}

.dark-mode .quick-actions button:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.2);
}

/* Agent Status Panel - Real-time feedback */
.agent-status-panel {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1));
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-text {
  font-size: 13px;
  font-weight: 500;
  color: #6366f1;
}

.dark-mode .status-text {
  color: #a5b4fc;
}

.elapsed-time {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 8px;
  font-family: 'Monaco', 'Menlo', monospace;
}

.agent-status-panel .typing-indicator {
  display: flex;
  gap: 4px;
}

.agent-status-panel .typing-indicator span {
  width: 6px;
  height: 6px;
  background: #6366f1;
  border-radius: 50%;
  animation: bounce 1.2s infinite ease-in-out;
}

.agent-status-panel .typing-indicator span:nth-child(2) {
  animation-delay: 0.15s;
}

.agent-status-panel .typing-indicator span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  40% {
    transform: scale(1.2);
    opacity: 1;
  }
}
</style>
