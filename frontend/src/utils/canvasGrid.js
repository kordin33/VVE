/**
 * Canvas Grid Module
 * Provides functionality for drawing the grid aligned to world coordinates.
 */

const MINOR_GRID_WORLD_SIZE = 20; // Base size of a small grid cell in world units
const MAJOR_GRID_FACTOR = 5; // Draw a major line every 5 minor lines

export const computeGridSteps = (zoomLevel) => {
  const baseWorldGridSize = MINOR_GRID_WORLD_SIZE;
  let worldGridStep = baseWorldGridSize;
  let screenGridSize = worldGridStep * zoomLevel;

  while (screenGridSize < 10 && worldGridStep < baseWorldGridSize * 100) {
    worldGridStep *= 2;
    screenGridSize = worldGridStep * zoomLevel;
  }
  while (screenGridSize > 40 && worldGridStep > baseWorldGridSize / 4) {
    worldGridStep /= 2;
    screenGridSize = worldGridStep * zoomLevel;
  }

  const majorWorldGridSize = worldGridStep * MAJOR_GRID_FACTOR;
  const majorScreenGridSize = majorWorldGridSize * zoomLevel;

  return {
    worldGridStep,
    screenGridSize,
    majorWorldGridSize,
    majorScreenGridSize,
  };
};

/**
 * Draw grid on canvas, aligned to world coordinates.
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {number} zoomLevel - Current zoom level
 * @param {object} panOffset - Pan offset {x, y} in screen coordinates
 * @param {number} canvasWidth - Canvas width in screen coordinates
 * @param {number} canvasHeight - Canvas height in screen coordinates
 * @param {boolean} darkMode - Dark mode enabled
 */
export const drawGrid = (ctx, zoomLevel, panOffset, canvasWidth, canvasHeight, darkMode) => {
  if (!ctx) return;

  ctx.save();

  // Clear canvas and set background
  ctx.fillStyle = darkMode ? '#1e1e1e' : '#ffffff'; // Use slightly darker dark mode bg
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // --- Calculate grid properties based on zoom ---
  const { worldGridStep, screenGridSize, majorWorldGridSize, majorScreenGridSize } = computeGridSteps(zoomLevel);

  // Don't draw if lines are too dense or too sparse
  if (screenGridSize < 5 || screenGridSize > canvasWidth * 2) {
     ctx.restore();
     return;
  }

  // --- Calculate visible world bounds ---
  const worldXMin = -panOffset.x / zoomLevel;
  const worldXMax = (canvasWidth - panOffset.x) / zoomLevel;
  const worldYMin = -panOffset.y / zoomLevel;
  const worldYMax = (canvasHeight - panOffset.y) / zoomLevel;

  // --- Calculate starting grid lines in world coordinates ---
  const startWorldX = Math.floor(worldXMin / worldGridStep) * worldGridStep;
  const startWorldY = Math.floor(worldYMin / worldGridStep) * worldGridStep;
  const startMajorWorldX = Math.floor(worldXMin / majorWorldGridSize) * majorWorldGridSize;
  const startMajorWorldY = Math.floor(worldYMin / majorWorldGridSize) * majorWorldGridSize;

  // --- Set line styles with Dynamic Opacity ---
  // Base alpha values for normal zoom (>= 0.5)
  const baseAlphaMinor = 0.08;
  const baseAlphaMajor = 0.15;

  // Calculate opacity factor based on zoom
  // 1.0 at zoom >= 0.5, dropping linearly to 0.2 at zoom 0.1
  const opacityFactor = Math.min(1, Math.max(0.2, zoomLevel * 2));

  const alphaMinor = baseAlphaMinor * opacityFactor;
  const alphaMajor = baseAlphaMajor * opacityFactor;

  const minorColor = darkMode
    ? `rgba(255, 255, 255, ${alphaMinor.toFixed(3)})`
    : `rgba(0, 0, 0, ${alphaMinor.toFixed(3)})`;
  const majorColor = darkMode
    ? `rgba(255, 255, 255, ${alphaMajor.toFixed(3)})`
    : `rgba(0, 0, 0, ${alphaMajor.toFixed(3)})`;

  const pixelRatio = window.devicePixelRatio || 1;
  const minorLineWidth = 1 / pixelRatio; // Aim for 1 physical pixel
  const majorLineWidth = 1.5 / pixelRatio; // Slightly thicker major lines

  // Helper function to convert world coord to screen coord
  const worldToScreenX = (worldX) => worldX * zoomLevel + panOffset.x;
  const worldToScreenY = (worldY) => worldY * zoomLevel + panOffset.y;

  // --- Draw Minor Grid Lines ---
  ctx.beginPath();
  ctx.strokeStyle = minorColor;
  ctx.lineWidth = minorLineWidth;

  // Vertical lines
  let currentWorldX = startWorldX;
  while (currentWorldX < worldXMax) {
    // Avoid drawing lines exactly on major grid lines if major grid is drawn
    if (majorScreenGridSize < 5 || Math.abs(currentWorldX % majorWorldGridSize) > 0.001) {
        const screenX = Math.round(worldToScreenX(currentWorldX)) + (minorLineWidth / 2); // Align to pixel grid
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, canvasHeight);
    }
    currentWorldX += worldGridStep;
  }

  // Horizontal lines
  let currentWorldY = startWorldY;
  while (currentWorldY < worldYMax) {
     if (majorScreenGridSize < 5 || Math.abs(currentWorldY % majorWorldGridSize) > 0.001) {
        const screenY = Math.round(worldToScreenY(currentWorldY)) + (minorLineWidth / 2); // Align to pixel grid
        ctx.moveTo(0, screenY);
        ctx.lineTo(canvasWidth, screenY);
     }
    currentWorldY += worldGridStep;
  }
  ctx.stroke();


  // --- Draw Major Grid Lines (if they are visually distinct enough) ---
  if (majorScreenGridSize >= 5) {
      ctx.beginPath();
      ctx.strokeStyle = majorColor;
      ctx.lineWidth = majorLineWidth;

      // Vertical major lines
      let currentMajorWorldX = startMajorWorldX;
      while (currentMajorWorldX < worldXMax) {
          const screenX = Math.round(worldToScreenX(currentMajorWorldX)) + (majorLineWidth / 2); // Align to pixel grid
          ctx.moveTo(screenX, 0);
          ctx.lineTo(screenX, canvasHeight);
          currentMajorWorldX += majorWorldGridSize;
      }

      // Horizontal major lines
      let currentMajorWorldY = startMajorWorldY;
      while (currentMajorWorldY < worldYMax) {
          const screenY = Math.round(worldToScreenY(currentMajorWorldY)) + (majorLineWidth / 2); // Align to pixel grid
          ctx.moveTo(0, screenY);
          ctx.lineTo(canvasWidth, screenY);
          currentMajorWorldY += majorWorldGridSize;
      }
      ctx.stroke();
  }

  ctx.restore();
};
