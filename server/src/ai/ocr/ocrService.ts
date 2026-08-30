/**
 * OCR Service - Extract text from images using Tesseract.js
 * Used for reading handwritten equations when vision models are not available
 * 
 * OPTIMIZATIONS:
 * - Uses 'sharp' to resize and preprocess images (grayscale + contrast)
 * - Caches Tesseract worker
 * - Whitelists math characters
 */
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { logger } from '../../logger';

// Cache worker for better performance
let worker: Tesseract.Worker | null = null;
let workerInitializing = false;

async function getWorker(): Promise<Tesseract.Worker> {
    if (worker) return worker;

    // Simple lock to prevent multiple initializations
    if (workerInitializing) {
        while (workerInitializing) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
        }
        if (worker) return worker;
    }

    workerInitializing = true;
    try {
        logger.info('[OCR] Initializing Tesseract worker');
        worker = await Tesseract.createWorker(['eng'], 1, {
            logger: (m) => {
                if (m.status === 'recognizing text' && Math.round(m.progress * 100) % 20 === 0) {
                    logger.debug('[OCR] Progress', { percent: Math.round(m.progress * 100) });
                }
            },
        });

        await worker.setParameters({
            tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-=*/^()[]{}√πΣ∫∂∞≠≤≥±×÷.,?!% ',
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
        });
        logger.info('[OCR] Worker initialized');
    } finally {
        workerInitializing = false;
    }
    return worker!;
}

/**
 * Preprocess image buffer:
 * 1. Resize to max 1000px width (balance speed/quality)
 * 2. Convert to grayscale
 * 3. Normalize (contrast stretch)
 * 4. Sharpen
 */
async function preprocessImage(buffer: Buffer): Promise<Buffer> {
    try {
        const processed = await sharp(buffer)
            .resize(1000, null, { // Resize to max 1000px width, auto height
                withoutEnlargement: true,
                fit: 'inside'
            })
            .grayscale()
            .normalize() // Improve contrast
            .sharpen()
            .toBuffer();

        return processed;
    } catch (e) {
        logger.warn('[OCR] Preprocessing failed', { error: (e as Error).message });
        return buffer; // Fallback to original
    }
}

function parseBase64(base64Image: string): Buffer {
    // Remove data URL prefix if present
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(cleanBase64, 'base64');
}

/**
 * Extract text from a base64 encoded image
 */
export async function extractTextFromImage(base64Image: string): Promise<string> {
    const startTime = Date.now();
    logger.info('[OCR] Starting OCR process');

    try {
        const imageBuffer = parseBase64(base64Image);

        // 1. Preprocess
        const processedBuffer = await preprocessImage(imageBuffer);

        // 2. OCR
        const ocrWorker = await getWorker();
        const result = await ocrWorker.recognize(processedBuffer);

        let text = result.data.text.trim();

        // 3. Post-process cleanups for common OCR mistakes in math
        text = text
            .replace(/l/g, '1')    // context dependent, but often 'l' is 1 in basic math
            .replace(/O/g, '0')
            .replace(/o/g, '0')
            .replace(/x/gi, 'x');  // standardize x

        const elapsed = Date.now() - startTime;
        logger.info('[OCR] Completed', { elapsed, textLen: text.length });

        return text;
    } catch (error) {
        logger.error('[OCR] Error', { error: (error as Error).message });
        return '';
    }
}

/**
 * Extract potential equations from text
 */
export function extractEquationsFromText(text: string): string[] {
    const lines = text.split('\n');
    const equations: string[] = [];

    for (const line of lines) {
        const clean = line.replace(/\s+/g, '');
        // Heuristic: looks like equation if it has numbers/vars and operator/=
        if (clean.length > 2 && /[0-9x]/.test(clean) && /[=+\-*/^]/.test(clean)) {
            equations.push(line.trim());
        }
    }
    return equations;
}

export async function terminateOCR() {
    if (worker) {
        await worker.terminate();
        worker = null;
    }
}
