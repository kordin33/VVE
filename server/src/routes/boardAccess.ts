import { Router } from 'express';
import { getDb } from '../db';
import { logger } from '../logger';
import type { CapabilityAccess, PresentedCredential } from '../pilot/capabilityAccess';
import { PUBLIC_TEACHER_IDENTITY, issueBoardWsToken } from '../pilot/capabilityAccess';
import {
  clientIpOf,
  logBoardAccess,
  studentLinkCredentialOf,
  teacherSessionCredentialOf,
  denyHttp
} from '../pilot/capabilityHttpAdapters';

/**
 * Board Access entry (Student + owning Teacher) through CapabilityAccess.
 *
 * The credential is resolved from the transport (teacher session cookie or
 * the Board Access Link token), authorized once via decide('board.read'),
 * and only then are board facts plus a scoped ws admission token returned.
 * Expiry, End Board Access, the deletion schedule, the durable credential
 * version and teacher activity are checked on every request — an expired or
 * ended board is DENIED here (and at WS admission), never downgraded to a
 * writable or read-only view.
 *
 * Students see exactly the immutable Public Teacher Identity (ADR-0009);
 * internal teacher labels never appear on this surface.
 */
export const createBoardAccessRouter = (access: CapabilityAccess) => {
  const router = Router();

  const boardHandler = async (req: import('express').Request, res: import('express').Response) => {
    const slug = req.params.slug;
    if (!slug) {
      res.status(400).json({ error: 'Brak identyfikatora tablicy.' });
      return;
    }

    let credential: PresentedCredential = teacherSessionCredentialOf(req);
    if (credential.kind === 'none') {
      credential = studentLinkCredentialOf(req, slug);
    }

    const decision = await access.decide({
      credential,
      action: 'board.read',
      target: { boardSlug: slug },
      now: new Date()
    });

    if (!decision.granted) {
      denyHttp(res, decision, 'board');
      return;
    }

    const boardId = decision.boardId!;
    let row: { title: string | null; student_name: string | null; valid_until: Date } | undefined;
    try {
      row = await getDb()('boards as b')
        .leftJoin('students as s', 's.id', 'b.student_id')
        .where('b.id', boardId)
        .first('b.title', getDb().ref('s.full_name').as('student_name'), 'b.valid_until');
    } catch (error) {
      // Durable facts could not be read after the grant: fail closed, never
      // a partial view.
      logger.error('Board facts read failed after grant', { boardId, error: (error as Error).message });
      res.status(503).json({ error: 'Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.' });
      return;
    }
    if (!row) {
      // Durable state vanished between grant and read: fail closed.
      res.status(503).json({ error: 'Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.' });
      return;
    }

    await logBoardAccess({
      boardId,
      actorType: decision.role === 'teacher' ? 'teacher' : 'student',
      actorId: decision.role === 'teacher' ? decision.teacherId : null,
      ip: clientIpOf(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null
    });

    const wsToken = issueBoardWsToken({
      boardId,
      role: decision.role === 'teacher' ? 'teacher' : 'student',
      ...(decision.role === 'teacher' && decision.teacherId ? { teacherId: decision.teacherId } : {}),
      cv: decision.credentialVersion
    });

    res.json({
      boardId,
      role: decision.role,
      publicSlug: slug,
      title: row.title ?? null,
      studentName: row.student_name ?? null,
      teacherName: PUBLIC_TEACHER_IDENTITY,
      validUntil: row.valid_until,
      wsToken,
      roomId: boardId
    });
  };

  router.get('/board/:slug', boardHandler);
  router.get('/api/board/:slug', boardHandler);
  router.get('/s/:slug', boardHandler);

  return router;
};
