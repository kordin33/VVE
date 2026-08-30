import type { AccessGrant } from '../pilot/capabilityAccess';

declare module 'express-serve-static-core' {
  interface Request {
    /** Scoped grant produced by the CapabilityAccess HTTP adapter for this request. */
    capabilityGrant?: AccessGrant;
    correlationId?: string;
  }
}

export {};
