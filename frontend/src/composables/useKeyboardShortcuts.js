/**
 * useKeyboardShortcuts - keyboard event handling extracted from WhiteboardCanvas.
 *
 * Handles tool shortcuts, zoom shortcuts, undo/redo, Space panning,
 * Escape cancel, and math ghost-answer accept (Tab / Shift+Enter).
 */
export function useKeyboardShortcuts({
  currentTool,
  inlineTextEditor,
  spacePanActive,
  activeConfigPanel,
  pinchGesture,
  getActiveFeature,
  mathRecognizerModule,
  zoomIn,
  zoomOut,
  resetZoom,
  setTool,
  cancelActiveDrawing,
  closeConfigPanel,
  undo,
  redo,
  updateCursor,
  resetSpacePanState,
  endTouchGesture,
  applyMathAnswer,
  selectPenPreset,
}) {

  const handleKeyDown = (event) => {
    const tagName = event.target.tagName.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || event.target.isContentEditable) return;

    // Don't intercept while inline text editor is open
    if (currentTool.value === 'text' && inlineTextEditor.visible) return;

    if (event.code === 'Space') {
      event.preventDefault();
      if (!spacePanActive.value) {
        spacePanActive.value = true;
        updateCursor();
      }
      return;
    }

    if (event.key === 'Escape') {
      let handled = false;
      if (activeConfigPanel.value) {
        closeConfigPanel();
        handled = true;
      }
      handled = cancelActiveDrawing() || handled;
      if (handled) {
        event.preventDefault();
        updateCursor();
        return;
      }
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === '+' || (event.key === '=' && event.shiftKey)) {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomOut();
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        resetZoom();
        return;
      }

      // Tool shortcuts
      const lowerKey = event.key.toLowerCase();
      if (lowerKey === 'v') { setTool('select'); return; }
      if (lowerKey === 'h') { setTool('pan'); return; }
      if (lowerKey === 'p') { setTool('pen'); return; }
      if (lowerKey === 't') { setTool('text'); return; }
      if (lowerKey === 'e') { setTool('eraser'); return; }

      // 10.1: Pen preset shortcuts 1-4
      if (selectPenPreset) {
        const presetMap = { '1': 'gel', '2': 'technical', '3': 'marker', '4': 'calligraphy' };
        if (presetMap[event.key]) {
          selectPenPreset(presetMap[event.key]);
          return;
        }
      }
    }

    // Undo / Redo
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      redo();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    }

    // Accept ghost answer (Tab or Shift+Enter)
    if (event.key === 'Tab' || (event.shiftKey && event.key === 'Enter')) {
      if (getActiveFeature() === 'mathRecognizer' && mathRecognizerModule.value) {
        const newStroke = mathRecognizerModule.value.acceptGhostAnswer();
        if (newStroke) {
          event.preventDefault();
          applyMathAnswer(newStroke);
          return;
        }
      }
    }
  };

  const handleKeyUp = (event) => {
    if (event.code === 'Space' && spacePanActive.value) {
      event.preventDefault();
      resetSpacePanState(true);
    }
  };

  const handleWindowBlur = () => {
    resetSpacePanState(true);
    if (pinchGesture.value) {
      endTouchGesture();
    }
  };

  return { handleKeyDown, handleKeyUp, handleWindowBlur };
}
