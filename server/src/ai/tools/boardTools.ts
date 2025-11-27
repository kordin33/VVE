import { BoardDoc } from '../../yjs/boardDoc';
import { BoardPatch, BoardSnapshot, BoardObject, BoardArrowStyle } from '../../models/boardSnapshot';
import { nanoid, snapToGrid, getCenter, getBBox, clamp } from './boardUtils';

type AlignSelectionArgs = {
    gridSize: number;
    selectionIds?: string[];
};

type GenerateDiagramArgs = {
    prompt: string;
    centerX?: number;
    centerY?: number;
    nodes?: BoardObject[]; // Optional, passed from agent if pre-generated
};

type SimplifyEquationArgs = {
    objectId: string;
};

type DrawBoardPatchArgs = { patch: BoardPatch };
type InsertLatexArgs = { latex: string; x?: number; y?: number; width?: number; height?: number };
type TextToLatexArgs = { objectId: string };
type PlotFunctionArgs = { expression: string; xMin?: number; xMax?: number; x?: number; y?: number };

type ConnectObjectsArgs = {
    fromId: string;
    toId: string;
    style?: {
        lineWidth?: number;
        lineStyle?: 'solid' | 'dashed' | 'dotted';
        arrowHead?: 'end' | 'both';
        color?: string;
        strokeMode?: 'clean' | 'handdrawn';
    };
};

type LabelObjectArgs = {
    objectId: string;
    text: string;
    mode?: 'plain' | 'latex';
    position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
};

type SetStyleArgs = {
    ids: string[];
    props: {
        lineWidth?: number;
        lineStyle?: 'solid' | 'dashed' | 'dotted';
        arrowStyle?: 'none' | 'start' | 'end' | 'both';
        strokeColor?: string;
        fillColor?: string;
        strokeMode?: 'clean' | 'handdrawn';
    };
};

type DeleteObjectsArgs = {
    ids: string[];
};

function getSelection(snapshot: BoardSnapshot, selectionIds?: string[]): BoardObject[] {
    if (selectionIds?.length) {
        const set = new Set(selectionIds);
        return snapshot.objects.filter(o => set.has(o.id));
    }
    return snapshot.objects.filter(o => o.selected);
}

// 1) Align to grid
export function toolAlignSelectionToGrid(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: AlignSelectionArgs,
): BoardPatch {
    const { gridSize } = args;
    const sel = getSelection(snapshot, args.selectionIds);
    const updates: NonNullable<BoardPatch['updates']> = [];

    for (const o of sel) {
        const props: Partial<BoardObject> = {
            x: snapToGrid(o.x, gridSize),
            y: snapToGrid(o.y, gridSize),
        };

        if (o.points && o.points.length) {
            props.points = o.points.map(p => ({
                x: snapToGrid(p.x, gridSize),
                y: snapToGrid(p.y, gridSize),
            }));
        }

        updates.push({ id: o.id, props });
    }

    const patch: BoardPatch = { updates };
    doc.applyPatch(patch);
    return patch;
}

// 2) Bardzo prosty generator diagramu – LLM zwraca JSON z węzłami.
export function toolGenerateDiagramFromPrompt(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: GenerateDiagramArgs,
    nodes: BoardObject[],
): BoardPatch {
    // Tu zakładamy, że "nodes" to wynik z LLM (parsowany po stronie agenta),
    // już w formacie BoardObject. Agent doda id, typ, x, y itd.
    const patch: BoardPatch = {
        creates: nodes,
    };
    doc.applyPatch(patch);
    return patch;
}

// 3) Uproszczenie równania – w praktyce wywołasz tu dodatkowe LLM albo libkę.
export function toolSimplifyEquationBlock(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: SimplifyEquationArgs,
    simplifiedLatex: string,
): BoardPatch {
    const target = snapshot.objects.find(o => o.id === args.objectId);
    if (!target) return { updates: [] };

    const patch: BoardPatch = {
        updates: [{ id: target.id, props: { text: simplifiedLatex } }],
    };
    doc.applyPatch(patch);
    return patch;
}

// 4) Draw Board Patch (Low-level)
export function toolDrawBoardPatch(
    doc: BoardDoc,
    _snapshot: BoardSnapshot,
    args: any,
): BoardPatch {
    const patch: BoardPatch = {
        creates: [],
        updates: [],
        deletes: [],
    };

    // Handle nested 'patch' object if present (legacy/schema variation)
    const source = args.patch || args;

    if (Array.isArray(source.creates)) {
        patch.creates = source.creates.map((raw: any) => ({
            ...raw,
        }));
    }

    if (Array.isArray(source.updates)) {
        patch.updates = source.updates.map((u: any) => ({
            id: u.id,
            props: u.props,
        }));
    }

    if (Array.isArray(source.deletes)) {
        patch.deletes = [...source.deletes];
    }

    // Basic validation
    const createsLen = patch.creates?.length ?? 0;
    const updatesLen = patch.updates?.length ?? 0;
    const deletesLen = patch.deletes?.length ?? 0;

    if (createsLen + updatesLen + deletesLen > 200) {
        throw new Error('Patch too large from AI');
    }

    if (createsLen === 0 && updatesLen === 0 && deletesLen === 0) {
        return { creates: [], updates: [], deletes: [] };
    }

    doc.applyPatch(patch);
    return patch;
}

// 5) Insert LaTeX Box
export function toolInsertLatexBox(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: InsertLatexArgs,
): BoardPatch {
    const baseX = args.x ?? snapshot.objects[0]?.x ?? 100;
    const baseY = args.y ?? snapshot.objects[0]?.y ?? 100;

    const latexObj: BoardObject = {
        id: `ai-latex-${nanoid()}`,
        type: 'latex',
        x: baseX,
        y: baseY,
        width: args.width ?? 260,
        height: args.height ?? 120,
        latex: args.latex,
    };

    const patch: BoardPatch = { creates: [latexObj] };
    doc.applyPatch(patch);
    return patch;
}

// 6) Text Block to LaTeX Update
export function toolTextBlockToLatexUpdate(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: TextToLatexArgs,
    latex: string,
): BoardPatch {
    const target = snapshot.objects.find(o => o.id === args.objectId);
    if (!target) return { updates: [] };

    const patch: BoardPatch = {
        updates: [
            {
                id: target.id,
                props: {
                    type: 'latex',
                    latex,
                    text: '', // Clear text as it's now latex
                },
            },
        ],
    };

    doc.applyPatch(patch);
    return patch;
}

// 7) Plot Function
export function toolPlotFunction(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: PlotFunctionArgs,
): BoardPatch {
    const baseX = args.x ?? snapshot.objects[0]?.x ?? 100;
    const baseY = args.y ?? snapshot.objects[0]?.y ?? 100;

    const plot: BoardObject = {
        id: `ai-fplot-${nanoid()}`,
        type: 'mathFunctionPlot',
        x: baseX,
        y: baseY,
        width: 400,
        height: 260,
        expression: args.expression,
        xRange: [args.xMin ?? -10, args.xMax ?? 10],
    };

    const patch: BoardPatch = { creates: [plot] };
    doc.applyPatch(patch);
    return patch;
}

// 8) Connect Objects
export function toolConnectObjects(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: ConnectObjectsArgs,
): BoardPatch {
    const from = snapshot.objects.find(o => o.id === args.fromId);
    const to = snapshot.objects.find(o => o.id === args.toId);

    if (!from || !to) {
        return { creates: [], updates: [] };
    }

    const a = getCenter(from);
    const b = getCenter(to);

    // Limit object creation if this tool were batch-called (here it's single, but just in case)

    // We can also try to clip to bounding box edge instead of center, but center is safer and simpler for now.
    // Ideally we would intersect line(a,b) with bbox(from) and bbox(to).
    // For now, center is fine as lines usually have lower z-index or are handled by renderer.

    const arrow: BoardObject = {
        id: `ai-arrow-${nanoid()}`,
        type: 'line',
        // In this model, line objects might use start/end points or just x/y + points
        // Assuming current renderer supports start/end for lines
        start: a,
        end: b,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),

        strokeColor: args.style?.color ?? '#000000',
        lineWidth: args.style?.lineWidth ?? 2,
        lineStyle: args.style?.lineStyle ?? 'solid',
        arrowStyle: (args.style?.arrowHead ?? 'end') as BoardArrowStyle,
        strokeMode: args.style?.strokeMode ?? 'clean',
    };

    // Snap to grid for cleaner layout? Maybe not for connections, they should follow objects.
    // However, the function `snapObjectToGrid` from user prompt suggests snapping everything.
    // Let's NOT snap connection lines rigidly as they must touch the objects, which might not be on grid.

    const patch: BoardPatch = { creates: [arrow] };
    doc.applyPatch(patch);
    return patch;
}

// 9) Label Object
export function toolLabelObject(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: LabelObjectArgs,
): BoardPatch {
    const target = snapshot.objects.find(o => o.id === args.objectId);
    if (!target) return { creates: [], updates: [] };

    const mode = args.mode ?? 'plain';
    const pos = args.position ?? 'top';

    const box = getBBox(target);
    const padding = 12;

    let x = box.x;
    let y = box.y;

    // Calculate position relative to bbox
    switch (pos) {
        case 'top':
            x = box.x + box.width / 2;
            y = box.y - padding;
            break;
        case 'bottom':
            x = box.x + box.width / 2;
            y = box.y + box.height + padding;
            break;
        case 'left':
            x = box.x - padding;
            y = box.y + box.height / 2;
            break;
        case 'right':
            x = box.x + box.width + padding;
            y = box.y + box.height / 2;
            break;
        case 'center':
            x = box.x + box.width / 2;
            y = box.y + box.height / 2;
            break;
    }

    // Adjust x/y because text usually anchors top-left or needs measuring.
    // Since we don't know text width here, we might rely on the frontend to center it
    // or we set textAlign: 'center' if supported.
    // Assuming simple placement for now.

    const label: BoardObject = {
        id: `ai-label-${nanoid()}`,
        type: mode === 'latex' ? 'latex' : 'text',
        x: snapToGrid(x),
        y: snapToGrid(y),
        width: 0, // Text auto-sizes usually
        height: 0,
        text: mode === 'plain' ? args.text : undefined,
        latex: mode === 'latex' ? args.text : undefined,
        color: '#000000',
        labelFor: target.id,
        // Optional: add alignment props if supported by renderer
        align: 'center',
        baseline: 'middle',
    };

    const patch: BoardPatch = { creates: [label] };
    doc.applyPatch(patch);
    return patch;
}

// 10) Set Style
export function toolSetStyle(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: SetStyleArgs,
): BoardPatch {
    const allowedProps = ['lineWidth', 'lineStyle', 'arrowStyle', 'strokeColor', 'fillColor', 'strokeMode'];
    const safeProps: Partial<BoardObject> = {};

    for (const key of allowedProps) {
        if (key in args.props) {
            safeProps[key] = (args.props as any)[key];
        }
    }

    if (Object.keys(safeProps).length === 0) return { updates: [] };

    const updates = args.ids.map(id => ({
        id,
        props: safeProps,
    }));

    const patch: BoardPatch = { updates };
    doc.applyPatch(patch);
    return patch;
}

// 11) Delete Objects
export function toolDeleteObjects(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: DeleteObjectsArgs,
): BoardPatch {
    const patch: BoardPatch = {
        deletes: args.ids,
    };
    doc.applyPatch(patch);
    return patch;
}
