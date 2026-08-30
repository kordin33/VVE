<template>
  <div class="theme-switch">
    <button 
      class="theme-btn" 
      @click="$emit('toggle')" 
      :title="darkMode ? 'Przełącz na jasny motyw' : 'Przełącz na ciemny motyw'">
      <svg v-if="darkMode" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    </button>
  </div>
</template>

<script>
export default {
  name: 'ThemeToggle',
  props: {
    darkMode: {
      type: Boolean,
      default: false
    }
  }
}
</script>

<style scoped>
.theme-switch {
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.5);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  padding: 0;
  transition: all 0.3s ease;
}

.theme-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

@media (prefers-color-scheme: dark) {
  .theme-btn {
    background-color: rgba(255, 255, 255, 0.3);
    color: #fff;
  }

  .theme-btn:hover {
    background-color: rgba(255, 255, 255, 0.4);
  }
}

@media (prefers-color-scheme: light) {
  .theme-btn {
    background-color: rgba(0, 0, 0, 0.3);
    color: #fff;
  }

  .theme-btn:hover {
    background-color: rgba(0, 0, 0, 0.5);
  }
}
</style>