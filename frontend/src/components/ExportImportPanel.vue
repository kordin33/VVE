<template>
  <div class="export-import-panel">
    <h3>Save & Load Whiteboard</h3>

    <div class="panel-section">
      <button class="panel-button" @click="exportState">
        Export Whiteboard
      </button>
      <p class="helper-text">Save the current whiteboard state</p>
    </div>

    <div class="panel-section">
      <button class="panel-button" @click="showImportDialog">
        Import Whiteboard
      </button>
      <p class="helper-text">Load a previously saved whiteboard</p>
    </div>

    <!-- Export Dialog -->
    <div v-if="showExport" class="dialog-overlay">
      <div class="dialog">
        <h4>Whiteboard State</h4>
        <p class="dialog-helper">Copy this text to save your whiteboard:</p>
        <textarea 
          ref="exportTextarea" 
          v-model="exportedState" 
          class="state-textarea" 
          readonly
        ></textarea>
        <div class="dialog-actions">
          <button @click="copyToClipboard" class="action-button">
            Copy to Clipboard
          </button>
          <button @click="showExport = false" class="action-button">
            Close
          </button>
        </div>
      </div>
    </div>

    <!-- Import Dialog -->
    <div v-if="showImport" class="dialog-overlay">
      <div class="dialog">
        <h4>Import Whiteboard</h4>
        <p class="dialog-helper">Paste the whiteboard state text:</p>
        <textarea 
          v-model="importText" 
          class="state-textarea" 
          placeholder="Paste whiteboard state here..."
        ></textarea>
        <div class="dialog-actions">
          <button @click="importState" class="action-button">
            Import
          </button>
          <button @click="cancelImport" class="action-button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ExportImportPanel',
  data() {
    return {
      showExport: false,
      showImport: false,
      exportedState: '',
      importText: '',
      importSuccess: false
    }
  },
  methods: {
    exportState() {
      // Request whiteboard state from parent
      this.$emit('request-whiteboard-state');
      this.showExport = true;
      // Focus and select the text in the textarea after it's rendered
      this.$nextTick(() => {
        this.$refs.exportTextarea.select();
      });
    },
    async copyToClipboard() {
      try {
        await navigator.clipboard.writeText(this.exportedState);
        alert('Copied to clipboard!');
      } catch {
        // Fallback for older browsers / insecure contexts
        this.$refs.exportTextarea.select();
        document.execCommand('copy');
        alert('Copied to clipboard!');
      }
    },
    showImportDialog() {
      this.importText = '';
      this.showImport = true;
    },
    importState() {
      if (!this.importText.trim()) {
        alert('Please paste a valid whiteboard state.');
        return;
      }

      try {
        // Try to parse the JSON to validate it
        JSON.parse(this.importText);

        // Emit event to parent component to handle the import
        this.$emit('import-whiteboard-state', this.importText);
        this.showImport = false;
        this.importText = '';
      } catch (e) {
        alert('Invalid whiteboard state format. Please check the text and try again.');
      }
    },
    cancelImport() {
      this.showImport = false;
      this.importText = '';
    }
  }
}
</script>

<style scoped>
.export-import-panel {
  padding: 15px;
  background-color: #333;
  border-left: 1px solid #444;
  width: 200px;
  flex-shrink: 0;
  color: #CCC;
}

h3 {
  margin-top: 0;
  margin-bottom: 10px;
  font-size: 16px;
  color: #FFF;
  font-weight: 500;
}

.panel-section {
  margin-bottom: 20px;
}

.panel-button {
  width: 100%;
  padding: 8px 0;
  background-color: #ff5c4c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: normal;
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-button:hover {
  background-color: #ff473a;
}

.helper-text {
  font-size: 12px;
  color: #999;
  margin-top: 5px;
  margin-bottom: 15px;
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.dialog {
  background-color: white;
  border-radius: 12px;
  padding: 25px;
  width: 90%;
  max-width: 600px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.15);
  animation: dialog-appear 0.3s ease-out;
}

@keyframes dialog-appear {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

h4 {
  margin-top: 0;
  color: #333;
}

.dialog-helper {
  font-size: 14px;
  color: #666;
}

.state-textarea {
  width: 100%;
  height: 200px;
  padding: 10px;
  margin: 10px 0;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  resize: none;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.action-button {
  padding: 8px 16px;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.action-button:hover {
  background-color: #45a049;
}
</style>