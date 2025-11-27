import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { BoardDoc } from '../src/yjs/boardDoc';
import { BoardPatch } from '../src/models/boardSnapshot';

describe('BoardDoc', () => {
    let doc: Y.Doc;
    let boardDoc: BoardDoc;

    beforeEach(() => {
        doc = new Y.Doc();
        boardDoc = new BoardDoc(doc);
    });

    it('should create objects', () => {
        const patch: BoardPatch = {
            creates: [
                { id: '1', type: 'rectangle', x: 10, y: 20 },
                { id: '2', type: 'circle', x: 30, y: 40 }
            ]
        };

        boardDoc.applyPatch(patch);
        const snapshot = boardDoc.getSnapshot();

        expect(snapshot.objects).toHaveLength(2);
        expect(snapshot.objects.find(o => o.id === '1')).toMatchObject({ x: 10, y: 20, type: 'rectangle' });
        expect(snapshot.objects.find(o => o.id === '2')).toMatchObject({ x: 30, y: 40, type: 'circle' });
    });

    it('should update objects', () => {
        // Setup initial state
        boardDoc.applyPatch({
            creates: [{ id: '1', type: 'rectangle', x: 10, y: 20 }]
        });

        // Update
        const patch: BoardPatch = {
            updates: [
                { id: '1', props: { x: 50, width: 100 } }
            ]
        };

        boardDoc.applyPatch(patch);
        const snapshot = boardDoc.getSnapshot();

        expect(snapshot.objects.find(o => o.id === '1')).toMatchObject({
            id: '1',
            type: 'rectangle',
            x: 50,
            y: 20, // Should preserve existing properties
            width: 100
        });
    });

    it('should update partial styles', () => {
        boardDoc.applyPatch({
            creates: [{ id: '1', type: 'line', x: 0, y: 0 }]
        });

        boardDoc.applyPatch({
            updates: [{
                id: '1',
                props: {
                    lineWidth: 5,
                    strokeMode: 'handdrawn',
                    arrowStyle: 'end'
                }
            }]
        });

        const obj = boardDoc.getSnapshot().objects[0];
        expect(obj.lineWidth).toBe(5);
        expect(obj.strokeMode).toBe('handdrawn');
        expect(obj.arrowStyle).toBe('end');
    });

    it('should delete objects by ID', () => {
        // Setup
        boardDoc.applyPatch({
            creates: [
                { id: '1', type: 'rect', x: 0, y: 0 },
                { id: '2', type: 'rect', x: 10, y: 10 },
                { id: '3', type: 'rect', x: 20, y: 20 }
            ]
        });

        expect(boardDoc.getSnapshot().objects).toHaveLength(3);

        // Delete
        boardDoc.applyPatch({
            deletes: ['2']
        });

        const snapshot = boardDoc.getSnapshot();
        expect(snapshot.objects).toHaveLength(2);
        expect(snapshot.objects.find(o => o.id === '2')).toBeUndefined();
        expect(snapshot.objects.find(o => o.id === '1')).toBeDefined();
        expect(snapshot.objects.find(o => o.id === '3')).toBeDefined();
    });

    it('should handle mixed operations (create, update, delete)', () => {
        boardDoc.applyPatch({
            creates: [{ id: '1', type: 'rect', x: 0, y: 0 }]
        });

        boardDoc.applyPatch({
            creates: [{ id: '2', type: 'rect', x: 10, y: 10 }],
            updates: [{ id: '1', props: { x: 5 } }],
            deletes: ['1'] // '1' is updated then deleted? Or order matters?
                           // Current impl does deletes first, then updates, then creates?
                           // Let's check implementation order in boardDoc.ts: Deletes, then Updates, then Creates.
        });

        const snapshot = boardDoc.getSnapshot();
        // 1 was deleted (so update might fail or be ignored if delete happens first)
        // 2 was created

        // Wait, current impl order:
        // 1. Deletes
        // 2. Updates
        // 3. Creates

        // If I delete '1', then update '1', the update logic tries to find '1'.
        // Since it's deleted from the array, it won't find it. So safe.

        expect(snapshot.objects).toHaveLength(1);
        expect(snapshot.objects[0].id).toBe('2');
    });
});
