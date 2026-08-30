import { ref, nextTick } from 'vue';
import * as Y from 'yjs';
import { undoRedoState } from '../utils/undoRedoState';

export function useUndoRedo({ ydoc, yDrawings }) {
  const undoManager = ref(null);
  const canUndo = ref(false);
  const canRedo = ref(false);

  const updateGlobalState = () => {
    if (undoManager.value) {
      const hasUndo = undoManager.value.canUndo();
      const hasRedo = undoManager.value.canRedo();
      canUndo.value = hasUndo;
      canRedo.value = hasRedo;
      undoRedoState.update(hasUndo, hasRedo);
    } else {
      canUndo.value = false;
      canRedo.value = false;
      undoRedoState.update(false, false);
    }
  };

  const initializeUndoManager = () => {
    if (undoManager.value) {
      try { undoManager.value.destroy(); } catch (err) { console.warn('[useUndoRedo] destroy failed:', err); }
      undoManager.value = null;
    }

    if (!ydoc.value || !yDrawings.value) return;

    undoManager.value = new Y.UndoManager(yDrawings.value, {
      captureTimeout: 0,
      trackedOrigins: new Set([
        'local-drawing', 'local-erase', 'local-clear', 'local-text', 'local-add-text',
        'local-image', 'local-plot', 'local-coordsys',
        'local-movable-drag', 'local-movable-rotate', 'local-movable-resize',
        'clone-object', 'ai-align', 'ai-style', 'ai-math'
      ])
    });

    undoManager.value.on('stack-item-added', updateGlobalState);
    undoManager.value.on('stack-item-popped', updateGlobalState);
    updateGlobalState();
  };

  const undo = (afterCallback) => {
    try {
      if (undoManager.value && undoManager.value.canUndo()) {
        undoManager.value.undo();
        nextTick(() => {
          afterCallback?.();
          updateGlobalState();
        });
      }
    } catch (err) { console.warn('[useUndoRedo] undo failed:', err); }
  };

  const redo = (afterCallback) => {
    try {
      if (undoManager.value && undoManager.value.canRedo()) {
        undoManager.value.redo();
        nextTick(() => {
          afterCallback?.();
          updateGlobalState();
        });
      }
    } catch (err) { console.warn('[useUndoRedo] redo failed:', err); }
  };

  const teardownUndoManager = () => {
    if (undoManager.value) {
      undoManager.value.off('stack-item-added', updateGlobalState);
      undoManager.value.off('stack-item-popped', updateGlobalState);
      undoManager.value.destroy();
      undoManager.value = null;
      updateGlobalState();
    }
  };

  return {
    undoManager,
    canUndo,
    canRedo,
    updateGlobalState,
    initializeUndoManager,
    undo,
    redo,
    teardownUndoManager,
  };
}
