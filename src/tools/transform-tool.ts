import { MoveDiagonal } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const TransformTool: ToolDefinition = {
  name: 'transform',
  label: 'Transform',
  icon: MoveDiagonal,
  category: 'select',
  modes: ['compose'],
  shortcut: 'T',
  cursor: 'default',

  onActivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = true;
    canvas.forEachObject((obj) => {
      obj.selectable = true;
      obj.evented = true;
      obj.hasControls = true;
      obj.lockMovementX = false;
      obj.lockMovementY = false;
    });
  },

  onDeactivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.renderAll();
  },
};
