import { useCallback } from 'react';
import { exportImageNode } from '@/lib/image-node-actions';
import { editorDocument } from '@/core/document';
import { openImageFromPicker, addImageFromPicker } from '@/lib/open-file';
import { useEditorStore } from '@/store';
import { toast } from '@/components/ui/Toast';

export function useFileIO() {
  const handleOpen = useCallback(() => {
    openImageFromPicker();
  }, []);

  const handleAddImage = useCallback(() => {
    addImageFromPicker();
  }, []);

  const handleClose = useCallback(() => {
    // Full close: clears layers, workspace nodes/edges, pixel data,
    // history, AND the persisted backend session (incl. its localStorage
    // entry). `newDocument()` only swaps the document meta — it leaves
    // imageNodes / widgetNodes on the canvas, which read as ghost items
    // after the user hits File → Close.
    editorDocument.closeDocument();
  }, []);

  const handleExport = useCallback(
    async (format: 'png' | 'jpeg' | 'webp') => {
      // Export the active image-node WYSIWYG (same renderer the canvas uses).
      // The menu items gate on hasLayers, but with no node selected we can't
      // tell which to render — ask the user to pick one.
      const { activeImageNodeId } = useEditorStore.getState();
      if (!activeImageNodeId) {
        toast.info('Select an image to export.');
        return;
      }
      await exportImageNode(activeImageNodeId, format);
    },
    [],
  );

  return { handleOpen, handleAddImage, handleClose, handleExport };
}
