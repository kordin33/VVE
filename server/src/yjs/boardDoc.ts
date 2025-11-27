import * as Y from 'yjs';
import { BoardSnapshot, BoardObject, BoardPatch } from '../models/boardSnapshot';

const DEFAULT_ARRAY_NAME = 'drawings'; // Matches the frontend 'drawings' array

export class BoardDoc {
    constructor(
        private readonly doc: Y.Doc,
        private readonly arrayName: string = DEFAULT_ARRAY_NAME,
    ) { }

    getSnapshot(): BoardSnapshot {
        // In the frontend, it's yDrawings which is a Y.Array of Y.Map
        // We assume the same structure here.
        const arr = this.doc.getArray<Y.Map<unknown>>(this.arrayName);
        const maps = arr.toArray();

        const objects: BoardObject[] = maps.map((m) => {
            const obj: any = {
                id: String(m.get('id')),
                type: String(m.get('type')),
                x: Number(m.get('x') ?? 0),
                y: Number(m.get('y') ?? 0),
            };

            if (m.has('width')) obj.width = Number(m.get('width'));
            if (m.has('height')) obj.height = Number(m.get('height'));
            if (m.has('rotation')) obj.rotation = Number(m.get('rotation'));
            if (m.has('text')) obj.text = String(m.get('text'));
            if (m.has('latex')) obj.latex = String(m.get('latex'));
            if (m.has('expression')) obj.expression = String(m.get('expression'));
            if (m.has('xRange')) obj.xRange = m.get('xRange') as number[];
            if (m.has('selected')) obj.selected = Boolean(m.get('selected'));

            if (m.has('points')) {
                const points = m.get('points') as any[];
                if (Array.isArray(points)) {
                    obj.points = points.map((p: any) => ({
                        x: Number(p.x),
                        y: Number(p.y),
                    }));
                }
            }

            // Copy other properties loosely if needed, but for now strict mapping is safer
            return obj as BoardObject;
        });

        return { objects };
    }

    applyPatch(patch: BoardPatch): void {
        const arr = this.doc.getArray<Y.Map<unknown>>(this.arrayName);
        const maps = arr.toArray() as Y.Map<unknown>[];

        const idToMap = new Map<string, { map: Y.Map<unknown>; index: number }>();
        for (const [index, m] of maps.entries()) {
            const id = String(m.get('id'));
            idToMap.set(id, { map: m, index });
        }

        this.doc.transact(() => {
            console.log(`[BoardDoc] Applying patch. Updates: ${patch.updates?.length ?? 0}, Creates: ${patch.creates?.length ?? 0}, Deletes: ${patch.deletes?.length ?? 0}`);

            const deleteIndices: number[] = [];
            for (const id of patch.deletes ?? []) {
                const entry = idToMap.get(id);
                if (!entry) continue;
                deleteIndices.push(entry.index);
                idToMap.delete(id);
            }

            deleteIndices
                .sort((a, b) => b - a)
                .forEach((idx) => arr.delete(idx, 1));

            // updates
            for (const upd of patch.updates ?? []) {
                const target = idToMap.get(upd.id)?.map;
                if (!target) continue;
                for (const [key, value] of Object.entries(upd.props)) {
                    if (value === undefined) continue;
                    target.set(key, value as unknown);
                }
            }

            // creates
            for (const obj of patch.creates ?? []) {
                const m = new Y.Map<unknown>();
                for (const [key, value] of Object.entries(obj)) {
                    m.set(key, value as unknown);
                }
                arr.push([m]);
                console.log(`[BoardDoc] Created object: ${obj.id} (${obj.type})`);
            }
        });
    }
}
