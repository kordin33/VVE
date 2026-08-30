import { Router } from 'express';
import { logger } from '../logger';
import type { CapabilityAccess } from '../pilot/capabilityAccess';
import { requireTeacherCapability } from '../pilot/capabilityHttpAdapters';
import { createBoardForTeacher, listBoardsForTeacher, updateBoard } from '../services/boardService';
import { findTeacherById } from '../services/teacherService';
import { createRateLimiter } from '../middleware/rateLimiter';

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts);
};

/**
 * Teacher dashboard board management. Every request is authorized through
 * CapabilityAccess.decide('teacher.openDashboard'), which re-verifies the
 * durable teacher active flag and credential version — a regenerated link or
 * a deactivated teacher kills the session on the very next request.
 */
export const createTeacherBoardsRouter = (access: CapabilityAccess) => {
  const router = Router();

  router.use(requireTeacherCapability(access));
  router.use(
    createRateLimiter({
      windowMs: 60_000,
      max: 120,
      keyResolver: (req) => req.capabilityGrant?.teacherId || req.ip || 'unknown'
    })
  );

  router.get('/', async (req, res) => {
    const teacherId = req.capabilityGrant!.teacherId!;
    try {
      const boards = await listBoardsForTeacher(teacherId);
      res.json({ boards });
    } catch (error) {
      logger.error('Failed to list boards', { teacherId, error: (error as Error).message });
      res.status(503).json({ error: 'Nie udało się pobrać tablic. Spróbuj ponownie.' });
    }
  });

  router.post('/', async (req, res) => {
    const teacherId = req.capabilityGrant!.teacherId!;
    const teacher = await findTeacherById(teacherId);
    if (!teacher) {
      res.status(401).json({ error: 'Sesja nauczyciela jest nieprawidłowa.' });
      return;
    }
    const body = req.body ?? {};
    const title = typeof body.title === 'string' ? body.title : null;
    const studentName = typeof body.studentName === 'string' ? body.studentName : null;
    const validUntil = parseDate(body.validUntil);

    const result = await createBoardForTeacher({
      teacherId,
      organizationId: teacher.organization_id ?? null,
      title,
      studentName,
      validUntil
    });

    res.status(201).json({
      boardId: result.board.id,
      studentUrl: result.studentUrl,
      publicSlug: result.board.public_slug,
      validUntil: result.board.valid_until
    });
  });

  router.patch('/:id', async (req, res) => {
    const teacherId = req.capabilityGrant!.teacherId!;
    const body = req.body ?? {};

    const params: import('../services/boardService').UpdateBoardParams = {};
    if (body.title !== undefined) {
      params.title = typeof body.title === 'string' ? body.title : null;
    }
    if (body.validUntil !== undefined) {
      params.validUntil = parseDate(body.validUntil);
    }
    if (body.archived !== undefined) {
      params.archivedAt = body.archived ? new Date() : null;
    }

    const updated = await updateBoard(req.params.id, teacherId, params);

    if (!updated) {
      res.status(404).json({ error: 'Nie znaleziono tablicy.' });
      return;
    }

    res.json({ board: updated });
  });

  return router;
};
