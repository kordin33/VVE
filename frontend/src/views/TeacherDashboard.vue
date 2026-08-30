<template>
  <div class="teacher-soft-shell">
    <header class="dash-head">
      <div>
        <p class="eyebrow">WhiteVue Pilot</p>
        <h1 class="dash-title">Moje tablice</h1>
        <p class="muted">Twórz lekcje i zarządzaj dostępem uczniów.</p>
      </div>
      <div class="head-tools">
        <button class="soft-btn quiet icon" :disabled="loading" title="Odśwież" @click="refresh">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
        </button>
        <button class="soft-btn accent" @click="showCreate = true">Nowa tablica</button>
      </div>
    </header>

    <main class="soft-card list-card">
      <div class="filters">
        <input v-model="query" type="text" class="soft-input search" placeholder="Szukaj ucznia lub tematu…" />
        <div class="soft-select-well">
          <select v-model="statusFilter" class="soft-select">
            <option value="all">Wszystkie statusy</option>
            <option value="active">Aktywne</option>
            <option value="archived">Zarchiwizowane</option>
            <option value="expired">Po terminie</option>
          </select>
        </div>
      </div>

      <!-- Load failure is an ERROR state, never a masked empty list. -->
      <div v-if="loadError" class="list-state">
        <p class="soft-alert wide" role="alert">{{ loadError }}</p>
        <button class="soft-btn quiet" @click="fetchBoards">Spróbuj ponownie</button>
      </div>

      <div v-else-if="loading" class="list-state">
        <div class="spinner-well"><div class="spinner"></div></div>
        <p class="muted">Ładowanie tablic…</p>
      </div>

      <div v-else-if="!filteredBoards.length" class="list-state">
        <p class="muted">Brak tablic do wyświetlenia.</p>
        <p class="muted small">Utwórz pierwszą tablicę przyciskiem „Nowa tablica”.</p>
      </div>

      <ul v-else class="board-rows">
        <li v-for="board in filteredBoards" :key="board.id" class="board-row" :class="{ off: board.archived_at }">
          <div class="row-main">
            <div class="row-id">
              <span class="status-pip" :class="pipClass(board)"></span>
              <div>
                <p class="row-name">{{ board.title || 'Bez tytułu' }}</p>
                <p class="row-sub mono">Uczeń: {{ board.student_name || 'bez etykiety' }}</p>
              </div>
            </div>
            <div class="row-side">
              <p class="row-date mono" :class="{ late: daysLeft(board.valid_until) < 3 && !board.archived_at }">
                {{ formatDate(board.valid_until) }}
              </p>
              <span v-if="board.archived_at" class="pill">Archiwum</span>
              <span v-else-if="isExpired(board)" class="pill late">Po terminie</span>
              <span v-else class="pill ok">Aktywna</span>
            </div>
          </div>

          <!-- Keyway: the current Board Access Link — copy only, never rotated by viewing. -->
          <div class="keyway">
            <div class="keyway-top">
              <span class="keyway-label">Link dostępu dla ucznia</span>
              <div class="keyway-actions">
                <button
                  class="soft-btn mini"
                  :class="{ copied: copiedId === board.id }"
                  @click="copy(board.student_url, board.id)"
                >
                  {{ copiedId === board.id ? 'Skopiowano' : 'Kopiuj' }}
                </button>
                <button class="soft-btn mini quiet2" title="Otwórz podgląd tablicy" @click="openBoard(board.student_url)">Podgląd</button>
              </div>
            </div>
            <div class="keyway-channel">{{ board.student_url }}</div>
          </div>
        </li>
      </ul>
    </main>

    <!-- Create modal -->
    <div v-if="showCreate" class="modal-backdrop" @click.self="closeCreate">
      <div class="soft-card modal-panel">
        <header class="modal-head">
          <h2 class="card-title">Nowa tablica</h2>
          <button class="soft-btn quiet icon" title="Zamknij" @click="closeCreate">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <label class="field-label" for="board-label">Etykieta ucznia / grupy</label>
        <input id="board-label" ref="labelInput" v-model="form.studentName" type="text" class="soft-input" placeholder="np. Kowalski — grupa A" @keydown.enter="createBoard" />

        <label class="field-label" for="board-title">Temat lekcji (opcjonalnie)</label>
        <input id="board-title" v-model="form.title" type="text" class="soft-input" placeholder="np. Ułamki zwykłe" @keydown.enter="createBoard" />

        <label class="field-label" for="board-valid">Ważne do (opcjonalnie)</label>
        <input id="board-valid" v-model="form.validUntil" type="date" class="soft-input" />

        <div v-if="createError" class="soft-alert" role="alert">{{ createError }}</div>

        <div v-if="createResult" class="keyway fresh">
          <div class="keyway-top">
            <span class="keyway-label">Nowy link dostępu dla ucznia</span>
            <button class="soft-btn mini" :class="{ copied: copiedId === 'new' }" @click="copy(createResult.studentLink, 'new')">
              {{ copiedId === 'new' ? 'Skopiowano' : 'Kopiuj' }}
            </button>
          </div>
          <div class="keyway-channel">{{ createResult.studentLink }}</div>
        </div>

        <footer class="modal-foot">
          <button class="soft-btn quiet" @click="closeCreate">Zamknij</button>
          <button v-if="!createResult" class="soft-btn accent" :disabled="!form.studentName || creating" @click="createBoard">
            {{ creating ? 'Tworzenie…' : 'Utwórz tablicę' }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

/**
 * Teacher dashboard (VVE-101): every request runs through the CapabilityAccess
 * HTTP adapter — a regenerated link or a deactivated teacher ends the session
 * on the very next request, surfaced here as a Polish error state instead of
 * a silently empty list. The student Board Access Link is COPY-ONLY: viewing
 * the dashboard never rotates it (story 18).
 */
const apiBase = resolveBackendBaseUrl();

const boards = ref([]);
const loading = ref(false);
const loadError = ref('');
const showCreate = ref(false);
const creating = ref(false);
const createError = ref('');
const createResult = ref(null);
const query = ref('');
const statusFilter = ref('active');
const copiedId = ref(null);
const labelInput = ref(null);

const form = reactive({ studentName: '', title: '', validUntil: '' });

const readError = async (res, fallback) => {
  try {
    const body = await res.json();
    return typeof body.error === 'string' && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
};

const fetchBoards = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await fetch(`${apiBase}/api/teacher/boards`, { credentials: 'include' });
    if (!res.ok) {
      loadError.value = await readError(res, 'Nie udało się pobrać tablic.');
      return;
    }
    const data = await res.json();
    boards.value = Array.isArray(data.boards) ? data.boards : [];
  } catch {
    loadError.value = 'Brak połączenia z serwerem. Nie udało się pobrać tablic.';
  } finally {
    loading.value = false;
  }
};

onMounted(fetchBoards);
const refresh = () => fetchBoards();

const daysLeft = (d) => (d ? Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24)) : 999);
const isExpired = (b) => b.valid_until && new Date(b.valid_until) < new Date();
const formatDate = (d) => {
  try {
    return d ? new Date(d).toLocaleDateString('pl-PL') : '—';
  } catch {
    return '—';
  }
};
const pipClass = (b) => (b.archived_at ? 'off' : isExpired(b) ? 'late' : 'on');

const filteredBoards = computed(() => {
  const q = query.value.toLowerCase().trim();
  return boards.value
    .filter((b) => {
      if (statusFilter.value === 'active' && (b.archived_at || isExpired(b))) return false;
      if (statusFilter.value === 'archived' && !b.archived_at) return false;
      if (statusFilter.value === 'expired' && !isExpired(b)) return false;
      return !q || `${b.title} ${b.student_name}`.toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
});

const copy = async (text, id) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* the channel keeps the full link selectable */
  }
  copiedId.value = id;
  setTimeout(() => (copiedId.value = null), 2000);
};
const openBoard = (url) => window.open(url, '_blank');

const createBoard = async () => {
  creating.value = true;
  createError.value = '';
  try {
    const res = await fetch(`${apiBase}/api/teacher/boards`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName: form.studentName, title: form.title, validUntil: form.validUntil })
    });
    if (!res.ok) {
      createError.value = await readError(res, 'Nie udało się utworzyć tablicy.');
      return;
    }
    createResult.value = await res.json();
    form.studentName = '';
    form.title = '';
    form.validUntil = '';
    fetchBoards();
  } catch {
    createError.value = 'Brak połączenia z serwerem. Nie udało się utworzyć tablicy.';
  } finally {
    creating.value = false;
  }
};

const closeCreate = () => {
  showCreate.value = false;
  createResult.value = null;
  createError.value = '';
};

watch(showCreate, (val) => {
  if (val) {
    createResult.value = null;
    createError.value = '';
    nextTick(() => labelInput.value?.focus());
  }
});
</script>

<style scoped>
/* Same structured Soft UI material as the Administrator console (VVE-101):
   one light source, raised cards, recessed keyway channels for credentials. */
.teacher-soft-shell {
  --soft-bg: #e4e9f2;
  --soft-surface: #e4e9f2;
  --soft-light: rgba(255, 255, 255, 0.92);
  --soft-dark: rgba(159, 173, 198, 0.58);
  --soft-ink: #1c2739;
  --soft-ink-2: #5a6b84;
  --soft-ink-3: #93a3ba;
  --soft-accent: #2f6fed;
  --soft-accent-ink: #f4f8ff;
  --soft-danger: #c23b4e;
  --soft-ok: #1f8a5b;
  --soft-late: #b7791f;
  --raise: 7px 7px 15px var(--soft-dark), -7px -7px 15px var(--soft-light);
  --raise-sm: 4px 4px 9px var(--soft-dark), -4px -4px 9px var(--soft-light);
  --press: inset 4px 4px 8px rgba(159, 173, 198, 0.5), inset -4px -4px 8px rgba(255, 255, 255, 0.85);
  --press-deep: inset 5px 5px 10px rgba(150, 165, 192, 0.55), inset -3px -3px 7px rgba(255, 255, 255, 0.7);

  min-height: 100vh;
  background: var(--soft-bg);
  color: var(--soft-ink);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  padding: 48px 32px 96px;
}

.eyebrow { font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 700; color: var(--soft-ink-3); margin: 0 0 6px; }
.muted { color: var(--soft-ink-2); font-size: 14px; margin: 0; }
.muted.small { font-size: 12.5px; }
.mono { font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 12px; }

.dash-head { max-width: 1080px; margin: 0 auto 32px; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.dash-title { font-size: 27px; font-weight: 800; margin: 0 0 8px; }
.head-tools { display: flex; gap: 12px; }

.soft-card { background: var(--soft-surface); border-radius: 20px; box-shadow: var(--raise); }
.card-title { font-size: 15.5px; font-weight: 700; margin: 0; }

.list-card { max-width: 1080px; margin: 0 auto; padding: 24px 26px 28px; }
.filters { display: flex; gap: 16px; margin-bottom: 22px; }
.search { flex: 0 1 320px; }
.soft-select-well { border-radius: 12px; box-shadow: var(--press); }
.soft-select {
  appearance: none;
  border: none;
  outline: none;
  background: transparent;
  box-shadow: none;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--soft-ink-2);
  font-family: inherit;
  cursor: pointer;
}

.soft-input {
  width: 100%;
  border: none;
  outline: none;
  border-radius: 12px;
  background: var(--soft-surface);
  box-shadow: var(--press);
  padding: 12px 16px;
  font-size: 14px;
  color: var(--soft-ink);
  font-family: inherit;
}
.soft-input:focus { box-shadow: var(--press), 0 0 0 2px rgba(47, 111, 237, 0.35); }
.soft-input::placeholder { color: var(--soft-ink-3); }

.soft-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  cursor: pointer;
  border-radius: 12px;
  padding: 11px 18px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--soft-ink-2);
  background: var(--soft-surface);
  box-shadow: var(--raise-sm);
  transition: box-shadow 0.15s ease, transform 0.15s ease, color 0.15s ease;
  font-family: inherit;
}
.soft-btn:hover:not(:disabled) { color: var(--soft-ink); }
.soft-btn:active:not(:disabled) { box-shadow: var(--press); transform: translateY(1px); }
.soft-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.soft-btn:focus-visible { outline: 2px solid rgba(47, 111, 237, 0.6); outline-offset: 2px; }
.soft-btn.accent { background: linear-gradient(145deg, #3d78f2, #2a63d8); color: var(--soft-accent-ink); box-shadow: 6px 6px 13px rgba(140, 160, 195, 0.55), -6px -6px 13px var(--soft-light); }
.soft-btn.accent:active:not(:disabled) { box-shadow: inset 4px 4px 9px rgba(20, 45, 100, 0.45); }
.soft-btn.quiet { padding: 9px 14px; font-size: 12.5px; }
.soft-btn.icon { padding: 9px; }
.soft-btn.mini { padding: 6px 12px; font-size: 11.5px; }
.soft-btn.mini.copied { color: var(--soft-ok); }
.soft-btn.mini.quiet2 { color: var(--soft-ink-3); }

.field-label { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--soft-ink-2); margin: 16px 0 8px; }

.soft-alert { border-radius: 12px; padding: 11px 14px; font-size: 13px; font-weight: 600; color: var(--soft-danger); box-shadow: var(--press-deep); margin: 0; }
.soft-alert.wide { margin: 0; }

.list-state { padding: 56px 20px; display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }

.board-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 20px; }
.board-row { border-radius: 18px; padding: 18px 20px; box-shadow: var(--raise-sm); }
.board-row.off { opacity: 0.62; }
.row-main { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.row-id { display: flex; align-items: center; gap: 13px; }
.row-name { font-size: 14.5px; font-weight: 700; margin: 0; }
.row-sub { color: var(--soft-ink-3); margin: 3px 0 0; font-size: 11.5px; }
.row-side { display: flex; align-items: center; gap: 12px; }
.row-date { color: var(--soft-ink-2); }
.row-date.late { color: var(--soft-late); font-weight: 700; }

.status-pip { width: 11px; height: 11px; border-radius: 50%; flex: none; }
.status-pip.on { background: var(--soft-ok); box-shadow: inset 2px 2px 3px rgba(10, 60, 38, 0.45), inset -2px -2px 3px rgba(160, 235, 200, 0.8); }
.status-pip.off { background: var(--soft-ink-3); }
.status-pip.late { background: var(--soft-late); }

.pill { font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 99px; padding: 4px 10px; box-shadow: var(--press-deep); color: var(--soft-ink-2); }
.pill.ok { color: var(--soft-ok); }
.pill.late { color: var(--soft-late); }

.keyway { margin-top: 14px; border-radius: 14px; padding: 11px 14px 13px; box-shadow: var(--press-deep); }
.keyway.fresh { box-shadow: var(--press-deep), 0 0 0 2px rgba(31, 138, 91, 0.35); }
.keyway-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.keyway-label { font-size: 10.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--soft-ink-3); }
.keyway-actions { display: flex; gap: 8px; }
.keyway-channel { font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 11.5px; line-height: 1.6; color: var(--soft-ink-2); word-break: break-all; user-select: all; }

/* Modal */
.modal-backdrop { position: fixed; inset: 0; background: rgba(28, 39, 57, 0.32); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.modal-panel { width: 100%; max-width: 460px; padding: 28px 30px; }
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.modal-foot { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }

.spinner-well { width: 52px; height: 52px; border-radius: 50%; box-shadow: var(--press); display: flex; align-items: center; justify-content: center; }
.spinner { width: 20px; height: 20px; border-radius: 50%; border: 3px solid rgba(47, 111, 237, 0.2); border-top-color: var(--soft-accent); animation: soft-spin 0.9s linear infinite; }
@keyframes soft-spin { to { transform: rotate(360deg); } }

@media (max-width: 720px) {
  .dash-head { flex-direction: column; align-items: flex-start; }
  .filters { flex-direction: column; }
  .search { flex: 1 1 auto; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 1.6s; }
  .soft-btn, .soft-input { transition: none; }
}
</style>
