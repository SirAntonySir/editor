import { Type } from 'lucide-react';
import type { ToolDefinition, CanvasPointerEvent, ToolContext } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useEffect, useState } from 'react';
import type { TextMeta } from '@/store/layer-slice';

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

function getBaseImageSize(): { width: number; height: number } | null {
  const { layers } = useEditorStore.getState();
  for (const layer of layers) {
    if (layer.type !== 'image') continue;
    const working = CanvasRegistry.get(layer.id);
    if (working && working.width > 0) return { width: working.width, height: working.height };
  }
  return null;
}

function getPixelCoords(e: CanvasPointerEvent, ctx: ToolContext): { x: number; y: number } | null {
  const canvas = ctx.canvasRef.current;
  if (!canvas) return null;
  const obj = canvas.getObjects()[0];
  if (!obj) return null;

  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;

  return {
    x: (e.x - left) / scaleX + w / 2,
    y: (e.y - top) / scaleY + h / 2,
  };
}

function renderTextToCanvas(meta: TextMeta, width: number, height: number): OffscreenCanvas {
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d');
  if (!ctx) return offscreen;

  const { fontSize, fontFamily, color, fontWeight, fontStyle, text, x, y } = meta;
  const fontStr = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

  ctx.font = fontStr;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';

  const maxWidth = width - x;
  const lines: string[] = [];
  const words = text.split(' ');
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const lineHeight = fontSize * 1.3;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineHeight);
  }

  return offscreen;
}

function reRenderTextLayer(layerId: string, meta: TextMeta) {
  const size = getBaseImageSize();
  if (!size) return;

  const offscreen = renderTextToCanvas(meta, size.width, size.height);

  // Update the working canvas in the registry
  const existing = CanvasRegistry.get(layerId);
  if (existing) {
    const ctx = existing.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, existing.width, existing.height);
      ctx.drawImage(offscreen, 0, 0);
    }
    // Also update source
    const source = CanvasRegistry.getSource(layerId);
    if (source) {
      const sctx = source.getContext('2d');
      if (sctx) {
        sctx.clearRect(0, 0, source.width, source.height);
        sctx.drawImage(offscreen, 0, 0);
      }
    }
  } else {
    CanvasRegistry.register(layerId, offscreen);
  }

  useEditorStore.getState().bumpPixelVersion();
}

function TextPanel() {
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const activeLayer = useEditorStore((s) => s.layers.find((l) => l.id === s.activeLayerId));
  const updateLayer = useEditorStore((s) => s.updateLayer);

  const isEditingTextLayer = activeLayer?.type === 'text' && activeLayer.textMeta != null;
  const meta = activeLayer?.textMeta;

  const [fontSize, setFontSize] = useState(meta?.fontSize ?? 32);
  const [fontIdx, setFontIdx] = useState(() => {
    const idx = FONT_FAMILIES.indexOf(meta?.fontFamily ?? '');
    return idx >= 0 ? idx : 0;
  });
  const [color, setColor] = useState(meta?.color ?? '#000000');
  const [bold, setBold] = useState(meta?.fontWeight === 'bold');
  const [italic, setItalic] = useState(meta?.fontStyle === 'italic');
  const [text, setText] = useState(meta?.text ?? 'Type here');

  // Sync panel state when active layer changes
  useEffect(() => {
    if (meta) {
      setText(meta.text);
      setFontSize(meta.fontSize);
      const idx = FONT_FAMILIES.indexOf(meta.fontFamily);
      setFontIdx(idx >= 0 ? idx : 0);
      setColor(meta.color);
      setBold(meta.fontWeight === 'bold');
      setItalic(meta.fontStyle === 'italic');
    } else {
      setText('Type here');
      setFontSize(32);
      setFontIdx(0);
      setColor('#000000');
      setBold(false);
      setItalic(false);
    }
  }, [activeLayerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When editing an existing text layer, update it live
  useEffect(() => {
    if (!isEditingTextLayer || !activeLayerId || !meta) return;

    const newMeta: TextMeta = {
      text,
      fontSize,
      fontFamily: FONT_FAMILIES[fontIdx],
      color,
      fontWeight: bold ? 'bold' : 'normal',
      fontStyle: italic ? 'italic' : 'normal',
      x: meta.x,
      y: meta.y,
    };

    updateLayer(activeLayerId, { textMeta: newMeta });
    reRenderTextLayer(activeLayerId, newMeta);
  }, [text, fontSize, fontIdx, color, bold, italic]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store current config for new text layer creation
  textPanelConfig.fontSize = fontSize;
  textPanelConfig.fontFamily = FONT_FAMILIES[fontIdx];
  textPanelConfig.color = color;
  textPanelConfig.fontWeight = bold ? 'bold' : 'normal';
  textPanelConfig.fontStyle = italic ? 'italic' : 'normal';
  textPanelConfig.text = text;

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-secondary">Text</span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="px-2 py-1 text-xs bg-surface-secondary border border-separator rounded-sm text-text-primary"
          placeholder="Enter text..."
        />
      </div>

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

// Mutable config for new text creation (read by onPointerDown)
const textPanelConfig = {
  fontSize: 32,
  fontFamily: FONT_FAMILIES[0],
  color: '#000000',
  fontWeight: 'normal',
  fontStyle: 'normal',
  text: 'Type here',
};

// Drag state for moving text layers
const dragState = {
  dragging: false,
  startX: 0,
  startY: 0,
  origX: 0,
  origY: 0,
  layerId: null as string | null,
};

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
    dragState.dragging = false;
  },

  onPointerDown: (e: CanvasPointerEvent, ctx: ToolContext) => {
    const pt = getPixelCoords(e, ctx);
    if (!pt) return;

    const size = getBaseImageSize();
    if (!size) return;

    const store = useEditorStore.getState();
    const activeLayer = store.layers.find((l) => l.id === store.activeLayerId);

    // If the active layer is a text layer, start dragging to reposition
    if (activeLayer?.type === 'text' && activeLayer.textMeta) {
      dragState.dragging = true;
      dragState.startX = pt.x;
      dragState.startY = pt.y;
      dragState.origX = activeLayer.textMeta.x;
      dragState.origY = activeLayer.textMeta.y;
      dragState.layerId = activeLayer.id;
      return;
    }

    const meta: TextMeta = {
      text: textPanelConfig.text,
      fontSize: textPanelConfig.fontSize,
      fontFamily: textPanelConfig.fontFamily,
      color: textPanelConfig.color,
      fontWeight: textPanelConfig.fontWeight,
      fontStyle: textPanelConfig.fontStyle,
      x: pt.x,
      y: pt.y,
    };

    const offscreen = renderTextToCanvas(meta, size.width, size.height);

    const id = crypto.randomUUID();
    CanvasRegistry.register(id, offscreen);

    const textCount = store.layers.filter((l) => l.type === 'text').length;
    store.addLayer({
      id,
      type: 'text',
      name: `Text ${textCount + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
      textMeta: meta,
    });

    store.bumpPixelVersion();
  },

  onPointerMove: (e: CanvasPointerEvent, ctx: ToolContext) => {
    if (!dragState.dragging || !dragState.layerId) return;

    const pt = getPixelCoords(e, ctx);
    if (!pt) return;

    const dx = pt.x - dragState.startX;
    const dy = pt.y - dragState.startY;

    const store = useEditorStore.getState();
    const layer = store.layers.find((l) => l.id === dragState.layerId);
    if (!layer?.textMeta) return;

    const newMeta: TextMeta = {
      ...layer.textMeta,
      x: dragState.origX + dx,
      y: dragState.origY + dy,
    };

    store.updateLayer(dragState.layerId, { textMeta: newMeta });
    reRenderTextLayer(dragState.layerId, newMeta);
  },

  onPointerUp: () => {
    dragState.dragging = false;
    dragState.layerId = null;
  },
};
