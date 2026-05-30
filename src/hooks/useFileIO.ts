import { useCallback, useRef } from 'react';
import { exportImage, saveAs } from '@/lib/export';
import { editorDocument } from '@/core/document';
import { useAiSession } from '@/hooks/useImageContext';

export function useFileIO() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await editorDocument.openImage(file);
        // Fire-and-forget AI analysis on new image open.
        createImageBitmap(file).then((bitmap) => useAiSession.getState().uploadAndAnalyse(bitmap));
      }
      // reset so same file can be re-selected
      e.target.value = '';
    },
    [],
  );

  const handleClose = useCallback(() => {
    editorDocument.newDocument();
  }, []);

  const handleExport = useCallback(
    async (format: 'png' | 'jpeg' | 'webp') => {
      const blob = await exportImage({ format, quality: format === 'jpeg' ? 0.92 : 1 });
      if (blob) {
        await saveAs(blob, `export.${format === 'jpeg' ? 'jpg' : format}`);
      }
    },
    [],
  );

  return { fileInputRef, handleOpen, handleFileChange, handleClose, handleExport };
}
