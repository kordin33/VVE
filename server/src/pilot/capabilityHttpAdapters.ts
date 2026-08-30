import type { Request, RequestHandler, Response } from 'express';
import { config } from '../config';
import { getDb } from '../db';
import { logger } from '../logger';
import {
  type AccessDecision,
  type AccessDenialReason,
  type CapabilityAccess,
  type CapabilityAction,
  type AccessGrant,
  type PresentedCredential
} from './capabilityAccess';

/**
 * Express Adapters for CapabilityAccess (VVE-101, Module 1).
 *
 * These are the ONLY places where HTTP-specific credential parsing happens:
 * cookies, query tokens and JSON bodies are translated into a
 * `PresentedCredential`, one `decide()` call is made, and the typed decision
 * is mapped to a Polish HTTP response. No authorization rule lives here.
 */

export const readCookie = (cookieHeader: string | undefined, name: string): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      return rest.join('=');
    }
  }
  return null;
};

export const clientIpOf = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || req.ip || 'unknown';
  }
  return req.ip || 'unknown';
};

/**
 * `board_access_logs.ip_addr` is an inet column: only a syntactically valid
 * IP may be stored, anything else (e.g. the 'unknown' fallback) becomes null.
 */
export const ipForLog = (ip: string): string | null =>
  /^[0-9a-fA-F.:]+$/.test(ip) ? ip : null;

/** Polish user-facing message per typed denial (spec: Polish copy, English internals). */
const DENIAL_STATUS: Record<AccessDenialReason, number> = {
  missing: 401,
  invalid: 401,
  revoked: 401,
  expired: 401,
  inactive: 403,
  wrongTarget: 404,
  unavailable: 503
};

const DENIAL_MESSAGE: Record<AccessDenialReason, string> = {
  missing: 'Brak danych uwierzytelniających.',
  invalid: 'Nieprawidłowy link lub sesja.',
  revoked: 'Dostęp został unieważniony.',
  expired: 'Dostęp wygasł.',
  inactive: 'Konto nauczyciela zostało wyłączone.',
  wrongTarget: 'Nie znaleziono tablicy.',
  unavailable: 'Usługa chwilowo niedostępna. Spróbuj ponownie za chwilę.'
};

export const denyHttp = (res: Response, decision: { granted: false; reason: AccessDenialReason }, context: string): void => {
  const status = DENIAL_STATUS[decision.reason];
  const message = context === 'admin' && decision.reason === 'missing'
    ? 'Wymagane uwierzytelnienie administratora.'
    : DENIAL_MESSAGE[decision.reason];
  res.status(status).json({ error: message, reason: decision.reason });
};

export const adminSessionCookie = (res: Response, token: string, maxAgeMs: number): void => {
  res.cookie(config.adminSessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: maxAgeMs,
    path: '/'
  });
};

export const clearAdminSessionCookie = (res: Response): void => {
  res.clearCookie(config.adminSessionCookie, { path: '/' });
};

export const teacherSessionCookie = (res: Response, token: string): void => {
  res.cookie(config.teacherSessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/'
  });
};

/** Administrator session credential from the HttpOnly cookie (never a URL/header). */
export const adminCredentialOf = (req: Request): PresentedCredential => {
  const token = readCookie(req.headers.cookie, config.adminSessionCookie);
  return token ? { kind: 'adminSession', token } : { kind: 'none' };
};

export const teacherSessionCredentialOf = (req: Request): PresentedCredential => {
  const token = readCookie(req.headers.cookie, config.teacherSessionCookie);
  return token ? { kind: 'teacherSession', token } : { kind: 'none' };
};

/** Student Board Access Link credential: `?token=` or the student_token cookie. */
export const studentLinkCredentialOf = (req: Request, boardSlug: string): PresentedCredential => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token = queryToken || readCookie(req.headers.cookie, 'student_token') || '';
  return token ? { kind: 'studentBoardLink', boardSlug, token } : { kind: 'none' };
};

const handleDecision = (
  res: Response,
  decision: AccessDecision,
  context: string
): AccessGrant | null => {
  if (!decision.granted) {
    denyHttp(res, decision, context);
    return null;
  }
  return decision;
};

/** Guard every administrator operation with the server-side session (ADR-0005). */
export const requireAdminCapability = (access: CapabilityAccess, action: CapabilityAction = 'admin.manageTeachers'): RequestHandler =>
  async (req, res, next) => {
    if (!config.adminPassphrase) {
      res.status(503).json({ error: 'Panel administratora nie jest skonfigurowany. Ustaw ADMIN_PASSPHRASE.' });
      return;
    }
    const decision = await access.decide({
      credential: adminCredentialOf(req),
      action,
      now: new Date()
    });
    const granted = handleDecision(res, decision, 'admin');
    if (granted) {
      req.capabilityGrant = granted;
      next();
    }
  };

/** Teacher dashboard guard: verifies the durable credential version every request. */
export const requireTeacherCapability = (access: CapabilityAccess, action: CapabilityAction = 'teacher.openDashboard'): RequestHandler =>
  async (req, res, next) => {
    const decision = await access.decide({
      credential: teacherSessionCredentialOf(req),
      action,
      now: new Date()
    });
    const granted = handleDecision(res, decision, 'teacher');
    if (granted) {
      req.capabilityGrant = granted;
      next();
    }
  };

export const logBoardAccess = async (
  input: { boardId: string; actorType: 'teacher' | 'student'; actorId: string | null; ip: string | null; userAgent: string | null }
): Promise<void> => {
  try {
    await getDb()('board_access_logs').insert({
      board_id: input.boardId,
      actor_type: input.actorType,
      actor_id: input.actorId,
      ip_addr: input.ip ? ipForLog(input.ip) : null,
      user_agent: input.userAgent
    });
  } catch (error) {
    // Audit logging must not change the access decision.
    logger.warn('board_access_logs insert failed', { error: (error as Error).message });
  }
};
