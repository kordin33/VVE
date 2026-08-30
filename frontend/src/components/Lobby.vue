<template>
  <div class="lobby-container">
    <div class="lobby-card">
      <div class="logo-section">
        <div class="logo-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </div>
        <h1>WhiteVue</h1>
      </div>
      
      <p class="tagline">Real-time Collaborative Whiteboard</p>

      <div class="actions-section">
        <button class="btn-primary" @click="createRoom" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Create New Room
        </button>

        <div class="divider">
          <span>OR JOIN EXISTING</span>
        </div>

        <div class="join-section">
          <input 
            v-model="roomIdInput" 
            type="text" 
            placeholder="Enter Room ID" 
            @keyup.enter="joinRoom"
          />
          <button class="btn-secondary" @click="joinRoom" :disabled="!roomIdInput">
            Join
          </button>
        </div>
      </div>

      <div class="rooms-section">
        <div class="tabs">
          <button :class="{ active: activeTab === 'active' }" @click="activeTab = 'active'">Active Rooms</button>
          <button :class="{ active: activeTab === 'recent' }" @click="activeTab = 'recent'">Recent</button>
        </div>

        <div v-if="activeTab === 'active'" class="room-list">
          <div v-if="loadingRooms" class="loading-state">Loading rooms...</div>
          <div v-else-if="activeRooms.length === 0" class="empty-state">No active rooms found.</div>
          <div 
            v-for="room in activeRooms" 
            :key="room.roomId" 
            class="room-item" 
            @click="$emit('join', room.roomId)"
          >
            <div class="room-info">
              <span class="room-name">{{ room.displayName || room.roomId }}</span>
              <span class="room-meta">Created {{ formatDate(room.createdAt) }}</span>
            </div>
            <div class="room-status">
              <span class="online-badge" v-if="room.onlineCount > 0">
                <span class="dot"></span> {{ room.onlineCount }} Online
              </span>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'recent'" class="room-list">
          <div v-if="recentRooms.length === 0" class="empty-state">No recent history.</div>
          <div 
            v-for="room in recentRooms" 
            :key="room.id" 
            class="room-item" 
            @click="$emit('join', room.id)"
          >
            <div class="room-info">
              <span class="room-name">{{ room.id }}</span>
              <span class="room-meta">Last visited {{ formatDate(room.lastVisited) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import axios from 'axios';

import { resolveBackendBaseUrl } from '../services/backendUrl';

const API_URL = resolveBackendBaseUrl();

export default {
  name: 'Lobby',
  emits: ['join'],
  setup(props, { emit }) {
    const roomIdInput = ref('');
    const recentRooms = ref([]);
    const activeRooms = ref([]);
    const loading = ref(false);
    // 5.1: Store interval ID for cleanup
    let roomPollInterval = null;
    const loadingRooms = ref(false);
    const activeTab = ref('active');

    const fetchRooms = async () => {
      loadingRooms.value = true;
      try {
        const response = await axios.get(`${API_URL}/api/rooms`);
        activeRooms.value = response.data.rooms || [];
      } catch (error) {
        console.error('Failed to fetch rooms:', error);
      } finally {
        loadingRooms.value = false;
      }
    };

    onMounted(() => {
      try {
        const stored = localStorage.getItem('whitevue_recent_rooms');
        if (stored) {
          recentRooms.value = JSON.parse(stored);
        }
      } catch (e) {
        console.error('Failed to load recent rooms', e);
      }
      fetchRooms();
      // Poll for room updates every 10 seconds
      // 5.1: Store interval ID for cleanup
      roomPollInterval = setInterval(fetchRooms, 10000);
    });

    const createRoom = async () => {
      loading.value = true;
      try {
        const response = await axios.post(`${API_URL}/api/rooms`, {
          displayName: `Room ${Math.floor(Math.random() * 1000)}`
        });
        const newRoom = response.data;
        emit('join', newRoom.roomId);
      } catch (error) {
        console.error('Failed to create room:', error);
        // Fallback to client-side ID generation if server fails
        const newId = `board_${Math.random().toString(36).substr(2, 9)}`;
        emit('join', newId);
      } finally {
        loading.value = false;
      }
    };

    const joinRoom = () => {
      if (roomIdInput.value.trim()) {
        emit('join', roomIdInput.value.trim());
      }
    };

    const formatDate = (timestamp) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return date.toLocaleDateString();
    };

    // 5.1: Clear interval on unmount to prevent memory leak
    onBeforeUnmount(() => {
      if (roomPollInterval) {
        clearInterval(roomPollInterval);
        roomPollInterval = null;
      }
    });

    return {
      roomIdInput,
      recentRooms,
      activeRooms,
      loading,
      loadingRooms,
      activeTab,
      createRoom,
      joinRoom,
      formatDate
    };
  }
}
</script>

<style scoped>
.lobby-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  /* Remove local background to show global mesh gradient */
  padding: 20px;
}

.lobby-card {
  /* Use global glass variables indirectly or mimic them */
  background: var(--glass-surface);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  padding: 40px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  position: relative;
  overflow: hidden;
}

/* Shine effect */
.lobby-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--glass-highlight), transparent);
  opacity: 0.5;
}

.logo-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 10px;
}

.logo-icon {
  background: linear-gradient(135deg, var(--accent-primary), #2563eb);
  padding: 10px;
  border-radius: 14px;
  display: flex;
  box-shadow: var(--accent-glow);
}

.logo-section h1 {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.5px;
}

.tagline {
  text-align: center;
  color: var(--text-secondary);
  font-size: 16px;
  margin-top: -10px;
  font-weight: 400;
}

.actions-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.btn-primary {
  width: 100%;
  padding: 16px;
  /* Using global variables mostly, but ensuring specifity here */
  background: linear-gradient(135deg, var(--accent-primary), #2563eb);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.2s var(--ease-fluid);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: wait;
  filter: grayscale(0.5);
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid var(--glass-border);
}

.divider span {
  padding: 0 10px;
}

.join-section {
  display: flex;
  gap: 10px;
}

/* Input styles handled globally in style.css */
.btn-secondary {
  padding: 0 24px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.rooms-section {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0; 
}

.tabs {
  display: flex;
  gap: 20px;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 10px;
}

.tabs button {
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 0;
  position: relative;
  transition: color 0.2s;
}

.tabs button:hover {
  color: var(--text-primary);
}

.tabs button.active {
  color: var(--accent-primary);
  font-weight: 600;
}

.tabs button.active::after {
  content: '';
  position: absolute;
  bottom: -11px;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--accent-primary);
  box-shadow: 0 0 8px var(--accent-primary);
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
}

.room-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
}

.room-item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
  transform: translateX(4px);
}

.room-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.room-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
}

.room-meta {
  font-size: 12px;
  color: var(--text-secondary);
}

.online-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #4ade80; /* Green-400 */
  background: rgba(74, 222, 128, 0.1);
  padding: 4px 8px;
  border-radius: 20px;
}

.dot {
  width: 6px;
  height: 6px;
  background: #4ade80;
  border-radius: 50%;
  box-shadow: 0 0 5px #4ade80;
}

.empty-state, .loading-state {
  text-align: center;
  color: var(--text-secondary);
  padding: 20px;
  font-size: 14px;
  font-style: italic;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
