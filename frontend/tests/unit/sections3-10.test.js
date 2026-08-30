import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readSrc = (relativePath) =>
  readFileSync(resolve(__dirname, '../../src', relativePath), 'utf-8');

const readRoot = (relativePath) =>
  readFileSync(resolve(__dirname, '../../', relativePath), 'utf-8');

// ─── Section 3: UI / Interface ───────────────────────────────────────────────

describe('3.1: Unified z-index system', () => {
  it('style.css defines z-index CSS variables', () => {
    const src = readSrc('style.css');
    expect(src).toContain('--z-canvas');
    expect(src).toContain('--z-toolbar');
    expect(src).toContain('--z-modal');
    expect(src).toContain('--z-toast');
    expect(src).toContain('--z-error-overlay');
  });

  it('App.vue uses CSS variable z-index values', () => {
    const src = readSrc('App.vue');
    expect(src).toContain('var(--z-');
  });

  it('FloatingOptions.vue uses CSS variable z-index', () => {
    const src = readSrc('components/FloatingOptions.vue');
    expect(src).toContain('var(--z-floating-options');
  });
});

describe('3.4: Toolbar auto-hide toggle', () => {
  it('App.vue has toolbar collapse functionality', () => {
    const src = readSrc('App.vue');
    expect(src).toContain('toolbarCollapsed');
    expect(src).toContain('toggleToolbar');
    expect(src).toContain('toolbar-hidden');
  });
});

describe('3.5: ColorPicker click-outside handler', () => {
  it('ColorPicker.vue adds pointerdown listener and cleanup', () => {
    const src = readSrc('components/ColorPicker.vue');
    expect(src).toContain('handleClickOutside');
    expect(src).toContain("addEventListener('pointerdown'");
    expect(src).toContain("removeEventListener('pointerdown'");
  });
});

// ─── Section 5: Memory Leaks ─────────────────────────────────────────────────

describe('5.7: WebSocket max payload', () => {
  it('server.ts sets maxPayload on WebSocketServer', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../server/src/server.ts'),
      'utf-8'
    );
    expect(src).toContain('maxPayload');
  });
});

describe('5.8: Specific watchers instead of deep watcher', () => {
  it('App.vue watches preset and smoothingFactor separately', () => {
    const src = readSrc('App.vue');
    expect(src).toContain("handwritingStylerOptions.value.preset");
    expect(src).toContain("handwritingStylerOptions.value.smoothingFactor");
  });
});

// ─── Section 6: Synchronization ──────────────────────────────────────────────

describe('6.1: Compaction after snapshot', () => {
  it('boardYjsPersistence.ts deletes incremental updates after snapshot', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../server/src/services/boardYjsPersistence.ts'),
      'utf-8'
    );
    expect(src).toContain("board_yjs_updates");
    expect(src).toContain(".del()");
  });
});

describe('6.2: Promise-based hydration lock', () => {
  it('rooms.ts uses hydrationPromise instead of boolean', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../server/src/rooms.ts'),
      'utf-8'
    );
    expect(src).toContain('hydrationPromise');
    expect(src).not.toMatch(/hydrating:\s*false/);
  });
});

describe('6.4: Silent catches → console.warn', () => {
  it('useUndoRedo.js uses console.warn in catch blocks', () => {
    const src = readSrc('composables/useUndoRedo.js');
    expect(src).toContain("console.warn('[useUndoRedo]");
    // No silent catches
    expect(src).not.toMatch(/catch\s*\(_\)\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/);
  });
});

describe('6.5: AI operation mutex', () => {
  it('useHelperModules.js implements withAiMutex', () => {
    const src = readSrc('composables/useHelperModules.js');
    expect(src).toContain('withAiMutex');
    expect(src).toContain('aiOperationQueue');
  });
});

// ─── Section 7: Functional Panels ────────────────────────────────────────────

describe('7.1: AIChatPanel race condition fix', () => {
  it('AIChatPanel.vue removes user message on error', () => {
    const src = readSrc('components/AIChatPanel.vue');
    expect(src).toContain('splice(idx, 1)');
  });
});

describe('7.2: AIChatPanel opacity restore in finally block', () => {
  it('AIChatPanel.vue uses finally for opacity restore', () => {
    const src = readSrc('components/AIChatPanel.vue');
    expect(src).toContain('finally');
  });
});

describe('7.3: Calculator clipboard fallback', () => {
  it('Calculator.vue has clipboard fallback', () => {
    const src = readSrc('components/Calculator.vue');
    expect(src).toContain('navigator.clipboard');
    expect(src).toContain('statusMessage');
  });
});

describe('7.5: Serializer extended fields', () => {
  it('serializer.js handles fillColor, strokeColor, rotation, opacity, text, roughness', () => {
    const src = readSrc('utils/serializer.js');
    expect(src).toContain('compact.fc'); // fillColor compact key
    expect(src).toContain('compact.sc'); // strokeColor compact key
    expect(src).toContain('compact.r');  // rotation
    expect(src).toContain('compact.o');  // opacity
    expect(src).toContain('compact.tx'); // text
    expect(src).toContain('compact.rg'); // roughness
  });
});

describe('7.6: HandwritingStyler normalizePoint null guard', () => {
  it('HandwritingStylerModule.js returns null for invalid data', () => {
    const src = readSrc('modules/HandwritingStylerModule.js');
    expect(src).toContain('return null');
    expect(src).toContain('.filter(Boolean)');
  });
});

describe('7.7: MathRecognizer AbortController', () => {
  it('MathRecognizerModule.js uses AbortController', () => {
    const src = readSrc('modules/MathRecognizerModule.js');
    expect(src).toContain('AbortController');
    expect(src).toContain('this.abortController');
  });
});

describe('7.8: RoomManagerModal AbortController', () => {
  it('RoomManagerModal.vue uses AbortController for search', () => {
    const src = readSrc('components/RoomManagerModal.vue');
    expect(src).toContain('AbortController');
  });
});

// ─── Section 8: CSS / Styling ────────────────────────────────────────────────

describe('8.1: No position:relative on * selector', () => {
  it('base.css does not set position:relative on all elements', () => {
    const src = readSrc('assets/base.css');
    expect(src).not.toContain('position: relative');
  });
});

describe('8.3: Dark mode uses @media instead of :deep(.dark-mode)', () => {
  it('EraserModeControls.vue uses @media prefers-color-scheme', () => {
    const src = readSrc('components/EraserModeControls.vue');
    expect(src).toContain('prefers-color-scheme: dark');
    expect(src).not.toContain(':deep(.dark-mode)');
  });

  it('ZoomPanControls.vue uses @media prefers-color-scheme', () => {
    const src = readSrc('components/ZoomPanControls.vue');
    expect(src).toContain('prefers-color-scheme: dark');
    expect(src).not.toContain(':deep(.dark-mode)');
  });

  it('ThemeToggle.vue uses @media prefers-color-scheme', () => {
    const src = readSrc('components/ThemeToggle.vue');
    expect(src).toContain('prefers-color-scheme: dark');
    expect(src).not.toContain(':deep(.dark-mode)');
  });
});

describe('8.4: No hardcoded #4285f4', () => {
  it('EraserModeControls.vue uses CSS variable for active color', () => {
    const src = readSrc('components/EraserModeControls.vue');
    expect(src).not.toContain('#4285f4');
    expect(src).toContain('var(--accent-primary');
  });

  it('LineWidthSelector.vue uses CSS variable for active color', () => {
    const src = readSrc('components/LineWidthSelector.vue');
    expect(src).not.toContain('#4285f4');
    expect(src).toContain('var(--accent-primary');
  });

  it('StatusMessage.vue uses CSS variable for background', () => {
    const src = readSrc('components/StatusMessage.vue');
    expect(src).not.toContain('#4285f4');
    expect(src).toContain('var(--accent-primary');
  });

  it('ZoomPanControls.vue uses CSS variable for hover color', () => {
    const src = readSrc('components/ZoomPanControls.vue');
    expect(src).not.toContain('#4285f4');
  });
});

describe('8.5: #app padding conflict', () => {
  it('main.css has padding: 0 on #app', () => {
    const src = readSrc('assets/main.css');
    expect(src).toMatch(/#app\s*\{[^}]*padding:\s*0/);
  });
});

describe('8.6: Viewport meta allows zoom', () => {
  it('index.html does not have user-scalable=no', () => {
    const src = readRoot('index.html');
    expect(src).not.toContain('user-scalable=no');
    expect(src).not.toContain('maximum-scale=1.0');
  });
});

// ─── Section 9: Technical Debt ───────────────────────────────────────────────

describe('9.1: historyManager.js removed', () => {
  it('historyManager.js does not exist', () => {
    expect(() => readSrc('utils/historyManager.js')).toThrow();
  });
});

describe('9.2: store/index.js removed', () => {
  it('store/index.js does not exist', () => {
    expect(() => readSrc('store/index.js')).toThrow();
  });
});

describe('9.3: LineWidthSelector uses beforeUnmount', () => {
  it('LineWidthSelector.vue uses beforeUnmount lifecycle hook', () => {
    const src = readSrc('components/LineWidthSelector.vue');
    expect(src).toContain('beforeUnmount()');
    // Ensure no beforeDestroy() method definition (comments are OK)
    expect(src).not.toMatch(/beforeDestroy\s*\(\)/);
  });
});

describe('9.4: ExportImportPanel uses navigator.clipboard', () => {
  it('ExportImportPanel.vue uses navigator.clipboard.writeText', () => {
    const src = readSrc('components/ExportImportPanel.vue');
    expect(src).toContain('navigator.clipboard.writeText');
  });
});

describe('9.7: No compiled vitest config artifacts in server', () => {
  it('server/vitest.config.js does not exist', () => {
    expect(() =>
      readFileSync(resolve(__dirname, '../../../server/vitest.config.js'), 'utf-8')
    ).toThrow();
  });
});

describe('9.8: Unused CSS variables removed', () => {
  it('base.css does not have --section-gap', () => {
    const src = readSrc('assets/base.css');
    expect(src).not.toContain('--section-gap');
  });

  it('WelcomeItem.vue does not exist', () => {
    expect(() => readSrc('components/WelcomeItem.vue')).toThrow();
  });
});

// ─── Section 10: Missing Features ────────────────────────────────────────────

describe('10.1: Pen preset keyboard shortcuts 1-4', () => {
  it('useKeyboardShortcuts.js has pen preset shortcuts', () => {
    const src = readSrc('composables/useKeyboardShortcuts.js');
    expect(src).toContain('selectPenPreset');
    expect(src).toContain("'1': 'gel'");
    expect(src).toContain("'2': 'technical'");
    expect(src).toContain("'3': 'marker'");
    expect(src).toContain("'4': 'calligraphy'");
  });

  it('WhiteboardCanvas.vue wires up useKeyboardShortcuts composable', () => {
    const src = readSrc('components/WhiteboardCanvas.vue');
    expect(src).toContain('useKeyboardShortcuts({');
    expect(src).toContain("emit('select-pen-preset'");
  });
});

describe('10.3: Extended color palette (20+ colors)', () => {
  it('ColorPicker.vue has 20+ basic colors', () => {
    const src = readSrc('components/ColorPicker.vue');
    // Count hex color entries in basicColors array
    const colorMatches = src.match(/#[0-9A-Fa-f]{6}/g) || [];
    expect(colorMatches.length).toBeGreaterThanOrEqual(20);
  });

  it('ColorPicker.vue grid has 6 columns', () => {
    const src = readSrc('components/ColorPicker.vue');
    expect(src).toContain('repeat(6, 1fr)');
  });

  it('ColorPicker.vue stores up to 6 recent colors', () => {
    const src = readSrc('components/ColorPicker.vue');
    expect(src).toContain('recentColors.slice(0, 6)');
    expect(src).toContain('recentColors.value.length > 6');
  });
});
