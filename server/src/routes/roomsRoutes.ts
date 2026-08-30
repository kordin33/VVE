import { Router } from 'express';
import type { RoomManager } from '../rooms';

const parseBooleanFlag = (value: unknown) => {
  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true';
  }
  return Boolean(value);
};

const parseLimit = (value: unknown, fallback = 25) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
};

const readOwnerSecret = (req: import('express').Request) =>
  (req.headers['x-owner-secret'] as string) ||
  (req.body && typeof req.body.ownerSecret === 'string' ? req.body.ownerSecret : undefined) ||
  (typeof req.query.ownerSecret === 'string' ? req.query.ownerSecret : undefined);

/**
 * Legacy anonymous peer-room API and the public lobby listing.
 * Registered by httpApp ONLY when the PilotAvailability manifest allows
 * `http.roomsApi` (development with the internal dev surface). Per
 * ADR-0010 the Pilot has no public lobby and no peer-room product entry.
 */
export const createRoomsApiRouter = (roomManager: RoomManager) => {
  const router = Router();

  router.get('/api/rooms', (req, res) => {
    const options: import('../rooms').ListRoomsOptions = {
      includeArchived: parseBooleanFlag(req.query.include_archived),
      limit: parseLimit(req.query.limit)
    };
    if (typeof req.query.search === 'string') {
      options.search = req.query.search;
    }
    const rooms = roomManager.listRooms(options);
    res.json({ rooms });
  });

  router.post('/api/rooms', async (req, res) => {
    try {
      const payload = req.body || {};
      const room = await roomManager.createRoom({
        displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
        ownerName: typeof payload.ownerName === 'string' ? payload.ownerName : undefined,
        roomId: typeof payload.roomId === 'string' ? payload.roomId : undefined
      });
      res.status(201).json(room);
    } catch (error) {
      const message = (error as Error).message || 'Failed to create room.';
      const status = message.includes('exists') ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.get('/api/rooms/:roomId', (req, res) => {
    const ownerSecret = readOwnerSecret(req);
    const room = roomManager.getRoomMetadata(req.params.roomId, ownerSecret);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    res.json(room);
  });

  router.patch('/api/rooms/:roomId', async (req, res) => {
    const ownerSecret = readOwnerSecret(req);
    if (!ownerSecret) {
      res.status(403).json({ error: 'ownerSecret is required.' });
      return;
    }
    try {
      const payload = req.body || {};
      const room = await roomManager.updateRoom(req.params.roomId, ownerSecret, {
        displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
        ownerName: typeof payload.ownerName === 'string' ? payload.ownerName : undefined,
        isListed: typeof payload.isListed === 'boolean' ? payload.isListed : undefined,
        metadata: typeof payload.metadata === 'object' ? payload.metadata : undefined
      });
      res.json(room);
    } catch (error) {
      const message = (error as Error).message || 'Unable to update room.';
      const status = message === 'Room not found.' ? 404 : 403;
      res.status(status).json({ error: message });
    }
  });

  router.delete('/api/rooms/:roomId', async (req, res) => {
    const ownerSecret = readOwnerSecret(req);
    if (!ownerSecret) {
      res.status(403).json({ error: 'ownerSecret is required.' });
      return;
    }
    try {
      const room = await roomManager.archiveRoom(req.params.roomId, ownerSecret);
      res.json(room);
    } catch (error) {
      const message = (error as Error).message || 'Unable to archive room.';
      const status = message === 'Room not found.' ? 404 : 403;
      res.status(status).json({ error: message });
    }
  });

  // Public lobby listing (dropped from the Pilot product per ADR-0010).
  router.get('/rooms', (_, res) => {
    res.json({
      rooms: roomManager.listRooms({ includeArchived: true, limit: 200 })
    });
  });

  return router;
};
