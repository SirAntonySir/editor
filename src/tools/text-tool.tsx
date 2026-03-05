import { Type } from 'lucide-react';
import * as fabric from 'fabric';
import type { ToolDefinition, CanvasPointerEvent, ToolContext } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useState } from 'react';

const FONT_FAMILIES = [
  '-apple-system, BlinkMacSystemFont, sans-serif',
  'Georgia, serif',
  'Menlo, Monaco, monospace',
  'Helvetica Neue, sans-serif',
  'Times New Roman, serif',
  'Courier New, monospace',
];

const FONT_LABELS = [
  'System', 'Georgia', 'Monospace', 'Helvetica', 'Times', 'Courier',
];

function TextPanel() {
  const [fontSize, setFontSize] = useState(32);
  const [fontIdx, setFontIdx] = useState(0);
  const [color, setColor] = useState('#000000');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);

  (window as unknown as Record<string, unknown>).__textConfig = {
    fontSize,
    fontFamily: FONT_FAMILIES[fontIdx],
    color,
    fontWeight: bold ? 'bold' : 'normal',
    fontStyle: italic ? 'italic' : 'normal',
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-secondary">Font</span>
        <select
          value={fontIdx}
          onChange={(e) => setFontIdx(Number(e.target.value))}
          className="px-2 py-1 text-xs bg-surface-secondary border border-separator rounded-sm text-text-primary"
        >
          {FONT_LABELS.map((label, i) => (
            <option key={i} value={i}>{label}</option>
          ))}
        </select>
      </div>

      <AdjustmentSlider label="Size" value={fontSize} min={8} max={200} onChange={setFontSize} formatValue={(v) => `${v}px`} />

      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-secondary">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-8 h-8 rounded border border-separator cursor-pointer"
        />
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => setBold(!bold)}
          className={`px-2 py-1 text-xs font-bold rounded transition-colors ${
            bold ? 'bg-accent text-white' : 'bg-surface-secondary text-text-primary'
          }`}
        >
          B
        </button>
        <button
          onClick={() => setItalic(!italic)}
          className={`px-2 py-1 text-xs italic rounded transition-colors ${
            italic ? 'bg-accent text-white' : 'bg-surface-secondary text-text-primary'
          }`}
        >
          I
        </button>
      </div>
    </div>
  );
}

function getTextConfig() {
  return (window as unknown as Record<string, unknown>).__textConfig as {
    fontSize: number;
    fontFamily: string;
    color: string;
    fontWeight: string;
    fontStyle: string;
  } ?? {
    fontSize: 32,
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    color: '#000000',
    fontWeight: 'normal',
    fontStyle: 'normal',
  };
}

export const TextTool: ToolDefinition = {
  name: 'text',
  label: 'Text',
  icon: Type,
  category: 'draw',
  shortcut: 'T',
  cursor: 'text',
  OptionsPanel: TextPanel,

  onActivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = false;
  },

  onDeactivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = true;
  },

  onPointerDown: (e: CanvasPointerEvent, ctx: ToolContext) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;

    // If clicking on existing text, enter edit mode
    const target = canvas.findTarget(e.rawEvent);
    if (target && target instanceof fabric.IText) {
      canvas.setActiveObject(target);
      target.enterEditing();
      return;
    }

    const config = getTextConfig();

    const text = new fabric.IText('Type here', {
      left: e.x,
      top: e.y,
      fontSize: config.fontSize,
      fontFamily: config.fontFamily,
      fill: config.color,
      fontWeight: config.fontWeight as '' | 'bold' | 'normal',
      fontStyle: config.fontStyle as '' | 'italic' | 'normal',
      editable: true,
      selectable: true,
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
  },
};
