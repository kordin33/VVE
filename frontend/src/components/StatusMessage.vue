<template>
  <div class="status-message" :class="{ visible: message }">
    {{ message }}
  </div>
</template>

<script>
export default {
  name: 'StatusMessage',
  props: {
    message: {
      type: String,
      default: ''
    }
  }
}
</script>

<style scoped>
.status-message {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--accent-primary, #2563eb);
  color: white;
  padding: 5px 10px;
  border-radius: 3px;
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.3s;
  z-index: 100;
}

.status-message.visible {
  opacity: 1;
}
</style>
