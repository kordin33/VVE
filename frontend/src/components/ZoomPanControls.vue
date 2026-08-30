<template>
  <div class="zoom-controls">
    <button class="zoom-btn" @click="$emit('zoom-out')" title="Zoom Out">−</button>
    <div class="zoom-level">{{ Math.round(zoomLevel * 100) }}%</div>
    <button class="zoom-btn" @click="$emit('zoom-in')" title="Zoom In">+</button>
    <button class="zoom-btn" @click="$emit('reset-zoom')" title="Reset View">⟲</button>
  </div>
</template>

<script>
export default {
  name: 'ZoomPanControls',
  props: {
    zoomLevel: {
      type: Number,
      default: 1
    }
  }
}
</script>

<style scoped>
.zoom-controls {
  position: absolute;
  bottom: 20px;
  right: 20px;
  display: flex;
  background-color: white;
  border-radius: 20px;
  padding: 5px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  z-index: 10;
}

/* 2.2: Use CSS variable for bottom offset (configurable by parent) */
@media (max-width: 768px), (hover: none) {
  .zoom-controls {
    bottom: var(--zoom-controls-bottom, 80px);
    right: 10px;
  }
}

.zoom-btn {
  width: 30px;
  height: 30px;
  background: none;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #333;
  font-weight: bold;
}

.zoom-btn:hover {
  color: var(--accent-primary, #2563eb);
}

.zoom-level {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  font-size: 12px;
  color: #333;
}

@media (prefers-color-scheme: dark) {
  .zoom-controls {
    background-color: #333;
    color: white;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  }

  .zoom-btn {
    color: #f0f0f0;
  }

  .zoom-level {
    color: #f0f0f0;
  }
}
</style>