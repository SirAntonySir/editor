import { MousePointer2 } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const SelectTool: ToolDefinition = {
  name: 'select',
  label: 'Select',
  icon: MousePointer2,
  category: 'select',
  modes: ['compose'],
  shortcut: 'V',
  cursor: 'default',

  onActivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = true;
    canvas.forEachObject((obj) => {
      obj.selectable = true;
      obj.evented = true;
    });
  },

  onDeactivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.renderAll();
  },
};
