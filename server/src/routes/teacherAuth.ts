import { Router } from 'express';
import { logger } from '../logger';
import { getDb } from '../db';
import type { CapabilityAccess } from '../pilot/capabilityAccess';
import { issueTeacherSessionToken } from '../pilot/capabilityAccess';
import { clientIpOf, ipForLog, teacherSessionCookie } from '../pilot/capabilityHttpAdapters';
import { createRateLimiter } from '../middleware/rateLimiter';

const renderErrorPage = (res: import('express').Response, message: string, status = 400) => {
  res
    .status(status)
    .send(
      `<html><head><title>WhiteVue</title></head><body style="font-family: sans-serif; max-width: 480px; margin: 40px auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.05);"><h2>Link do logowania</h2><p>${message}</p><p>Popros administratora o nowy link.</p></body></html>`
    );
};

const DENIAL_PAGE: Record<string, [string, number]> = {
  missing: ['Link jest nieprawidłowy lub wygasł.', 400],
  invalid: ['Link jest nieprawidłowy lub został unieważniony.', 400],
  revoked: ['Ten link został unieważniony. Poproś administratora o nowy link.', 401],
  expired: ['Ten link wygasł. Poproś administratora o nowy link.', 401],
  inactive: ['Konto nauczyciela zostało wyłączone.', 403],
  wrongTarget: ['Link jest nieprawidłowy.', 400],
  unavailable: ['Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.', 503]
};

const denialPage = (reason: string): [string, number] =>
  DENIAL_PAGE[reason] ?? ['Link jest nieprawidłowy lub został unieważniony.', 400];

/**
 * Teacher Access Link login (ADR-0001): GET /teacher/login?token=... is the
 * single entry. The link is validated through CapabilityAccess.decide()
 * (durable active-link + teacher active + credential version checks); a grant
 * exchanges for a teacher session cookie that itself embeds the credential
 * version, so regeneration or deactivation kills it on the next request.
 */
export const createTeacherAuthRouter = (access: CapabilityAccess) => {
  const router = Router();
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

  router.get('/teacher/login', loginLimiter, async (req, res) => {
    const correlationId = req.correlationId;
    const token = typeof req.query.token === 'string' ? req.query.token : '';

    if (!token) {
      renderErrorPage(res, 'Link jest nieprawidłowy lub wygasł.', 400);
      return;
    }

    const decision = await access.decide({
      credential: { kind: 'teacherAccessLink', token },
      action: 'teacher.openDashboard',
      now: new Date()
    });

    if (!decision.granted) {
      const [message, status] = denialPage(decision.reason);
      renderErrorPage(res, message, status);
      return;
    }

    const teacherId = decision.teacherId;
    if (!teacherId) {
      renderErrorPage(res, 'Link jest nieprawidłowy.', 400);
      return;
    }

    try {
      // Durable bookkeeping FIRST: the session cookie is only issued after
      // the writes succeed, so a half-failed login never leaves a session.
      await getDb()('teachers').where({ id: teacherId }).update({ last_login_at: new Date() });
      await getDb()('board_access_logs').insert({
        board_id: null,
        actor_type: 'teacher',
        actor_id: teacherId,
        ip_addr: ipForLog(clientIpOf(req)),
        user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null
      });

      teacherSessionCookie(res, issueTeacherSessionToken(teacherId, decision.credentialVersion));
      res.redirect('/teacher/dashboard');
    } catch (error) {
      logger.error('Teacher login failed', {
        error: (error as Error).message,
        teacherId,
        correlationId
      });
      renderErrorPage(res, 'Wystąpił błąd. Spróbuj ponownie lub poproś o nowy link.', 500);
    }
  });

  return router;
};
