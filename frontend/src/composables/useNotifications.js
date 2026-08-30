import { ref } from 'vue';

export function useNotifications() {
  const statusMessage = ref('');
  const statusTimeout = ref(null);
  const notifications = ref([]);
  const notificationId = ref(0);

  const showStatus = (message, duration = 2000) => {
    statusMessage.value = message;
    if (statusTimeout.value) clearTimeout(statusTimeout.value);
    statusTimeout.value = setTimeout(() => { statusMessage.value = ''; }, duration);
  };

  const showToast = (message, type = 'default', duration = 3000) => {
    const id = ++notificationId.value;
    notifications.value.push({ id, message, type });
    setTimeout(() => {
      notifications.value = notifications.value.filter(n => n.id !== id);
    }, duration);
  };

  return {
    statusMessage,
    notifications,
    showStatus,
    showToast,
  };
}
