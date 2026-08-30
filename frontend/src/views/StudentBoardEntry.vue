<template>
  <div class="student-shell">
    <div class="center-content fade-in">
      <div class="minimal-card entry-card">
        <header class="card-header">
          <p class="eyebrow">Zaproszenie</p>
          <h1>{{ boardTitle }}</h1>
        </header>

        <div class="meta-grid">
          <div class="meta-item">
            <span class="label">Nauczyciel</span>
            <span class="value">{{ boardInfo?.teacherName || '...' }}</span>
          </div>
          <div class="meta-item right">
            <span class="label">Uczeń</span>
            <span class="value">{{ boardInfo?.studentName || 'Ty' }}</span>
          </div>
        </div>

        <div v-if="loading" class="state-box loading">
          <div class="spinner"></div> Ładowanie...
        </div>

        <div v-else-if="error" class="state-box error">
          {{ error }}
        </div>

        <div v-else class="card-body">
          <div class="info-row">
             <div class="term-info">
               <span class="label-sm">Ważne do:</span>
               <span class="value-mono">{{ validUntil }}</span>
             </div>
          </div>

          <div class="actions">
            <div v-if="connectionStatus === 'reconnecting' || connectionStatus === 'disconnected'" class="status-msg">
              Łączenie...
            </div>
            <button class="btn-primary full-width big-btn" :disabled="loading || !boardInfo" @click="startBoard">
              Dołącz do lekcji
            </button>
          </div>
        </div>

        <!-- Hidden canvas pre-loader -->
        <div v-if="showCanvas" class="hidden-canvas">
          <WhiteboardCanvas
            :room-id="boardInfo?.roomId"
            :username="boardInfo?.studentName || 'Uczeń'"
            :room-key="null"
            :ws-token="boardInfo?.wsToken"
            :on-connection-status="handleStatus"
          />
        </div>
      </div>
      
      <p class="footer-brand">WhiteVue Student</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import WhiteboardCanvas from '../components/WhiteboardCanvas.vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

const props = defineProps({ slug: { type: String, required: true } });
const apiBase = resolveBackendBaseUrl();

const boardInfo = ref(null);
const loading = ref(false);
const error = ref('');
const showCanvas = ref(false);
const connectionStatus = ref('connecting');

const boardTitle = computed(() => boardInfo.value?.title || 'Tablica');
const validUntil = computed(() => {
  try { return boardInfo.value?.validUntil ? new Date(boardInfo.value.validUntil).toLocaleDateString() : 'Bezterminowo'; }
  catch { return '---'; }
});

const fetchBoard = async () => {
  loading.value = true; error.value = '';
  try {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    const res = await fetch(`${apiBase}/api/board/${props.slug}?token=${encodeURIComponent(token)}`, { credentials: 'include' });
    // Expiry, revocation and deactivation are DENIALS from CapabilityAccess:
    // show the server's Polish message instead of a half-loaded board.
    if (!res.ok) {
      let message = 'Link jest nieprawidłowy lub wygasł.';
      try {
        const body = await res.json();
        if (typeof body.error === 'string' && body.error) message = body.error;
      } catch { /* keep the fallback */ }
      throw new Error(message);
    }
    boardInfo.value = await res.json();
  } catch (err) { error.value = err.message; }
  finally { loading.value = false; }
};

onMounted(fetchBoard);

const startBoard = () => {
  if (!boardInfo.value) return;
  const params = new URLSearchParams({
    room: boardInfo.value.roomId,
    wsToken: boardInfo.value.wsToken,
    name: boardInfo.value.studentName || 'Uczeń'
  });
  window.location.href = `/?${params.toString()}`;
};

const handleStatus = (s) => connectionStatus.value = s;
</script>

<style scoped>
.student-shell {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background-color: var(--bg-base);
}
.center-content { width: 100%; max-width: 420px; text-align: center; }

.entry-card { text-align: left; background: var(--bg-surface); padding: 40px; box-shadow: 0 10px 40px -10px rgba(0,0,0,0.1); border-radius: 16px; border: 1px solid var(--border-subtle); }

.card-header { margin-bottom: 24px; text-align: center; }
.eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--accent-primary); font-weight: 700; margin-bottom: 8px; }
h1 { font-size: 26px; margin: 0; color: var(--text-primary); font-weight: 700; }

.meta-grid {
  display: flex; justify-content: space-between;
  padding: 20px 0; border-top: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 24px;
}
.meta-item { display: flex; flex-direction: column; gap: 4px; }
.meta-item.right { align-items: flex-end; }
.label { font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; }
.value { font-size: 15px; color: var(--text-primary); font-weight: 600; }

.info-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.term-info { display: flex; gap: 8px; align-items: baseline; }
.label-sm { font-size: 13px; color: var(--text-secondary); }
.value-mono { font-family: monospace; color: var(--text-primary); font-size: 14px; font-weight: 500; }

.big-btn { height: 48px; font-size: 16px; font-weight: 600; }
.full-width { width: 100%; }

.footer-brand { margin-top: 24px; font-size: 12px; color: var(--text-tertiary); }

.state-box { padding: 24px; text-align: center; background: var(--bg-surface-hover); border-radius: 8px; color: var(--text-secondary); font-size: 14px; }
.state-box.error { color: var(--danger); background: #fef2f2; border: 1px solid #fee2e2; }
.hidden-canvas { display: none; }
</style>
