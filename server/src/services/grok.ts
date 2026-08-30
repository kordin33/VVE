import nodeFetch, { RequestInit, Response } from 'node-fetch';
import { HttpError } from './httpError';
import { logger } from '../logger';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
};

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

const resolveFetch = (): FetchImpl => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as unknown as FetchImpl;
  }
  return nodeFetch as unknown as FetchImpl;
};

export interface CallGrokOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  fetchImpl?: FetchImpl;
}

export async function callGrok({
  messages,
  model = 'x-ai/grok-4.1-fast',
  temperature = 0.2,
  maxTokens = 800,
  fetchImpl,
}: CallGrokOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, 'OPENROUTER_API_KEY is not configured.');
  }

  // Determine fallback models based on the model type
  let fallbackModels: string[] = [];
  if (model.includes('grok') || model === process.env.CHAT_MODEL) {
    fallbackModels = [
      model,
      process.env.CHAT_MODEL_FALLBACK_1 || 'openai/gpt-oss-120b:exacto',
      process.env.CHAT_MODEL_FALLBACK_2 || 'nvidia/nemotron-nano-12b-v2-vl:free',
    ];
  } else {
    fallbackModels = [model];
  }

  const fetchClient = fetchImpl ?? resolveFetch();
  let lastError: Error | null = null;

  // Try each model in sequence
  for (const currentModel of fallbackModels) {
    try {
      const response = await fetchClient('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://whitevue.app',
          'X-Title': 'WhiteVue AI Assistant',
        },
        body: JSON.stringify({
          model: currentModel,
          temperature,
          max_tokens: maxTokens,
          messages,
        }),
      });

      if (!response.ok) {
        const text = await safeReadBody(response);
        throw new HttpError(response.status, `OpenRouter error ${response.status} for model ${currentModel}`, text);
      }

      const payload = (await response.json()) as any;
      const content = payload.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new HttpError(502, `Invalid OpenRouter response for model ${currentModel}: missing content.`);
      }

      logger.info('[AI] Successfully used model', { model: currentModel });
      return content.trim();
    } catch (error) {
      lastError = error as Error;
      logger.warn('[AI] Model failed', { model: currentModel, error: (error as Error).message });

      if (currentModel !== fallbackModels[fallbackModels.length - 1]) {
        logger.info('[AI] Trying fallback model');
        continue;
      }

      // This was the last model, throw the error
      throw error;
    }
  }

  // Should never reach here, but just in case
  throw lastError || new HttpError(502, 'All AI models failed');
}

async function safeReadBody(res: Response) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
