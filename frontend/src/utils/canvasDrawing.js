/**
 * Canvas Drawing Utilities
 * Provides functions for drawing different elements on the canvas using Rough.js for a hand-drawn aesthetic,
 * or native Canvas API for a "Clean" aesthetic.
 */

import rough from 'roughjs';
import * as math from 'mathjs';
import { drawStyledPen } from './penStyles';

// Throttle function to limit the rate of function calls
export const throttle = (fn, delay) => {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
};

// Helper for "handdrawn" lines using the pen engine
const drawHanddrawnLine = (
  context,
  start,
  end,
  color,
  lw,
  penStyleOptions = {},
  seed = 1
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  // Normalized normal vector
  const nx = -dy / len;
  const ny = dx / len;

  // Curvature amplitude (max ~8 px)
  const maxAmp = Math.min(8, len * 0.04);

  const segments = 4; // Total 6 points (with ends)

  const points = [];

  // Pseudo-random based on seed + index
  const rand = (i) => {
    const x = Math.sin(seed * 9973 + i * 7919) * 10000;
    return x - Math.floor(x); // [0,1)
  };

  for (let i = 0; i <= segments + 1; i++) {
    const t = i / (segments + 1); // 0..1
    const bx = start.x + dx * t;
    const by = start.y + dy * t;

    // First and last sample - no jitter, perfect ends
    let amp = 0;
    if (i > 0 && i < segments + 1) {
      const r = rand(i) * 2 - 1; // [-1,1]
      amp = r * maxAmp;
    }

    points.push({
      x: bx + nx * amp,
      y: by + ny * amp,
      t: typeof performance !== 'undefined' ? performance.now() : Date.now()
    });
  }

  const penStyle = 'technical'; // Could be parameterized if needed
  const presetConfig =
    (penStyleOptions.presets && penStyleOptions.presets[penStyle]) || {};

  const globalSmoothing =
    typeof penStyleOptions.smoothingFactor === 'number'
      ? Math.min(Math.max(penStyleOptions.smoothingFactor / 100, 0), 1)
      : 0.25;

  drawStyledPen(context, points, {
    style: penStyle,
    color,
    lineWidth: lw,
    config: presetConfig,
    globalSmoothing
  });
};

/**
 * Draw a single element on the canvas.
 * This is the main dispatcher that renders all element types.
 *
 * @param {CanvasRenderingContext2D} context - Canvas 2D context
 * @param {Object} element - Element data (type, geometry, style, etc.)
 * @param {boolean} [isHighlighted=false] - Whether element should be highlighted (e.g. eraser hover)
 * @param {number} [smoothingFactor=0.65] - Reserved for future pen smoothing
 * @param {Map<string, HTMLImageElement>} [imageCache] - Cache used for image elements
 * @param {Function} [requestRedraw] - Callback to request a redraw when async work (image load) finishes
 */
export const drawElement = (
  context,
  element,
  isHighlighted = false,
  smoothingFactor = 0.65,
  imageCache,
  requestRedraw,
  penStyleOptions = {},
  rcOverride = null
) => {
  if (!context || !element || !element.type) return;

  const type = element.type;
  const rc = rcOverride || rough.canvas(context.canvas);

  // Base style
  const baseColor = element.strokeColor || element.color || '#000000';
  const color = isHighlighted ? '#ff5252' : baseColor;
  const lw = element.lineWidth || 2;
  const lineStyle = element.lineStyle || 'solid'; // solid, dashed, dotted
  const roughness = element.roughness !== undefined ? element.roughness : 1; // 0 = clean, 1 = default, 2 = sloppy
  const fillColor = element.fillColor || null;
  const fillOpacity = typeof element.fillOpacity === 'number' ? element.fillOpacity : 1;
  const fillStyle = element.fillStyle || 'solid';

  // Determine dash pattern
  let strokeLineDash = [];
  if (lineStyle === 'dashed') strokeLineDash = [12, 8];
  if (lineStyle === 'dotted') strokeLineDash = [3, 6];

  // RoughJS options
  const options = {
    stroke: color,
    strokeWidth: lw,
    roughness: roughness,
    bowing: roughness > 0 ? 1 : 0, // No bowing if clean
    seed: element.seed || 1,
    strokeLineDash: strokeLineDash,
    disableMultiStroke: roughness === 0, // Single stroke for clean look
    disableMultiStrokeFiller: roughness === 0,
    fill: fillColor || undefined,
    fillStyle: fillColor ? fillStyle : undefined,
    fillWeight: element.fillWeight || 2,
    hachureGap: element.hachureGap || undefined
  };

  context.save();
  context.strokeStyle = color;
  context.fillStyle = fillColor || color;
  context.lineWidth = lw;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (strokeLineDash.length) {
    context.setLineDash(strokeLineDash);
  }

  // Helper for "Clean" mode (Native Canvas)
  const isClean = roughness === 0;

  switch (type) {
    case 'pen': {
      // --- OPTIMIZATION: Use Cached Path2D ---
      // Uses the pre-calculated Path2D from the local scene cache if available.
      // To DISABLE: Comment out this 'if' block to force re-rendering from points.
      if (element.cachedPath) {
        context.save();
        context.strokeStyle = element.strokeColor || element.color || color;
        context.lineWidth = lw;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.stroke(element.cachedPath);
        context.restore();
        break;
      }
      // --- END OPTIMIZATION ---

      const points = element.points || [];
      if (points.length < 2) break;
      const penStyle = element.penStyle || 'technical';
      const presetConfig = element.penConfig || (penStyleOptions.presets ? penStyleOptions.presets[penStyle] : {}) || {};
      const globalSmoothing = typeof penStyleOptions.smoothingFactor === 'number'
        ? Math.min(Math.max(penStyleOptions.smoothingFactor / 100, 0), 1)
        : 0.25;
      const strokeColor = element.strokeColor || element.color || color;

      drawStyledPen(context, points, {
        style: penStyle,
        color: strokeColor,
        lineWidth: lw,
        config: presetConfig,
        globalSmoothing
      });
      break;
    }
    case 'eraser': {
      const points = element.points || [];
      if (points.length < 2) break;
      const normalize = (pt) => (Array.isArray(pt) ? { x: pt[0], y: pt[1] } : pt);
      const first = normalize(points[0]);
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i++) {
        const pt = normalize(points[i]);
        context.lineTo(pt.x, pt.y);
      }
      context.stroke();
      break;
    }

    case 'line': {
      if (!element.start || !element.end) break;

      const strokeMode = element.strokeMode || 'clean';

      if (strokeMode === 'handdrawn') {
        const strokeColor = element.strokeColor || element.color || color;
        drawHanddrawnLine(
          context,
          element.start,
          element.end,
          strokeColor,
          lw,
          penStyleOptions,
          element.seed || 1
        );
      } else {
          if (isClean) {
            context.beginPath();
            context.moveTo(element.start.x, element.start.y);
            context.lineTo(element.end.x, element.end.y);
            context.stroke();
          } else {
            rc.line(element.start.x, element.start.y, element.end.x, element.end.y, options);
          }
      }

      // Arrowheads
      const arrowStyle = element.arrowStyle || 'none';
      if (arrowStyle === 'end' || arrowStyle === 'both') {
        drawArrowhead(context, rc, element.start, element.end, options, isClean);
      }
      if (arrowStyle === 'start' || arrowStyle === 'both') {
        drawArrowhead(context, rc, element.end, element.start, options, isClean);
      }
      break;
    }

    case 'rectangle':
    case 'square':
      if (element.start && element.end) {
        const x = Math.min(element.start.x, element.end.x);
        const y = Math.min(element.start.y, element.end.y);
        const w = Math.abs(element.end.x - element.start.x);
        const h = Math.abs(element.end.y - element.start.y);

        if (isClean) {
          if (fillColor) {
            context.globalAlpha = fillOpacity;
            context.fillRect(x, y, w, h);
            context.globalAlpha = 1;
          }
          context.strokeRect(x, y, w, h);
        } else {
          rc.rectangle(x, y, w, h, options);
        }
      }
      break;

    case 'circle':
      if (element.start && element.end) {
        const centerX = (element.start.x + element.end.x) / 2;
        const centerY = (element.start.y + element.end.y) / 2;
        const width = Math.abs(element.end.x - element.start.x);
        const height = Math.abs(element.end.y - element.start.y);

        if (isClean) {
          context.beginPath();
          context.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, 2 * Math.PI);
          if (fillColor) {
            context.globalAlpha = fillOpacity;
            context.fill();
            context.globalAlpha = 1;
          }
          context.stroke();
        } else {
          rc.ellipse(centerX, centerY, width, height, options);
        }
      }
      break;

    case 'triangle':
      if (element.start && element.end) {
        const midX = element.start.x + (element.end.x - element.start.x) / 2;
        const points = [
          [midX, element.start.y],
          [element.end.x, element.end.y],
          [element.start.x, element.end.y]
        ];

        if (isClean) {
          context.beginPath();
          context.moveTo(points[0][0], points[0][1]);
          context.lineTo(points[1][0], points[1][1]);
          context.lineTo(points[2][0], points[2][1]);
          context.closePath();
          if (fillColor) {
            context.globalAlpha = fillOpacity;
            context.fill();
            context.globalAlpha = 1;
          }
          context.stroke();
        } else {
          rc.polygon(points, options);
        }
      }
      break;

    case 'trapezoid':
      if (element.start && element.end) {
        const x = Math.min(element.start.x, element.end.x);
        const y = Math.min(element.start.y, element.end.y);
        const w = Math.abs(element.end.x - element.start.x);
        const h = Math.abs(element.end.y - element.start.y);
        const topWidth = Math.max(10, w * 0.6);
        const offset = (w - topWidth) / 2;
        const points = [
          [x + offset, y],
          [x + offset + topWidth, y],
          [x + w, y + h],
          [x, y + h]
        ];

        if (isClean) {
          context.beginPath();
          context.moveTo(points[0][0], points[0][1]);
          for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
          context.closePath();
          if (fillColor) {
            context.globalAlpha = fillOpacity;
            context.fill();
            context.globalAlpha = 1;
          }
          context.stroke();
        } else {
          rc.polygon(points, options);
        }
      }
      break;

    case 'parallelogram':
      if (element.start && element.end) {
        const x = Math.min(element.start.x, element.end.x);
        const y = Math.min(element.start.y, element.end.y);
        const w = Math.abs(element.end.x - element.start.x);
        const h = Math.abs(element.end.y - element.start.y);
        const slant = Math.min(w * 0.35, h * 0.8);
        const points = [
          [x + slant, y],
          [x + w, y],
          [x + w - slant, y + h],
          [x, y + h]
        ];

        if (isClean) {
          context.beginPath();
          context.moveTo(points[0][0], points[0][1]);
          for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
          context.closePath();
          if (fillColor) {
            context.globalAlpha = fillOpacity;
            context.fill();
            context.globalAlpha = 1;
          }
          context.stroke();
        } else {
          rc.polygon(points, options);
        }
      }
      break;

    case 'deltoid':
      if (element.start && element.end) {
        const x = Math.min(element.start.x, element.end.x);
        const y = Math.min(element.start.y, element.end.y);
        const w = Math.abs(element.end.x - element.start.x);
        const h = Math.abs(element.end.y - element.start.y);
        const cx = x + w / 2;
        const points = [
          [cx, y],
          [x + w, y + h / 2],
          [cx, y + h],
          [x, y + h / 2]
        ];

        if (isClean) {
          context.beginPath();
          context.moveTo(points[0][0], points[0][1]);
          for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
          context.closePath();
          if (fillColor) {
            context.globalAlpha = fillOpacity;
            context.fill();
            context.globalAlpha = 1;
          }
          context.stroke();
        } else {
          rc.polygon(points, options);
        }
      }
      break;

    case 'diamond':
      if (element.start && element.end) {
        const centerX = (element.start.x + element.end.x) / 2;
        const centerY = (element.start.y + element.end.y) / 2;
        const width = Math.abs(element.end.x - element.start.x);
        const height = Math.abs(element.end.y - element.start.y);
        const points = [
          [centerX, centerY - height / 2],
          [centerX + width / 2, centerY],
          [centerX, centerY + height / 2],
          [centerX - width / 2, centerY]
        ];

        if (isClean) {
          context.beginPath();
          context.moveTo(points[0][0], points[0][1]);
          for (let i = 1; i < points.length; i++) {
            context.lineTo(points[i][0], points[i][1]);
          }
          context.closePath();
          if (fillColor) {
            context.globalAlpha = fillOpacity;
            context.fill();
            context.globalAlpha = 1;
          }
          context.stroke();
        } else {
          rc.polygon(points, options);
        }
      }
      break;

    case 'cuboid':
      if (element.start && element.end) {
        const x = Math.min(element.start.x, element.end.x);
        const y = Math.min(element.start.y, element.end.y);
        const w = Math.abs(element.end.x - element.start.x);
        const h = Math.abs(element.end.y - element.start.y);
        const depth = Math.min(w, h) * 0.25;

        const front = [
          [x, y + depth],
          [x + w - depth, y + depth],
          [x + w - depth, y + h],
          [x, y + h]
        ];
        const back = [
          [x + depth, y],
          [x + w, y],
          [x + w, y + h - depth],
          [x + depth, y + h - depth]
        ];

        if (isClean) {
          const drawPoly = (pts) => {
            context.beginPath();
            context.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) context.lineTo(pts[i][0], pts[i][1]);
            context.closePath();
            context.stroke();
          };
          drawPoly(front);
          drawPoly(back);
          context.beginPath();
          context.moveTo(front[0][0], front[0][1]); context.lineTo(back[0][0], back[0][1]);
          context.moveTo(front[1][0], front[1][1]); context.lineTo(back[1][0], back[1][1]);
          context.moveTo(front[2][0], front[2][1]); context.lineTo(back[2][0], back[2][1]);
          context.moveTo(front[3][0], front[3][1]); context.lineTo(back[3][0], back[3][1]);
          context.stroke();
        } else {
          rc.polygon(front, options);
          rc.polygon(back, options);
          rc.line(front[0][0], front[0][1], back[0][0], back[0][1], options);
          rc.line(front[1][0], front[1][1], back[1][0], back[1][1], options);
          rc.line(front[2][0], front[2][1], back[2][0], back[2][1], options);
          rc.line(front[3][0], front[3][1], back[3][0], back[3][1], options);
        }
      }
      break;

    case 'tetrahedron':
      if (element.start && element.end) {
        const x = Math.min(element.start.x, element.end.x);
        const y = Math.min(element.start.y, element.end.y);
        const w = Math.abs(element.end.x - element.start.x);
        const h = Math.abs(element.end.y - element.start.y);
        const apex = [x + w / 2, y];
        const left = [x, y + h];
        const right = [x + w, y + h];
        const back = [x + w / 2, y + h * 0.65];

        const faces = [
          [left, right, back],
          [apex, left, back],
          [apex, right, back],
          [apex, left, right]
        ];

        if (isClean) {
          faces.forEach((pts, idx) => {
            context.beginPath();
            context.moveTo(pts[0][0], pts[0][1]);
            context.lineTo(pts[1][0], pts[1][1]);
            context.lineTo(pts[2][0], pts[2][1]);
            context.closePath();
            if (idx === 0) {
              context.setLineDash([5, 5]);
              context.stroke();
              context.setLineDash([]);
            } else {
              context.stroke();
            }
          });
        } else {
          faces.forEach((pts, idx) => {
            rc.polygon(pts, idx === 0 ? { ...options, strokeLineDash: [6, 4] } : options);
          });
        }
      }
      break;

    case 'text':
      // Allow drawing if either 'position' object exists OR top-level x/y exist
      if ((element.position || (element.x !== undefined && element.y !== undefined)) && element.text) {
        drawText(context, element);
      }
      break;

    case 'image':
      if (imageCache) {
        drawImage(context, element, imageCache, requestRedraw);
      }
      break;

    // --- Advanced Shapes (RoughJS Implementation) ---

    case 'coordinateSystem2D':
      if (element.position) drawCoordinateSystem2D(rc, context, element, options, isClean);
      break;

    case 'mathFunctionPlot':
      if (element.position && element.expression) drawMathFunctionPlot(rc, context, element, options, isClean);
      break;

    case 'physicsDataPlot':
      if (element.position) drawPhysicsDataPlot(rc, context, element, options, isClean);
      break;

    case 'coordinateSystem3D':
      if (element.position) drawCoordinateSystem3D(rc, context, element, options, isClean);
      break;

    // --- 3D Primitives (2D Projection) ---
    case 'cube':
      drawCube(rc, context, element, options, isClean);
      break;
    case 'sphere':
      drawSphere(rc, context, element, options, isClean);
      break;
    case 'cylinder':
      drawCylinder(rc, context, element, options, isClean);
      break;
    case 'pyramid':
      drawPyramid(rc, context, element, options, isClean);
      break;
    case 'cone':
      drawCone(rc, context, element, options, isClean);
      break;

    default:
      break;
  }

  context.restore();
};

// --- Helper Functions ---

const drawArrowhead = (context, rc, from, to, options, isClean) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = 15;
  const x1 = to.x - headLength * Math.cos(angle - Math.PI / 6);
  const y1 = to.y - headLength * Math.sin(angle - Math.PI / 6);
  const x2 = to.x - headLength * Math.cos(angle + Math.PI / 6);
  const y2 = to.y - headLength * Math.sin(angle + Math.PI / 6);

  if (isClean) {
    context.beginPath();
    context.moveTo(to.x, to.y);
    context.lineTo(x1, y1);
    context.moveTo(to.x, to.y);
    context.lineTo(x2, y2);
    context.stroke();
  } else {
    rc.line(to.x, to.y, x1, y1, options);
    rc.line(to.x, to.y, x2, y2, options);
  }
};

const drawText = (context, element) => {
  const fontSize = element.fontSize || 16;
  const fontWeight = element.fontWeight || '600';
  const fontFamily = element.fontFamily || '"Inter", "Segoe UI", "Helvetica Neue", sans-serif';
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  context.textAlign = element.align || 'left';
  context.textBaseline = element.baseline || 'top';
  context.fillStyle = element.color || '#000000';

  // Fallback to top-level x/y if position object is missing
  const posX = element.position ? element.position.x : element.x;
  const posY = element.position ? element.position.y : element.y;

  if (posX === undefined || posY === undefined) return;

  if (element.maxWidth) {
    context.fillText(element.text, posX, posY, element.maxWidth);
  } else {
    context.fillText(element.text, posX, posY);
  }
};

const drawImage = (context, element, imageCache, requestRedraw) => {
  const { dataUrl, position, width, height } = element;
  // Allow top-level x/y
  const posX = position ? position.x : element.x;
  const posY = position ? position.y : element.y;

  if (!dataUrl || (posX === undefined || posY === undefined)) return;

  let img = imageCache.get(dataUrl);
  if (img) {
    if (img.complete && img.naturalWidth > 0) {
      context.drawImage(img, posX, posY, width, height);
    }
  } else {
    img = new Image();
    img.onload = () => requestRedraw && requestRedraw();
    img.src = dataUrl;
    imageCache.set(dataUrl, img);
  }
};

// --- Graph & Plot Implementations ---

const drawCoordinateSystem2D = (rc, context, element, options, isClean) => {
  const { x, y } = element.position;
  const { width, height, xLabel, yLabel } = element;

  // Axes
  if (isClean) {
    context.beginPath();
    context.moveTo(x, y + height / 2);
    context.lineTo(x + width, y + height / 2); // X
    context.moveTo(x + width / 2, y);
    context.lineTo(x + width / 2, y + height); // Y
    context.stroke();
  } else {
    rc.line(x, y + height / 2, x + width, y + height / 2, options); // X
    rc.line(x + width / 2, y, x + width / 2, y + height, options); // Y
  }

  // Arrows
  drawArrowhead(context, rc, { x, y: y + height / 2 }, { x: x + width, y: y + height / 2 }, options, isClean);
  drawArrowhead(context, rc, { x: x + width / 2, y: y + height }, { x: x + width / 2, y }, options, isClean);

  // Labels
  context.fillStyle = options.stroke;
  context.font = '16px sans-serif';
  context.fillText(xLabel || 'x', x + width - 15, y + height / 2 + 10);
  context.fillText(yLabel || 'y', x + width / 2 + 10, y);
};

const drawMathFunctionPlot = (rc, context, element, options, isClean) => {
  const { x: plotX, y: plotY } = element.position;
  const { width, height, expression } = element;

  // Draw axes first
  drawCoordinateSystem2D(rc, context, { ...element, xLabel: 'x', yLabel: 'f(x)' }, { ...options, stroke: '#666' }, isClean);

  // Plot function
  try {
    const compiled = math.compile(expression || 'x');
    const points = [];
    const steps = 100;
    const xMin = -10, xMax = 10;
    const yMin = -10, yMax = 10;

    for (let i = 0; i <= steps; i++) {
      const xVal = xMin + (xMax - xMin) * (i / steps);
      const scope = { x: xVal };
      const yVal = compiled.evaluate(scope);

      if (typeof yVal === 'number' && isFinite(yVal)) {
        const canvasX = plotX + ((xVal - xMin) / (xMax - xMin)) * width;
        const canvasY = plotY + height - ((yVal - yMin) / (yMax - yMin)) * height;

        if (canvasY >= plotY && canvasY <= plotY + height) {
          points.push([canvasX, canvasY]);
        } else {
          if (points.length > 1) {
            if (isClean) drawCleanCurve(context, points, element.color || '#007bff');
            else rc.curve(points, { ...options, stroke: element.color || '#007bff', strokeWidth: 3 });
          }
          points.length = 0;
        }
      }
    }
    if (points.length > 1) {
      if (isClean) drawCleanCurve(context, points, element.color || '#007bff');
      else rc.curve(points, { ...options, stroke: element.color || '#007bff', strokeWidth: 3 });
    }

  } catch (e) {
    context.fillText('Error', plotX, plotY);
  }
};

const drawCleanCurve = (context, points, color) => {
  if (points.length < 2) return;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i][0], points[i][1]);
  }
  context.stroke();
  context.restore();
};

const drawPhysicsDataPlot = (rc, context, element, options, isClean) => {
  const { x: plotX, y: plotY } = element.position;
  const { width, height, xData, yData } = element;

  // Axes
  drawCoordinateSystem2D(rc, context, { ...element, xLabel: 't', yLabel: 'v' }, { ...options, stroke: '#666' }, isClean);

  if (!xData || !yData || xData.length === 0) return;

  const xMin = Math.min(...xData), xMax = Math.max(...xData);
  const yMin = Math.min(...yData), yMax = Math.max(...yData);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const points = xData.map((val, i) => {
    const cx = plotX + ((val - xMin) / xRange) * width;
    const cy = plotY + height - ((yData[i] - yMin) / yRange) * height;
    return [cx, cy];
  });

  // Draw curve
  if (isClean) drawCleanCurve(context, points, element.color || '#dc3545');
  else rc.curve(points, { ...options, stroke: element.color || '#dc3545', strokeWidth: 3 });

  // Draw points
  points.forEach(([px, py]) => {
    if (isClean) {
      context.fillStyle = element.color || '#dc3545';
      context.beginPath();
      context.arc(px, py, 3, 0, 2 * Math.PI);
      context.fill();
    } else {
      rc.circle(px, py, 6, { ...options, fill: element.color || '#dc3545', fillStyle: 'solid' });
    }
  });
};

const drawCoordinateSystem3D = (rc, context, element, options, isClean) => {
  const { x, y } = element.position;
  const size = element.size || 200;
  const half = size / 2;

  // Center
  const cx = x, cy = y;

  // Axes (Isometric-ish)
  const xEnd = { x: cx + half, y: cy + half * 0.5 };
  const yEnd = { x: cx - half, y: cy + half * 0.5 };
  const zEnd = { x: cx, y: cy - half };

  if (isClean) {
    context.beginPath();
    context.moveTo(cx, cy); context.lineTo(xEnd.x, xEnd.y);
    context.moveTo(cx, cy); context.lineTo(yEnd.x, yEnd.y);
    context.moveTo(cx, cy); context.lineTo(zEnd.x, zEnd.y);
    context.stroke();
  } else {
    rc.line(cx, cy, xEnd.x, xEnd.y, options);
    rc.line(cx, cy, yEnd.x, yEnd.y, options);
    rc.line(cx, cy, zEnd.x, zEnd.y, options);
  }

  context.fillText('x', xEnd.x, xEnd.y);
  context.fillText('y', yEnd.x, yEnd.y);
  context.fillText('z', zEnd.x, zEnd.y);
};

// --- 3D Shapes ---

const drawCube = (rc, context, element, options, isClean) => {
  const { start, end } = element;
  const size = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  const pointsFront = [[x, y + size * 0.25], [x + size, y + size * 0.25], [x + size, y + size + size * 0.25], [x, y + size + size * 0.25]];
  const pointsTop = [[x, y + size * 0.25], [x + size * 0.5, y], [x + size * 1.5, y], [x + size, y + size * 0.25]];
  const pointsSide = [[x + size, y + size * 0.25], [x + size * 1.5, y], [x + size * 1.5, y + size], [x + size, y + size + size * 0.25]];

  if (isClean) {
    const drawPoly = (pts) => {
      context.beginPath();
      context.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) context.lineTo(pts[i][0], pts[i][1]);
      context.closePath();
      context.stroke();
    };
    drawPoly(pointsFront);
    drawPoly(pointsTop);
    drawPoly(pointsSide);
  } else {
    rc.rectangle(x, y + size * 0.25, size, size, options);
    rc.polygon(pointsTop, options);
    rc.polygon(pointsSide, options);
  }
};

const drawSphere = (rc, context, element, options, isClean) => {
  const cx = (element.start.x + element.end.x) / 2;
  const cy = (element.start.y + element.end.y) / 2;
  const w = Math.abs(element.end.x - element.start.x);

  if (isClean) {
    context.beginPath();
    context.arc(cx, cy, w / 2, 0, 2 * Math.PI);
    context.stroke();
    context.beginPath();
    context.ellipse(cx, cy, w / 2, w * 0.15, 0, 0, 2 * Math.PI);
    context.stroke();
  } else {
    rc.circle(cx, cy, w, options);
    rc.ellipse(cx, cy, w, w * 0.3, options); // Equator
  }
};

const drawCylinder = (rc, context, element, options, isClean) => {
  const w = Math.abs(element.end.x - element.start.x);
  const h = Math.abs(element.end.y - element.start.y);
  const x = Math.min(element.start.x, element.end.x);
  const y = Math.min(element.start.y, element.end.y);

  if (isClean) {
    context.beginPath();
    context.ellipse(x + w / 2, y, w / 2, w * 0.15, 0, 0, 2 * Math.PI);
    context.stroke();
    context.beginPath();
    context.ellipse(x + w / 2, y + h, w / 2, w * 0.15, 0, 0, 2 * Math.PI);
    context.stroke();
    context.beginPath();
    context.moveTo(x, y); context.lineTo(x, y + h);
    context.moveTo(x + w, y); context.lineTo(x + w, y + h);
    context.stroke();
  } else {
    rc.ellipse(x + w / 2, y, w, w * 0.3, options); // Top
    rc.ellipse(x + w / 2, y + h, w, w * 0.3, options); // Bottom
    rc.line(x, y, x, y + h, options);
    rc.line(x + w, y, x + w, y + h, options);
  }
};

const drawPyramid = (rc, context, element, options, isClean) => {
  const w = Math.abs(element.end.x - element.start.x);
  const h = Math.abs(element.end.y - element.start.y);
  const x = Math.min(element.start.x, element.end.x);
  const y = Math.min(element.start.y, element.end.y);

  const top = { x: x + w / 2, y: y };
  const bl = { x: x, y: y + h };
  const br = { x: x + w, y: y + h };
  const back = { x: x + w * 0.7, y: y + h * 0.8 };

  if (isClean) {
    context.beginPath();
    context.moveTo(bl.x, bl.y);
    context.lineTo(br.x, br.y);
    context.lineTo(top.x, top.y);
    context.closePath();
    context.stroke();

    context.beginPath();
    context.setLineDash([5, 5]);
    context.moveTo(top.x, top.y);
    context.lineTo(back.x, back.y);
    context.stroke();
    context.setLineDash([]);
  } else {
    rc.polygon([
      [bl.x, bl.y], [br.x, br.y], [top.x, top.y]
    ], options);
    rc.line(top.x, top.y, back.x, back.y, { ...options, strokeLineDash: [5, 5] });
  }
};

const drawCone = (rc, context, element, options, isClean) => {
  const w = Math.abs(element.end.x - element.start.x);
  const h = Math.abs(element.end.y - element.start.y);
  const x = Math.min(element.start.x, element.end.x);
  const y = Math.min(element.start.y, element.end.y);

  if (isClean) {
    context.beginPath();
    context.ellipse(x + w / 2, y + h, w / 2, w * 0.15, 0, 0, 2 * Math.PI);
    context.stroke();
    context.beginPath();
    context.moveTo(x, y + h);
    context.lineTo(x + w / 2, y);
    context.lineTo(x + w, y + h);
    context.stroke();
  } else {
    rc.ellipse(x + w / 2, y + h, w, w * 0.3, options);
    rc.line(x, y + h, x + w / 2, y, options);
    rc.line(x + w, y + h, x + w / 2, y, options);
  }
}

// Export hit detection (kept mostly same but imported)

// For now, let's keep the hit detection logic in this file to avoid breaking imports if it was here before.
// Re-implementing basic hit detection here for completeness as per instruction "Replace entire file".

export const distanceToSegment = (p, v, w) => {
  const l2 = Math.pow(w.x - v.x, 2) + Math.pow(w.y - v.y, 2);
  if (l2 === 0) return Math.sqrt(Math.pow(p.x - v.x, 2) + Math.pow(p.y - v.y, 2));
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const px = v.x + t * (w.x - v.x);
  const py = v.y + t * (w.y - v.y);
  return Math.sqrt(Math.pow(p.x - px, 2) + Math.pow(p.y - py, 2));
};

export const isPointInElement = (point, element, hitDistance = 10) => {
  if (!element || !element.type) return false;

  // Simplified hit detection for now
  const { start, end, position, width, height } = element;

  // Check for position object OR top-level x/y (used by text/images)
  const posX = position ? position.x : element.x;
  const posY = position ? position.y : element.y;

  if (posX !== undefined && posY !== undefined && width && height) {
    return point.x >= posX - hitDistance &&
      point.x <= posX + width + hitDistance &&
      point.y >= posY - hitDistance &&
      point.y <= posY + height + hitDistance;
  }

  if (start && end) {
    const minX = Math.min(start.x, end.x) - hitDistance;
    const maxX = Math.max(start.x, end.x) + hitDistance;
    const minY = Math.min(start.y, end.y) - hitDistance;
    const maxY = Math.max(start.y, end.y) + hitDistance;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }

  if (element.points) {
    for (let i = 0; i < element.points.length - 1; i++) {
      if (distanceToSegment(point, element.points[i], element.points[i + 1]) < hitDistance) return true;
    }
  }

  return false;
};
