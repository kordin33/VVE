import * as Y from 'yjs';
import { drawElement } from '../utils/canvasDrawing.js';
import { drawGrid as drawUtilGrid } from '../utils/canvasGrid.js';

// P0-FIX: Reduced DPI from 600 to 200 to avoid OOM on iPad and reduce file size
const EXPORT_DPI = 200;
const PAGE_SIZE_INCH = { w: 8.27, h: 11.69 }; // A4 portrait in inches
const PAGE_PX = {
  w: Math.round(PAGE_SIZE_INCH.w * EXPORT_DPI),
  h: Math.round(PAGE_SIZE_INCH.h * EXPORT_DPI),
};
const PDF_IMAGE_COMPRESSION = 'FAST'; // Use FAST compression to reduce PDF size

export function usePdfExport({ yDrawings, ydoc, smoothingFactor, imageCache, showToast, debugLog, debugWarn }) {

  const normalizePointForBounds = (pt) => {
    if (!pt) return null;
    if (Array.isArray(pt)) {
      const [x, y] = pt;
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      return null;
    }
    const x = Number.isFinite(pt.x) ? pt.x : null;
    const y = Number.isFinite(pt.y) ? pt.y : null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  };

  const getElementBounds = (element) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const addPoint = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    const addRect = (x, y, w, h) => {
      if (![x, y, w, h].every(Number.isFinite)) return;
      addPoint(x, y);
      addPoint(x + w, y + h);
    };

    if (Array.isArray(element?.points)) {
      element.points.forEach((pt) => {
        const p = normalizePointForBounds(pt);
        if (p) addPoint(p.x, p.y);
      });
    }

    if (element?.start && element?.end) {
      const start = normalizePointForBounds(element.start);
      const end = normalizePointForBounds(element.end);
      if (start) addPoint(start.x, start.y);
      if (end) addPoint(end.x, end.y);
    }

    if (element?.position) {
      const { x, y } = element.position;
      const width = Number.isFinite(element.width)
        ? element.width
        : Number.isFinite(element.size) ? element.size : 0;
      const height = Number.isFinite(element.height)
        ? element.height
        : Number.isFinite(element.size) ? element.size : 0;
      addRect(x, y, width, height);
    }

    if (Number.isFinite(element?.x) && Number.isFinite(element?.y)) {
      const w = Number.isFinite(element.width) ? element.width : 0;
      const h = Number.isFinite(element.height) ? element.height : 0;
      addRect(element.x, element.y, w, h);
    }

    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
      return null;
    }
    const padding = Math.max(2, Number.isFinite(element.lineWidth) ? element.lineWidth : 0);
    return { x1: minX - padding, y1: minY - padding, x2: maxX + padding, y2: maxY + padding };
  };

  const getSceneBounds = (elements) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach((el) => {
      const bounds = getElementBounds(el);
      if (!bounds) return;
      minX = Math.min(minX, bounds.x1);
      minY = Math.min(minY, bounds.y1);
      maxX = Math.max(maxX, bounds.x2);
      maxY = Math.max(maxY, bounds.y2);
    });
    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
      return null;
    }
    return { x1: minX, y1: minY, x2: maxX, y2: maxY };
  };

  const preloadImagesForExport = async (elements) => {
    const loaders = [];
    elements.forEach((el) => {
      if (el.type !== 'image') return;
      const src = el.src || el.dataUrl;
      if (!src) return;
      const cached = imageCache.value?.get(src);
      if (cached && cached.complete) return;
      loaders.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          imageCache.value?.set(src, img);
          resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = src;
      }));
    });
    if (loaders.length) {
      await Promise.all(loaders);
    }
  };

  const drawGridForExport = (ctx, bounds, scale, marginPx, pagePx) => {
    const pan = {
      x: marginPx - bounds.x1 * scale,
      y: marginPx - bounds.y1 * scale,
    };
    drawUtilGrid(ctx, scale, pan, pagePx.w, pagePx.h, false);
    return pan;
  };

  const tileIntersects = (tileRect, bounds) => {
    return !(bounds.x2 <= tileRect.x1 || bounds.x1 >= tileRect.x2 || bounds.y2 <= tileRect.y1 || bounds.y1 >= tileRect.y2);
  };

  const renderTileToImage = (tileRect, elements) => {
    const marginPx = Math.round(0.2 * EXPORT_DPI);
    const worldW = Math.max(1, tileRect.x2 - tileRect.x1);
    const worldH = Math.max(1, tileRect.y2 - tileRect.y1);
    const scale = Math.min(
      (PAGE_PX.w - 2 * marginPx) / worldW,
      (PAGE_PX.h - 2 * marginPx) / worldH
    );

    const off = document.createElement('canvas');
    off.width = PAGE_PX.w;
    off.height = PAGE_PX.h;
    const ctx = off.getContext('2d');
    if (!ctx) return null;

    const pan = drawGridForExport(ctx, tileRect, scale, marginPx, PAGE_PX);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);

    elements.forEach((el) => {
      drawElement(ctx, el, false, smoothingFactor.value, imageCache.value);
    });

    ctx.restore();
    const dataUrl = off.toDataURL('image/png');
    // Release canvas memory immediately
    off.width = 0;
    off.height = 0;
    return dataUrl;
  };

  const exportBoardAsPdf = async () => {
    try {
      debugLog('[usePdfExport] exportBoardAsPdf start');
      showToast('Preparing PDF...', 'info', 1500);
      if (!yDrawings.value || !yDrawings.value.length) {
        showToast('Nothing to export yet.', 'warning');
        return;
      }

      const elements = yDrawings.value.toArray().map(map => map.toJSON());
      const sceneBounds = getSceneBounds(elements);
      if (!sceneBounds) {
        showToast('Nothing to export yet.', 'warning');
        return;
      }

      await preloadImagesForExport(elements);

      const marginPx = Math.round(0.2 * EXPORT_DPI);
      const worldW = Math.max(1, sceneBounds.x2 - sceneBounds.x1);
      const worldH = Math.max(1, sceneBounds.y2 - sceneBounds.y1);
      const scale = Math.min(
        (PAGE_PX.w - 2 * marginPx) / worldW,
        (PAGE_PX.h - 2 * marginPx) / worldH
      );

      const offscreen = document.createElement('canvas');
      offscreen.width = PAGE_PX.w;
      offscreen.height = PAGE_PX.h;
      const ctx = offscreen.getContext('2d');
      if (!ctx) {
        showToast('Unable to prepare PDF canvas.', 'error');
        return;
      }

      const pan = drawGridForExport(ctx, sceneBounds, scale, marginPx, PAGE_PX);

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(scale, scale);

      elements.forEach((element) => {
        drawElement(ctx, element, false, smoothingFactor.value, imageCache.value);
      });

      ctx.restore();

      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF('portrait', 'pt', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgData = offscreen.toDataURL('image/png');
      // Release offscreen canvas memory
      offscreen.width = 0;
      offscreen.height = 0;
      pdf.addImage(
        imgData,
        'PNG',
        0, 0, pageW, pageH,
        undefined,
        PDF_IMAGE_COMPRESSION
      );
      // 2.3: iOS Safari fallback — a.click() doesn't work on iOS
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) {
        // iOS: open blob in new tab (user can then save/share)
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'whiteboard.pdf';
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('Exported to PDF', 'success');
    } catch (err) {
      console.error('[exportBoardAsPdf] failed', err);
      showToast('PDF export failed. Check console.', 'error');
    }
  };

  const exportBoardAsPdfPaged = async () => {
    try {
      debugLog('[usePdfExport] exportBoardAsPdfPaged start');
      showToast('Preparing PDF...', 'info', 1500);
      if (!yDrawings.value || !yDrawings.value.length) {
        showToast('Nothing to export yet.', 'warning');
        return;
      }

      const elements = yDrawings.value.toArray().map(map => map.toJSON());
      const sceneBounds = getSceneBounds(elements);
      if (!sceneBounds) {
        showToast('Nothing to export yet.', 'warning');
        return;
      }

      await preloadImagesForExport(elements);

      const TILE_W = 2000;
      const TILE_H = 1400;
      const tilesX = Math.max(1, Math.ceil((sceneBounds.x2 - sceneBounds.x1) / TILE_W));
      const tilesY = Math.max(1, Math.ceil((sceneBounds.y2 - sceneBounds.y1) / TILE_H));

      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF('portrait', 'pt', 'a4');
      let isFirst = true;

      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const tileRect = {
            x1: sceneBounds.x1 + tx * TILE_W,
            y1: sceneBounds.y1 + ty * TILE_H,
            x2: sceneBounds.x1 + (tx + 1) * TILE_W,
            y2: sceneBounds.y1 + (ty + 1) * TILE_H,
          };

          const shapesInTile = elements.filter((el) => {
            const b = getElementBounds(el);
            if (!b) return false;
            return tileIntersects(tileRect, b);
          });

          if (!shapesInTile.length) continue;

          const imgData = renderTileToImage(tileRect, shapesInTile);
          if (!imgData) continue;

          if (!isFirst) pdf.addPage();
          isFirst = false;
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          pdf.addImage(
            imgData,
            'PNG',
            0, 0, pageW, pageH,
            undefined,
            PDF_IMAGE_COMPRESSION
          );
          pdf.setFontSize(10);
          pdf.text(`Page ${pdf.getNumberOfPages()}`, pageW - 60, pageH - 20);
        }
      }

      if (isFirst) {
        showToast('Nothing to export yet.', 'warning');
        return;
      }

      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'whiteboard-notes.pdf';
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('Exported to PDF (notes)', 'success');
    } catch (err) {
      console.error('[exportBoardAsPdfPaged] failed', err);
      showToast('PDF export failed. Check console.', 'error');
    }
  };

  const getSnapshot = () => {
    if (!ydoc.value) return '';
    try {
      const stateUpdate = Y.encodeStateAsUpdate(ydoc.value);
      let binary = '';
      for (let i = 0; i < stateUpdate.length; i++) {
        binary += String.fromCharCode(stateUpdate[i]);
      }
      return window.btoa(binary);
    } catch (err) {
      debugWarn('[getSnapshot] Error encoding state:', err);
      return '';
    }
  };

  const getSerializableState = () => getSnapshot();
  const loadState = () => false; // Placeholder
  const exportAsText = () => getSnapshot();
  const importFromText = () => false; // Placeholder

  return {
    exportBoardAsPdf,
    exportBoardAsPdfPaged,
    getSnapshot,
    getSerializableState,
    loadState,
    exportAsText,
    importFromText,
  };
}
