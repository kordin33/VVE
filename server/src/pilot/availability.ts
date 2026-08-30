/**
 * PilotAvailability — the one shared, versioned feature manifest for the VVE Pilot.
 *
 * This module is consumed by BOTH packages:
 *  - the server (`server/src/httpApp.ts`) uses it to decide which HTTP route
 *    groups are registered at startup;
 *  - the frontend (via the `@pilot` alias, see `frontend/vite.config.js`) uses
 *    it to decide which views, toolbar buttons, panels and shortcuts exist.
 *
 * It is pure and deterministic: no I/O, no clocks, no randomness. Unknown
 * feature ids and invalid environments/roles fail closed with typed errors.
 *
 * Surface rules (see docs/architecture/VVE-DEEP-MODULE-DESIGN.md, Module 9):
 *  - `environment: 'pilot'` is the production-like Pilot surface: every
 *    `dev-only` feature resolves unavailable and no runtime input can widen it.
 *  - `environment: 'development'` keeps the full capability set, but `dev-only`
 *    features still require an explicit internal `devSurface` flag
 *    (`VVE_DEV_SURFACE=1` on the server, `?__dev=1` on a development build of
 *    the frontend). The flag is a developer affordance only; it is never read
 *    from untrusted input in the pilot environment.
 */

export const PILOT_MANIFEST_VERSION = 'vve.pilot-availability/1';

export type RuntimeEnvironment = 'development' | 'pilot';

export type RuntimeRole = 'administrator' | 'teacher' | 'student' | 'developer' | 'server';

export type FeatureId =
  // Visible lesson tools (toolbar).
  | 'tool.select'
  | 'tool.pan'
  | 'tool.pen'
  | 'tool.text'
  | 'tool.eraser'
  | 'tool.shapes'
  | 'tool.undo'
  | 'tool.redo'
  | 'tool.clearBoard'
  // Visible panels and artifact actions.
  | 'panel.calculator'
  | 'panel.mathGraph'
  | 'panel.physicsGraph'
  | 'panel.coordinateSystem'
  | 'panel.inputStyle'
  | 'panel.imagePaste'
  | 'panel.pdfImport'
  | 'panel.pdfExport'
  // Product surfaces (frontend views).
  | 'surface.adminPanel'
  | 'surface.teacherDashboard'
  | 'surface.studentEntry'
  | 'surface.boardSession'
  // Server route groups.
  | 'http.adminTeachers'
  | 'http.teacherAuth'
  | 'http.teacherBoards'
  | 'http.boardAccess'
  | 'http.ai'
  | 'http.roomsApi'
  // Internal / developer-only surfaces (ADR-0007, ADR-0010, ADR-0011).
  | 'dev.legacyPeerRooms'
  | 'dev.rawBoardTransfer'
  | 'dev.debugControls'
  | 'dev.encryptionClaims'
  | 'dev.editParticipantNames'
  | 'experiment.ai'
  | 'experiment.chemistry'
  | 'experiment.gridAlign';

export type DenialReason =
  | 'unknown-feature'
  | 'invalid-environment'
  | 'invalid-role'
  | 'not-in-pilot'
  | 'dev-surface-required'
  | 'role-not-allowed';

export type AvailabilityDecision =
  | { available: true; feature: FeatureId; environment: RuntimeEnvironment; role: RuntimeRole }
  | { available: false; feature: FeatureId | null; reason: DenialReason };

export interface AvailabilityContext {
  environment: RuntimeEnvironment;
  role: RuntimeRole;
  /** Intentional internal flag; ignored in the pilot environment. */
  devSurface?: boolean;
}

/**
 * Where a feature surfaces in the UI:
 *  - `toolbar`: rendered as a ToolBar button (the enumerable lesson tool set);
 *  - `menu`: rendered in the TopMenu;
 *  - `background`: a visible capability without its own control (e.g. image
 *    paste via clipboard).
 */
export type ToolKind = 'toolbar' | 'menu' | 'background';

export interface ToolDescriptor {
  id: FeatureId;
  kind: ToolKind;
}

export interface FeatureManifest {
  version: string;
  environment: RuntimeEnvironment;
  role: RuntimeRole;
  /** Every feature id available for this environment + role (dev-only features are listed in development). */
  features: readonly FeatureId[];
  /** Frontend views that may be mounted. */
  surfaces: readonly FeatureId[];
  /** Server route groups that may be registered. */
  serverRoutes: readonly FeatureId[];
  /** Ordered toolbar/panel descriptors for the UI. */
  tools: readonly ToolDescriptor[];
}

export class PilotAvailabilityError extends Error {
  constructor(readonly reason: 'invalid-environment' | 'invalid-role', message: string) {
    super(`[pilot-availability] ${message}`);
    this.name = 'PilotAvailabilityError';
  }
}

type EnvironmentPolicy = 'always' | 'dev-only';

interface FeatureDefinition {
  id: FeatureId;
  env: EnvironmentPolicy;
  roles: readonly RuntimeRole[];
  tool?: ToolKind;
}

const EVERYONE: readonly RuntimeRole[] = ['administrator', 'teacher', 'student', 'developer'];
const LESSON_ROLES: readonly RuntimeRole[] = ['teacher', 'student', 'developer'];
const SERVER_ONLY: readonly RuntimeRole[] = ['server'];

/**
 * The catalog is the single source of truth. Ordering matters: `tools` preserves
 * it so the manifest snapshot is stable and the toolbar renders in catalog order.
 */
const CATALOG: readonly FeatureDefinition[] = [
  // --- Lesson tools -------------------------------------------------------
  { id: 'tool.select', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'tool.pan', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'tool.pen', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'tool.text', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'tool.eraser', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'tool.shapes', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'tool.undo', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'tool.redo', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  // Whole-board clear is a Teacher command (Pilot spec: students never get it).
  { id: 'tool.clearBoard', env: 'always', roles: ['teacher', 'developer'], tool: 'toolbar' },
  // --- Visible panels and artifact actions --------------------------------
  { id: 'panel.calculator', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'panel.mathGraph', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'panel.physicsGraph', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'panel.coordinateSystem', env: 'always', roles: LESSON_ROLES, tool: 'toolbar' },
  { id: 'panel.inputStyle', env: 'always', roles: LESSON_ROLES, tool: 'menu' },
  { id: 'panel.imagePaste', env: 'always', roles: LESSON_ROLES, tool: 'background' },
  { id: 'panel.pdfImport', env: 'always', roles: LESSON_ROLES, tool: 'menu' },
  { id: 'panel.pdfExport', env: 'always', roles: LESSON_ROLES, tool: 'menu' },
  // --- Product surfaces ---------------------------------------------------
  { id: 'surface.adminPanel', env: 'always', roles: ['administrator'] },
  { id: 'surface.teacherDashboard', env: 'always', roles: ['teacher'] },
  { id: 'surface.studentEntry', env: 'always', roles: ['student'] },
  { id: 'surface.boardSession', env: 'always', roles: LESSON_ROLES },
  // --- Server route groups -------------------------------------------------
  { id: 'http.adminTeachers', env: 'always', roles: SERVER_ONLY },
  { id: 'http.teacherAuth', env: 'always', roles: SERVER_ONLY },
  { id: 'http.teacherBoards', env: 'always', roles: SERVER_ONLY },
  { id: 'http.boardAccess', env: 'always', roles: SERVER_ONLY },
  { id: 'http.ai', env: 'dev-only', roles: SERVER_ONLY },
  { id: 'http.roomsApi', env: 'dev-only', roles: SERVER_ONLY },
  // --- Internal / developer-only ------------------------------------------
  { id: 'dev.legacyPeerRooms', env: 'dev-only', roles: ['developer'] },
  { id: 'dev.rawBoardTransfer', env: 'dev-only', roles: ['developer'] },
  { id: 'dev.debugControls', env: 'dev-only', roles: ['developer'] },
  // ADR-0011: no E2E encryption claims; CONTEXT.md: participant labels are
  // system-assigned and cannot be edited.
  { id: 'dev.encryptionClaims', env: 'dev-only', roles: ['developer'] },
  { id: 'dev.editParticipantNames', env: 'dev-only', roles: ['developer'] },
  { id: 'experiment.ai', env: 'dev-only', roles: LESSON_ROLES },
  { id: 'experiment.chemistry', env: 'dev-only', roles: LESSON_ROLES },
  { id: 'experiment.gridAlign', env: 'dev-only', roles: LESSON_ROLES }
];

const BY_ID: ReadonlyMap<string, FeatureDefinition> = new Map(CATALOG.map((def) => [def.id, def]));

const ENVIRONMENTS: readonly RuntimeEnvironment[] = ['development', 'pilot'];
const ROLES: readonly RuntimeRole[] = ['administrator', 'teacher', 'student', 'developer', 'server'];

const isEnvironment = (value: unknown): value is RuntimeEnvironment =>
  typeof value === 'string' && (ENVIRONMENTS as readonly string[]).includes(value);

const isRole = (value: unknown): value is RuntimeRole =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export interface PilotAvailability {
  resolve(input: { environment: RuntimeEnvironment; role: RuntimeRole }): FeatureManifest;
  require(feature: FeatureId, ctx: AvailabilityContext): AvailabilityDecision;
}

const manifestFor = (environment: RuntimeEnvironment, role: RuntimeRole): FeatureManifest => {
  const features = CATALOG.filter(
    (def) =>
      (environment === 'development' || def.env === 'always') &&
      def.roles.includes(role)
  ).map((def) => def.id);
  return {
    version: PILOT_MANIFEST_VERSION,
    environment,
    role,
    features,
    surfaces: features.filter((id) => id.startsWith('surface.')),
    serverRoutes: features.filter((id) => id.startsWith('http.')),
    tools: CATALOG.filter(
      (def) => def.tool === 'toolbar' && features.includes(def.id)
    ).map((def) => ({ id: def.id, kind: def.tool as ToolKind }))
  };
};

export const createPilotAvailability = (): PilotAvailability => ({
  resolve({ environment, role }) {
    if (!isEnvironment(environment)) {
      throw new PilotAvailabilityError(
        'invalid-environment',
        `Unknown environment ${JSON.stringify(environment)}; expected one of ${ENVIRONMENTS.join(', ')}.`
      );
    }
    if (!isRole(role)) {
      throw new PilotAvailabilityError(
        'invalid-role',
        `Unknown role ${JSON.stringify(role)}; expected one of ${ROLES.join(', ')}.`
      );
    }
    return manifestFor(environment, role);
  },

  require(feature, ctx) {
    const definition = typeof feature === 'string' ? BY_ID.get(feature) : undefined;
    if (!definition) {
      return { available: false, feature: null, reason: 'unknown-feature' };
    }
    if (!isEnvironment(ctx?.environment)) {
      return { available: false, feature: definition.id, reason: 'invalid-environment' };
    }
    if (!isRole(ctx?.role)) {
      return { available: false, feature: definition.id, reason: 'invalid-role' };
    }
    if (definition.env === 'dev-only') {
      if (ctx.environment === 'pilot') {
        return { available: false, feature: definition.id, reason: 'not-in-pilot' };
      }
      if (!ctx.devSurface) {
        return { available: false, feature: definition.id, reason: 'dev-surface-required' };
      }
    }
    if (!definition.roles.includes(ctx.role)) {
      return { available: false, feature: definition.id, reason: 'role-not-allowed' };
    }
    return { available: true, feature: definition.id, environment: ctx.environment, role: ctx.role };
  }
});
