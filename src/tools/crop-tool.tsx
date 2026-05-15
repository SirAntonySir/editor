import { Crop } from 'lucide-react';
import { useCropEditingStore } from '@/store/crop-editing-slice';
import { resetCanvasInteraction } from '@/tools/canvas-reset';
import type { ToolDefinition, ToolContext } from '@/types/tool';

export const CropTool: ToolDefinition = {
  name: 'crop',
  label: 'Crop',
  icon: Crop,
  category: 'transform',
  shortcut: 'C',
  modes: ['develop', 'compose'],

  onActivate: (_ctx: ToolContext) => {
    useCropEditingStore.getState().setIsCropEditing(true);
    return () => {
      useCropEditingStore.getState().setIsCropEditing(false);
    };
  },

  onDeactivate: (ctx: ToolContext) => {
    useCropEditingStore.getState().setIsCropEditing(false);
    // Restore canvas interaction after leaving crop mode
    resetCanvasInteraction(ctx);
  },
};
