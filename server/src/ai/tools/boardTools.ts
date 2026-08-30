// server/src/ai/tools/boardTools.ts

import { BoardDoc } from '../../yjs/boardDoc';
import {
    BoardPatch,
    BoardSnapshot,
    BoardObject,
} from '../../models/boardSnapshot';
import { applyLayoutFixes, LayoutElement } from '../agent/layoutEngine';
import { logger } from '../../logger';

// ---------- Typy argumentów narzędzi ----------

type AlignSelectionArgs = {
    gridSize: number;
    selectionIds?: string[];
};

type GenerateDiagramArgs = {
    prompt: string;
    centerX?: number;
    centerY?: number;
    nodes?: BoardObject[];
};

type SimplifyEquationArgs = {
    objectId: string;
};

type DrawBoardPatchArgs = { patch: BoardPatch | any };

type InsertLatexArgs = {
    latex: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
};

type TextToLatexArgs = { objectId: string };

type PlotFunctionArgs = {
    expression: string;
    xMin?: number;
    xMax?: number;
    x?: number;
    y?: number;
};

// High–level tools
type ConnectObjectsArgs = {
    fromId: string;
    toId: string;
    style?: {
        lineWidth?: number;
        lineStyle?: 'solid' | 'dashed' | 'dotted';
        arrowHead?: 'end' | 'both';
        color?: string;
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
    props: Partial<BoardObject>;
};

type DeleteObjectsArgs = { ids: string[] };

type DrawHandstrokeArgs = {
    points: { x: number; y: number }[];
    style?: 'teacher_marker' | 'student_pen' | 'sketch';
    color?: string;
};

// ---------- Helpery geometryczne / ID / snapping ----------

const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

function getSelection(
    snapshot: BoardSnapshot,
    selectionIds?: string[],
): BoardObject[] {
    if (selectionIds?.length) {
        const set = new Set(selectionIds);
        return snapshot.objects.filter((o) => set.has(o.id));
    }
    return snapshot.objects.filter((o) => o.selected);
}

const GRID = 8;

function snapObjectToGrid<
    T extends { x?: number; y?: number; width?: number; height?: number },
>(obj: T): T {
    return {
        ...obj,
        x: obj.x !== undefined ? snap(obj.x, GRID) : obj.x,
        y: obj.y !== undefined ? snap(obj.y, GRID) : obj.y,
        width: obj.width !== undefined ? snap(obj.width, GRID) : obj.width,
        height: obj.height !== undefined ? snap(obj.height, GRID) : obj.height,
    };
}

function getBBox(o: BoardObject) {
    const x = o.x ?? o.start?.x ?? 0;
    const y = o.y ?? o.start?.y ?? 0;
    const w = o.width ?? (o.end ? Math.abs(o.end.x - x) : 0);
    const h = o.height ?? (o.end ? Math.abs(o.end.y - y) : 0);
    return { x, y, width: w, height: h };
}

function getCenter(o: BoardObject) {
    const { x, y, width, height } = getBBox(o);
    return { x: x + width / 2, y: y + height / 2 };
}

function newId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Delikatny jitter do „odręcznego” looku
function jitter(val: number, amount: number) {
    return val + (Math.random() * 2 - 1) * amount;
}

// Prosta interpolacja Catmull–Rom dla wygładzenia stroke’a
function interpolateStroke(
    points: { x: number; y: number }[],
    step = 0.2,
) {
    if (points.length <= 2) return points;

    const res: { x: number; y: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? i : i - 1]!;
        const p1 = points[i]!;
        const p2 = points[i + 1]!;
        const p3 = points[i + 2 < points.length ? i + 2 : i + 1]!;

        for (let t = 0; t < 1; t += step) {
            const t2 = t * t;
            const t3 = t2 * t;

            const x =
                0.5 *
                ((2 * p1.x) +
                    (-p0.x + p2.x) * t +
                    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

            const y =
                0.5 *
                ((2 * p1.y) +
                    (-p0.y + p2.y) * t +
                    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

            res.push({ x, y });
        }
    }

    const lastPoint = points[points.length - 1];
    if (lastPoint) res.push(lastPoint);
    return res;
}

// ---------- 1) Align to Grid ----------

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
            x: snap(o.x, gridSize),
            y: snap(o.y, gridSize),
        };

        if (o.points && o.points.length) {
            props.points = o.points.map((p) => ({
                x: snap(p.x, gridSize),
                y: snap(p.y, gridSize),
            }));
        }

        updates.push({ id: o.id, props });
    }

    const patch: BoardPatch = { updates };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 2) (opcjonalny) generate_diagram_from_prompt ----------
// Zostawiam jako prosty wrapper na „creates”, jeśli jeszcze gdzieś go używasz.
export function toolGenerateDiagramFromPrompt(
    doc: BoardDoc,
    _snapshot: BoardSnapshot,
    _args: GenerateDiagramArgs,
    nodes: BoardObject[],
): BoardPatch {
    const patch: BoardPatch = { creates: nodes };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 3) Simplify Equation Block ----------

export function toolSimplifyEquationBlock(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: SimplifyEquationArgs,
    simplifiedLatex: string,
): BoardPatch {
    const target = snapshot.objects.find((o) => o.id === args.objectId);
    if (!target) return { updates: [] };

    const patch: BoardPatch = {
        updates: [{ id: target.id, props: { text: simplifiedLatex } }],
    };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 4) Niskopoziomowy draw_board_patch (z enforced grid snapping) ----------

export function toolDrawBoardPatch(
    doc: BoardDoc,
    _snapshot: BoardSnapshot,
    args: DrawBoardPatchArgs,
): BoardPatch {
    const patch: BoardPatch = {
        creates: [],
        updates: [],
        deletes: [],
    };

    const source = (args as DrawBoardPatchArgs).patch || args;

    if (Array.isArray(source.creates)) {
        logger.debug('[AI] Creating objects', { count: source.creates.length });
        patch.creates = source.creates.map((raw: any) => {
            const id = raw.id || newId('ai');
            const type = raw.type;

            // Enforce grid snapping on all coordinates
            const x = snap(raw.x ?? 0, GRID);
            const y = snap(raw.y ?? 0, GRID);
            const width = snap(raw.width ?? 0, GRID);
            const height = snap(raw.height ?? 0, GRID);

            const obj: any = {
                ...raw,
                id,
                type,
                x,
                y,
                width,
                height,
            };

            // CRITICAL FIX: Frontend canvasDrawing.js requires start/end for ALL shapes
            // Types that need start/end: line, rectangle, square, circle, triangle, trapezoid, 
            // parallelogram, deltoid, diamond, cuboid, tetrahedron, cube, sphere, cylinder, pyramid, cone
            const shapesNeedingStartEnd = [
                'line', 'rectangle', 'square', 'circle', 'triangle',
                'trapezoid', 'parallelogram', 'deltoid', 'diamond',
                'cuboid', 'tetrahedron', 'cube', 'sphere', 'cylinder', 'pyramid', 'cone'
            ];

            if (shapesNeedingStartEnd.includes(type)) {
                // Compute start/end from x/y/width/height
                const sx = raw.start?.x ?? x;
                const sy = raw.start?.y ?? y;
                const ex = raw.end?.x ?? (x + (width || 100));
                const ey = raw.end?.y ?? (y + (height || 100));
                obj.start = { x: snap(sx, GRID), y: snap(sy, GRID) };
                obj.end = { x: snap(ex, GRID), y: snap(ey, GRID) };

                // Also ensure width/height are set if they were missing
                if (!obj.width || obj.width === 0) {
                    obj.width = Math.abs(obj.end.x - obj.start.x) || 100;
                }
                if (!obj.height || obj.height === 0) {
                    obj.height = Math.abs(obj.end.y - obj.start.y) || 100;
                }
            }

            // Ensure color always exists
            if (!obj.color && !obj.strokeColor) {
                obj.color = '#000000';
            }

            // Ensure lineWidth for visibility
            if (!obj.lineWidth) {
                obj.lineWidth = 2;
            }

            // If fillColor is provided, use clean rendering (roughness=0) for solid fill
            if (obj.fillColor) {
                obj.roughness = 0;
            }

            return obj as BoardObject;
        });
    }

    if (Array.isArray(source.updates)) {
        patch.updates = source.updates.map((u: any) => {
            const props: any = { ...u.props };

            // Snap coordinate updates to grid
            if ('x' in props) props.x = snap(props.x, GRID);
            if ('y' in props) props.y = snap(props.y, GRID);
            if ('width' in props) props.width = snap(props.width, GRID);
            if ('height' in props) props.height = snap(props.height, GRID);

            // Snap line start/end
            if (props.start) {
                props.start = {
                    x: snap(props.start.x, GRID),
                    y: snap(props.start.y, GRID),
                };
            }
            if (props.end) {
                props.end = {
                    x: snap(props.end.x, GRID),
                    y: snap(props.end.y, GRID),
                };
            }

            return { id: u.id, props };
        });
    }

    if (Array.isArray(source.deletes)) {
        patch.deletes = [...source.deletes];
    }

    const createsLen = patch.creates?.length ?? 0;
    const updatesLen = patch.updates?.length ?? 0;
    const deletesLen = patch.deletes?.length ?? 0;

    if (createsLen + updatesLen + deletesLen > 200) {
        throw new Error('Patch too large from AI');
    }

    if (createsLen === 0 && updatesLen === 0 && deletesLen === 0) {
        return { creates: [], updates: [], deletes: [] };
    }

    // ========== LAYOUT ENGINE INTEGRATION ==========
    // Use the professional Layout Engine to fix coordinates and normalize elements
    if (patch.creates && patch.creates.length > 0) {
        logger.debug('[LAYOUT ENGINE] Processing elements', { count: patch.creates.length });
        patch.creates = applyLayoutFixes(patch.creates as LayoutElement[]) as BoardObject[];
        logger.debug('[LAYOUT ENGINE] Applied layout fixes');
    }
    // ========== END LAYOUT ENGINE ==========

    doc.applyPatch(patch);
    return patch;
}

// ---------- 5) Insert LaTeX Box ----------

export function toolInsertLatexBox(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: InsertLatexArgs,
): BoardPatch {
    const baseX = args.x ?? snapshot.objects[0]?.x ?? 100;
    const baseY = args.y ?? snapshot.objects[0]?.y ?? 100;

    const latexObj: BoardObject = {
        id: newId('ai-latex'),
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

// ---------- 6) Text Block -> LaTeX ----------

export function toolTextBlockToLatexUpdate(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: TextToLatexArgs,
    latex: string,
): BoardPatch {
    const target = snapshot.objects.find((o) => o.id === args.objectId);
    if (!target) return { updates: [] };

    const patch: BoardPatch = {
        updates: [
            {
                id: target.id,
                props: {
                    type: 'latex',
                    latex,
                    text: '',
                },
            },
        ],
    };

    doc.applyPatch(patch);
    return patch;
}

// ---------- 7) Plot Function ----------

export function toolPlotFunction(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: PlotFunctionArgs,
): BoardPatch {
    const baseX = args.x ?? snapshot.objects[0]?.x ?? 100;
    const baseY = args.y ?? snapshot.objects[0]?.y ?? 100;

    const plot: BoardObject = {
        id: newId('ai-fplot'),
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

// ---------- 8) Connect Objects (strzałki / wektory) ----------

export function toolConnectObjects(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: ConnectObjectsArgs,
): BoardPatch {
    const from = snapshot.objects.find((o) => o.id === args.fromId);
    const to = snapshot.objects.find((o) => o.id === args.toId);
    if (!from || !to) {
        return { creates: [], updates: [] };
    }

    const a = getCenter(from);
    const b = getCenter(to);

    const arrow: BoardObject = {
        id: newId('ai-arrow'),
        type: 'line',
        start: a,
        end: b,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
        color: args.style?.color ?? '#000000',
        lineWidth: args.style?.lineWidth ?? 2,
        lineStyle: args.style?.lineStyle ?? 'solid',
        arrowStyle: args.style?.arrowHead ?? 'end',
    };

    const patch: BoardPatch = { creates: [snapObjectToGrid(arrow)] };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 9) Label Object ----------

export function toolLabelObject(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: LabelObjectArgs,
): BoardPatch {
    const target = snapshot.objects.find((o) => o.id === args.objectId);
    if (!target) return { creates: [], updates: [] };

    const mode = args.mode ?? 'plain';
    const pos = args.position ?? 'top';

    const box = getBBox(target);
    const padding = 12;

    let x = box.x;
    let y = box.y;

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

    const base: BoardObject = {
        id: newId('ai-label'),
        type: mode === 'latex' ? 'latex' : 'text',
        x,
        y,
        width: 0,
        height: 0,
        ...(mode === 'plain'
            ? { text: args.text }
            : { latex: args.text }),
        color: '#000000',
    };

    const patch: BoardPatch = { creates: [snapObjectToGrid(base)] };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 10) Set Style ----------

export function toolSetStyle(
    doc: BoardDoc,
    _snapshot: BoardSnapshot,
    args: SetStyleArgs,
): BoardPatch {
    const updates = args.ids.map((id) => ({
        id,
        props: args.props,
    }));
    const patch: BoardPatch = { updates };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 11) Delete Objects ----------

export function toolDeleteObjects(
    doc: BoardDoc,
    _snapshot: BoardSnapshot,
    args: DeleteObjectsArgs,
): BoardPatch {
    const patch: BoardPatch = {
        deletes: args.ids,
    };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 12) Draw Handstroke (naturalny odręczny stroke) ----------

export function toolDrawHandstroke(
    doc: BoardDoc,
    _snapshot: BoardSnapshot,
    args: DrawHandstrokeArgs,
): BoardPatch {
    if (!args.points || args.points.length < 2) {
        return { creates: [], updates: [] };
    }

    const base = args.points.map((p) => ({
        x: jitter(p.x, 0.5),
        y: jitter(p.y, 0.5),
        t:
            typeof performance !== 'undefined'
                ? performance.now()
                : Date.now(),
    }));

    const dense = interpolateStroke(base, 0.25);

    const style = args.style ?? 'teacher_marker';
    const configByStyle = {
        teacher_marker: { smoothing: 0.5, baseWidth: 3 },
        student_pen: { smoothing: 0.65, baseWidth: 2 },
        sketch: { smoothing: 0.35, baseWidth: 1.5 },
    } as const;

    const cfg = configByStyle[style];

    const xs = dense.map((p) => p.x);
    const ys = dense.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    const element: BoardObject = {
        id: newId('ai-pen'),
        type: 'pen',
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        points: dense,
        rawPoints: base,
        smoothedPoints: [],
        color: args.color ?? '#000000',
        lineWidth: cfg.baseWidth,
        penStyle: style,
        penConfig: {
            smoothing: cfg.smoothing,
        },
        timestamp: Date.now(),
    };

    const patch: BoardPatch = { creates: [element] };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 13) Distribute Horizontally ----------

type DistributeArgs = { ids: string[] };

export function toolDistributeHorizontally(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: DistributeArgs,
): BoardPatch {
    if (!args.ids || args.ids.length < 3) {
        return { updates: [] };
    }

    const objects = snapshot.objects.filter(o => args.ids.includes(o.id));
    if (objects.length < 3) return { updates: [] };

    // Sort by x position
    objects.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));

    const first = objects[0]!;
    const last = objects[objects.length - 1]!;
    const firstX = first.x ?? 0;
    const lastX = last.x ?? 0;
    const totalWidth = (lastX + (last.width ?? 0)) - firstX;
    const gap = totalWidth / (objects.length - 1);

    const updates = objects.slice(1, -1).map((obj, i) => ({
        id: obj.id,
        props: { x: snap(firstX + gap * (i + 1), GRID) },
    }));

    const patch: BoardPatch = { updates };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 14) Distribute Vertically ----------

export function toolDistributeVertically(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: DistributeArgs,
): BoardPatch {
    if (!args.ids || args.ids.length < 3) {
        return { updates: [] };
    }

    const objects = snapshot.objects.filter(o => args.ids.includes(o.id));
    if (objects.length < 3) return { updates: [] };

    // Sort by y position
    objects.sort((a, b) => (a.y ?? 0) - (b.y ?? 0));

    const first = objects[0]!;
    const last = objects[objects.length - 1]!;
    const firstY = first.y ?? 0;
    const lastY = last.y ?? 0;
    const totalHeight = (lastY + (last.height ?? 0)) - firstY;
    const gap = totalHeight / (objects.length - 1);

    const updates = objects.slice(1, -1).map((obj, i) => ({
        id: obj.id,
        props: { y: snap(firstY + gap * (i + 1), GRID) },
    }));

    const patch: BoardPatch = { updates };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 15) Clone Object ----------

type CloneObjectArgs = {
    id: string;
    offsetX?: number;
    offsetY?: number;
};

export function toolCloneObject(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: CloneObjectArgs,
): BoardPatch {
    const source = snapshot.objects.find(o => o.id === args.id);
    if (!source) return { creates: [] };

    const offsetX = snap(args.offsetX ?? 40, GRID);
    const offsetY = snap(args.offsetY ?? 40, GRID);

    const clone: BoardObject = {
        ...source,
        id: newId('clone'),
        x: snap((source.x ?? 0) + offsetX, GRID),
        y: snap((source.y ?? 0) + offsetY, GRID),
        selected: false,
    };

    // Clone line start/end if present
    if (source.start && source.end) {
        clone.start = {
            x: snap(source.start.x + offsetX, GRID),
            y: snap(source.start.y + offsetY, GRID),
        };
        clone.end = {
            x: snap(source.end.x + offsetX, GRID),
            y: snap(source.end.y + offsetY, GRID),
        };
    }

    // Clone points if present
    if (source.points && Array.isArray(source.points)) {
        clone.points = source.points.map(p => ({
            x: p.x + offsetX,
            y: p.y + offsetY,
        }));
    }

    const patch: BoardPatch = { creates: [clone] };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 16) Move Object (Simpler than draw_board_patch) ----------

type MoveObjectArgs = {
    id: string;
    x?: number;
    y?: number;
    deltaX?: number;
    deltaY?: number;
};

export function toolMoveObject(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: MoveObjectArgs,
): BoardPatch {
    const target = snapshot.objects.find(o => o.id === args.id);
    if (!target) return { updates: [] };

    let newX = target.x ?? 0;
    let newY = target.y ?? 0;

    // Absolute positioning
    if (args.x !== undefined) newX = args.x;
    if (args.y !== undefined) newY = args.y;

    // Relative positioning (delta)
    if (args.deltaX !== undefined) newX += args.deltaX;
    if (args.deltaY !== undefined) newY += args.deltaY;

    const props: any = {
        x: snap(newX, GRID),
        y: snap(newY, GRID),
    };

    // Also move line start/end if present
    if (target.start && target.end) {
        const dx = props.x - (target.x ?? 0);
        const dy = props.y - (target.y ?? 0);
        props.start = {
            x: snap(target.start.x + dx, GRID),
            y: snap(target.start.y + dy, GRID),
        };
        props.end = {
            x: snap(target.end.x + dx, GRID),
            y: snap(target.end.y + dy, GRID),
        };
    }

    const patch: BoardPatch = { updates: [{ id: args.id, props }] };
    doc.applyPatch(patch);
    return patch;
}

// ---------- 17) Solve Equation (SymPy integration) ----------

import { solveEquation as solveWithSymPy } from '../math/mathSolver';

type SolveEquationArgs = {
    equation: string;
    insertResult?: boolean;
    x?: number;
    y?: number;
};

export async function toolSolveEquation(
    doc: BoardDoc,
    snapshot: BoardSnapshot,
    args: SolveEquationArgs,
): Promise<{ patch: BoardPatch; result: any }> {
    logger.info('[AI TOOL] Solving equation', { equation: args.equation });

    // Call Python/SymPy solver
    const result = await solveWithSymPy(args.equation);

    if (!result.success) {
        logger.warn('[AI TOOL] Equation solve failed', { error: result.error });
        return {
            patch: { creates: [], updates: [] },
            result: {
                success: false,
                error: result.error || 'Failed to solve equation',
            },
        };
    }

    // Create LaTeX block with the result if requested
    const insertResult = args.insertResult !== false; // Default to true

    if (insertResult && result.latex) {
        const baseX = args.x ?? snapshot.objects[0]?.x ?? 100;
        const baseY = args.y ?? (snapshot.objects[0]?.y ?? 100) + 100;

        const latexObj: BoardObject = {
            id: newId('ai-solution'),
            type: 'latex',
            x: snap(baseX, GRID),
            y: snap(baseY, GRID),
            width: 260,
            height: 80,
            latex: result.latex,
            color: '#1e3a5f',
        };

        const patch: BoardPatch = { creates: [latexObj] };
        doc.applyPatch(patch);

        return {
            patch,
            result: {
                success: true,
                solutions: result.solutions,
                latex: result.latex,
            },
        };
    }

    return {
        patch: { creates: [], updates: [] },
        result: {
            success: true,
            solutions: result.solutions,
            latex: result.latex,
        },
    };
}
