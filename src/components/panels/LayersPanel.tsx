import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  GripVertical,
  Sun,
  Spline,
  SlidersHorizontal,
  Thermometer,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Image,
  Paintbrush,
  Type,
} from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { LutRegistry } from '@/lib/lut-registry';
import type { Layer, LayerType, Adjustment, BlendMode } from '@/store/layer-slice';

const LAYER_TYPE_ICONS: Record<LayerType, typeof Sun> = {
  image: Image,
  brush: Paintbrush,
  text: Type,
};

const ADJUSTMENT_ICONS: Record<Adjustment['type'], typeof Sun> = {
  basic: Sun,
  curves: Spline,
  levels: SlidersHorizontal,
  kelvin: Thermometer,
  lut: Sparkles,
};

const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  'normal': 'Normal',
  'multiply': 'Multiply',
  'screen': 'Screen',
  'overlay': 'Overlay',
  'darken': 'Darken',
  'lighten': 'Lighten',
  'soft-light': 'Soft Light',
  'hard-light': 'Hard Light',
};

function OpacityInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) { el.focus(); el.select(); }
  }, []);

  const commit = () => {
    setEditing(false);
    const parsed = parseInt(text, 10);
    if (!isNaN(parsed)) {
      onChange(Math.max(0, Math.min(100, parsed)) / 100);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-10 text-right text-[10px] tabular-nums bg-surface-secondary border border-accent rounded-sm px-1 py-0 text-text-primary outline-none"
      />
    );
  }

  return (
    <span
      className="text-[10px] text-text-secondary tabular-nums w-7 text-right cursor-text hover:text-text-primary transition-colors"
      onClick={() => { setText(String(Math.round(value * 100))); setEditing(true); }}
    >
      {Math.round(value * 100)}%
    </span>
  );
}

const LAYER_BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light',
];

export function LayersPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const activeLayer = useEditorStore((s) => s.layers.find((l) => l.id === s.activeLayerId));
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);

  // Reverse so top layer shows first
  const sortedLayers = [...layers].sort((a, b) => b.order - a.order);

  return (
    <motion.div
      className="absolute top-12 left-2 bottom-8 z-20 w-48 glass-panel flex flex-col overflow-hidden"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator flex items-center justify-between">
        <span>Layers</span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              const id = crypto.randomUUID();
              useEditorStore.getState().addLayer({
                id,
                type: 'image',
                name: `Layer ${layers.length + 1}`,
                visible: true,
                opacity: 1,
                blendMode: 'normal',
                locked: false,
              });
            }}
            className="p-0.5 rounded hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
          >
            <Plus size={14} />
          </button>
          {activeLayerId && (
            <button
              onClick={() => removeLayer(activeLayerId)}
              className="p-0.5 rounded hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Opacity + Blend Mode for active layer */}
      {activeLayer && (
        <div className="px-2 py-1.5 border-b border-separator flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center justify-between flex-1 px-1.5 py-0.5 text-[10px]
                  bg-surface-secondary rounded-sm border border-separator
                  hover:bg-separator transition-colors text-text-primary capitalize cursor-default">
                  {activeLayer.blendMode.replace('-', ' ')}
                  <ChevronDown size={10} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="glass-panel p-1 min-w-[120px] z-50" sideOffset={4}>
                  {LAYER_BLEND_MODES.map((mode) => (
                    <DropdownMenu.Item
                      key={mode}
                      className={`px-2 py-0.5 text-[10px] rounded-sm cursor-pointer outline-none capitalize
                        ${activeLayer.blendMode === mode
                          ? 'bg-accent text-white'
                          : 'text-text-primary hover:bg-surface-secondary'
                        }`}
                      onSelect={() => updateLayer(activeLayerId!, { blendMode: mode })}
                    >
                      {mode.replace('-', ' ')}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <OpacityInput
              value={activeLayer.opacity}
              onChange={(v) => updateLayer(activeLayerId!, { opacity: v })}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence>
          {sortedLayers.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              isActive={layer.id === activeLayerId}
              onSelect={() => setActiveLayer(layer.id)}
              onToggleVisibility={() =>
                updateLayer(layer.id, { visible: !layer.visible })
              }
              onToggleLock={() =>
                updateLayer(layer.id, { locked: !layer.locked })
              }
              onDelete={() => removeLayer(layer.id)}
              onDuplicate={() => {
                const id = crypto.randomUUID();
                useEditorStore.getState().addLayer({
                  id,
                  type: layer.type,
                  name: `${layer.name} copy`,
                  visible: layer.visible,
                  opacity: layer.opacity,
                  blendMode: layer.blendMode,
                  locked: false,
                });
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

interface LayerRowProps {
  layer: Layer;
  isActive: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function LayerRow({
  layer,
  isActive,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onDelete,
  onDuplicate,
}: LayerRowProps) {
  const [expanded, setExpanded] = useState(true);
  const adjustments = layer.adjustmentStack.adjustments;

  const handleContextAction = useCallback(
    (action: string) => {
      switch (action) {
        case 'duplicate': onDuplicate(); break;
        case 'delete': onDelete(); break;
        case 'lock': onToggleLock(); break;
      }
    },
    [onDuplicate, onDelete, onToggleLock],
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <motion.div
          layout
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
        >
          {/* Pixel layer row */}
          <div
            className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer border-b border-separator
              transition-colors text-xs
              ${isActive ? 'bg-accent/10' : 'hover:bg-surface-secondary'}`}
            onClick={onSelect}
          >
            {adjustments.length > 0 ? (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="p-0 text-text-secondary/40 flex-shrink-0"
              >
                <ChevronRight
                  size={12}
                  className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
                />
              </button>
            ) : (
              <GripVertical size={12} className="text-text-secondary/40 flex-shrink-0 cursor-grab" />
            )}

            {layer.type === 'image' ? (
              <LayerThumbnail layerId={layer.id} visible={layer.visible} />
            ) : (
              (() => { const Icon = LAYER_TYPE_ICONS[layer.type]; return (
                <div className={`w-6 h-6 rounded-sm border flex-shrink-0 flex items-center justify-center
                  ${layer.visible ? 'border-separator bg-surface-secondary' : 'border-separator/50 bg-surface-secondary/50 opacity-50'}`}>
                  <Icon size={12} className="text-text-secondary" />
                </div>
              ); })()
            )}

            <span
              className={`flex-1 truncate ${
                layer.visible ? 'text-text-primary' : 'text-text-secondary'
              }`}
            >
              {layer.name}
            </span>

            <button
              onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
              className="p-0.5 rounded hover:bg-surface-secondary text-text-secondary flex-shrink-0"
            >
              {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          </div>

          {/* Adjustment layers (nested) */}
          {isActive && expanded && adjustments.length > 0 && (
            <div className="border-b border-separator">
              {adjustments.map((adj) => (
                <AdjustmentRow key={adj.id} layerId={layer.id} adjustment={adj} />
              ))}
            </div>
          )}
        </motion.div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="glass-panel p-1 min-w-[140px] z-50">
          <ContextMenu.Item
            className="px-2 py-1 text-xs text-text-primary hover:bg-surface-secondary rounded-sm outline-none cursor-pointer"
            onSelect={() => handleContextAction('duplicate')}
          >
            Duplicate Layer
          </ContextMenu.Item>
          <ContextMenu.Item
            className="px-2 py-1 text-xs text-text-primary hover:bg-surface-secondary rounded-sm outline-none cursor-pointer"
            onSelect={() => handleContextAction('lock')}
          >
            {layer.locked ? 'Unlock Layer' : 'Lock Layer'}
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px bg-separator my-1" />
          <ContextMenu.Item
            className="px-2 py-1 text-xs text-red-500 hover:bg-surface-secondary rounded-sm outline-none cursor-pointer"
            onSelect={() => handleContextAction('delete')}
          >
            Delete Layer
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function AdjustmentRow({ layerId, adjustment }: { layerId: string; adjustment: Adjustment }) {
  const updateMeta = useEditorStore((s) => s.updateAdjustmentMeta);
  const removeAdj = useEditorStore((s) => s.removeAdjustment);

  const Icon = ADJUSTMENT_ICONS[adjustment.type] ?? Sun;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateMeta(layerId, adjustment.id, { enabled: !adjustment.enabled });
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (adjustment.type === 'lut') {
      LutRegistry.remove(adjustment.id);
    }
    removeAdj(layerId, adjustment.id);
  };

  const handleBlendChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    updateMeta(layerId, adjustment.id, { blendMode: e.target.value as BlendMode });
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    updateMeta(layerId, adjustment.id, { opacity: parseFloat(e.target.value) });
  };

  return (
    <div className="group">
      <div
        className={`flex items-center gap-1 pl-5 pr-2 py-1 text-[11px] transition-colors
          ${adjustment.enabled ? 'text-text-primary' : 'text-text-secondary/50'}
          hover:bg-surface-secondary/40`}
      >
        <Icon size={11} className="flex-shrink-0 text-text-secondary" />

        <span className="flex-1 truncate">{adjustment.name}</span>

        {adjustment.opacity < 1 && (
          <span className="text-[9px] text-text-secondary tabular-nums">
            {Math.round(adjustment.opacity * 100)}%
          </span>
        )}

        <button
          onClick={handleToggle}
          className="p-0.5 rounded hover:bg-surface-secondary text-text-secondary flex-shrink-0"
        >
          {adjustment.enabled ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>

        <button
          onClick={handleRemove}
          className="p-0.5 rounded hover:bg-surface-secondary text-text-secondary flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Inline blend mode + opacity controls (only for non-normal or when interacting) */}
      {(adjustment.blendMode !== 'normal' || adjustment.opacity < 1) && (
        <div className="flex items-center gap-1 pl-5 pr-2 pb-1 text-[10px]" onClick={(e) => e.stopPropagation()}>
          <select
            value={adjustment.blendMode}
            onChange={handleBlendChange}
            className="bg-transparent text-text-secondary text-[10px] outline-none cursor-pointer"
          >
            {Object.entries(BLEND_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={adjustment.opacity}
            onChange={handleOpacityChange}
            className="flex-1 h-1 accent-accent"
          />
        </div>
      )}
    </div>
  );
}

function LayerThumbnail({ layerId, visible }: { layerId: string; visible: boolean }) {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    const working = CanvasRegistry.get(layerId);
    if (!working) return;

    const thumbW = 24;
    const thumbH = Math.round((working.height / working.width) * thumbW) || 24;
    const tmp = document.createElement('canvas');
    tmp.width = thumbW;
    tmp.height = thumbH;
    const ctx = tmp.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(working, 0, 0, thumbW, thumbH);
    setSrc(tmp.toDataURL());
  }, [layerId]);

  if (!src) {
    return (
      <div
        className={`w-6 h-6 rounded-sm border flex-shrink-0
          ${visible ? 'border-separator bg-surface-secondary' : 'border-separator/50 bg-surface-secondary/50'}`}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={`w-6 h-6 rounded-sm border flex-shrink-0 object-cover
        ${visible ? 'border-separator' : 'border-separator/50 opacity-50'}`}
    />
  );
}
