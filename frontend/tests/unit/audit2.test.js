import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readSrc = (relativePath) =>
  readFileSync(resolve(__dirname, '../../src', relativePath), 'utf-8');

const readServer = (relativePath) =>
  readFileSync(resolve(__dirname, '../../../server/src', relativePath), 'utf-8');

// ─── C1: Composable wiring — useDrawingEngine & useHelperModules ─────────────

describe('C1: Composable wiring in WhiteboardCanvas', () => {
  const src = readSrc('components/WhiteboardCanvas.vue');

  it('calls useHelperModules() (not just import)', () => {
    expect(src).toContain('} = useHelperModules({');
  });

  it('calls useDrawingEngine() (not just import)', () => {
    expect(src).toContain('} = useDrawingEngine({');
  });

  it('destructures critical functions from useDrawingEngine', () => {
    expect(src).toMatch(/const\s*\{[^}]*startDrawing[^}]*\}\s*=\s*useDrawingEngine/s);
    expect(src).toMatch(/const\s*\{[^}]*finishDrawing[^}]*\}\s*=\s*useDrawingEngine/s);
    expect(src).toMatch(/const\s*\{[^}]*draw[,\s][^}]*\}\s*=\s*useDrawingEngine/s);
    expect(src).toMatch(/const\s*\{[^}]*eraseElement[^}]*\}\s*=\s*useDrawingEngine/s);
  });

  it('destructures critical functions from useHelperModules', () => {
    expect(src).toMatch(/const\s*\{[^}]*getActiveModule[^}]*\}\s*=\s*useHelperModules/s);
    expect(src).toMatch(/const\s*\{[^}]*syncModulesWithYjs[^}]*\}\s*=\s*useHelperModules/s);
    expect(src).toMatch(/const\s*\{[^}]*renderLatex[^}]*\}\s*=\s*useHelperModules/s);
    expect(src).toMatch(/const\s*\{[^}]*applyMathAnswer[^}]*\}\s*=\s*useHelperModules/s);
  });

  it('passes getCoordinates and transformCoordinates to startDrawing', () => {
    expect(src).toContain('startDrawing(event, getCoordinates, transformCoordinates)');
  });

  it('useKeyboardShortcuts uses real cancelActiveDrawing (not inline stub)', () => {
    // Should NOT have the old inline stub
    expect(src).not.toMatch(/cancelActiveDrawing:\s*\(\)\s*=>\s*\{/);
  });

  it('useKeyboardShortcuts uses real applyMathAnswer (not empty function)', () => {
    // Should NOT have the old empty stub
    expect(src).not.toMatch(/applyMathAnswer:\s*\(\)\s*=>\s*\{\s*\}/);
  });
});

// ─── C2: Path traversal fix ─────────────────────────────────────────────────

describe('C2: Path traversal prevention in analyze-pdf', () => {
  it('aiRoutes.ts validates resolved path stays within uploads dir', () => {
    // The analyze-pdf handler moved out of httpApp.ts into the AI router.
    const src = readServer('routes/aiRoutes.ts');
    expect(src).toContain('path.resolve(filePath)');
    expect(src).toContain('path.resolve(uploadsDir)');
    expect(src).toContain('resolvedPath.startsWith(');
  });
});

// ─── C4: roundRect fallback ─────────────────────────────────────────────────

describe('C4: roundRect browser compatibility', () => {
  it('MathRecognizerModule uses roundRect with fallback', () => {
    const src = readSrc('modules/MathRecognizerModule.js');
    expect(src).toContain("typeof ctx.roundRect === 'function'");
    expect(src).toContain('ctx.arcTo(');
  });
});

// ─── H6: Timing-safe credential comparison (VVE-101) ────────────────────────

describe('H6: Timing-safe credential comparison', () => {
  it('CapabilityAccess compares credentials in constant time', () => {
    // VVE-101 moved every credential comparison behind CapabilityAccess;
    // the constant-time compare lives there now, not in route files.
    const src = readServer('pilot/capabilityAccess.ts');
    expect(src).toContain('timingSafeEqual');
    expect(src).toContain('const safeEqual');
    expect(src).toContain('safeEqual(passphrase, config.adminPassphrase)');
  });

  it('httpApp.ts no longer reads a raw admin secret from headers or query', () => {
    const src = readServer('httpApp.ts');
    expect(src).not.toContain('x-admin-secret');
    expect(src).not.toContain('adminSecret');
    expect(src).not.toContain('readAdminSecret');
  });
});

// ─── H9: redo must call updateGlobalState ────────────────────────────────────

describe('H9: redo calls updateGlobalState', () => {
  it('useUndoRedo redo function calls updateGlobalState', () => {
    const src = readSrc('composables/useUndoRedo.js');
    // Both undo and redo should call updateGlobalState
    const undoMatch = src.match(/const undo[\s\S]*?updateGlobalState/);
    const redoMatch = src.match(/const redo[\s\S]*?updateGlobalState/);
    expect(undoMatch).not.toBeNull();
    expect(redoMatch).not.toBeNull();
  });
});

// ─── C3: XSS prevention in MovableObject.vue ─────────────────────────────────

describe('C3: XSS prevention in MovableObject LaTeX rendering', () => {
  const src = readSrc('components/MovableObject.vue');

  it('imports DOMPurify', () => {
    expect(src).toContain("import DOMPurify from 'dompurify'");
  });

  it('sanitizes katex renderToString output', () => {
    expect(src).toContain('DOMPurify.sanitize(katex.renderToString(');
  });

  it('sanitizes error message latexCode to prevent XSS', () => {
    expect(src).toContain('DOMPurify.sanitize(latexCode)');
  });

  it('does not use unsanitized latexCode in error HTML', () => {
    // Ensure we don't have raw latexCode interpolated in template literal after "LaTeX Error:"
    expect(src).not.toMatch(/LaTeX Error: \$\{latexCode\}/);
  });
});

// ─── H3: withAiMutex unhandled rejection prevention ──────────────────────────

describe('H3: withAiMutex handles rejected promises', () => {
  const src = readSrc('composables/useHelperModules.js');

  it('withAiMutex has .catch() handler', () => {
    expect(src).toContain('.catch((err)');
  });

  it('withAiMutex logs warning on failure', () => {
    expect(src).toContain('[useHelperModules] AI operation failed:');
  });
});

// ─── H8: Per-IP WebSocket connection limiting ────────────────────────────────

describe('H8: Per-IP WebSocket connection limiting', () => {
  const src = readServer('server.ts');

  it('defines MAX_CONNECTIONS_PER_IP constant', () => {
    expect(src).toContain('MAX_CONNECTIONS_PER_IP');
  });

  it('implements trackIpConnect and trackIpDisconnect', () => {
    expect(src).toContain('trackIpConnect');
    expect(src).toContain('trackIpDisconnect');
  });

  it('checks per-IP limit on WebSocket connection', () => {
    expect(src).toContain('Too many connections');
  });

  it('decrements IP count on close/error/unauthorized', () => {
    // Should have trackIpDisconnect in close handler, error handler, and early exits
    const disconnectCalls = (src.match(/trackIpDisconnect/g) || []).length;
    expect(disconnectCalls).toBeGreaterThanOrEqual(4);
  });
});

// ─── Canvas memory cleanup in PDF export ─────────────────────────────────────

describe('Canvas memory cleanup in usePdfExport', () => {
  const src = readSrc('composables/usePdfExport.js');

  it('resets offscreen canvas dimensions to release memory', () => {
    expect(src).toContain('off.width = 0');
    expect(src).toContain('offscreen.width = 0');
  });
});

// ─── C5: Default secrets warning ─────────────────────────────────────────────

describe('C5: Default secrets development warning', () => {
  const src = readServer('config.ts');

  it('warns about default teacherSessionSecret in dev mode', () => {
    expect(src).toContain("'change-me-in-prod'");
    expect(src).toContain('WARNING: Using default teacherSessionSecret');
  });

  it('fails fast in production when defaults are used', () => {
    expect(src).toContain("config.nodeEnv === 'production'");
    expect(src).toContain('still using default fallback');
  });
});
