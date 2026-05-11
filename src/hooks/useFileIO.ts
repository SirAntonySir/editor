import { useCallback, useRef } from 'react';
import type * as fabric from 'fabric';
import { loadImageToCanvas, hydrateCanvasFromStore } from '@/components/canvas/EditorCanvas';
import { exportImage, saveAs } from '@/lib/export';
import { editorDocument } from '@/core/document';
import { useAiSession } from '@/hooks/useImageContext';

export function useFileIO(canvasRef: React.RefObject<fabric.Canvas | null>) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        if (file.name.endsWith('.edp')) {
          await editorDocument.openEdp(file);
          hydrateCanvasFromStore(canvasRef.current);
        } else {
          await loadImageToCanvas(file, canvasRef.current);
          // Fire-and-forget AI analysis on new image open (not session-restore, which goes through the .edp branch).
          createImageBitmap(file).then((bitmap) => useAiSession.getState().uploadAndAnalyse(bitmap));
        }
      }
      // reset so same file can be re-selected
      e.target.value = '';
    },
    [canvasRef],
  );

  const handleSaveAs = useCallback(() => {
    editorDocument.saveAs();
  }, []);

  const handleClose = useCallback(() => {
    editorDocument.newDocument();
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.clear();
      canvas.renderAll();
    }
  }, [canvasRef]);

  const handleExport = useCallback(
    async (format: 'png' | 'jpeg' | 'webp') => {
      const blob = await exportImage({ format, quality: format === 'jpeg' ? 0.92 : 1 });
      if (blob) {
        await saveAs(blob, `export.${format === 'jpeg' ? 'jpg' : format}`);
      }
    },
    [],
  );

  return { fileInputRef, handleOpen, handleFileChange, handleSaveAs, handleClose, handleExport };
}
