<template>
  <teleport to="body">
    <div v-if="visible" class="room-manager-overlay" @keydown.esc="requestClose">
      <div class="room-manager-dialog" role="dialog" aria-modal="true">
        <header class="dialog-header">
          <div>
            <h2>Room Manager</h2>
            <p class="subtitle">Create, browse, and manage collaborative rooms.</p>
          </div>
          <button class="close-btn" @click="requestClose" aria-label="Close room manager">×</button>
        </header>

        <section class="section section-grid">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Launch a room</h3>
                <p>Create a dedicated space for your workshop, retro, or tutoring session.</p>
              </div>
              <div v-if="createHint" class="status-chip success">{{ createHint }}</div>
            </div>
            <form class="create-form" @submit.prevent="handleCreateRoom">
              <label class="input-field">
                <span>Room name</span>
                <input
                  v-model="createForm.displayName"
                  type="text"
                  placeholder="e.g. Product Sprint Retro"
                  maxlength="255"
                />
              </label>
              <label class="input-field">
                <span>Owner label (optional)</span>
                <input
                  v-model="createForm.ownerName"
                  type="text"
                  placeholder="Displayed to collaborators"
                  maxlength="255"
                />
              </label>
              <label class="input-field">
                <span>Custom room ID (optional)</span>
                <input
                  v-model="createForm.roomId"
                  type="text"
                  placeholder="Leave empty to auto-generate"
                  maxlength="255"
                />
              </label>
              <div class="create-actions">
                <button type="submit" class="primary" :disabled="isCreating">
                  {{ isCreating ? 'Creating...' : 'Create room' }}
                </button>
              </div>
              <p v-if="createError" class="error-text">{{ createError }}</p>
              <div v-if="createdRoomSecret" class="secret-banner">
                <strong>Owner secret:</strong>
                <code>{{ createdRoomSecret }}</code>
                <span>Save this token to rename or archive the room later.</span>
              </div>
            </form>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h3>Browse rooms</h3>
                <p>Jump into an existing collaboration space or reopen drafts.</p>
              </div>
              <div class="list-actions">
                <label class="checkbox">
                  <input type="checkbox" v-model="showArchived" />
                  <span>Show archived</span>
                </label>
                <button class="ghost" @click="loadRooms" :disabled="isLoading">
                  {{ isLoading ? 'Refreshing...' : 'Refresh' }}
                </button>
              </div>
            </div>

            <div class="search-box">
              <input
                v-model="searchTerm"
                type="search"
                placeholder="Search by name or ID"
                @keydown.stop
              />
            </div>

            <div v-if="managerError" class="error-banner">
              {{ managerError }}
            </div>

            <div v-if="!rooms.length && !isLoading" class="empty-state">
              <p>No rooms match your filters.</p>
            </div>

            <ul class="room-list">
              <li
                v-for="room in rooms"
                :key="room.roomId"
                :class="['room-row', { active: room.roomId === currentRoomId }]"
              >
                <div class="room-meta">
                  <div class="title-line">
                    <strong>{{ room.displayName }}</strong>
                    <span v-if="room.isArchived" class="badge">Archived</span>
                    <span v-else-if="room.roomId === currentRoomId" class="badge accent">Current</span>
                  </div>
                  <div class="meta-line">
                    <span>ID: {{ room.roomId }}</span>
                    <span>Users online: {{ room.onlineCount ?? 0 }}</span>
                    <span>Updated: {{ formatDate(room.updatedAt) }}</span>
                  </div>
                </div>
                <div class="room-actions">
                  <button class="ghost" @click="joinRoom(room)">Join</button>
                  <button class="ghost" @click="copyShareLink(room)">Copy link</button>
                  <button class="ghost" @click="promptRename(room)">Rename</button>
                  <button class="danger ghost" @click="promptArchive(room)" :disabled="room.isArchived">
                    Archive
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { archiveRoom, createRoom, fetchRooms, updateRoom } from '../services/roomService.js';

const OWNER_SECRET_KEY = 'whiteboard_room_owner_secrets';

const props = defineProps({
  visible: { type: Boolean, default: false },
  currentRoomId: { type: String, default: '' },
});

const emit = defineEmits(['update:visible', 'join-room']);

const rooms = ref([]);
const isLoading = ref(false);
const managerError = ref('');
const createError = ref('');
const createHint = ref('');
const createdRoomSecret = ref('');
const isCreating = ref(false);
const searchTerm = ref('');
const showArchived = ref(false);
const createForm = reactive({
  displayName: '',
  ownerName: '',
  roomId: '',
});

const ownerSecrets = ref(loadOwnerSecrets());
let searchDebounce = null;
// 7.8: AbortController to cancel stale search requests
let searchAbortController = null;
let createHintTimer = null;

const shareBaseUrl = computed(() => {
  if (typeof window === 'undefined') return '';
  const { origin, pathname } = window.location;
  const cleanPath = pathname.includes('?') ? pathname.split('?')[0] : pathname;
  return `${origin}${cleanPath}`;
});

const requestClose = () => emit('update:visible', false);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadRooms();
    } else {
      managerError.value = '';
      createHint.value = '';
    }
  },
);

watch([searchTerm, showArchived], () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  // 7.8: Abort previous in-flight search request
  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();
  const signal = searchAbortController.signal;
  searchDebounce = setTimeout(() => {
    loadRooms(signal);
  }, 300);
});

async function loadRooms(signal) {
  if (!props.visible) return;
  isLoading.value = true;
  managerError.value = '';
  try {
    const response = await fetchRooms({
      search: searchTerm.value.trim(),
      includeArchived: showArchived.value,
      limit: 40,
      signal, // 7.8: Pass abort signal to fetch
    });
    if (signal?.aborted) return; // Discard stale result
    rooms.value = Array.isArray(response?.rooms) ? response.rooms : [];
  } catch (error) {
    if (error?.name === 'AbortError') return; // 7.8: Ignore aborted requests
    rooms.value = [];
    managerError.value = error.payload?.error || error.message || 'Unable to load rooms right now.';
  } finally {
    if (!signal?.aborted) isLoading.value = false;
  }
}

async function handleCreateRoom() {
  createError.value = '';
  createHint.value = '';
  createdRoomSecret.value = '';
  isCreating.value = true;
  try {
    const payload = {
      displayName: createForm.displayName.trim() || undefined,
      ownerName: createForm.ownerName.trim() || undefined,
      roomId: createForm.roomId.trim() || undefined,
    };
    const room = await createRoom(payload);
    createdRoomSecret.value = room.ownerSecret;
    rememberOwnerSecret(room.roomId, room.ownerSecret);
    rooms.value = [room, ...rooms.value.filter((r) => r.roomId !== room.roomId)];
    createForm.displayName = '';
    createForm.ownerName = '';
    createForm.roomId = '';
    createHint.value = 'Room created';
    if (createHintTimer) clearTimeout(createHintTimer);
    createHintTimer = setTimeout(() => {
      createHint.value = '';
    }, 3000);
  } catch (error) {
    createError.value = error.payload?.error || error.message || 'Failed to create room.';
  } finally {
    isCreating.value = false;
  }
}

function joinRoom(room) {
  emit('join-room', room);
}

async function promptRename(room) {
  const secret = ensureOwnerSecret(room.roomId);
  if (!secret) return;

  const newName = window.prompt('Enter new room name', room.displayName);
  if (!newName || newName.trim() === room.displayName) return;

  try {
    const updated = await updateRoom(room.roomId, { displayName: newName.trim() }, secret);
    replaceRoom(updated);
  } catch (error) {
    alert(error.message || 'Unable to rename room.');
  }
}

async function promptArchive(room) {
  if (room.isArchived) return;
  const secret = ensureOwnerSecret(room.roomId);
  if (!secret) return;
  const confirmed = window.confirm(`Archive "${room.displayName}"? Collaborators will only be able to view the last snapshot.`);
  if (!confirmed) return;

  try {
    const updated = await archiveRoom(room.roomId, secret);
    replaceRoom(updated);
  } catch (error) {
    alert(error.message || 'Unable to archive room.');
  }
}

function copyShareLink(room) {
  const url = `${shareBaseUrl.value}?room=${room.roomId}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      // no-op success toast at parent level
    }).catch(() => fallbackCopy(url));
  } else {
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  } catch (error) {
    console.error('Clipboard fallback failed', error);
  }
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function replaceRoom(updated) {
  rooms.value = rooms.value.map((room) =>
    room.roomId === updated.roomId ? updated : room,
  );
}

function ensureOwnerSecret(roomId) {
  let secret = ownerSecrets.value[roomId];
  if (!secret) {
    const input = window.prompt('Enter the owner secret for this room');
    if (!input) return null;
    secret = input.trim();
    rememberOwnerSecret(roomId, secret);
  }
  return secret;
}

function rememberOwnerSecret(roomId, secret) {
  if (!secret) return;
  ownerSecrets.value = { ...ownerSecrets.value, [roomId]: secret };
  localStorage.setItem(OWNER_SECRET_KEY, JSON.stringify(ownerSecrets.value));
}

function loadOwnerSecrets() {
  try {
    const raw = localStorage.getItem(OWNER_SECRET_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn('Failed to parse stored room secrets', error);
    return {};
  }
}

onMounted(() => {
  if (props.visible) {
    loadRooms();
  }
});

onBeforeUnmount(() => {
  if (searchDebounce) clearTimeout(searchDebounce);
  if (createHintTimer) clearTimeout(createHintTimer);
  if (searchAbortController) searchAbortController.abort();
});
</script>

<style scoped>
.room-manager-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.room-manager-dialog {
  background: var(--dialog-bg, #ffffff);
  color: var(--text-color, #222);
  width: min(960px, 100%);
  max-height: 95vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}

.dialog-header {
  padding: 20px 28px;
  border-bottom: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-header h2 {
  margin: 0;
  font-size: 1.4rem;
}

.subtitle {
  margin: 4px 0 0;
  color: var(--text-color-secondary, #666);
}

.close-btn {
  font-size: 24px;
  line-height: 1;
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
}

.section {
  padding: 20px 28px;
  overflow-y: auto;
}

.section-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}

.panel {
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 16px;
  padding: 20px;
  background: var(--panel-bg, #f9fafb);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.panel-header h3 {
  margin: 0;
}

.status-chip {
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
}

.status-chip.success {
  background: rgba(34, 197, 94, 0.15);
  color: #15803d;
}

.create-form {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.input-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.9rem;
}

.input-field input {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.15));
  font-size: 0.95rem;
}

.create-actions {
  display: flex;
  align-items: flex-end;
}

.primary {
  background: var(--btn-primary-bg, #2563eb);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secret-banner {
  grid-column: 1 / -1;
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.2);
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 0.9rem;
}

.search-box input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.15));
}

.list-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.checkbox {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 0.9rem;
}

.ghost {
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
  background: transparent;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.error-banner {
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
  border: 1px solid rgba(220, 38, 38, 0.2);
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.ghost {
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.2));
  background: transparent;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.room-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.room-row {
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.12));
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.room-row.active {
  border-color: var(--accent-color, #2563eb);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.room-meta {
  flex: 1;
}

.title-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.meta-line {
  color: var(--text-color-secondary, #666);
  font-size: 0.85rem;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

.room-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.badge {
  background: rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 0.75rem;
}

.badge.accent {
  background: rgba(37, 99, 235, 0.15);
  color: #1d4ed8;
}

.danger {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.4);
}

.error-text {
  color: #dc2626;
  font-size: 0.9rem;
  margin-top: 8px;
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: var(--text-color-secondary, #666);
}

@media (max-width: 720px) {
  .room-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .list-actions {
    width: 100%;
    justify-content: space-between;
  }

  .room-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
