import { randomBytes } from 'crypto';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { PersistenceLayer } from './persistence';
import { logger } from './logger';
import { BoardYjsPersistence } from './services/boardYjsPersistence';

export interface RoomMetadata {
  roomId: string;
  displayName: string;
  ownerName: string;
  ownerSecret: string;
  isArchived: boolean;
  isListed: boolean;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  metadata: Record<string, unknown>;
}

export interface RoomSnapshot extends Omit<RoomMetadata, 'ownerSecret'> {
  onlineCount: number;
}

export interface CreateRoomOptions {
  displayName?: string;
  ownerName?: string;
  roomId?: string;
}

export interface UpdateRoomOptions {
  displayName?: string;
  ownerName?: string;
  isListed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ListRoomsOptions {
  search?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface RoomContext {
  id: string;
  doc: Y.Doc;
  awareness: Awareness;
  connections: Map<WebSocket, Set<number>>;
  lastActive: number;
  initialized?: boolean;
  hydrated?: boolean;
  // 6.2: Promise-based hydration lock instead of boolean flag
  hydrationPromise?: Promise<void>;
  meta: RoomMetadata;
}

export interface RoomLookup {
  room: RoomContext;
  created: boolean;
}

class InMemoryPersistence implements PersistenceLayer {
  private storage = new Map<string, { update: Uint8Array; meta: RoomMetadata }>();

  async saveRoom(roomId: string, doc: Y.Doc, meta: RoomMetadata): Promise<void> {
    this.storage.set(roomId, { update: Y.encodeStateAsUpdate(doc), meta: { ...meta } });
  }

  async loadRoom(roomId: string): Promise<{ doc: Y.Doc; meta: RoomMetadata } | null> {
    const entry = this.storage.get(roomId);
    if (!entry) return null;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, entry.update);
    return { doc, meta: { ...entry.meta } };
  }

  async listRooms(): Promise<RoomMetadata[]> {
    return Array.from(this.storage.values()).map(({ meta }) => ({ ...meta }));
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.storage.delete(roomId);
  }
}

const now = () => Date.now();

export class RoomManager {
  private rooms = new Map<string, RoomContext>();
  private persistence: PersistenceLayer;
  private boardPersistence: BoardYjsPersistence | undefined;

  constructor(persistence?: PersistenceLayer, boardPersistence?: BoardYjsPersistence) {
    this.persistence = persistence ?? new InMemoryPersistence();
    this.boardPersistence = boardPersistence ?? undefined;
    this.loadFromPersistence();
  }

  private async loadFromPersistence() {
    const storedRooms = await this.persistence.listRooms();
    for (const meta of storedRooms) {
      // Lazy loading: Create a placeholder context with just metadata.
      // The doc and awareness will be initialized when get() is called.
      // We use a temporary doc that will be replaced or hydrated on access.
      // Actually, to keep listRooms working, we just need the metadata in memory.
      // We can mark it as 'unloaded' or similar.

      // For now, let's create a minimal context.
      // We won't load the full doc content yet.
      const roomId = meta.roomId;
      const doc = new Y.Doc(); // Empty doc for now
      const awareness = new Awareness(doc);

      const room: RoomContext = {
        id: roomId,
        doc,
        awareness,
        connections: new Map(),
        lastActive: meta.lastActiveAt || now(),
        initialized: false, // Will be set by initializeRoom on first connection
        hydrated: false,
        meta
      };
      this.rooms.set(roomId, room);
    }
    logger.info(`Loaded metadata for ${this.rooms.size} rooms from persistence.`);
  }

  private generateRoomId(): string {
    let roomId: string;
    do {
      roomId = `board_${randomBytes(4).toString('hex')}`;
    } while (this.rooms.has(roomId));
    return roomId;
  }

  private generateSecret(): string {
    return randomBytes(16).toString('hex');
  }

  private createContext(roomId: string): RoomContext {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const timestamp = now();
    return {
      id: roomId,
      doc,
      awareness,
      connections: new Map(),
      lastActive: timestamp,
      initialized: false,
      hydrated: this.boardPersistence ? false : true,
      meta: {
        roomId,
        displayName: roomId,
        ownerName: '',
        ownerSecret: this.generateSecret(),
        isArchived: false,
        isListed: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActiveAt: timestamp,
        metadata: {}
      }
    };
  }

  private saveDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private bumpActivity(room: RoomContext) {
    const timestamp = now();
    room.lastActive = timestamp;
    room.meta.lastActiveAt = timestamp;
    // Debounce persistence writes to avoid disk I/O on every access
    const existing = this.saveDebounceTimers.get(room.id);
    if (existing) clearTimeout(existing);
    this.saveDebounceTimers.set(room.id, setTimeout(() => {
      this.saveDebounceTimers.delete(room.id);
      this.saveRoom(room);
    }, 5000));
  }

  private async saveRoom(room: RoomContext) {
    await this.persistence.saveRoom(room.id, room.doc, room.meta);
  }

  private serialize(room: RoomContext, includeSecret = false): RoomSnapshot & { ownerSecret?: string } {
    const payload: RoomSnapshot & { ownerSecret?: string } = {
      roomId: room.meta.roomId,
      displayName: room.meta.displayName,
      ownerName: room.meta.ownerName,
      isArchived: room.meta.isArchived,
      isListed: room.meta.isListed,
      createdAt: room.meta.createdAt,
      updatedAt: room.meta.updatedAt,
      lastActiveAt: room.meta.lastActiveAt,
      metadata: room.meta.metadata,
      onlineCount: room.connections.size
    };
    if (includeSecret) {
      payload.ownerSecret = room.meta.ownerSecret;
    }
    return payload;
  }

  async get(roomId: string): Promise<RoomLookup> {
    let room = this.rooms.get(roomId);
    let created = false;

    if (!room) {
      room = this.createContext(roomId);
      this.rooms.set(roomId, room);
      created = true;
    }

    // 6.2: Promise-based hydration lock — concurrent get() calls await the same promise
    if (room && room.hydrated === false) {
      if (!room.hydrationPromise) {
        room.hydrationPromise = (async () => {
          try {
            const isBoard = this.boardPersistence
              ? await this.boardPersistence.isBoardRoom(roomId)
              : false;

            if (isBoard && this.boardPersistence) {
              await this.boardPersistence.hydrate(room);
            } else {
              const data = await this.persistence.loadRoom(roomId);
              if (data) {
                Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(data.doc));
                room.meta = data.meta;
              } else {
                await this.saveRoom(room);
              }
              room.hydrated = true;
            }
          } catch (err) {
            logger.error(`Failed to hydrate room ${roomId}`, {
              error: (err as Error).message
            });
          } finally {
            delete room.hydrationPromise;
          }
        })();
      }
      await room.hydrationPromise;
    }

    this.bumpActivity(room);
    return { room: room!, created };
  }

  async createRoom(options: CreateRoomOptions = {}): Promise<RoomSnapshot & { ownerSecret: string }> {
    const roomId = options.roomId ? options.roomId.trim() : this.generateRoomId();
    if (!roomId) {
      throw new Error('Room ID cannot be empty.');
    }
    if (this.rooms.has(roomId)) {
      throw new Error('Room with this ID already exists.');
    }
    const { room } = await this.get(roomId);
    if (options.displayName) {
      room.meta.displayName = options.displayName.trim();
    }
    if (options.ownerName) {
      room.meta.ownerName = options.ownerName.trim();
    }
    room.meta.updatedAt = now();
    await this.saveRoom(room);
    return this.serialize(room, true) as RoomSnapshot & { ownerSecret: string };
  }

  listRooms(options: ListRoomsOptions = {}): RoomSnapshot[] {
    const includeArchived = Boolean(options.includeArchived);
    const searchTerm = options.search?.toLowerCase().trim();
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

    const result: RoomSnapshot[] = [];
    for (const room of this.rooms.values()) {
      if (!includeArchived && room.meta.isArchived) continue;
      if (searchTerm) {
        const matches =
          room.meta.roomId.toLowerCase().includes(searchTerm) ||
          room.meta.displayName.toLowerCase().includes(searchTerm) ||
          (room.meta.ownerName || '').toLowerCase().includes(searchTerm);
        if (!matches) continue;
      }
      result.push(this.serialize(room));
      if (result.length >= limit) break;
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getRoomMetadata(roomId: string, ownerSecret?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const includeSecret = ownerSecret === room.meta.ownerSecret;
    return this.serialize(room, includeSecret);
  }

  private assertOwner(room: RoomContext, ownerSecret: string) {
    if (!ownerSecret || ownerSecret !== room.meta.ownerSecret) {
      throw new Error('Invalid owner secret.');
    }
  }

  async updateRoom(roomId: string, ownerSecret: string, updates: UpdateRoomOptions) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found.');
    this.assertOwner(room, ownerSecret);
    if (typeof updates.displayName === 'string') {
      room.meta.displayName = updates.displayName.trim() || room.meta.roomId;
    }
    if (typeof updates.ownerName === 'string') {
      room.meta.ownerName = updates.ownerName.trim();
    }
    if (typeof updates.isListed === 'boolean') {
      room.meta.isListed = updates.isListed;
    }
    if (updates.metadata && typeof updates.metadata === 'object') {
      room.meta.metadata = { ...room.meta.metadata, ...updates.metadata };
    }
    room.meta.updatedAt = now();
    await this.saveRoom(room);
    return this.serialize(room, true);
  }

  async archiveRoom(roomId: string, ownerSecret: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found.');
    this.assertOwner(room, ownerSecret);
    room.meta.isArchived = true;
    room.meta.isListed = false;
    room.meta.updatedAt = now();
    await this.saveRoom(room);
    return this.serialize(room, true);
  }

  delete(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.doc.destroy();
    this.rooms.delete(roomId);
    this.persistence.deleteRoom(roomId);
    return true;
  }

  cleanup(ttlMs: number) {
    const timestamp = now();
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.connections.size === 0 && timestamp - room.lastActive > ttlMs) {
        // Instead of deleting, maybe just archive or unload from memory?
        // For now, let's keep the delete behavior but it deletes from persistence too.
        // If we want persistence, we shouldn't delete on TTL unless it's a "temp" room.
        // Let's change cleanup to UNLOAD from memory but keep in persistence if we want long term storage.
        // But for now, let's stick to the requested "persistence" which usually means "survive restart".
        // If I delete here, it's gone forever.
        // So I should probably NOT delete if it's a saved room.
        // Let's just unload it from memory to save RAM.

        // Unload logic:
        room.doc.destroy();
        this.rooms.delete(roomId);
        logger.info('Unloaded inactive room from memory', { roomId });

        // We do NOT call this.persistence.deleteRoom(roomId) here.
      }
    }
  }
}
