/**
 * usePdfImport - renders PDF pages to images and adds them to the whiteboard.
 * Uses pdfjs-dist to render each page to a canvas, converts to dataURL,
 * then adds image elements via addElementFromPanel with explicit positions.
 */
const RENDER_SCALE = 1.5; // Balance between quality and memory usage
const PAGE_GAP = 40; // Vertical gap between pages in canvas coordinates

export function usePdfImport({ addElementFromPanel, showToast, debugLog }) {

  const importPdfFile = async (file) => {
    if (!file || file.type !== 'application/pdf') {
      showToast?.('Please select a valid PDF file.', 'warning');
      return;
    }

    showToast?.('Importing PDF...', 'info', 2000);
    debugLog?.('[usePdfImport] Starting PDF import');

    try {
      // Dynamic import to keep pdfjs-dist out of the main bundle
      const pdfjsLib = await import('pdfjs-dist');

      // Configure the worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;

      debugLog?.(`[usePdfImport] PDF loaded: ${numPages} pages`);

      if (numPages > 20) {
        showToast?.(`PDF has ${numPages} pages. Importing first 20 to avoid memory issues.`, 'warning', 4000);
      }

      const maxPages = Math.min(numPages, 20);
      let currentY = 100;

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: RENDER_SCALE });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport }).promise;

        const dataUrl = canvas.toDataURL('image/png');
        const imgWidth = viewport.width / RENDER_SCALE;
        const imgHeight = viewport.height / RENDER_SCALE;

        // Add as image element with explicit position
        if (addElementFromPanel) {
          addElementFromPanel({
            type: 'image',
            dataUrl,
            src: dataUrl,
            position: { x: 100, y: currentY },
            x: 100,
            y: currentY,
            width: imgWidth,
            height: imgHeight,
            rotation: 0,
          });
        }

        currentY += imgHeight + PAGE_GAP;

        // Clean up canvas to free memory
        canvas.width = 0;
        canvas.height = 0;
      }

      showToast?.(`Imported ${maxPages} page${maxPages > 1 ? 's' : ''} from PDF.`, 'success');
    } catch (err) {
      console.error('[usePdfImport] Failed:', err);
      showToast?.('PDF import failed. Check console.', 'error');
    }
  };

  return { importPdfFile };
}
