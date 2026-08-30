import OpenAI from 'openai';
import { config } from '../../config';
import { logger } from '../../logger';

const apiKey = config.openRouterApiKey;
if (!apiKey) {
    logger.warn('[AI] No OpenRouter API key configured – Board Assistant disabled');
}

const baseURL = config.aiBaseUrl;

export const llmClient = apiKey
    ? new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders: {
            'HTTP-Referer': 'https://whitevue.com', // Optional: required by OpenRouter for rankings
            'X-Title': 'WhiteVue', // Optional
        }
    })
    : null;

export const BOARD_AI_MODEL = config.aiModel;
