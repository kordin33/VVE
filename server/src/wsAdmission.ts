import type { AccessDecision, CapabilityAccess } from './pilot/capabilityAccess';

/**
 * WebSocket admission Adapter for Managed Board rooms (VVE-101, Module 6 prep).
 *
 * `/ws/whiteboard/:roomId?wsToken=...` admission MUST go through
 * CapabilityAccess.decide('board.edit'): the durable board state (expiry, End
 * Board Access, deletion schedule, credential version, owning teacher
 * activity) and the scoped token are re-verified at admission, and a
 * database failure denies the connection — the previous fail-open path
 * (DB error ⇒ treated as a non-board room ⇒ admitted) is deleted.
 *
 * Legacy non-UUID peer rooms (ADR-0010, dev-only surface) remain reachable
 * ONLY in the development environment with the internal dev flag; in the
 * Pilot they are denied. Frame-level authorization inside a live session is
 * VVE-103's scope.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WsAdmission =
  | { admitted: true; decision: AccessDecision & { granted: true }; roomId: string }
  | { admitted: false; closeCode: 1008 | 1013; closeReason: string; roomId: string };

export const isManagedBoardRoomId = (roomId: string): boolean => UUID_PATTERN.test(roomId);

export const createWsAdmission = (access: CapabilityAccess, legacyPeerRoomsAllowed: boolean) => ({
  /**
   * Admit one connection to a room. Board rooms require a granted
   * board.edit decision; non-UUID rooms are legacy peer rooms (dev-only).
   */
  admit: async (roomId: string, token: string | null, now: Date = new Date()): Promise<WsAdmission> => {
    if (!isManagedBoardRoomId(roomId)) {
      if (legacyPeerRoomsAllowed) {
        // Legacy peer room (ADR-0010): the developer-only surface.
        return {
          admitted: true,
          roomId,
          decision: {
            granted: true,
            action: 'board.edit',
            role: 'teacher',
            teacherId: null,
            boardId: null,
            credentialVersion: 0,
            validUntil: null
          }
        };
      }
      return { admitted: false, closeCode: 1008, closeReason: 'Room not available', roomId };
    }

    if (!token) {
      return { admitted: false, closeCode: 1008, closeReason: 'Unauthorized', roomId };
    }

    const decision = await access.decide({
      credential: { kind: 'boardWs', boardId: roomId, token },
      action: 'board.edit',
      target: { boardId: roomId },
      now
    });

    if (!decision.granted) {
      return { admitted: false, closeCode: 1008, closeReason: 'Unauthorized', roomId };
    }
    return { admitted: true, roomId, decision };
  }
});

export type WsAdmissionAdapter = ReturnType<typeof createWsAdmission>;
