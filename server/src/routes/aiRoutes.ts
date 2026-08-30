import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../logger';
import type { EquationSolver } from '../services/aiSolver';
import { HttpError } from '../services/httpError';
import { ChatMessage, callGrok, type CallGrokOptions } from '../services/grok';
import { verifyBoardWsToken } from '../pilot/capabilityAccess';

/**
 * AI HTTP surface (solve-equation, chat, PDF analysis, diagrams, vision).
 * Registered by httpApp ONLY when the PilotAvailability manifest allows
 * `http.ai` (development with the internal dev surface); per ADR-0007 the
 * whole route family is unreachable in the Pilot. The board-assistant router
 * (`aiBoardAssistant.ts`) mounts under the same gate.
 */
export const createAiRoutesRouter = (aiSolver: EquationSolver) => {
  const router = Router();

  router.post('/solve-equation/', async (req, res) => {
    const equation = (req.body?.equation as string | undefined)?.trim();
    const image = req.body?.image as string | undefined;

    try {
      if (image) {
        // Image-based solving (OCR + Solve)
        const result = await aiSolver.solveEquationFromImage(image);
        res.json(result);
      } else if (equation) {
        // Text-based solving
        const solution = await aiSolver.solveEquation(equation);
        res.json({ solution });
      } else {
        res.status(400).json({ error: 'Field "equation" or "image" is required.' });
      }
    } catch (error) {
      const err = error as any;
      const status = err instanceof HttpError && err.status ? err.status : 502;
      logger.error('AI solver failed', { error: err.message, status, details: err.body, stack: err.stack });

      res.status(status).json({ error: err.message || 'Failed to solve equation.', details: err.body });
    }
  });

  router.post('/chat', async (req, res) => {
    try {
      // P2-15: Verify board token – students are blocked from AI chat
      const boardToken = req.headers['x-board-token'] as string | undefined;
      if (boardToken) {
        const session = verifyBoardWsToken(boardToken);
        if (!session) {
          res.status(401).json({ error: 'Invalid or expired board token.' });
          return;
        }
        if (session.role === 'student') {
          res.status(403).json({ error: 'AI chat is not available for students.' });
          return;
        }
      }

      const history = Array.isArray(req.body?.history) ? (req.body.history as ChatMessage[]) : [];
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const includeScreenshot = Boolean(req.body?.includeScreenshot);
      const screenshotDataUrl = typeof req.body?.screenshotDataUrl === 'string' ? req.body.screenshotDataUrl : null;
      const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'normal_chat';

      const system: ChatMessage = {
        role: 'system',
        content:
          'Jesteś asystentem tablicy WhiteVue. ' +
          'WAŻNE: Gdy to jest pierwsza wiadomość w konwersacji, ZAWSZE zacznij od krótkiego powitania i zaoferowania pomocy (np. "Cześć! W czym mogę Ci pomóc?"). ' +
          '\n\n=== KRYTYCZNE: CO IGNOROWAĆ ===\n' +
          'Gdy analizujesz screenshot tablicy, CAŁKOWICIE IGNORUJ i NIE WSPOMINAJ o:\n' +
          '- Toolbarach, paskach narzędzi (górnych, bocznych, dolnych)\n' +
          '- Przyciskach (Share Room, Debug, Your Name, itp.)\n' +
          '- Panelach bocznych i menu\n' +
          '- Licznikach (np. "0 osób online", procenty zoom jak "100%")\n' +
          '- Siatce pomocniczej (grid/squares w tle)\n' +
          '- Kontrolkach interfejsu (minimize, maximize, close)\n' +
          '- Wskaźnikach stanu (online/offline, debug on/off)\n' +
          '- Elementach nawigacji i ustawieniach\n' +
          '- Jakichkolwiek innych elementach UI/interfejsu\n' +
          '\n=== SKUP SIĘ TYLKO NA ===\n' +
          'Analizuj WYŁĄCZNIE zawartość canvas (obszar rysowania):\n' +
          '- Rysunki i szkice zrobione przez użytkownika\n' +
          '- Tekst napisany na tablicy\n' +
          '- Kształty geometryczne narysowane\n' +
          '- Diagramy i wykresy\n' +
          '- Równania matematyczne i fizyczne\n' +
          '- Notatki i adnotacje\n' +
          'Jeśli canvas jest PUSTY (brak rysunków/tekstu), powiedz po prostu: "Tablica jest pusta. Mogę pomóc z matematyką, fizyką lub analizą diagramów!"\n' +
          '\nOdpowiadaj po polsku, zwięźle (3-8 zdań lub punktów). ' +
          '\n\nFORMATOWANIE MATEMATYCZNE I FIZYCZNE:\n' +
          '- Wzory matematyczne i fizyczne ZAWSZE formatuj w LaTeX\n' +
          '- Wzory inline (w tekście): użyj $wzór$ (pojedyncze dolary)\n' +
          '- Wzory display (wycentrowane): użyj $$wzór$$ (pododwójne dolary)\n' +
          '- Przykłady poprawnego formatowania:\n' +
          '  * Inline: "Wierzchołek paraboli to $x = -\\frac{b}{2a}$"\n' +
          '  * Display: "Wzór kwadratowy:\\n$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$"\n' +
          '  * Fizyka: "Energia kinetyczna: $E_k = \\frac{1}{2}mv^2$"\n' +
          '  * Układ równań: "$$\\begin{cases} x + y = 5 \\\\ 2x - y = 1 \\end{cases}$$"\n' +
          '- NIE używaj zwykłego tekstu dla wzorów (np. "x = -b/2a" jest ZŁE)\n' +
          '- Używaj poprawnej składni LaTeX: \\frac{}{}, \\sqrt{}, ^{}, _{}, \\pm, \\times, itd.',
      };

      const messages: ChatMessage[] = [system];
      for (const item of history) {
        if (item && (item.role === 'user' || item.role === 'assistant') && item.content) {
          messages.push({ role: item.role, content: item.content });
        }
      }

      const hasVision = typeof aiSolver.chatWithVision === 'function';
      const wantVision = (includeScreenshot || mode === 'screenshot_intro') && Boolean(screenshotDataUrl);

      if (wantVision && hasVision) {
        const visionMessages: Array<{ role: string; content: string; image?: string }> = history.map((item) => ({
          role: item.role,
          content: typeof item.content === 'string' ? item.content : '',
        }));
        visionMessages.unshift({
          role: 'system',
          content: typeof system.content === 'string' ? system.content : '',
        });
        if (message || screenshotDataUrl) {
          visionMessages.push({
            role: 'user',
            content: message || 'Przeanalizuj ten screenshot.',
            image: screenshotDataUrl || undefined,
          });
        }
        const answer = await aiSolver.chatWithVision!(visionMessages);
        res.json({ answer });
        return;
      }

      if ((includeScreenshot || mode === 'screenshot_intro') && screenshotDataUrl) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'To jest zrzut ekranu tablicy. NIE opisuj żadnych elementów UI (toolbary, przyciski, panele, siatka, procenty, liczniki). Analizuj TYLKO to, co użytkownik narysował/napisał na canvas (białym obszarze rysowania). Jeśli canvas jest pusty, powiedz: "Tablica jest pusta. Mogę pomóc z matematyką, fizyką lub analizą!". Przywitaj się krótko.',
            },
            { type: 'image_url', image_url: { url: screenshotDataUrl } },
          ],
        });
      }

      if (message) {
        messages.push({ role: 'user', content: message });
      }

      const callOptions: CallGrokOptions = { messages };
      if (process.env.CHAT_MODEL) {
        callOptions.model = process.env.CHAT_MODEL;
      }
      const answer = await callGrok(callOptions);
      res.json({ answer });
    } catch (error) {
      const err = error as any;
      const status = err instanceof HttpError ? err.status : 502;
      const fallback = status === 429 ? 'AI chwilowo niedostępne (limit). Spróbuj ponownie za chwilę.' : null;
      res.status(status).json({ error: err.message, details: err.body, fallback });
    }
  });

  router.post('/analyze-pdf', async (req, res) => {
    try {
      const fileId = typeof req.body?.fileId === 'string' ? req.body.fileId : '';
      const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'SUMMARY';
      if (!fileId) throw new HttpError(400, 'fileId is required.');

      const uploadsDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
      const pathWithExt = fileId.endsWith('.pdf') ? fileId : `${fileId}.pdf`;
      const filePath = path.join(uploadsDir, pathWithExt);
      // SEC: Prevent path traversal — resolved path must stay within uploadsDir
      const resolvedPath = path.resolve(filePath);
      const resolvedUploads = path.resolve(uploadsDir);
      if (!resolvedPath.startsWith(resolvedUploads + path.sep) && resolvedPath !== resolvedUploads) {
        throw new HttpError(403, 'Access denied.');
      }
      if (!fs.existsSync(resolvedPath)) {
        throw new HttpError(404, 'PDF file not found.');
      }

      const pdfText = await extractPdfText(filePath);
      if (!pdfText.trim()) throw new HttpError(400, 'PDF has no extractable text.');

      const system = 'Jesteś asystentem do analizy dokumentów PDF. Otrzymasz tekst dokumentu.';
      const userPrompt = buildPdfPrompt(mode, pdfText);
      const answer = await callGrok({ messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }] });
      res.json({ result: answer });
    } catch (error) {
      const err = error as any;
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: err.message, details: err.body });
    }
  });

  router.post('/generate-diagram', async (req, res) => {
    try {
      const text = typeof req.body?.text === 'string' ? req.body.text : '';
      const mode = req.body?.mode === 'FLOWCHART' ? 'FLOWCHART' : 'CONCEPT_MAP';
      if (!text.trim()) throw new HttpError(400, 'text is required.');

      const system = 'Jesteś asystentem do projektowania diagramów. Otrzymasz opis procesu lub systemu.';
      const userPrompt = `Na podstawie tego tekstu wygeneruj węzły i połączenia diagramu ${mode}. Zwróć JSON o strukturze: {"nodes":[{"id","label","type"}],"edges":[{"id","from","to","label":null}]}. Typ węzła: 'start', 'process', 'decision', 'end' (dla flowchart). Nie pisz nic poza JSON.\n\nOpis:\n${text}`;
      const answer = await callGrok({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      const parsed = parseDiagramAnswer(answer);
      res.json({ nodes: parsed.nodes, edges: parsed.edges, raw: answer });
    } catch (error) {
      const err = error as any;
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: err.message, details: err.body });
    }
  });

  router.post('/auto-layout-diagram', async (req, res) => {
    try {
      const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
      const edges = Array.isArray(req.body?.edges) ? req.body.edges : [];
      if (!nodes.length) throw new HttpError(400, 'nodes are required.');

      const system = 'Jesteś asystentem do układania diagramów. Masz listę węzłów i krawędzi.';
      const userPrompt = `Na podstawie poniższego JSONa wyznacz level (0,1,2,...) i index (0..N) dla każdego węzła, aby powstała hierarchia top-down. Zwróć tylko JSON: {"nodes":[{"id":"...","level":0,"index":0}]}.\n\nWejście:\n${JSON.stringify({ nodes, edges })}`;
      const answer = await callGrok({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      const layout = parseLayoutAnswer(answer);
      res.json({ nodes: layout, raw: answer });
    } catch (error) {
      const err = error as any;
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: err.message, details: err.body });
    }
  });

  router.post('/vision-chat', async (req, res) => {
    const messages = req.body?.messages;

    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'Field "messages" must be an array.' });
      return;
    }

    try {
      // Check if aiSolver has chatWithVision method (it should if updated)
      if ('chatWithVision' in aiSolver) {
        const reply = await (aiSolver as any).chatWithVision(messages);
        res.json({ reply });
      } else {
        res.status(501).json({ error: 'Vision chat not implemented on server.' });
      }
    } catch (error) {
      const err = error as Error;
      logger.error('AI Vision Chat failed', { error: err.message });
      res.status(502).json({ error: err.message || 'Failed to process vision chat.' });
    }
  });

  return router;
};

async function extractPdfText(filePath: string): Promise<string> {
  try {
    const pdfParse = await import('pdf-parse');
    const buffer = await fs.promises.readFile(filePath);
    const parsed = await pdfParse.default(buffer);
    return (parsed.text || '').slice(0, 15000);
  } catch (error) {
    throw new HttpError(500, 'PDF parsing failed.', (error as Error).message);
  }
}

function buildPdfPrompt(mode: string, text: string) {
  if (mode === 'TODO') {
    return `Wyodrębnij listę zadań/do-done z dokumentu. Użyj wypunktowania.\n\n${text}`;
  }
  if (mode === 'RISKS') {
    return `Wypisz najważniejsze ryzyka, pułapki, obowiązki z dokumentu.\n\n${text}`;
  }
  return `Streść ten dokument w maksymalnie 10 punktach.\n\n${text}`;
}

function parseDiagramAnswer(answer: string) {
  try {
    const jsonStart = answer.indexOf('{');
    const jsonText = jsonStart >= 0 ? answer.slice(jsonStart) : answer;
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      throw new Error('Invalid diagram JSON shape.');
    }
    return parsed;
  } catch (error) {
    throw new HttpError(502, 'Failed to parse diagram JSON.', (error as Error).message);
  }
}

function parseLayoutAnswer(answer: string) {
  try {
    const jsonStart = answer.indexOf('{');
    const jsonText = jsonStart >= 0 ? answer.slice(jsonStart) : answer;
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed.nodes)) {
      throw new Error('Invalid layout JSON shape.');
    }
    return parsed.nodes;
  } catch (error) {
    throw new HttpError(502, 'Failed to parse layout JSON.', (error as Error).message);
  }
}
