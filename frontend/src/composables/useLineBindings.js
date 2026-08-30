import * as Y from 'yjs';

const BINDABLE_ELEMENT_TYPES = new Set([
  'rectangle', 'circle', 'square', 'triangle', 'trapezoid', 'parallelogram',
  'deltoid', 'cube', 'cuboid', 'sphere', 'cylinder', 'cone', 'pyramid', 'tetrahedron',
  'text', 'image', 'coordinateSystem2D', 'coordinateSystem3D',
  'mathFunctionPlot', 'physicsDataPlot'
]);

const BINDING_PADDING = 8;
const BINDING_DISTANCE_THRESHOLD = 18;
const BINDING_GAP_DEFAULT = 4;

export function useLineBindings(yDrawings, ydoc) {

  const getConnectorAnchors = (rect) => {
    if (!rect) return [];
    const rot = (rect.rotation || 0) * Math.PI / 180;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const anchorsLocal = [
      { x: -rect.width / 2, y: 0, normalLocal: { x: -1, y: 0 } },
      { x: rect.width / 2, y: 0, normalLocal: { x: 1, y: 0 } },
      { x: 0, y: -rect.height / 2, normalLocal: { x: 0, y: -1 } },
      { x: 0, y: rect.height / 2, normalLocal: { x: 0, y: 1 } },
      { x: 0, y: 0, normalLocal: null },
    ];
    return anchorsLocal.map(({ x, y, normalLocal }) => {
      const anchorWorld = {
        x: cx + x * cosR - y * sinR,
        y: cy + x * sinR + y * cosR,
      };
      const ratioX = rect.width ? (x + rect.width / 2) / rect.width : 0.5;
      const ratioY = rect.height ? (y + rect.height / 2) / rect.height : 0.5;
      return { anchorLocal: { x, y }, anchorWorld, ratioX, ratioY, normalLocal };
    });
  };

  const findElementMapById = (id) => {
    if (!id || !yDrawings.value) return null;
    return yDrawings.value.toArray().find((el) => el.get('id') === id) || null;
  };

  const getRectFromElementMap = (map) => {
    if (!map) return null;
    const x = Number(map.get('x'));
    const y = Number(map.get('y'));
    const width = Math.abs(Number(map.get('width'))) || 0;
    const height = Math.abs(Number(map.get('height'))) || 0;
    const rotation = Number(map.get('rotation')) || 0;
    if ([x, y, width, height].every((v) => Number.isFinite(v))) {
      return { x, y, width, height, rotation };
    }
    const start = map.get('start');
    const end = map.get('end');
    const sx = start?.get?.('x');
    const sy = start?.get?.('y');
    const ex = end?.get?.('x');
    const ey = end?.get?.('y');
    if ([sx, sy, ex, ey].every((v) => Number.isFinite(v))) {
      return {
        x: Math.min(sx, ex),
        y: Math.min(sy, ey),
        width: Math.abs(ex - sx),
        height: Math.abs(ey - sy),
        rotation,
      };
    }
    return null;
  };

  const distanceToRect = (point, rect, padding = BINDING_PADDING) => {
    const padded = {
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    };
    const withinX = point.x >= padded.x && point.x <= padded.x + padded.width;
    const withinY = point.y >= padded.y && point.y <= padded.y + padded.height;
    if (withinX && withinY) return 0;
    const dx = Math.max(padded.x - point.x, 0, point.x - (padded.x + padded.width));
    const dy = Math.max(padded.y - point.y, 0, point.y - (padded.y + padded.height));
    return Math.hypot(dx, dy);
  };

  const clampVectorToRotatedRect = (rect, reference) => {
    const rot = (rect.rotation || 0) * Math.PI / 180;
    const cosR = Math.cos(-rot);
    const sinR = Math.sin(-rot);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const toLocal = (pt) => {
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      return { x: dx * cosR - dy * sinR, y: dx * sinR + dy * cosR };
    };
    const toWorld = (pt) => {
      const cosF = Math.cos(rot);
      const sinF = Math.sin(rot);
      return {
        x: cx + pt.x * cosF - pt.y * sinF,
        y: cy + pt.x * sinF + pt.y * cosF,
      };
    };

    const refLocal = toLocal(reference);
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    let dx = refLocal.x;
    let dy = refLocal.y;
    if (dx === 0 && dy === 0) dx = halfW;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    let anchorLocal;
    if (absDx * halfH > absDy * halfW) {
      const scale = absDx === 0 ? 1 : halfW / absDx;
      anchorLocal = { x: Math.sign(dx) * halfW, y: dy * scale };
    } else {
      const scale = absDy === 0 ? 1 : halfH / absDy;
      anchorLocal = { x: dx * scale, y: Math.sign(dy) * halfH };
    }
    const anchorWorld = toWorld(anchorLocal);
    return { anchorLocal, anchorWorld, toWorld };
  };

  const makeBindingPayload = (targetMap, rect, referencePoint, fallbackPoint, lineWidth = 2, anchorOverride = null) => {
    if (!targetMap || !rect) return { binding: null, point: null };
    const rot = (rect.rotation || 0) * Math.PI / 180;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const cosInv = Math.cos(-rot);
    const sinInv = Math.sin(-rot);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const ref = referencePoint || fallbackPoint || { x: rect.x + rect.width, y: rect.y + rect.height / 2 };

    const anchorLocal = anchorOverride?.anchorLocal
      ? { ...anchorOverride.anchorLocal }
      : clampVectorToRotatedRect(rect, ref).anchorLocal;
    const ratioX = anchorOverride?.ratioX ?? (rect.width ? (anchorLocal.x + rect.width / 2) / rect.width : 0.5);
    const ratioY = anchorOverride?.ratioY ?? (rect.height ? (anchorLocal.y + rect.height / 2) / rect.height : 0.5);

    const refLocal = {
      x: (ref.x - cx) * cosInv - (ref.y - cy) * sinInv,
      y: (ref.x - cx) * sinInv + (ref.y - cy) * cosInv,
    };

    let normalLocal = anchorOverride?.normalLocal || null;
    if (!normalLocal) {
      const vectorLocal = { x: refLocal.x - anchorLocal.x, y: refLocal.y - anchorLocal.y };
      const len = Math.hypot(vectorLocal.x, vectorLocal.y);
      if (!len || len < 1e-6) {
        normalLocal = { x: 1, y: 0 };
      } else {
        normalLocal = { x: vectorLocal.x / len, y: vectorLocal.y / len };
      }
    }

    const gap = Math.max(BINDING_GAP_DEFAULT, (lineWidth || 2) * 1.1);
    const normalWorld = {
      x: normalLocal.x * cosR - normalLocal.y * sinR,
      y: normalLocal.x * sinR + normalLocal.y * cosR,
    };
    const normalLen = Math.hypot(normalWorld.x, normalWorld.y) || 1;
    const anchorWorld = {
      x: cx + anchorLocal.x * cosR - anchorLocal.y * sinR,
      y: cy + anchorLocal.x * sinR + anchorLocal.y * cosR,
    };
    const point = {
      x: anchorWorld.x + (normalWorld.x / normalLen) * gap,
      y: anchorWorld.y + (normalWorld.y / normalLen) * gap,
    };
    const binding = {
      elementId: targetMap.get('id'),
      ratioX,
      ratioY,
      normalLocal,
      gap,
    };
    return { binding, point };
  };

  const resolveBindingPoint = (binding) => {
    if (!binding) return null;
    const target = findElementMapById(binding.elementId);
    const rect = getRectFromElementMap(target);
    if (!rect) return null;
    const rot = (rect.rotation || 0) * Math.PI / 180;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const anchorLocal = {
      x: (binding.ratioX ?? 0.5) * rect.width - rect.width / 2,
      y: (binding.ratioY ?? 0.5) * rect.height - rect.height / 2,
    };
    const anchorWorld = {
      x: cx + anchorLocal.x * cosR - anchorLocal.y * sinR,
      y: cy + anchorLocal.x * sinR + anchorLocal.y * cosR,
    };
    const normalLocal = binding.normalLocal ?? binding.normal ?? { x: 1, y: 0 };
    const gap = binding.gap ?? BINDING_GAP_DEFAULT;
    const normalWorld = {
      x: normalLocal.x * cosR - normalLocal.y * sinR,
      y: normalLocal.x * sinR + normalLocal.y * cosR,
    };
    const len = Math.hypot(normalWorld.x, normalWorld.y) || 1;
    return {
      x: anchorWorld.x + (normalWorld.x / len) * gap,
      y: anchorWorld.y + (normalWorld.y / len) * gap,
    };
  };

  const getLineEndpoints = (lineMap) => {
    const startMap = lineMap?.get?.('start');
    const endMap = lineMap?.get?.('end');
    const start = startMap?.get ? { x: Number(startMap.get('x')), y: Number(startMap.get('y')) } : null;
    const end = endMap?.get ? { x: Number(endMap.get('x')), y: Number(endMap.get('y')) } : null;
    return { start, end };
  };

  const setLineEndpoints = (lineMap, start, end) => {
    if (!lineMap || !start || !end) return;
    let startMap = lineMap.get('start');
    let endMap = lineMap.get('end');
    if (!(startMap instanceof Y.Map)) {
      startMap = new Y.Map();
      lineMap.set('start', startMap);
    }
    if (!(endMap instanceof Y.Map)) {
      endMap = new Y.Map();
      lineMap.set('end', endMap);
    }
    startMap.set('x', start.x);
    startMap.set('y', start.y);
    endMap.set('x', end.x);
    endMap.set('y', end.y);
    lineMap.set('x', Math.min(start.x, end.x));
    lineMap.set('y', Math.min(start.y, end.y));
    lineMap.set('width', Math.abs(end.x - start.x));
    lineMap.set('height', Math.abs(end.y - start.y));
  };

  const findBindingTargetNearPoint = (point, excludeId = null, maxDistance = BINDING_DISTANCE_THRESHOLD, collectAll = false) => {
    if (!yDrawings.value || !point) return collectAll ? [] : null;
    const elements = yDrawings.value.toArray();
    let best = null;
    let bestDistance = Infinity;
    const hits = [];
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      const id = el.get('id');
      if (excludeId && id === excludeId) continue;
      const type = el.get('type');
      if (!BINDABLE_ELEMENT_TYPES.has(type)) continue;
      const rect = getRectFromElementMap(el);
      if (!rect) continue;
      const anchors = getConnectorAnchors(rect);
      anchors.forEach((anchor) => {
        const dist = Math.hypot(anchor.anchorWorld.x - point.x, anchor.anchorWorld.y - point.y);
        if (dist <= maxDistance) {
          const payload = { map: el, rect, anchor, distance: dist };
          if (collectAll) hits.push(payload);
          if (dist < bestDistance) {
            bestDistance = dist;
            best = payload;
          }
        }
      });
    }
    return collectAll ? hits : best;
  };

  const attachBindingsToLineDraft = (lineDraft) => {
    if (!lineDraft || lineDraft.type !== 'line' || !lineDraft.start || !lineDraft.end || !yDrawings.value) return;
    const lineWidth = lineDraft.lineWidth || 2;
    const startTarget = findBindingTargetNearPoint(lineDraft.start, lineDraft.id);
    if (startTarget) {
      const { binding, point } = makeBindingPayload(startTarget.map, startTarget.rect, lineDraft.end, lineDraft.start, lineWidth, startTarget.anchor);
      if (binding && point) {
        lineDraft.startBinding = binding;
        lineDraft.start = point;
      }
    }
    const endTarget = findBindingTargetNearPoint(lineDraft.end, lineDraft.id);
    if (endTarget) {
      const { binding, point } = makeBindingPayload(endTarget.map, endTarget.rect, lineDraft.start, lineDraft.end, lineWidth, endTarget.anchor);
      if (binding && point) {
        lineDraft.endBinding = binding;
        lineDraft.end = point;
      }
    }
    lineDraft.x = Math.min(lineDraft.start.x, lineDraft.end.x);
    lineDraft.y = Math.min(lineDraft.start.y, lineDraft.end.y);
    lineDraft.width = Math.abs(lineDraft.start.x - lineDraft.end.x);
    lineDraft.height = Math.abs(lineDraft.start.y - lineDraft.end.y);
  };

  const updateBindingsForTarget = (targetId) => {
    if (!targetId || !yDrawings.value || !ydoc.value) return;
    const target = findElementMapById(targetId);
    const rect = getRectFromElementMap(target);
    if (!rect) return;
    const lines = yDrawings.value.toArray().filter((el) => el.get('type') === 'line');
    if (!lines.length) return;
    ydoc.value.transact(() => {
      lines.forEach((line) => {
        const { start, end } = getLineEndpoints(line);
        if (!start || !end) return;
        let nextStart = start;
        let nextEnd = end;
        let changed = false;
        const startBinding = line.get('startBinding');
        if (startBinding?.elementId === targetId) {
          const point = resolveBindingPoint(startBinding);
          if (point) {
            nextStart = point;
            changed = true;
          }
        }
        const endBinding = line.get('endBinding');
        if (endBinding?.elementId === targetId) {
          const point = resolveBindingPoint(endBinding);
          if (point) {
            nextEnd = point;
            changed = true;
          }
        }
        if (changed) {
          setLineEndpoints(line, nextStart, nextEnd);
        }
      });
    }, 'auto-binding');
  };

  const refreshLineBindings = (lineMap) => {
    if (!lineMap || lineMap.get('type') !== 'line' || !ydoc.value) return;
    const lineId = lineMap.get('id');
    const { start, end } = getLineEndpoints(lineMap);
    if (!start || !end) return;
    const lineWidth = lineMap.get('lineWidth') || 2;
    ydoc.value.transact(() => {
      let nextStart = start;
      let nextEnd = end;
      let changed = false;

      const startBinding = lineMap.get('startBinding');
      if (startBinding?.elementId) {
        const point = resolveBindingPoint(startBinding);
        if (point) {
          nextStart = point;
          changed = true;
        } else {
          lineMap.delete('startBinding');
          changed = true;
        }
      } else {
        const target = findBindingTargetNearPoint(start, lineId);
        if (target) {
          const { binding, point } = makeBindingPayload(target.map, target.rect, end, start, lineWidth, target.anchor);
          if (binding && point) {
            lineMap.set('startBinding', binding);
            nextStart = point;
            changed = true;
          }
        }
      }

      const endBinding = lineMap.get('endBinding');
      if (endBinding?.elementId) {
        const point = resolveBindingPoint(endBinding);
        if (point) {
          nextEnd = point;
          changed = true;
        } else {
          lineMap.delete('endBinding');
          changed = true;
        }
      } else {
        const target = findBindingTargetNearPoint(end, lineId);
        if (target) {
          const { binding, point } = makeBindingPayload(target.map, target.rect, start, end, lineWidth, target.anchor);
          if (binding && point) {
            lineMap.set('endBinding', binding);
            nextEnd = point;
            changed = true;
          }
        }
      }

      if (changed && nextStart && nextEnd) {
        setLineEndpoints(lineMap, nextStart, nextEnd);
      }
    }, 'auto-binding');
  };

  const detachLineBindings = (lineId) => {
    if (!ydoc.value || !yDrawings.value) return;
    const map = findElementMapById(lineId);
    if (!map || map.get('type') !== 'line') return;
    ydoc.value.transact(() => {
      if (map.has('startBinding')) map.delete('startBinding');
      if (map.has('endBinding')) map.delete('endBinding');
    }, 'line-detach-binding');
  };

  return {
    BINDABLE_ELEMENT_TYPES,
    BINDING_DISTANCE_THRESHOLD,
    getConnectorAnchors,
    findElementMapById,
    getRectFromElementMap,
    distanceToRect,
    findBindingTargetNearPoint,
    attachBindingsToLineDraft,
    updateBindingsForTarget,
    refreshLineBindings,
    detachLineBindings,
  };
}
