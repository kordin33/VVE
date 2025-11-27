export type BoardLineStyle = 'solid' | 'dashed' | 'dotted';
export type BoardArrowStyle = 'none' | 'start' | 'end' | 'both';
export type BoardStrokeMode = 'clean' | 'handdrawn';

export interface BoardPoint {
    x: number;
    y: number;
}

export interface BoardObject {
    id: string;
    type: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;
    text?: string;
    latex?: string; // For LaTeX content
    expression?: string; // For function plots
    xRange?: number[]; // For function plots
    points?: BoardPoint[];
    selected?: boolean;
    style?: Record<string, unknown>; // For custom properties like function expression, colors, etc.

    // Style properties
    lineWidth?: number;
    lineStyle?: BoardLineStyle;
    arrowStyle?: BoardArrowStyle;
    strokeColor?: string;
    fillColor?: string;
    strokeMode?: BoardStrokeMode;

    // Metadata
    labelFor?: string; // ID of the object this label is attached to

    [key: string]: any; // Allow other properties loosely
}

export interface BoardSnapshot {
    objects: BoardObject[];
}

export interface BoardPatch {
    updates?: Array<{
        id: string;
        props: Partial<BoardObject>;
    }>;
    creates?: BoardObject[];
    deletes?: string[];
}
