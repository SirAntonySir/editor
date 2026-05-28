import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  GripVertical,
  Sun,
  ChevronRight,
  ChevronDown,
  Image,
  Paintbrush,
  Type,
} from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { duplicateLayer } from '@/store/segment-actions';
import { SegmentRow } from './SegmentRow';
import type { BlendMode } from '@/types/adjustment';
import type { Layer } from '@/store/layer-slice';
import type { MaskSummary } from '@/types/widget';

// LayerType is `string` (extensible) — Record key is therefore widened.
// Unknown types fall back to Image at the access site.
const LAYER_TYPE_ICONS: Record<string, typeof Sun> = {
  image: Image,
  brush: Paintbrush,
  text: Type,
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

export function LayersPanelActions() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const removeLayer = useEditorStore((s) => s.removeLayer);

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
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
          onClick={(e) => {
            e.stopPropagation();
            removeLayer(activeLayerId);
          }}
          className="p-0.5 rounded hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
        >
          <Trash2 size={14} />
        </button>
      )}
    </>
  );
}

const EMPTY_MASKS: MaskSummary[] = [];

export function LayersPanelBody() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const activeLayer = useEditorStore((s) => s.layers.find((l) => l.id === s.activeLayerId));
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  // Backend snapshot owns the live mask index; segments nest under their image layer.
  const masks = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);

  const sortedLayers = [...layers].sort((a, b) => b.order - a.order);

  return (
    <div className="flex flex-col h-full">
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

      <div className="flex-1 overflow-y-auto min-h-0">
        <AnimatePresence>
          {sortedLayers.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              masks={masks}
              isActive={layer.id === activeLayerId}
              onSelect={() => {
                setActiveLayer(layer.id);
                useEditorStore.getState().setActiveScope({ kind: 'global' });
                useSegmentSelection.setState({ selectedSegmentId: null });
              }}
              onToggleVisibility={() =>
                updateLayer(layer.id, { visible: !layer.visible })
              }
              onToggleLock={() =>
                updateLayer(layer.id, { locked: !layer.locked })
              }
              onDelete={() => removeLayer(layer.id)}
              onDuplicate={() => duplicateLayer(layer.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface LayerRowProps {
  layer: Layer;
  masks: MaskSummary[];
  isActive: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function LayerRow({
  layer,
  masks,
  isActive,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onDelete,
  onDuplicate,
}: LayerRowProps) {
  const [expanded, setExpanded] = useState(true);
  // Segments only nest under image layers. In the single-image flow today,
  // all backend masks attach to the active image layer; once multi-image
  // lands the projection can filter by mask.layerId.
  const segmentsForLayer = layer.type === 'image' ? masks : [];

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
            {segmentsForLayer.length > 0 ? (
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
              (() => { const Icon = LAYER_TYPE_ICONS[layer.type] ?? Image; return (
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

          {/* Segments (nested under image layers) */}
          {isActive && expanded && segmentsForLayer.length > 0 && (
            <div className="border-b border-separator">
              {segmentsForLayer.map((m) => (
                <SegmentRow key={m.id} layerId={layer.id} mask={m} />
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
