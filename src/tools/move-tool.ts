import { Move } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const MoveTool: ToolDefinition = {
  name: 'move',
  label: 'Move',
  icon: Move,
  category: 'select',
  modes: ['compose'],
  shortcut: 'M',
  cursor: 'move',

  onActivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = true;
    canvas.forEachObject((obj) => {
      obj.selectable = true;
      obj.evented = true;
      obj.hasControls = false;
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
