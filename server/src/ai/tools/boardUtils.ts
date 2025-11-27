import { BoardObject } from '../../models/boardSnapshot';

/**
 * Generates a URL-friendly unique ID of given length.
 * Replaces nanoid(length) for backend usage to avoid ESM/CJS issues.
 */
export function nanoid(length: number = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Snaps a value to the nearest grid step.
 */
export function snapToGrid(val: number, gridSize: number = 8): number {
    return Math.round(val / gridSize) * gridSize;
}

/**
 * Clamps a value between min and max.
 */
export function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

/**
 * Returns the bounding box of a BoardObject.
 * Handles objects with x/y/width/height and objects with start/end (like lines).
 */
export function getBBox(obj: BoardObject): { x: number; y: number; width: number; height: number } {
    let x = obj.x ?? 0;
    let y = obj.y ?? 0;
    let width = obj.width ?? 0;
    let height = obj.height ?? 0;

    // Handle line-like objects that might store start/end instead of x/y/w/h
    if (obj.start && obj.end) {
        x = Math.min(obj.start.x, obj.end.x);
        y = Math.min(obj.start.y, obj.end.y);
        width = Math.abs(obj.end.x - obj.start.x);
        height = Math.abs(obj.end.y - obj.start.y);
    }

    return { x, y, width, height };
}

/**
 * Returns the center point of a BoardObject.
 */
export function getCenter(obj: BoardObject): { x: number; y: number } {
    const box = getBBox(obj);
    return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
    };
}
