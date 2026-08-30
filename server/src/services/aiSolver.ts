import nodeFetch, { Response, RequestInit } from 'node-fetch';
import { HttpError } from './httpError';
import { create, all } from 'mathjs';
import { logger } from '../logger';
import type { FactoryFunctionMap } from 'mathjs';

export interface EquationSolver {
  solveEquation(equation: string): Promise<string>;
  solveEquationFromImage(imageBase64: string): Promise<{ equation: string; solution: string }>;
  chatWithVision?(
    messages: Array<{ role: string; content: string; image?: string }>
  ): Promise<string>;
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

const resolveFetch = (): FetchImpl => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as unknown as FetchImpl;
  }
  return nodeFetch as unknown as FetchImpl;
};

const math = create(all as FactoryFunctionMap, { number: 'number', precision: 12 });
const RESERVED_FUNCTION_NAMES = new Set([
  'sin', 'cos', 'tan', 'log', 'ln', 'sqrt', 'pow', 'abs', 'exp', 'max', 'min', 'mod', 'round', 'floor', 'ceil'
]);

const normalizeEquationText = (text: string): string => {
  if (!text) return '';
  let cleaned = text
    .replace(/\\cdot|·|⋅|∙|×/g, '*')
    .replace(/÷/g, '/')
    .replace(/—|–/g, '-')
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

const detectVariableName = (expression: string): string | null => {
  const matches = expression.match(/[a-zA-Z]+/g);
  if (!matches) return null;
  return matches.find((name) => !RESERVED_FUNCTION_NAMES.has(name.toLowerCase())) || null;
};

const tryEvaluateExpression = (expression: string, scope: Record<string, number> = {}) => {
  try {
    return math.evaluate(expression, scope);
  } catch {
    return null;
  }
};

const evaluateCompiled = (compiled: any, variable: string, value: number) => {
  try {
    return compiled.evaluate({ [variable]: value });
  } catch {
    return NaN;
  }
};

const bisectRoot = (compiled: any, variable: string, a: number, b: number, iterations = 40): number | null => {
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

const findRoot = (compiled: any, variable: string): number | null => {
  const ranges: Array<[number, number]> = [
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

const solveEquationLocally = (equationText: string): string | null => {
  const normalized = normalizeEquationText(equationText);
  if (!normalized) return null;

  if (!normalized.includes('=')) {
    const value = tryEvaluateExpression(normalized);
    if (value === null || value === undefined) return null;
    return math.format(value, { precision: 6 }) as string;
  }

  const [lhs, rhs] = normalized.split('=');
  if (!lhs || !rhs) return null;

  const variable = detectVariableName(lhs + rhs);
  if (!variable) {
    const leftVal = tryEvaluateExpression(lhs);
    const rightVal = tryEvaluateExpression(rhs);
    if (leftVal === null || rightVal === null) return null;
    if (Math.abs(Number(leftVal) - Number(rightVal)) < 1e-9) {
      return math.format(leftVal, { precision: 6 }) as string;
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

export interface OpenRouterSolverOptions {
  fetchImpl?: FetchImpl;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class OpenRouterEquationSolver implements EquationSolver {
  private readonly fetchImpl: FetchImpl;
  private readonly ocrModel: string;
  private readonly solverModel: string;
  private readonly chatModel: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(options: OpenRouterSolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? resolveFetch();
    // Use configured models or defaults
    this.ocrModel = process.env.OCR_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free';
    this.solverModel = process.env.SOLVER_MODEL || 'deepseek/deepseek-r1:free';
    this.chatModel = process.env.CHAT_MODEL || process.env.OCR_MODEL || 'openai/gpt-4o-mini';
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens ?? 1024; // Increased for chain of thought
  }

  async solveEquation(equation: string): Promise<string> {
    const normalized = equation?.trim();
    const localSolution = normalized ? solveEquationLocally(normalized) : null;
    if (localSolution) return localSolution;

    try {
      return await this.callSolver(normalized);
    } catch (error) {
      const fallback = normalized ? solveEquationLocally(normalized) : null;
      if (fallback) return fallback;
      throw error;
    }
  }

  async solveEquationFromImage(imageBase64: string): Promise<{ equation: string; solution: string }> {
    // Step 1: OCR
    const extractedEquation = await this.callOCR(imageBase64);
    if (!extractedEquation) {
      throw new Error('Could not extract equation from image.');
    }

    // Step 2: Solve
    const localSolution = solveEquationLocally(extractedEquation);
    if (localSolution) {
      return { equation: extractedEquation, solution: localSolution };
    }

    try {
      const solution = await this.callSolver(extractedEquation);
      return { equation: extractedEquation, solution };
    } catch (error) {
      const fallback = solveEquationLocally(extractedEquation);
      if (fallback) {
        return { equation: extractedEquation, solution: fallback };
      }
      throw error;
    }
  }

  private async callOCR(imageBase64: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new HttpError(500, 'OPENROUTER_API_KEY is not configured.');

    // Define fallback models for OCR
    const fallbackModels = [
      this.ocrModel,
      process.env.OCR_MODEL_FALLBACK_1 || 'x-ai/grok-4.1-fast:free',
      process.env.OCR_MODEL_FALLBACK_2 || 'nvidia/nemotron-nano-12b-v2-vl:free',
    ];

    let lastError: Error | null = null;

    for (const currentModel of fallbackModels) {
      try {
        const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: currentModel,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Transcribe the mathematical equation in this image into LaTeX format. Return ONLY the LaTeX string, no other text.' },
                  { type: 'image_url', image_url: { url: imageBase64 } }
                ]
              }
            ]
          })
        });

        if (!response.ok) {
          const text = await response.text();
          throw new HttpError(response.status, `OCR request failed for model ${currentModel} (${response.status})`, text);
        }

        const payload = (await response.json()) as any;
        const content = payload.choices?.[0]?.message?.content?.trim();

        // Success!
        logger.info('[AI] OCR successfully used model', { model: currentModel });
        return content ? content.replace(/```latex|```/g, '').trim() : '';
      } catch (error) {
        lastError = error as Error;
        logger.warn('[AI] OCR model failed', { model: currentModel, error: (error as Error).message });

        if (currentModel !== fallbackModels[fallbackModels.length - 1]) {
          logger.info('[AI] Trying fallback OCR model');
          continue;
        }

        throw error;
      }
    }

    throw lastError || new HttpError(502, 'All OCR models failed');
  }

  private async callSolver(equation: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new HttpError(500, 'OPENROUTER_API_KEY is not configured.');

    const systemPrompt =
      'You are a precise math engine. ' +
      'Return ONLY the final result, formatted succinctly so it can be drawn to the right of an equals sign. ' +
      'If the input is a LaTeX equation, solve it.';
    const userPrompt = `Solve this equation and return just the final result: ${equation}`;

    // Define fallback models for Solver
    const fallbackModels = [
      this.solverModel,
      process.env.SOLVER_MODEL_FALLBACK_1 || 'x-ai/grok-4.1-fast:free',
      process.env.SOLVER_MODEL_FALLBACK_2 || 'deepseek/deepseek-r1:free',
    ];

    let lastError: Error | null = null;

    for (const currentModel of fallbackModels) {
      try {
        const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: currentModel,
            temperature: this.temperature,
            max_tokens: this.maxTokens,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ]
          })
        });

        if (!response.ok) {
          const text = await response.text();
          throw new HttpError(response.status, `Solver request failed for model ${currentModel} (${response.status})`, text);
        }

        const payload = (await response.json()) as any;
        const result = payload.choices?.[0]?.message?.content?.trim() || '';

        // Success!
        logger.info('[AI] Solver successfully used model', { model: currentModel });
        return result;
      } catch (error) {
        lastError = error as Error;
        logger.warn('[AI] Solver model failed', { model: currentModel, error: (error as Error).message });

        if (currentModel !== fallbackModels[fallbackModels.length - 1]) {
          logger.info('[AI] Trying fallback Solver model');
          continue;
        }

        throw error;
      }
    }

    throw lastError || new HttpError(502, 'All Solver models failed');
  }
  async chatWithVision(messages: Array<{ role: string; content: string; image?: string }>): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');

    // Prepare messages for OpenRouter
    const apiMessages = messages.map(msg => {
      if (msg.image) {
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content || 'Analyze this image.' },
            { type: 'image_url', image_url: { url: msg.image } }
          ]
        };
      } else {
        return {
          role: msg.role,
          content: msg.content
        };
      }
    });

    // Add system prompt if not present
    if (!apiMessages.some(m => m.role === 'system')) {
      apiMessages.unshift({
        role: 'system',
        content: 'You are a helpful AI assistant integrated into a whiteboard application. You can see the whiteboard content via snapshots. Answer questions about the content, solve math problems, explain diagrams, or provide creative suggestions. Be concise and helpful.'
      });
    }

    const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://whitevue.local',
        'X-Title': 'WhiteVue AI Assistant'
      },
      body: JSON.stringify({
        model: this.chatModel, // Vision-capable chat model
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('[AI Solver] Vision Chat request failed', { status: response.status });
      throw new Error(`Vision Chat request failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as any;
    return payload.choices?.[0]?.message?.content?.trim() || '';
  }
}
