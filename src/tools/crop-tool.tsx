import { Crop } from 'lucide-react';
import type { ToolDefinition, CanvasOverlayProps } from '@/types/tool';
import { CropOverlay } from '@/components/canvas/CropOverlay';

export const CropTool: ToolDefinition = {
  name: 'crop',
  label: 'Crop',
  icon: Crop,
  category: 'transform',
  shortcut: 'C',
  cursor: 'crosshair',

  CanvasOverlay: (props: CanvasOverlayProps) => <CropOverlay {...props} />,

  onActivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = false;
    canvas.forEachObject((obj) => {
      obj.selectable = false;
      obj.evented = false;
    });
  },

  onDeactivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = true;
    canvas.forEachObject((obj) => {
      obj.selectable = true;
      obj.evented = true;
    });
  },
};
