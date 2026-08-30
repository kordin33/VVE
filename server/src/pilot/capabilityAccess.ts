import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Knex } from 'knex';
import { config } from '../config';
import { getDb } from '../db';
import { logger } from '../logger';
import { normalizeTeacherEmail } from '../services/teacherService';

/**
 * CapabilityAccess — Module 1 of the VVE Pilot deep-module design (slice S1).
 *
 * One authorization Interface for HTTP and WebSocket: `decide()` answers
 * whether a presented capability may perform a named action against a named
 * resource. Every result is a scoped grant or a typed denial — never an
 * unscoped boolean.
 *
 * What the Implementation hides: token generation, retrievable storage
 * (ADR-0008), credential versioning, constant-time verification, cookie and
 * session signing, the Administrator login rate limit, board lookup, expiry
 * calculation, the Public Teacher Identity, and transport-specific parsing.
 *
 * Interface invariants (see docs/architecture/VVE-DEEP-MODULE-DESIGN.md):
 *  - the exact target is resolved before a grant is returned;
 *  - teacher ownership and active status are checked against durable state,
 *    never trusted from a signed token alone;
 *  - a Student grant never contains Teacher-only actions;
 *  - board expiry, End Board Access, the deletion schedule and the durable
 *    credential version are checked on EVERY decision (HTTP request and
 *    WebSocket admission alike);
 *  - regeneration and deactivation are enforced via the durable credential
 *    version, so old sessions die immediately;
 *  - every database failure fails CLOSED as `unavailable`.
 *
 * The hot path performs at most one indexed query plus constant-time token
 * compares — no heavy joins — keeping normal denials far below the 100 ms
 * local p95 budget.
 */

// ---------------------------------------------------------------------------
// Interface types
// ---------------------------------------------------------------------------

export type CapabilityAction =
  | 'admin.manageTeachers'
  | 'teacher.openDashboard'
  | 'board.read'
  | 'board.edit'
  | 'board.export'
  | 'board.clear'
  | 'board.rotateAccess'
  | 'board.endAccess';

export type AccessDenialReason =
  | 'missing'
  | 'invalid'
  | 'revoked'
  | 'expired'
  | 'inactive'
  | 'wrongTarget'
  | 'unavailable';

export type AccessRole = 'administrator' | 'teacher' | 'student';

/** Transport-agnostic credential, already extracted by an Adapter. */
export type PresentedCredential =
  | { kind: 'none' }
  | { kind: 'adminSession'; token: string }
  | { kind: 'teacherAccessLink'; token: string }
  | { kind: 'teacherSession'; token: string }
  | { kind: 'studentBoardLink'; boardSlug: string; token: string }
  | { kind: 'boardWs'; boardId: string; token: string };

export interface AccessGrant {
  granted: true;
  action: CapabilityAction;
  role: AccessRole;
  /** Exact resolved teacher (owner for board grants, null for admin/students' own view). */
  teacherId: string | null;
  /** Exact resolved board; never a slug. */
  boardId: string | null;
  /** Durable credential version the grant was issued under. */
  credentialVersion: number;
  /** Validity bounds: board `validUntil` or session expiry. */
  validUntil: Date | null;
}

export type AccessDecision =
  | AccessGrant
  | { granted: false; action: CapabilityAction; reason: AccessDenialReason };

export interface DecideInput {
  credential: PresentedCredential;
  action: CapabilityAction;
  target?: { teacherId?: string | undefined; boardId?: string | undefined; boardSlug?: string | undefined };
  now: Date;
}

// ---------------------------------------------------------------------------
// Administrator session (ADR-0005)
// ---------------------------------------------------------------------------

export type AdminExchangeResult =
  | { ok: true; sessionToken: string; expiresAt: Date }
  | { ok: false; reason: 'missing' | 'invalid' | 'rateLimited' | 'unavailable' };

export interface AdminSessionPayload {
  role: 'administrator';
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Teacher Access Link lifecycle (ADR-0001, ADR-0008)
// ---------------------------------------------------------------------------

export interface TeacherAccessLinkView {
  teacherId: string;
  email: string;
  internalLabel: string | null;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  /** The current active Teacher Access Link URL, or null when none is active. */
  accessLink: string | null;
  linkCreatedAt: Date | null;
}

export type TeacherMutationResult =
  | { ok: true; teacherId: string; email: string; internalLabel: string | null; created: boolean; accessLink: string; token: string }
  | { ok: false; reason: 'notFound' | 'invalidEmail' | 'alreadyInactive' | 'unavailable' };

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type TeacherRow = {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  access_credential_version: number;
  created_at: Date;
  last_login_at: Date | null;
  organization_id: string | null;
};

type BoardFactsRow = {
  id: string;
  teacher_id: string;
  public_slug: string | null;
  student_token: string | null;
  valid_until: Date;
  access_ended_at: Date | null;
  delete_after: Date | null;
  deleted_at: Date | null;
  access_credential_version: number;
  teacher_is_active: boolean;
  teacher_credential_version: number;
};

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

export type BoardWsTokenClaims = {
  boardId: string;
  role: 'teacher' | 'student';
  teacherId?: string | undefined;
  cv: number;
  exp: number;
};

export type TeacherSessionClaims = {
  teacherId: string;
  cv: number;
  exp: number;
};

/** Signature + shape + expiry verification only; durable checks live in decide(). */
export const verifyBoardWsToken = (token: string): BoardWsTokenClaims | null => {
  const verified = verifySignedPayload<BoardWsTokenClaims>(token, config.boardWsSecret);
  if (!verified) return null;
  const claims = verified.payload;
  if (
    typeof claims.boardId !== 'string' ||
    (claims.role !== 'teacher' && claims.role !== 'student') ||
    typeof claims.cv !== 'number' ||
    (claims.role === 'teacher' && typeof claims.teacherId !== 'string')
  ) {
    return null;
  }
  if (Date.now() > claims.exp) return null;
  return claims;
};

/** Signature + shape + expiry verification only; durable checks live in decide(). */
export const verifyTeacherSessionClaims = (token: string): TeacherSessionClaims | null => {
  const verified = verifySignedPayload<TeacherSessionClaims>(token, config.teacherSessionSecret);
  if (!verified) return null;
  const claims = verified.payload;
  if (typeof claims.teacherId !== 'string' || typeof claims.cv !== 'number') return null;
  if (Date.now() > claims.exp) return null;
  return claims;
};

const hmacSign = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

const signPayload = (payload: object, secret: string): string => {
  const base = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${base}.${hmacSign(secret, base)}`;
};

const verifySignedPayload = <T>(token: string, secret: string): { payload: T; exp: number } | null => {
  const [base, signature] = token.split('.');
  if (!base || !signature) return null;
  if (!safeEqual(signature, hmacSign(secret, base))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(base, 'base64url').toString('utf8')) as T & { exp?: unknown };
    if (typeof parsed.exp !== 'number') return null;
    return { payload: parsed, exp: parsed.exp };
  } catch {
    return null;
  }
};

const grant = (input: Omit<AccessGrant, 'granted'>): AccessDecision => ({ granted: true, ...input });
const deny = (action: CapabilityAction, reason: AccessDenialReason): AccessDecision => ({
  granted: false,
  action,
  reason
});

const TEACHER_ONLY_BOARD_ACTIONS: readonly CapabilityAction[] = [
  'board.clear',
  'board.rotateAccess',
  'board.endAccess'
];

const STUDENT_BOARD_ACTIONS: readonly CapabilityAction[] = ['board.read', 'board.edit', 'board.export'];

export interface CreateCapabilityAccessOptions {
  /** Durable access state; defaults to the process knex instance. */
  db?: Knex;
  /** Administrator login rate limit; defaults come from config (5/min). */
  loginMax?: number;
  loginWindowMs?: number;
}

export interface CapabilityAccess {
  decide(input: DecideInput): Promise<AccessDecision>;
  /** ADR-0005 passphrase → signed twelve-hour session token (cookie value). */
  exchangeAdministratorPassphrase(input: {
    passphrase: string | undefined;
    clientKey: string;
    now?: Date;
  }): AdminExchangeResult;
  verifyAdministratorSessionToken(token: string, now: Date): AdminSessionPayload | null;
  createOrReuseTeacherAccessLink(input: {
    email: string;
    internalLabel?: string | null;
    organizationId?: string | null;
  }): Promise<TeacherMutationResult>;
  regenerateTeacherAccessLink(teacherId: string, now?: Date): Promise<TeacherMutationResult>;
  deactivateTeacher(teacherId: string, now?: Date): Promise<{ ok: true } | { ok: false; reason: 'notFound' | 'alreadyInactive' | 'unavailable' }>;
  listTeacherAccessLinks(): Promise<TeacherAccessLinkView[] | { error: 'unavailable' }>;
}

export const teacherAccessLinkUrl = (token: string): string => {
  const base = config.teacherAppBaseUrl || 'https://app.whitevue.com';
  const url = new URL('/teacher/login', base);
  url.searchParams.set('token', token);
  return url.toString();
};

export const createCapabilityAccess = (options: CreateCapabilityAccessOptions = {}): CapabilityAccess => {
  const db = () => options.db ?? getDb();
  const loginMax = options.loginMax ?? config.adminLoginMax;
  const loginWindowMs = options.loginWindowMs ?? config.adminLoginWindowMs;

  // ---- Administrator login rate limiting (hidden inside the module) -------
  const loginBuckets = new Map<string, { count: number; resetAt: number }>();
  const loginAllowed = (clientKey: string, now: Date): boolean => {
    const bucket = loginBuckets.get(clientKey);
    if (!bucket || bucket.resetAt < now.getTime()) {
      loginBuckets.set(clientKey, { count: 1, resetAt: now.getTime() + loginWindowMs });
      return true;
    }
    if (bucket.count >= loginMax) return false;
    bucket.count += 1;
    return true;
  };

  // ---- Shared durable lookups (single indexed query on the hot path) -----

  const loadBoardFacts = async (where: { boardId?: string | undefined; boardSlug?: string | undefined }): Promise<BoardFactsRow | null> => {
    const query = db()('boards as b')
      .join('teachers as t', 't.id', 'b.teacher_id')
      .where('b.deleted_at', null)
      .first(
        'b.id',
        'b.teacher_id',
        'b.public_slug',
        'b.student_token',
        'b.valid_until',
        'b.access_ended_at',
        'b.delete_after',
        'b.access_credential_version',
        db().ref('t.is_active').as('teacher_is_active'),
        db().ref('t.access_credential_version').as('teacher_credential_version')
      );
    if (where.boardId) {
      return query.where('b.id', where.boardId);
    }
    return query.where('b.public_slug', where.boardSlug ?? '');
  };

  const boardStateDenial = (board: BoardFactsRow, action: CapabilityAction, now: Date): AccessDecision | null => {
    if (board.delete_after && new Date(board.delete_after) <= now) {
      return deny(action, 'revoked');
    }
    if (board.access_ended_at) {
      return deny(action, 'revoked');
    }
    if (new Date(board.valid_until) <= now) {
      return deny(action, 'expired');
    }
    if (!board.teacher_is_active) {
      return deny(action, 'inactive');
    }
    return null;
  };

  const verifyTeacherSessionToken = (token: string): { teacherId: string; cv: number; exp: number } | null => {
    const verified = verifySignedPayload<{ teacherId?: unknown; cv?: unknown }>(token, config.teacherSessionSecret);
    if (!verified) return null;
    const { teacherId, cv } = verified.payload;
    if (typeof teacherId !== 'string' || typeof cv !== 'number') return null;
    return { teacherId, cv, exp: verified.exp };
  };

  // ---- decide(): the one authorization seam for HTTP and WS ---------------

  const decide = async (input: DecideInput): Promise<AccessDecision> => {
    const { credential, action, target = {}, now } = input;

    if (credential.kind === 'none') {
      return deny(action, 'missing');
    }

    if (credential.kind === 'adminSession') {
      const session = verifySignedPayload<AdminSessionPayload>(credential.token, config.adminSessionSecret);
      if (!session || session.payload.role !== 'administrator') {
        return deny(action, 'invalid');
      }
      if (now.getTime() > session.exp) {
        return deny(action, 'expired');
      }
      if (action !== 'admin.manageTeachers') {
        return deny(action, 'wrongTarget');
      }
      return grant({
        action,
        role: 'administrator',
        teacherId: null,
        boardId: null,
        credentialVersion: 0,
        validUntil: new Date(session.exp)
      });
    }

    if (credential.kind === 'teacherAccessLink') {
      if (action !== 'teacher.openDashboard') {
        return deny(action, 'wrongTarget');
      }
      let row: { teacher_id: string; is_active: boolean; credential_version: number } | undefined;
      try {
        row = await db()('teacher_access_links')
          .where({ token: credential.token })
          .first('teacher_id', 'is_active', 'credential_version');
      } catch (error) {
        logger.error('CapabilityAccess: teacher link lookup failed', { error: (error as Error).message });
        return deny(action, 'unavailable');
      }
      if (!row) {
        return deny(action, 'invalid');
      }
      let teacher: TeacherRow | undefined;
      try {
        teacher = await db()<TeacherRow>('teachers').where({ id: row.teacher_id }).first();
      } catch (error) {
        logger.error('CapabilityAccess: teacher lookup failed', { error: (error as Error).message });
        return deny(action, 'unavailable');
      }
      if (!teacher) {
        return deny(action, 'invalid');
      }
      // Ordering: a deactivated teacher reports `inactive` even though its
      // link row was also superseded; with the teacher active, a version or
      // row mismatch is a regeneration `revoked`.
      if (!teacher.is_active) {
        return deny(action, 'inactive');
      }
      if (row.credential_version !== teacher.access_credential_version || !row.is_active) {
        return deny(action, 'revoked');
      }
      return grant({
        action,
        role: 'teacher',
        teacherId: teacher.id,
        boardId: null,
        credentialVersion: teacher.access_credential_version,
        validUntil: null
      });
    }

    if (credential.kind === 'teacherSession') {
      const session = verifyTeacherSessionToken(credential.token);
      if (!session) {
        return deny(action, 'invalid');
      }
      if (now.getTime() > session.exp) {
        return deny(action, 'expired');
      }
      if (action === 'teacher.openDashboard') {
        let teacher: TeacherRow | undefined;
        try {
          teacher = await db()<TeacherRow>('teachers').where({ id: session.teacherId }).first();
        } catch (error) {
          logger.error('CapabilityAccess: teacher lookup failed', { error: (error as Error).message });
          return deny(action, 'unavailable');
        }
        if (!teacher) {
          return deny(action, 'invalid');
        }
        // Deactivation reports `inactive` even though the version was also
        // bumped; with the teacher active, a version mismatch is a
        // regeneration `revoked`.
        if (!teacher.is_active) {
          return deny(action, 'inactive');
        }
        if (session.cv !== teacher.access_credential_version) {
          return deny(action, 'revoked');
        }
        return grant({
          action,
          role: 'teacher',
          teacherId: teacher.id,
          boardId: null,
          credentialVersion: teacher.access_credential_version,
          validUntil: new Date(session.exp)
        });
      }

      // Board actions: exact target resolved against durable state first.
      if (!target.boardId && !target.boardSlug) {
        return deny(action, 'wrongTarget');
      }
      let board: BoardFactsRow | null;
      try {
        board = await loadBoardFacts({ boardId: target.boardId, boardSlug: target.boardSlug });
      } catch (error) {
        logger.error('CapabilityAccess: board lookup failed', { error: (error as Error).message });
        return deny(action, 'unavailable');
      }
      if (!board) {
        return deny(action, 'wrongTarget');
      }
      if (board.teacher_id !== session.teacherId) {
        return deny(action, 'wrongTarget');
      }
      // Teacher deactivation outranks the credential-version revocation (see
      // the dashboard branch).
      if (!board.teacher_is_active) {
        return deny(action, 'inactive');
      }
      if (session.cv !== board.teacher_credential_version) {
        return deny(action, 'revoked');
      }
      const denied = boardStateDenial(board, action, now);
      if (denied) {
        return denied;
      }
      return grant({
        action,
        role: 'teacher',
        teacherId: board.teacher_id,
        boardId: board.id,
        credentialVersion: board.teacher_credential_version,
        validUntil: new Date(board.valid_until)
      });
    }

    if (credential.kind === 'studentBoardLink') {
      if (!STUDENT_BOARD_ACTIONS.includes(action)) {
        return deny(action, 'invalid');
      }
      let board: BoardFactsRow | null;
      try {
        board = await loadBoardFacts({ boardSlug: credential.boardSlug });
      } catch (error) {
        logger.error('CapabilityAccess: board lookup failed', { error: (error as Error).message });
        return deny(action, 'unavailable');
      }
      if (!board) {
        return deny(action, 'wrongTarget');
      }
      if (!board.student_token || !safeEqual(credential.token, board.student_token)) {
        return deny(action, 'invalid');
      }
      const denied = boardStateDenial(board, action, now);
      if (denied) {
        return denied;
      }
      return grant({
        action,
        role: 'student',
        teacherId: board.teacher_id,
        boardId: board.id,
        credentialVersion: board.access_credential_version,
        validUntil: new Date(board.valid_until)
      });
    }

    // boardWs: admission credential for /ws/whiteboard/:roomId
    if (!STUDENT_BOARD_ACTIONS.includes(action)) {
      return deny(action, 'invalid');
    }
    const ws = verifySignedPayload<BoardWsTokenClaims>(credential.token, config.boardWsSecret);
    if (
      !ws ||
      typeof ws.payload.boardId !== 'string' ||
      (ws.payload.role !== 'teacher' && ws.payload.role !== 'student') ||
      typeof ws.payload.cv !== 'number' ||
      (ws.payload.role === 'teacher' && typeof ws.payload.teacherId !== 'string')
    ) {
      return deny(action, 'invalid');
    }
    const wsClaims = ws.payload;
    if (now.getTime() > ws.exp) {
      return deny(action, 'expired');
    }
    if (wsClaims.boardId !== credential.boardId) {
      return deny(action, 'wrongTarget');
    }
    let board: BoardFactsRow | null;
    try {
      board = await loadBoardFacts({ boardId: credential.boardId });
    } catch (error) {
      logger.error('CapabilityAccess: board lookup failed (WS admission)', { error: (error as Error).message });
      return deny(action, 'unavailable');
    }
    if (!board) {
      return deny(action, 'wrongTarget');
    }
    if (wsClaims.role === 'teacher') {
      if (board.teacher_id !== wsClaims.teacherId) {
        return deny(action, 'wrongTarget');
      }
      // Teacher deactivation outranks the credential-version revocation (see
      // the teacher-session branch).
      if (!board.teacher_is_active) {
        return deny(action, 'inactive');
      }
      if (wsClaims.cv !== board.teacher_credential_version) {
        return deny(action, 'revoked');
      }
    } else {
      if (!board.teacher_is_active) {
        return deny(action, 'inactive');
      }
      if (wsClaims.cv !== board.access_credential_version) {
        return deny(action, 'revoked');
      }
    }
    const denied = boardStateDenial(board, action, now);
    if (denied) {
      return denied;
    }
    return grant({
      action,
      role: wsClaims.role,
      teacherId: board.teacher_id,
      boardId: board.id,
      credentialVersion: wsClaims.role === 'teacher' ? board.teacher_credential_version : board.access_credential_version,
      validUntil: new Date(board.valid_until)
    });
  };

  // ---- Administrator passphrase exchange -----------------------------------

  const exchangeAdministratorPassphrase = ({
    passphrase,
    clientKey,
    now = new Date()
  }: {
    passphrase: string | undefined;
    clientKey: string;
    now?: Date;
  }): AdminExchangeResult => {
    if (!config.adminPassphrase) {
      return { ok: false, reason: 'unavailable' };
    }
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      return { ok: false, reason: 'missing' };
    }
    if (!loginAllowed(clientKey, now)) {
      return { ok: false, reason: 'rateLimited' };
    }
    if (!safeEqual(passphrase, config.adminPassphrase)) {
      return { ok: false, reason: 'invalid' };
    }
    const payload: AdminSessionPayload = {
      role: 'administrator',
      iat: now.getTime(),
      exp: now.getTime() + config.adminSessionTtlMs
    };
    return { ok: true, sessionToken: signPayload(payload, config.adminSessionSecret), expiresAt: new Date(payload.exp) };
  };

  const verifyAdministratorSessionToken = (token: string, now: Date): AdminSessionPayload | null => {
    const verified = verifySignedPayload<AdminSessionPayload>(token, config.adminSessionSecret);
    if (!verified || verified.payload.role !== 'administrator') return null;
    if (now.getTime() > verified.exp) return null;
    return verified.payload;
  };

  // ---- Teacher Access Link lifecycle --------------------------------------

  const newLinkFor = async (trx: Knex, teacherId: string, cv: number): Promise<{ token: string; url: string }> => {
    const token = randomBytes(32).toString('base64url');
    await trx('teacher_access_links').insert({
      teacher_id: teacherId,
      token,
      credential_version: cv,
      is_active: true
    });
    return { token, url: teacherAccessLinkUrl(token) };
  };

  const createOrReuseTeacherAccessLink = async ({
    email,
    internalLabel,
    organizationId
  }: {
    email: string;
    internalLabel?: string | null;
    organizationId?: string | null;
  }): Promise<TeacherMutationResult> => {
    const normalized = normalizeTeacherEmail(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      return { ok: false, reason: 'invalidEmail' };
    }
    try {
      return await db().transaction(async (trx) => {
        let teacher = await trx<TeacherRow>('teachers').where({ email: normalized }).first();
        let created = false;
        if (!teacher) {
          const [row] = await trx<TeacherRow>('teachers')
            .insert({
              email: normalized,
              full_name: internalLabel ?? null,
              organization_id: organizationId ?? null
            })
            .returning('*');
          teacher = row;
          created = true;
        }
        if (!teacher) {
          return { ok: false as const, reason: 'unavailable' as const };
        }
        const [existing] = await trx('teacher_access_links')
          .where({ teacher_id: teacher.id, is_active: true })
          .select('token');
        if (existing) {
          return {
            ok: true as const,
            teacherId: teacher.id,
            email: teacher.email,
            internalLabel: teacher.full_name,
            created,
            token: existing.token,
            accessLink: teacherAccessLinkUrl(existing.token)
          };
        }
        const link = await newLinkFor(trx, teacher.id, teacher.access_credential_version);
        return {
          ok: true as const,
          teacherId: teacher.id,
          email: teacher.email,
          internalLabel: teacher.full_name,
          created,
          token: link.token,
          accessLink: link.url
        };
      });
    } catch (error) {
      logger.error('CapabilityAccess: create teacher failed', { error: (error as Error).message });
      return { ok: false, reason: 'unavailable' };
    }
  };

  const regenerateTeacherAccessLink = async (
    teacherId: string,
    now = new Date()
  ): Promise<TeacherMutationResult> => {
    try {
      return await db().transaction(async (trx) => {
        const teacher = await trx<TeacherRow>('teachers').where({ id: teacherId }).first();
        if (!teacher) {
          return { ok: false as const, reason: 'notFound' as const };
        }
        // Atomic version bump: every credential issued before this point
        // (link, session cookie, ws token) is denied immediately afterwards.
        const [bumped] = await trx<TeacherRow>('teachers')
          .where({ id: teacherId })
          .increment('access_credential_version', 1)
          .returning(['id', 'email', 'full_name', 'access_credential_version']);
        if (!bumped) {
          return { ok: false as const, reason: 'unavailable' as const };
        }
        await trx('teacher_access_links')
          .where({ teacher_id: teacherId, is_active: true })
          .update({ is_active: false, regenerated_at: now });
        const link = await newLinkFor(trx, teacherId, bumped.access_credential_version);
        return {
          ok: true as const,
          teacherId,
          email: bumped.email,
          internalLabel: bumped.full_name,
          created: false,
          token: link.token,
          accessLink: link.url
        };
      });
    } catch (error) {
      logger.error('CapabilityAccess: regenerate teacher link failed', { teacherId, error: (error as Error).message });
      return { ok: false, reason: 'unavailable' };
    }
  };

  const deactivateTeacher = async (
    teacherId: string,
    now = new Date()
  ): Promise<{ ok: true } | { ok: false; reason: 'notFound' | 'alreadyInactive' | 'unavailable' }> => {
    try {
      return await db().transaction(async (trx) => {
        const teacher = await trx<TeacherRow>('teachers').where({ id: teacherId }).first();
        if (!teacher) {
          return { ok: false as const, reason: 'notFound' as const };
        }
        if (!teacher.is_active) {
          return { ok: false as const, reason: 'alreadyInactive' as const };
        }
        // Version bump + is_active=false in one transaction: sessions, links
        // and ws tokens die immediately. Scheduling board deletion is
        // VVE-102's job; access denial must not wait for it.
        await trx('teachers')
          .where({ id: teacherId })
          .update({ is_active: false, access_credential_version: teacher.access_credential_version + 1 });
        await trx('teacher_access_links')
          .where({ teacher_id: teacherId, is_active: true })
          .update({ is_active: false, regenerated_at: now });
        return { ok: true as const };
      });
    } catch (error) {
      logger.error('CapabilityAccess: deactivate teacher failed', { teacherId, error: (error as Error).message });
      return { ok: false, reason: 'unavailable' };
    }
  };

  const listTeacherAccessLinks = async (): Promise<TeacherAccessLinkView[] | { error: 'unavailable' }> => {
    try {
      const rows = await db()<TeacherRow & { link_token: string | null; link_created_at: Date | null }>('teachers as t')
        .leftJoin('teacher_access_links as l', function joinActive() {
          this.on('l.teacher_id', 't.id').andOnVal('l.is_active', true);
        })
        .orderBy('t.created_at', 'desc')
        .limit(500)
        .select(
          't.id',
          't.email',
          db().ref('t.full_name').as('full_name'),
          't.is_active',
          't.created_at',
          't.last_login_at',
          db().ref('l.token').as('link_token'),
          db().ref('l.created_at').as('link_created_at')
        );
      return rows.map((row) => ({
        teacherId: row.id,
        email: row.email,
        internalLabel: row.full_name ?? null,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at ?? null,
        accessLink: row.link_token ? teacherAccessLinkUrl(row.link_token) : null,
        linkCreatedAt: row.link_created_at ?? null
      }));
    } catch (error) {
      logger.error('CapabilityAccess: teacher list failed', { error: (error as Error).message });
      return { error: 'unavailable' };
    }
  };

  return {
    decide,
    exchangeAdministratorPassphrase,
    verifyAdministratorSessionToken,
    createOrReuseTeacherAccessLink,
    regenerateTeacherAccessLink,
    deactivateTeacher,
    listTeacherAccessLinks
  };
};

// ---------------------------------------------------------------------------
// Transport session token issuance (used by HTTP adapters after a grant)
// ---------------------------------------------------------------------------

export const TEACHER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export const issueTeacherSessionToken = (teacherId: string, cv: number): string =>
  signPayload({ teacherId, cv, exp: Date.now() + TEACHER_SESSION_TTL_MS }, config.teacherSessionSecret);

export const issueBoardWsToken = (input: {
  boardId: string;
  role: 'teacher' | 'student';
  teacherId?: string | undefined;
  cv: number;
  ttlMs?: number;
}): string =>
  signPayload(
    {
      boardId: input.boardId,
      role: input.role,
      ...(input.role === 'teacher' && input.teacherId ? { teacherId: input.teacherId } : {}),
      cv: input.cv,
      exp: Date.now() + (input.ttlMs ?? 1000 * 60 * 60 * 2)
    },
    config.boardWsSecret
  );

/** The immutable Public Teacher Identity (ADR-0009). */
export const PUBLIC_TEACHER_IDENTITY: string = 'Dawid Furmaniuk - Matsin';

// Exported for tests: constant-time compare helper parity.
export const constantTimeEquals = safeEqual;
