// MathRecognizerModule.js
// Recognizes handwritten equations and renders lightweight AI-based previews.

import * as math from 'mathjs';
import Tesseract from 'tesseract.js';
import axios from 'axios';
import { resolveBackendBaseUrl } from '../services/backendUrl';

// Resolve backend base URL for AI calls (sanitized for HTTPS/mixed-content).
const BACKEND_BASE_URL = resolveBackendBaseUrl();

const RESERVED_FUNCTION_NAMES = new Set([
  'sin', 'cos', 'tan', 'log', 'ln', 'sqrt', 'pow', 'abs', 'exp', 'max', 'min', 'mod', 'round', 'floor', 'ceil'
]);

const normalizeEquationText = (text = '') => {
  if (!text) return '';
  let cleaned = text
    .replace(/\\cdot|·|⋅|∙|×/g, '*')
    .replace(/÷/g, '/')
    .replace(/—|–/g, '-')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\\left|\\right/g, '')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, '');

  cleaned = cleaned
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\\frac\(([^)]+)\)\(([^)]+)\)/g, '($1)/($2)')
    .replace(/\^\{([^}]+)\}/g, '^($1)')
    .replace(/[{}]/g, match => (match === '{' ? '(' : ')'))
    .replace(/\$/g, '');

  return cleaned.trim();
};

const detectVariableName = (expression = '') => {
  const matches = expression.match(/[a-zA-Z]+/g);
  if (!matches) return null;
  return matches.find(name => !RESERVED_FUNCTION_NAMES.has(name.toLowerCase()));
};

const tryEvaluateExpression = (expression, scope = {}) => {
  try {
    return math.evaluate(expression, scope);
  } catch {
    return null;
  }
};

const evaluateCompiled = (compiled, variable, value) => {
  try {
    return compiled.evaluate({ [variable]: value });
  } catch {
    return NaN;
  }
};

const bisectRoot = (compiled, variable, a, b, iterations = 40) => {
  let fa = evaluateCompiled(compiled, variable, a);
  let fb = evaluateCompiled(compiled, variable, b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;

  for (let i = 0; i < iterations; i += 1) {
    const mid = (a + b) / 2;
    const fm = evaluateCompiled(compiled, variable, mid);
    if (!Number.isFinite(fm)) break;
    if (Math.abs(fm) < 1e-7) return mid;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
      fb = fm;
    }
  }
  return (a + b) / 2;
};

const findRoot = (compiled, variable) => {
  const ranges = [
    [-100, 100],
    [-50, 50],
    [-10, 10],
    [-5, 5],
    [0, 50],
    [-50, 0]
  ];

  for (const [start, end] of ranges) {
    const steps = 60;
    let prevX = start;
    let prevY = evaluateCompiled(compiled, variable, start);

    for (let i = 1; i <= steps; i += 1) {
      const x = start + ((end - start) * i) / steps;
      const y = evaluateCompiled(compiled, variable, x);
      if (!Number.isFinite(y)) {
        prevX = x;
        prevY = y;
        continue;
      }
      if (Math.abs(y) < 1e-6) return x;
      if (Number.isFinite(prevY) && Math.sign(y) !== Math.sign(prevY)) {
        return bisectRoot(compiled, variable, prevX, x);
      }
      prevX = x;
      prevY = y;
    }
  }
  return null;
};

const buildLatexFromExpression = (expression) => {
  try {
    const node = math.parse(expression);
    return node.toTex({ parenthesis: 'keep' });
  } catch {
    return '';
  }
};

const solveEquationLocally = (equationText = '') => {
  const normalized = normalizeEquationText(equationText);
  if (!normalized) return null;

  // Simple expression without equality
  if (!normalized.includes('=')) {
    const value = tryEvaluateExpression(normalized);
    if (value === null || value === undefined) return null;
    return math.format(value, { precision: 6 });
  }

  const [lhs, rhs] = normalized.split('=');
  if (!lhs || !rhs) return null;

  const variable = detectVariableName(lhs + rhs);
  if (!variable) {
    const leftVal = tryEvaluateExpression(lhs);
    const rightVal = tryEvaluateExpression(rhs);
    if (leftVal === null || rightVal === null) return null;
    if (Math.abs(Number(leftVal) - Number(rightVal)) < 1e-9) {
      return math.format(leftVal, { precision: 6 });
    }
    return `${math.format(leftVal, { precision: 6 })} = ${math.format(rightVal, { precision: 6 })}`;
  }

  try {
    const diffNode = math.parse(`${lhs}-(${rhs})`);
    const compiled = diffNode.compile();
    const root = findRoot(compiled, variable);
    if (root !== null && Number.isFinite(root)) {
      return `${variable} ≈ ${math.format(root, { precision: 6 })}`;
    }
  } catch {
    return null;
  }

  return null;
};

export default class MathRecognizerModule {
  constructor(canvasContext, options = {}) {
    this.ctx = canvasContext;

    this.options = {
      renderLatex: true,
      ghostOpacity: options.ghostOpacity ?? 0.5, // Increased default opacity
      recognitionDelay: options.recognitionDelay ?? 1500, // Increased delay for auto-mode
      autoRecognize: options.autoRecognize ?? true, // Default to true
      debug: options.debug ?? false,
      backendUrl: options.backendUrl || BACKEND_BASE_URL,
      showHint: options.showHint ?? true,
      ...options,
    };

    this.strokes = [];
    this.equationStrokes = [];
    this.ghostAnswer = null;
    this.recognitionStatus = '';
    this.latexEquation = '';
    this.solution = '';
    this.enabled = false;
    this.renderLatexFn = options.renderLatexFn || null;
    this.recognitionTimeout = null;
    // 7.7: AbortController to cancel concurrent requests
    this.abortController = null;
  }

  logDebug(...args) {
    if (this.options.debug) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  }

  // Enable / disable
  enable() {
    this.enabled = true;
    return this;
  }

  disable() {
    this.enabled = false;
    this.clearRecognitionState();
    if (this.recognitionTimeout) {
      clearTimeout(this.recognitionTimeout);
      this.recognitionTimeout = null;
    }
    return this;
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
    // If auto-recognize is turned off, clear any pending timeout
    if (!this.options.autoRecognize && this.recognitionTimeout) {
      clearTimeout(this.recognitionTimeout);
      this.recognitionTimeout = null;
    }
    return this;
  }

  setLatexRenderer(renderFn) {
    this.renderLatexFn = renderFn;
    return this;
  }

  renderLatexSafe(latexString) {
    if (this.renderLatexFn && this.options.renderLatex) {
      try {
        this.renderLatexFn(latexString || '');
      } catch (error) {
        this.logDebug('[Math] Latex render failed', error);
      }
    }
  }

  async runLocalOcrAndSolve(imageBase64) {
    try {
      // 5.2: Create worker explicitly so we can terminate it after use
      const worker = await Tesseract.createWorker('eng');
      const { data } = await worker.recognize(imageBase64);
      await worker.terminate();
      const rawEquation = data?.text || '';
      const normalized = normalizeEquationText(rawEquation);
      if (!normalized) {
        this.logDebug('[Math] Local OCR returned empty string');
        return null;
      }

      const latex = buildLatexFromExpression(normalized) || normalized;
      this.latexEquation = latex;
      this.renderLatexSafe(latex);

      const solution = solveEquationLocally(normalized);
      if (solution) {
        this.solution = solution;
        this.generateGhostAnswer(solution);
        this.recognitionStatus = 'Solved locally';
        return { latex, solution };
      }

      this.recognitionStatus = 'Equation read, solving...';
      return { latex, solution: '' };
    } catch (error) {
      this.logDebug('[Math] Local OCR failed', error);
      return null;
    }
  }

  // Stroke management
  addStroke(stroke) {
    if (!this.enabled) return this;

    const equationStroke = { ...stroke, type: 'math' };
    this.equationStrokes.push(equationStroke);
    this.strokes.push(equationStroke);

    // Reset ghost answer when equation changes
    this.ghostAnswer = null;

    // Auto-recognition logic
    if (this.options.autoRecognize) {
      if (this.recognitionTimeout) {
        clearTimeout(this.recognitionTimeout);
      }
      // Debounce recognition
      this.recognitionTimeout = setTimeout(
        () => this.recognizeEquationWithAi(),
        this.options.recognitionDelay
      );
    }

    return this;
  }

  setStrokes(strokes) {
    this.strokes = [...strokes];
    this.equationStrokes = this.strokes.map((stroke) => ({
      ...stroke,
      type: 'math',
    }));
    this.clearRecognitionState();
    return this;
  }

  // Bounds helpers
  getStrokeBounds(stroke) {
    const points = stroke.points || [];
    if (!points.length) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const pt of points) {
      // Handle both [x, y] and {x, y} formats if necessary, though usually it's array or object
      const x = Array.isArray(pt) ? pt[0] : pt.x;
      const y = Array.isArray(pt) ? pt[1] : pt.y;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    return { minX, minY, maxX, maxY };
  }

  getEquationBounds() {
    if (!this.equationStrokes.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    this.equationStrokes.forEach((stroke) => {
      const bounds = this.getStrokeBounds(stroke);
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }

    return { minX, minY, maxX, maxY };
  }

  // Render equation strokes into a small offscreen canvas for OCR
  createEquationCanvas() {
    if (!this.ctx || !this.equationStrokes.length || typeof document === 'undefined') {
      return null;
    }

    const bounds = this.getEquationBounds();
    if (!bounds) return null;

    const padding = 20;
    const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX + padding * 2));
    const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY + padding * 2));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3; // Thicker for better recognition
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    this.equationStrokes.forEach((stroke) => {
      const pts = stroke.points || [];
      if (pts.length < 2) return;
      ctx.beginPath();

      const getX = (pt) => (Array.isArray(pt) ? pt[0] : pt.x) - bounds.minX + padding;
      const getY = (pt) => (Array.isArray(pt) ? pt[1] : pt.y) - bounds.minY + padding;

      ctx.moveTo(getX(pts[0]), getY(pts[0]));
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(getX(pts[i]), getY(pts[i]));
      }
      ctx.stroke();
    });

    return canvas;
  }

  // Backwards-compatible entry point – use AI-powered recognizer
  async recognizeEquation() {
    return this.recognizeEquationWithAi();
  }

  // Main OCR + LLM pipeline
  async recognizeEquationWithAi() {
    if (!this.enabled || !this.equationStrokes.length) {
      this.recognitionStatus = 'No equation to recognize.';
      return this;
    }

    // 7.7: Abort previous concurrent request
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.recognitionStatus = 'Thinking...';
    this.latexEquation = '';
    this.solution = '';
    this.ghostAnswer = null;

    try {
      const eqCanvas = this.createEquationCanvas();
      if (!eqCanvas) {
        this.recognitionStatus = 'Could not prepare equation image.';
        return this;
      }

      const imageBase64 = eqCanvas.toDataURL('image/png');

      // Try local OCR + mathjs solve first to avoid API rate limits
      let localResult = null;
      try {
        localResult = await this.runLocalOcrAndSolve(imageBase64);
        if (localResult?.solution) {
          return localResult;
        }
      } catch (localErr) {
        this.logDebug('[Math] Local solve failed', localErr);
      }

      // Backend fallback
      if (this.options.backendUrl) {
        try {
          const payload = localResult?.latex
            ? { equation: normalizeEquationText(localResult.latex) || localResult.latex }
            : { image: imageBase64 };
          const backendBase = this.options.backendUrl.replace(/\/$/, '');
          const resp = await axios.post(
            `${backendBase}/api/ai/solve-equation/`,
            payload,
            { signal } // 7.7: Pass abort signal
          );

          if (resp.data) {
            this.latexEquation = resp.data.equation || localResult?.latex || '';
            this.solution = resp.data.solution || '';
            if (this.latexEquation) {
              this.renderLatexSafe(this.latexEquation);
            }

            this.logDebug('[Math] Backend result:', { latex: this.latexEquation, solution: this.solution });

            if (
              this.solution &&
              typeof this.solution === 'string' &&
              !this.solution.toLowerCase().startsWith('error') &&
              !this.solution.toLowerCase().startsWith('cannot')
            ) {
              this.generateGhostAnswer(this.solution);
            }

            this.recognitionStatus = this.solution ? 'Solved!' : 'Parsed';
            return {
              latex: this.latexEquation,
              solution: this.solution,
            };
          }
        } catch (err) {
          console.error('Backend recognition failed:', err);
          if (err.response) {
            console.error('Backend error details:', err.response.status, err.response.data);
            this.recognitionStatus = `Error: ${err.response.data.error || 'AI Connection Failed'}`;
          } else {
            this.recognitionStatus = 'Error connecting to AI.';
          }

          // If backend failed but we have a local OCR result, return it
          if (localResult) {
            return {
              latex: localResult.latex || '',
              solution: this.solution || ''
            };
          }
        }
      }

      // As a last attempt, try local solve again if backend did not respond
      if (!this.solution && !this.latexEquation) {
        const fallbackLocal = await this.runLocalOcrAndSolve(imageBase64);
        if (fallbackLocal) {
          return fallbackLocal;
        }
      }

      this.recognitionStatus = 'Unable to solve equation.';
      return this;
    } catch (error) {
      this.recognitionStatus = 'Error: ' + (error.message || 'Unknown error');
      console.error('Recognition error (AI):', error);
      this.clearRecognitionState();
      return this;
    } finally {
      if (this.recognitionTimeout) {
        clearTimeout(this.recognitionTimeout);
        this.recognitionTimeout = null;
      }
    }
  }

  // Generate ghost answer (positioned after equals sign or at the end)
  generateGhostAnswer(solutionText) {
    const bounds = this.getEquationBounds();
    if (!bounds) return this;

    // Position to the right of the equation
    const startX = bounds.maxX + 20;
    const startY = (bounds.minY + bounds.maxY) / 2;

    this.ghostAnswer = {
      text: solutionText,
      x: startX,
      y: startY,
      color: `rgba(100, 100, 255, ${this.options.ghostOpacity})`, // Blue-ish hint
      font: 'bold 24px "Inter", sans-serif',
    };

    return this;
  }

  // Convert ghost answer into a simple stroke
  applyGhostAnswer() {
    if (!this.enabled || !this.ghostAnswer || !this.ghostAnswer.text) return null;

    const text = this.ghostAnswer.text;
    const startX = this.ghostAnswer.x;
    const startY = this.ghostAnswer.y;

    // Create a text element representation
    // Note: This structure needs to match what WhiteboardCanvas expects for text elements
    // or we create a stroke-based representation if we want it to be "handwritten"
    // For now, let's create a special "ai-answer" type that WhiteboardCanvas can handle

    const newElement = {
      type: 'text',
      x: startX,
      y: startY,
      text: text,
      color: '#0000FF', // Blue color for the answer
      fontSize: 24,
      id: 'ai-answer-' + Date.now(),
      timestamp: Date.now()
    };

    this.clearRecognitionState();
    return newElement;
  }

  // Draw ghost answer text on the canvas
  drawGhostAnswer(ctx = this.ctx) {
    if (!this.enabled || !this.ghostAnswer || !this.ghostAnswer.text || !ctx || !this.options.showHint) return this;

    ctx.save();
    ctx.fillStyle = this.ghostAnswer.color;
    ctx.font = this.ghostAnswer.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Draw background pill for better visibility
    const metrics = ctx.measureText(this.ghostAnswer.text);
    const padding = 8;
    const bgHeight = 32;
    const bgWidth = metrics.width + padding * 2;

    ctx.fillStyle = `rgba(240, 240, 255, 0.9)`;
    ctx.beginPath();
    const rx = this.ghostAnswer.x - padding;
    const ry = this.ghostAnswer.y - bgHeight / 2;
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(rx, ry, bgWidth, bgHeight, 8);
    } else {
      // Fallback for browsers without roundRect support
      const r = 8;
      ctx.moveTo(rx + r, ry);
      ctx.arcTo(rx + bgWidth, ry, rx + bgWidth, ry + bgHeight, r);
      ctx.arcTo(rx + bgWidth, ry + bgHeight, rx, ry + bgHeight, r);
      ctx.arcTo(rx, ry + bgHeight, rx, ry, r);
      ctx.arcTo(rx, ry, rx + bgWidth, ry, r);
      ctx.closePath();
    }
    ctx.fill();
    ctx.strokeStyle = `rgba(100, 100, 255, 0.5)`;
    ctx.stroke();

    // Draw text
    ctx.fillStyle = '#2563EB'; // Solid blue
    ctx.fillText(this.ghostAnswer.text, this.ghostAnswer.x, this.ghostAnswer.y);

    // Draw "Press Tab" hint
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#9CA3AF';
    ctx.fillText('Press Tab to insert', this.ghostAnswer.x, this.ghostAnswer.y + 24);

    ctx.restore();

    return this;
  }

  // Keyboard shortcut handler – use Tab to accept ghost answer
  handleKeyDown(e) {
    if (this.enabled && e.key === 'Tab' && this.ghostAnswer) {
      e.preventDefault();
      return this.applyGhostAnswer();
    }
    return null;
  }

  hasEquation() {
    return this.equationStrokes.length > 0;
  }

  clear() {
    this.equationStrokes = [];
    this.strokes = [];
    this.clearRecognitionState();
    if (this.recognitionTimeout) {
      clearTimeout(this.recognitionTimeout);
      this.recognitionTimeout = null;
    }
    return this;
  }

  clearRecognitionState() {
    this.ghostAnswer = null;
    this.latexEquation = '';
    this.solution = '';
    this.recognitionStatus = '';
    if (this.options.renderLatex && this.renderLatexFn) {
      this.renderLatexFn('');
    }
  }

  getRecognitionStatus() {
    return this.recognitionStatus;
  }

  getLatexEquation() {
    return this.latexEquation;
  }

  getSolution() {
    return this.solution;
  }
}

