import * as Y from 'yjs';
import { randomUUID } from 'crypto';
import { getDb } from '../db';
import { logger } from '../logger';

type BoardStateRow = {
  board_id: string;
  ydoc_state: Buffer;
  updated_at: Date;
};

type BoardRow = {
  id: string;
  valid_until: Date;
  archived_at: Date | null;
  deleted_at: Date | null;
};

type FlushState = {
  pendingUpdates: number;
  timer?: NodeJS.Timeout | undefined;
  lastSnapshotAt: number;
};

const SNAPSHOT_EVERY_UPDATES = 20;
const SNAPSHOT_INTERVAL_MS = 10_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BoardYjsPersistence {
  private knownBoards = new Set<string>();
  private missingBoards = new Set<string>();
  private flushState = new Map<string, FlushState>();
  private cleanupTimer?: NodeJS.Timeout;

  async isBoardRoom(boardId: string): Promise<boolean> {
    if (this.knownBoards.has(boardId)) return true;
    if (this.missingBoards.has(boardId)) return false;
    if (!UUID_PATTERN.test(boardId)) {
      this.missingBoards.add(boardId);
      return false;
    }
    const row = await getDb()('boards').where({ id: boardId }).first('id');
    if (row) {
      this.knownBoards.add(boardId);
      return true;
    }
    this.missingBoards.add(boardId);
    return false;
  }

  async hydrate(room: { id: string; doc: Y.Doc; hydrated?: boolean }): Promise<void> {
    const boardId = room.id;
    const isBoard = await this.isBoardRoom(boardId);
    if (!isBoard) {
      room.hydrated = true;
      return;
    }

    try {
      const existing = await getDb()('board_yjs_state')
        .where({ board_id: boardId })
        .first();

      if (existing && existing.ydoc_state) {
        Y.applyUpdate(room.doc, new Uint8Array(existing.ydoc_state));
      } else {
        // Create empty snapshot so subsequent updates have a row to update
        const emptyUpdate = Y.encodeStateAsUpdate(new Y.Doc());
        await getDb()('board_yjs_state')
          .insert({
            board_id: boardId,
            ydoc_state: Buffer.from(emptyUpdate)
          })
          .onConflict('board_id')
          .ignore();
      }

      room.hydrated = true;
    } catch (error) {
      logger.error('Failed to hydrate board Yjs state', {
        boardId,
        error: (error as Error).message
      });
    }
  }

  async recordUpdate(boardId: string, update: Uint8Array, doc: Y.Doc): Promise<void> {
    const isBoard = await this.isBoardRoom(boardId);
    if (!isBoard) return;

    try {
      await getDb()('board_yjs_updates').insert({
        board_id: boardId,
        update: Buffer.from(update)
      });
    } catch (error) {
      logger.warn('Failed to append Yjs incremental update', {
        boardId,
        error: (error as Error).message
      });
    }

    const state = this.flushState.get(boardId) ?? {
      pendingUpdates: 0,
      lastSnapshotAt: 0
    };
    state.pendingUpdates += 1;

    const shouldSnapshot =
      state.pendingUpdates >= SNAPSHOT_EVERY_UPDATES ||
      Date.now() - state.lastSnapshotAt > SNAPSHOT_INTERVAL_MS;

    if (shouldSnapshot) {
      state.pendingUpdates = 0;
      state.lastSnapshotAt = Date.now();
      await this.forceSnapshot(boardId, doc);
    } else if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        state.pendingUpdates = 0;
        this.forceSnapshot(boardId, doc).catch((err) =>
          logger.error('Deferred snapshot failed', {
            boardId,
            error: (err as Error).message
          })
        );
      }, SNAPSHOT_INTERVAL_MS);
    }

    this.flushState.set(boardId, state);
  }

  async forceSnapshot(boardId: string, doc: Y.Doc): Promise<void> {
    const isBoard = await this.isBoardRoom(boardId);
    if (!isBoard) return;
    try {
      const snapshot = Y.encodeStateAsUpdate(doc);
      const db = getDb();
      await db('board_yjs_state')
        .insert({
          board_id: boardId,
          ydoc_state: Buffer.from(snapshot),
          updated_at: new Date()
        })
        .onConflict('board_id')
        .merge({
          ydoc_state: Buffer.from(snapshot),
          updated_at: new Date()
        });

      // 6.1: Size-based compaction — prune incremental updates after snapshot
      const deleted = await db('board_yjs_updates')
        .where({ board_id: boardId })
        .del();
      if (deleted > 0) {
        logger.debug('Compacted incremental updates after snapshot', {
          boardId,
          deletedRows: deleted
        });
      }
    } catch (error) {
      logger.error('Forced snapshot failed', {
        boardId,
        error: (error as Error).message
      });
    }
  }

  async cleanupExpired(): Promise<{ removed: number }> {
    const db = getDb();
    const threshold = db.raw(`now() - interval '3 months'`);

    const expiredBoards = await db<BoardRow>('boards')
      .where('valid_until', '<', threshold)
      .select('id');

    if (!expiredBoards.length) return { removed: 0 };

    const ids = expiredBoards.map((row) => row.id);
    await db.transaction(async (trx) => {
      await trx('board_yjs_updates').whereIn('board_id', ids).del();
      await trx('board_yjs_state').whereIn('board_id', ids).del();
    });

    logger.info('Cleaned expired board Yjs state', {
      boards: ids.length,
      correlationId: randomUUID()
    });

    return { removed: ids.length };
  }

  startCleanupJob(intervalMs = CLEANUP_INTERVAL_MS) {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch((error) =>
        logger.error('Cleanup job failed', { error: (error as Error).message })
      );
    }, intervalMs);
  }
}
