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

            // Common properties
            const props = ['width', 'height', 'rotation', 'text', 'latex', 'expression', 'xRange', 'selected',
                // New style properties
                'lineWidth', 'lineStyle', 'arrowStyle', 'strokeColor', 'fillColor', 'strokeMode', 'labelFor'
            ];

            for (const p of props) {
                if (m.has(p)) {
                    obj[p] = m.get(p);
                }
            }

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

        this.doc.transact(() => {
            const updatesCount = patch.updates?.length ?? 0;
            const createsCount = patch.creates?.length ?? 0;
            const deletesCount = patch.deletes?.length ?? 0;

            if (updatesCount > 0 || createsCount > 0 || deletesCount > 0) {
                 console.log(`[BoardDoc] Applying patch. Updates: ${updatesCount}, Creates: ${createsCount}, Deletes: ${deletesCount}`);
            }

            // Deletes
            // Note: We need to find indexes in the Y.Array to delete them.
            // Since deleting invalidates indexes, we should probably map IDs to indexes first,
            // but Y.Array doesn't support random access deletion by ID easily without scanning.
            // A common pattern is to iterate backwards or rebuild.
            // Here we just scan for each delete since the list shouldn't be massive for this use case.
            // Optimization: Map ID -> Index first? But indexes shift.
            // Better: Iterate array once and collect indexes to delete (sorted desc).
            if (patch.deletes && patch.deletes.length > 0) {
                const deleteIds = new Set(patch.deletes);
                // We iterate backwards to safely delete indexes
                let i = arr.length - 1;
                while (i >= 0) {
                    const m = arr.get(i);
                    const id = String(m.get('id'));
                    if (deleteIds.has(id)) {
                        arr.delete(i, 1);
                    }
                    i--;
                }
            }

            // Updates
            if (patch.updates && patch.updates.length > 0) {
                 // Re-scan map for updates since deletes might have shifted things?
                 // Actually accessing by index is how Y.Array works, but we need to find the object by ID.
                 // Ideally we'd have a persistent map, but we don't.
                 // Let's build a temporary lookup.
                 const maps = arr.toArray() as Y.Map<unknown>[];
                 const idToMap = new Map<string, Y.Map<unknown>>();
                 for (const m of maps) {
                     idToMap.set(String(m.get('id')), m);
                 }

                 for (const upd of patch.updates) {
                    const target = idToMap.get(upd.id);
                    if (!target) continue;

                    for (const [key, value] of Object.entries(upd.props)) {
                        if (value === undefined) continue; // Don't overwrite with undefined
                        target.set(key, value as unknown);
                    }
                }
            }

            // Creates
            for (const obj of patch.creates ?? []) {
                const m = new Y.Map<unknown>();
                for (const [key, value] of Object.entries(obj)) {
                    if (value !== undefined) {
                        m.set(key, value as unknown);
                    }
                }
                arr.push([m]);
            }
        });
    }
}
