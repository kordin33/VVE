<template>
  <div class="landing-page">
    <div class="container">
      <div class="logo">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
        <h1>Interactive Whiteboard</h1>
      </div>

      <div class="actions">
        <div class="action-card">
          <h2>New Whiteboard</h2>
          <p>Start a fresh collaborative whiteboard session</p>
          <button @click="createNewBoard" class="btn btn-primary">
            <span class="icon">+</span>
            Create New Board
          </button>
        </div>

        <div class="separator">OR</div>

        <div class="action-card">
          <h2>Join Existing Board</h2>
          <p>Enter a board ID to join an existing session</p>
          <div class="input-group">
            <input 
              type="text" 
              v-model="boardId" 
              placeholder="Enter board ID" 
              @keyup.enter="joinExistingBoard"
            />
            <button @click="joinExistingBoard" class="btn btn-secondary" :disabled="!boardId">
              Join
            </button>
          </div>
        </div>
      </div>

      <div v-if="recentBoards.length > 0" class="recent-boards">
        <h3>Recent Boards</h3>
        <ul>
          <li v-for="board in recentBoards" :key="board.id">
            <a @click.prevent="joinBoard(board.id)" href="#" class="recent-board-link">
              {{ board.name || board.id }}
              <span class="timestamp">{{ formatDate(board.timestamp) }}</span>
            </a>
          </li>
        </ul>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </div>

    <footer>
      <p>&copy; {{ new Date().getFullYear() }} Interactive Whiteboard</p>
    </footer>
  </div>
</template>

<script>
export default {
  name: 'LandingPage',
  data() {
    return {
      boardId: '',
      error: '',
      recentBoards: []
    }
  },
  mounted() {
    // Load recent boards from localStorage
    this.loadRecentBoards();
  },
  methods: {
    async createNewBoard() {
      try {
        // Generate a random board ID with the correct prefix
        const boardId = 'board_' + Math.random().toString(36).substr(2, 9);

        // Save to recent boards
        this.saveToRecentBoards(boardId);

        // Navigate to the new board using the correct URL format
        this.$router.push({ name: 'whiteboard', params: { id: boardId } });
      } catch (error) {
        console.error('Error creating new board:', error);
        this.error = 'Failed to create a new board. Please try again.';
      }
    },

    joinExistingBoard() {
      if (!this.boardId.trim()) {
        this.error = 'Please enter a valid board ID';
        return;
      }

      // Add 'board_' prefix if it's missing
      let boardIdToUse = this.boardId;
      if (!boardIdToUse.startsWith('board_')) {
        boardIdToUse = 'board_' + boardIdToUse;
      }

      this.joinBoard(boardIdToUse);
    },

    joinBoard(boardId) {
      // Save to recent boards
      this.saveToRecentBoards(boardId);

      // Navigate to the board using the correct URL format
      this.$router.push({ name: 'whiteboard', params: { id: boardId } });
    },

    saveToRecentBoards(boardId, name = '') {
      // Get existing boards
      const boards = JSON.parse(localStorage.getItem('recentBoards') || '[]');

      // Remove if already exists
      const filteredBoards = boards.filter(board => board.id !== boardId);

      // Add to beginning
      filteredBoards.unshift({
        id: boardId,
        name: name,
        timestamp: Date.now()
      });

      // Keep only the last 5
      const recentBoards = filteredBoards.slice(0, 5);

      // Save back to localStorage
      localStorage.setItem('recentBoards', JSON.stringify(recentBoards));

      // Update local data
      this.recentBoards = recentBoards;
    },

    loadRecentBoards() {
      try {
        const boards = JSON.parse(localStorage.getItem('recentBoards') || '[]');
        this.recentBoards = boards;
      } catch (error) {
        console.error('Error loading recent boards:', error);
        this.recentBoards = [];
      }
    },

    formatDate(timestamp) {
      if (!timestamp) return '';

      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return 'Today';
      } else if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        return `${diffDays} days ago`;
      } else {
        return date.toLocaleDateString();
      }
    }
  }
}
</script>

<style scoped>
.landing-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #1e1e1e;
  color: #f0f0f0;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}

.logo {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 3rem;
}

.logo svg {
  stroke: var(--accent-primary, #2563eb);
  width: 48px;
  height: 48px;
}

.logo h1 {
  font-size: 2.5rem;
  font-weight: 600;
  color: #f0f0f0;
  margin: 0;
}

.actions {
  display: flex;
  gap: 2rem;
  margin-bottom: 3rem;
}

@media (max-width: 768px) {
  .actions {
    flex-direction: column;
  }
}

.action-card {
  flex: 1;
  background-color: #252525;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.action-card h2 {
  margin-top: 0;
  margin-bottom: 0.5rem;
  font-size: 1.5rem;
  color: #fff;
}

.action-card p {
  margin-bottom: 1.5rem;
  color: #aaa;
}

.separator {
  display: flex;
  align-items: center;
  color: #777;
  font-weight: 600;
}

.input-group {
  display: flex;
  gap: 0.5rem;
}

input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid #444;
  border-radius: 4px;
  background-color: #333;
  color: #fff;
  font-size: 16px;
}

input:focus {
  outline: none;
  border-color: var(--accent-primary, #2563eb);
}

.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.2s ease;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background-color: var(--accent-primary, #2563eb);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #3367d6;
}

.btn-secondary {
  background-color: #555;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #666;
}

.icon {
  font-weight: bold;
  font-size: 18px;
}

.recent-boards {
  margin-top: auto;
  padding-top: 2rem;
}

.recent-boards h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #aaa;
  font-size: 1.2rem;
  font-weight: 500;
}

.recent-boards ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.recent-boards li {
  margin-bottom: 0.5rem;
}

.recent-board-link {
  display: flex;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background-color: #252525;
  border-radius: 4px;
  color: #f0f0f0;
  text-decoration: none;
  transition: background-color 0.2s ease;
}

.recent-board-link:hover {
  background-color: #333;
}

.timestamp {
  color: #888;
  font-size: 0.9rem;
}

.error-message {
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background-color: rgba(255, 59, 48, 0.2);
  border-left: 4px solid #ff3b30;
  color: #ff3b30;
  border-radius: 4px;
}

footer {
  text-align: center;
  padding: 1rem;
  background-color: #252525;
  color: #888;
  font-size: 0.9rem;
}
</style>