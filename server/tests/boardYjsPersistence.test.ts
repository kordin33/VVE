import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDb } = vi.hoisted(() => ({
  mockGetDb: vi.fn()
}));

vi.mock('../src/db', () => ({
  getDb: mockGetDb
}));

import { BoardYjsPersistence } from '../src/services/boardYjsPersistence';

describe('BoardYjsPersistence', () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it('treats non-UUID ids as peer rooms without querying the boards table', async () => {
    const persistence = new BoardYjsPersistence();

    await expect(persistence.isBoardRoom('lW0H4UO8I1EDbZWoysSS6h')).resolves.toBe(false);

    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it('checks the boards table for UUID ids', async () => {
    const boardId = '7f1d4f4a-f226-4a94-93a0-8ed66f2bb4d4';
    const first = vi.fn().mockResolvedValue({ id: boardId });
    const where = vi.fn().mockReturnValue({ first });
    const db = vi.fn().mockReturnValue({ where });
    mockGetDb.mockReturnValue(db);
    const persistence = new BoardYjsPersistence();

    await expect(persistence.isBoardRoom(boardId)).resolves.toBe(true);

    expect(mockGetDb).toHaveBeenCalledOnce();
    expect(db).toHaveBeenCalledWith('boards');
    expect(where).toHaveBeenCalledWith({ id: boardId });
    expect(first).toHaveBeenCalledWith('id');
  });
});
