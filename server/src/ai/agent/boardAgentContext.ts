import { BoardSnapshot, BoardObject } from '../../models/boardSnapshot';

export type AgentBoardObjectKind =
    | 'shape'
    | 'note'
    | 'latex'
    | 'handwriting'
    | 'functionPlot'
    | 'image'
    | 'arrow'
    | 'other';

export interface AgentBoardObject {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    latex?: string;
    kind: AgentBoardObjectKind;
}

export interface AgentBoardContext {
    objects: AgentBoardObject[];
    viewport?: { x: number; y: number; width: number; height: number } | undefined;
    totalObjectCount: number;
}

/**
 * Buduje „odchudzony” kontekst tablicy dla agenta:
 * - filtr po viewport
 * - max N obiektów
 * - tylko ID, typ, koordy, tekst (ucięty)
 */
export function buildAgentBoardContext(
    snapshot: BoardSnapshot,
    viewport?: { x: number; y: number; width: number; height: number },
    maxObjects = 64,
): AgentBoardContext {
    const objects: BoardObject[] = snapshot.objects ?? [];

    const intersectsViewport = (obj: BoardObject): boolean => {
        if (!viewport) return true;

        const x = (obj as any).x ?? (obj as any).position?.x ?? 0;
        const y = (obj as any).y ?? (obj as any).position?.y ?? 0;
        const w =
            (obj as any).width ??
            ((obj as any).start && (obj as any).end
                ? Math.abs((obj as any).end.x - (obj as any).start.x)
                : 0);
        const h =
            (obj as any).height ??
            ((obj as any).start && (obj as any).end
                ? Math.abs((obj as any).end.y - (obj as any).start.y)
                : 0);

        const vx1 = viewport.x;
        const vy1 = viewport.y;
        const vx2 = viewport.x + viewport.width;
        const vy2 = viewport.y + viewport.height;

        const ox1 = x;
        const oy1 = y;
        const ox2 = x + w;
        const oy2 = y + h;

        return !(ox2 < vx1 || ox1 > vx2 || oy2 < vy1 || oy1 > vy2);
    };

    // Filter out internal objects (e.g. selection handles)
    const isVisibleToAgent = (obj: BoardObject): boolean => {
        if (obj.type === 'selection' || obj.type === 'handle' || obj.type === 'cursor') return false;
        return true;
    };

    const filtered = (viewport ? objects.filter(intersectsViewport) : [...objects])
        .filter(isVisibleToAgent);

    // Sortowanie po zIndex/timestamp, żeby agent widział „górę” stosu
    filtered.sort(
        (a: any, b: any) =>
            (a.zIndex ?? a.timestamp ?? 0) - (b.zIndex ?? b.timestamp ?? 0),
    );

    const trimmed = filtered.slice(0, maxObjects);

    const agentObjects: AgentBoardObject[] = trimmed.map((o: any) => {
        const x = o.x ?? o.position?.x ?? (o.start ? Math.min(o.start.x, o.end?.x ?? o.start.x) : 0);
        const y = o.y ?? o.position?.y ?? (o.start ? Math.min(o.start.y, o.end?.y ?? o.start.y) : 0);

        const width =
            o.width ??
            (o.start && o.end ? Math.abs(o.end.x - o.start.x) : 0);
        const height =
            o.height ??
            (o.start && o.end ? Math.abs(o.end.y - o.start.y) : 0);

        const base: AgentBoardObject = {
            id: o.id,
            type: o.type,
            x,
            y,
            width,
            height,
            kind: inferKind(o),
        };

        if (o.text) {
            base.text = String(o.text).slice(0, 120); // Reduced limit
        }
        if (o.latex) {
            base.latex = String(o.latex).slice(0, 120); // Reduced limit
        }

        return base;
    });

    return {
        objects: agentObjects,
        viewport,
        totalObjectCount: objects.length,
    };
}

function inferKind(o: any): AgentBoardObjectKind {
    switch (o.type) {
        case 'latex':
            return 'latex';
        case 'note':
        case 'text':
            return 'note';
        case 'path':
        case 'pen':
            return 'handwriting';
        case 'functionPlot':
        case 'mathFunctionPlot':
            return 'functionPlot';
        case 'image':
            return 'image';
        case 'line':
            // If it has arrowStyle, it's likely an arrow/vector
            if (o.arrowStyle && o.arrowStyle !== 'none') return 'arrow';
            return 'shape';
        default:
            return 'shape';
    }
}
