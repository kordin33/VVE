import { Router } from 'express';
import { config } from '../config';
import { logger } from '../logger';
import type { CapabilityAccess } from '../pilot/capabilityAccess';
import {
  adminCredentialOf,
  adminSessionCookie,
  clearAdminSessionCookie,
  clientIpOf
} from '../pilot/capabilityHttpAdapters';

/**
 * Administrator session endpoints (ADR-0005): one shared passphrase is
 * exchanged for a signed twelve-hour HttpOnly session. The passphrase is
 * only ever read from the JSON body of POST /api/admin/session — never from
 * a URL, query string, or header — and the login is rate-limited inside the
 * CapabilityAccess module (default 5 attempts/min/IP, configurable).
 */
export const createAdminAuthRouter = (access: CapabilityAccess) => {
  const router = Router();

  router.post('/session', async (req, res) => {
    const body = req.body ?? {};
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : undefined;
    const result = access.exchangeAdministratorPassphrase({
      passphrase,
      clientKey: clientIpOf(req),
      now: new Date()
    });

    if (!result.ok) {
      if (result.reason === 'unavailable') {
        res.status(503).json({ error: 'Panel administratora nie jest skonfigurowany. Ustaw ADMIN_PASSPHRASE.' });
        return;
      }
      if (result.reason === 'rateLimited') {
        res.status(429).json({ error: 'Zbyt wiele prób logowania. Odczekaj chwilę i spróbuj ponownie.' });
        return;
      }
      if (result.reason === 'missing') {
        res.status(400).json({ error: 'Wprowadź hasło administratora.' });
        return;
      }
      logger.warn('Administrator login failed', { ip: clientIpOf(req), correlationId: req.correlationId });
      res.status(401).json({ error: 'Nieprawidłowe hasło.' });
      return;
    }

    adminSessionCookie(res, result.sessionToken, config.adminSessionTtlMs);
    res.json({ ok: true, expiresAt: result.expiresAt.toISOString() });
  });

  router.get('/session', async (req, res) => {
    const decision = await access.decide({
      credential: adminCredentialOf(req),
      action: 'admin.manageTeachers',
      now: new Date()
    });
    if (decision.granted) {
      res.json({ authenticated: true, expiresAt: decision.validUntil?.toISOString() ?? null });
    } else if (decision.reason === 'unavailable') {
      res.status(503).json({ authenticated: false, error: 'Panel administratora nie jest skonfigurowany.' });
    } else {
      res.status(401).json({ authenticated: false });
    }
  });

  router.delete('/session', (_req, res) => {
    clearAdminSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
};
