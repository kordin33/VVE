import request from 'supertest';
import type { Express } from 'express';

/**
 * The admin→teacher→board→student flow through the CapabilityAccess stack
 * (VVE-101), expressed once and reusably.
 *
 * Every step is a real HTTP call against the app under test:
 *   1. The Administrator exchanges the shared passphrase for a twelve-hour
 *      HttpOnly session cookie (POST /api/admin/session) and creates a
 *      Teacher with exactly one active retrievable Teacher Access Link.
 *   2. The Teacher opens the access link; CapabilityAccess validates it and
 *      the stack exchanges it for a teacher session cookie, then redirects
 *      to the dashboard.
 *   3. The Teacher creates a Managed Board and receives the Board Access
 *      Link.
 *   4. The Student opens the Board Access Link and receives board facts plus
 *      a scoped collaboration ws admission token.
 */
export interface CurrentStackFlowResult {
  teacherId: string;
  teacherAccessPath: string;
  adminSessionCookie: string;
  teacherSessionCookie: string;
  boardId: string;
  publicSlug: string;
  studentAccessPath: string;
  studentBoard: {
    wsToken: string;
    role: string;
    teacherName: string;
    title: string | null;
  };
}

export interface CurrentStackFlowOptions {
  adminPassphrase: string;
  teacherEmail: string;
  teacherFullName?: string;
  boardTitle?: string;
}

const pathOf = (url: string): string => `${new URL(url).pathname}${new URL(url).search}`;

const cookieFrom = (res: request.Response): string => {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof raw !== 'string') {
    throw new Error('Expected a Set-Cookie header from the login route.');
  }
  return raw.split(';')[0] ?? raw;
};

export const driveCurrentStackLessonFlow = async (
  app: Express,
  { adminPassphrase, teacherEmail, teacherFullName = 'Flow Teacher', boardTitle = 'Flow Board' }: CurrentStackFlowOptions
): Promise<CurrentStackFlowResult> => {
  // 1a. Administrator passphrase → twelve-hour HttpOnly session.
  const loginRes = await request(app)
    .post('/api/admin/session')
    .send({ passphrase: adminPassphrase });
  if (loginRes.status !== 200) {
    throw new Error(`Admin session login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const adminSessionCookie = cookieFrom(loginRes);

  // 1b. Administrator creates the teacher and receives the ONE active link.
  const importRes = await request(app)
    .post('/api/admin/teachers')
    .set('Cookie', adminSessionCookie)
    .send({ email: teacherEmail, internalLabel: teacherFullName });
  if (importRes.status !== 200 && importRes.status !== 201) {
    throw new Error(`Admin teacher creation failed: ${importRes.status} ${JSON.stringify(importRes.body)}`);
  }
  const teacherLink: string | undefined = importRes.body.accessLink;
  const teacherId: string | undefined = importRes.body.teacherId;
  if (typeof teacherLink !== 'string' || typeof teacherId !== 'string') {
    throw new Error(`Admin teacher creation returned no access link: ${JSON.stringify(importRes.body)}`);
  }

  // 2. Teacher opens the access link → session cookie + dashboard redirect.
  const teacherLoginRes = await request(app).get(pathOf(teacherLink));
  if (teacherLoginRes.status !== 302) {
    throw new Error(`Teacher login failed: ${teacherLoginRes.status} ${JSON.stringify(teacherLoginRes.body)}`);
  }
  const teacherSessionCookie = cookieFrom(teacherLoginRes);

  // 3. Teacher creates a Managed Board and receives the Board Access Link.
  const createBoardRes = await request(app)
    .post('/api/teacher/boards')
    .set('Cookie', teacherSessionCookie)
    .send({ title: boardTitle, studentName: 'Flow Student' });
  if (createBoardRes.status !== 201) {
    throw new Error(
      `Teacher board creation failed: ${createBoardRes.status} ${JSON.stringify(createBoardRes.body)}`
    );
  }
  const studentUrl: string = createBoardRes.body.studentUrl;
  const boardId: string = createBoardRes.body.boardId;
  const publicSlug: string = createBoardRes.body.publicSlug;

  // 4. Student opens the Board Access Link and receives board facts + ws token.
  const studentRes = await request(app).get(pathOf(studentUrl));
  if (studentRes.status !== 200) {
    throw new Error(`Student board access failed: ${studentRes.status} ${JSON.stringify(studentRes.body)}`);
  }

  return {
    teacherId,
    teacherAccessPath: pathOf(teacherLink),
    adminSessionCookie,
    teacherSessionCookie,
    boardId,
    publicSlug,
    studentAccessPath: pathOf(studentUrl),
    studentBoard: {
      wsToken: studentRes.body.wsToken,
      role: studentRes.body.role,
      teacherName: studentRes.body.teacherName,
      title: studentRes.body.title ?? null
    }
  };
};
