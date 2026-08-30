import { describe, expect, it, vi } from 'vitest';
import { distanceToSegment, isPointInElement } from '../../src/utils/canvasDrawing.js';

describe('1.1: Grid snap uses correct function name', () => {
  it('useDrawingEngine source does not reference _getSnapSettingsInternal', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/composables/useDrawingEngine.js'),
      'utf-8'
    );
    expect(source).not.toContain('_getSnapSettingsInternal');
    expect(source).toContain('getSnapSettings()');
  });
});

describe('1.2: Rough.js instance caching', () => {
  it('canvasDrawing source uses roughCanvasCache WeakMap', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/utils/canvasDrawing.js'),
      'utf-8'
    );
    expect(source).toContain('roughCanvasCache');
    expect(source).toContain('WeakMap');
  });
});

describe('1.8: Coordinate validation', () => {
  it('useDrawingEngine source validates isFinite before Yjs save', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/composables/useDrawingEngine.js'),
      'utf-8'
    );
    expect(source).toContain('Number.isFinite(minX)');
    expect(source).toContain('Number.isFinite(minY)');
  });
});

describe('1.10: Image loading timeout', () => {
  it('createImageElement source has timeout', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/utils/canvasTools.js'),
      'utf-8'
    );
    expect(source).toContain('setTimeout');
    expect(source).toContain('10_000');
    expect(source).toContain('clearTimeout');
  });
});

describe('Geometry: distanceToSegment', () => {
  it('returns 0 for point on segment', () => {
    const dist = distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dist).toBeCloseTo(0, 5);
  });

  it('returns correct perpendicular distance', () => {
    const dist = distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dist).toBeCloseTo(3, 5);
  });

  it('returns distance to nearest endpoint for point beyond segment', () => {
    const dist = distanceToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dist).toBeCloseTo(5, 5);
  });

  it('handles zero-length segment (point)', () => {
    const dist = distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(dist).toBeCloseTo(5, 5);
  });
});

describe('Geometry: isPointInElement', () => {
  it('detects point inside rectangle', () => {
    const element = {
      type: 'rectangle',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 }
    };
    expect(isPointInElement({ x: 50, y: 50 }, element)).toBe(true);
  });

  it('rejects point outside rectangle', () => {
    const element = {
      type: 'rectangle',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 }
    };
    expect(isPointInElement({ x: 200, y: 200 }, element)).toBe(false);
  });

  it('detects point near pen stroke segment', () => {
    const element = {
      type: 'pen',
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    };
    expect(isPointInElement({ x: 50, y: 5 }, element, 10)).toBe(true);
  });

  it('returns false for null/undefined element', () => {
    expect(isPointInElement({ x: 0, y: 0 }, null)).toBe(false);
    expect(isPointInElement({ x: 0, y: 0 }, undefined)).toBe(false);
  });
});
