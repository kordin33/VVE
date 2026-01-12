<template>
  <div class="sync-indicator" :title="statusTitle">
    <div class="dot" :class="statusClass"></div>
    <span class="status-text" v-if="showText">{{ statusText }}</span>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as Y from 'yjs';

export default {
  name: 'SyncIndicator',
  props: {
    ydoc: {
      type: Object,
      default: null
    },
    showText: {
      type: Boolean,
      default: false
    }
  },
  setup(props) {
    const isSaving = ref(false);
    const saveTimeout = ref(null);

    const statusClass = ref('synced');
    const statusText = ref('Synced');
    const statusTitle = ref('All changes saved');

    const setSaving = () => {
      isSaving.value = true;
      statusClass.value = 'saving';
      statusText.value = 'Saving...';
      statusTitle.value = 'Syncing changes...';

      if (saveTimeout.value) {
        clearTimeout(saveTimeout.value);
      }

      saveTimeout.value = setTimeout(() => {
        isSaving.value = false;
        statusClass.value = 'synced';
        statusText.value = 'Synced';
        statusTitle.value = 'All changes saved';
      }, 1000); // Revert to synced after 1 second of inactivity
    };

    const handleUpdate = (update, origin) => {
       // Only show saving for local changes or if we want to show network activity
       // The requirement says: "Small dot: gray = synced, yellow = saving..."
       // "Uspokaja użytkownika, że nic nie zniknie" -> Reassures user that nothing will disappear.
       // So basically any update (incoming or outgoing) involves sync.
       setSaving();
    };

    watch(() => props.ydoc, (newDoc, oldDoc) => {
      if (oldDoc) {
        oldDoc.off('update', handleUpdate);
      }
      if (newDoc) {
        newDoc.on('update', handleUpdate);
      }
    }, { immediate: true });

    onBeforeUnmount(() => {
      if (props.ydoc) {
        props.ydoc.off('update', handleUpdate);
      }
      if (saveTimeout.value) {
        clearTimeout(saveTimeout.value);
      }
    });

    return {
      statusClass,
      statusText,
      statusTitle
    };
  }
}
</script>

<style scoped>
.sync-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 12px;
  border: 1px solid #e0e0e0;
  pointer-events: auto;
  user-select: none;
  font-size: 12px;
  color: #666;
  transition: all 0.3s ease;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background-color 0.3s;
}

.dot.synced {
  background-color: #9e9e9e; /* Gray */
}

.dot.saving {
  background-color: #fdd835; /* Yellow */
  box-shadow: 0 0 4px #fdd835;
}

.status-text {
  font-weight: 500;
}

/* Dark mode support if parent has dark-mode class or via media query if consistent */
:global(.dark-mode) .sync-indicator {
  background: rgba(40, 40, 40, 0.8);
  border-color: #555;
  color: #aaa;
}
</style>
