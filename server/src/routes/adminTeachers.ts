import express, { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { logger } from '../logger';
import type { CapabilityAccess } from '../pilot/capabilityAccess';

// 4.7: Limit file upload size to 5MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const textParser = express.text({ type: ['text/csv', 'text/plain', 'application/csv'] });

type ImportRow = { email: string; fullName?: string | null };

const parseCsvTeachers = (csv: string): ImportRow[] => {
  try {
    const parsed = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Array<Record<string, string>>;

    return parsed
      .map((row) => ({
        email: row.email || row.Email || '',
        fullName: row.full_name || row.fullName || row.name || null
      }))
      .filter((row) => row.email);
  } catch (error) {
    logger.warn('Failed to parse teacher CSV', { error: (error as Error).message });
    return [];
  }
};

const parseBodyTeachers = (body: unknown): ImportRow[] => {
  if (!body) return [];
  if (typeof body === 'string') {
    return parseCsvTeachers(body);
  }
  if (Array.isArray((body as any).teachers)) {
    const entries = (body as any).teachers as Array<Record<string, unknown>>;
    return entries
      .map((entry) => ({
        email: typeof entry.email === 'string' ? entry.email : '',
        fullName:
          typeof entry.fullName === 'string'
            ? entry.fullName
            : typeof entry.full_name === 'string'
              ? entry.full_name
              : null
      }))
      .filter((row) => row.email);
  }
  if (typeof (body as any).email === 'string') {
    return [
      {
        email: (body as any).email as string,
        fullName:
          typeof (body as any).fullName === 'string'
            ? ((body as any).fullName as string)
            : typeof (body as any).full_name === 'string'
              ? ((body as any).full_name as string)
              : null
      }
    ];
  }
  return [];
};

const dedupeByEmail = (rows: ImportRow[]): ImportRow[] => {
  const seen = new Set<string>();
  const result: ImportRow[] = [];
  for (const row of rows) {
    const normalized = row.email.trim().toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ ...row, email: normalized });
  }
  return result;
};

/**
 * Administrator teacher management through CapabilityAccess (VVE-101).
 *
 * GET / is side-effect-free: it lists teachers WITH their current retrievable
 * Teacher Access Link (ADR-0008) and never creates or rotates anything.
 * Regeneration is the explicit POST /:id/regenerate-link; deactivation is the
 * explicit POST /:id/deactivate and ends all access immediately.
 */
export const createAdminTeachersRouter = (access: CapabilityAccess) => {
  const router = Router();

  // List teachers with their current link — read-only, never rotates.
  router.get('/', async (_req, res) => {
    const result = await access.listTeacherAccessLinks();
    if ('error' in result) {
      res.status(503).json({ error: 'Nie udało się pobrać listy nauczycieli. Spróbuj ponownie.' });
      return;
    }
    res.json({
      teachers: result.map((t) => ({
        teacherId: t.teacherId,
        email: t.email,
        internalLabel: t.internalLabel,
        isActive: t.isActive,
        createdAt: t.createdAt,
        lastLoginAt: t.lastLoginAt,
        accessLink: t.accessLink
      }))
    });
  });

  // Create one teacher (internal label only) with exactly one active link.
  router.post('/', async (req, res) => {
    const body = req.body ?? {};
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const internalLabel = typeof body.internalLabel === 'string' ? body.internalLabel.trim() : null;
    if (!email) {
      res.status(400).json({ error: 'Adres email jest wymagany.' });
      return;
    }
    const result = await access.createOrReuseTeacherAccessLink({ email, internalLabel });
    if (!result.ok) {
      if (result.reason === 'invalidEmail') {
        res.status(400).json({ error: 'Nieprawidłowy adres email.' });
        return;
      }
      res.status(503).json({ error: 'Nie udało się dodać nauczyciela. Spróbuj ponownie.' });
      return;
    }
    res.status(result.created ? 201 : 200).json({
      teacherId: result.teacherId,
      email: result.email,
      internalLabel: result.internalLabel,
      created: result.created,
      accessLink: result.accessLink
    });
  });

  router.post('/import', textParser, upload.single('file'), async (req, res) => {
    const fileContent = req.file ? req.file.buffer.toString('utf-8') : null;
    const rowsFromFile = fileContent ? parseCsvTeachers(fileContent) : [];
    const bodyRows = parseBodyTeachers(req.body);

    const entries = dedupeByEmail([...rowsFromFile, ...bodyRows]).slice(0, 500);
    if (!entries.length) {
      res.status(400).json({ error: 'Brak danych nauczycieli w zadaniu.' });
      return;
    }

    const results: Array<Record<string, unknown>> = [];
    let createdCount = 0;

    for (const row of entries) {
      const result = await access.createOrReuseTeacherAccessLink({ email: row.email, internalLabel: row.fullName ?? null });
      if (!result.ok) {
        results.push({ email: row.email, error: result.reason === 'invalidEmail' ? 'Nieprawidłowy email.' : 'Import nie powiódł się.' });
        continue;
      }
      if (result.created) createdCount += 1;
      results.push({
        email: result.email,
        internalLabel: result.internalLabel,
        teacherId: result.teacherId,
        created: result.created,
        accessLink: result.accessLink
      });
    }

    res.json({ imported: results.length, created: createdCount, results });
  });

  // EXPLICIT regeneration: atomically invalidates only the previous credential.
  router.post('/:id/regenerate-link', async (req, res) => {
    const teacherId = req.params.id;
    const result = await access.regenerateTeacherAccessLink(teacherId);
    if (!result.ok) {
      if (result.reason === 'notFound') {
        res.status(404).json({ error: 'Nie znaleziono nauczyciela.' });
        return;
      }
      res.status(503).json({ error: 'Nie udało się wygenerować nowego linku. Spróbuj ponownie.' });
      return;
    }
    res.json({
      teacherId,
      email: result.email,
      internalLabel: result.internalLabel,
      accessLink: result.accessLink,
      note: 'Poprzedni link został unieważniony. Tablice nauczyciela pozostały bez zmian.'
    });
  });

  // Deactivation ends ALL access immediately (board deletion scheduling is VVE-102).
  router.post('/:id/deactivate', async (req, res) => {
    const teacherId = req.params.id;
    const result = await access.deactivateTeacher(teacherId);
    if (!result.ok) {
      if (result.reason === 'notFound') {
        res.status(404).json({ error: 'Nie znaleziono nauczyciela.' });
        return;
      }
      if (result.reason === 'alreadyInactive') {
        res.status(409).json({ error: 'Nauczyciel jest już wyłączony.' });
        return;
      }
      res.status(503).json({ error: 'Nie udało się wyłączyć nauczyciela. Spróbuj ponownie.' });
      return;
    }
    res.json({ teacherId, deactivated: true });
  });

  return router;
};
