import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Plus, Trash2, GripVertical } from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useEditorStore } from '@/store';
import type { Layer } from '@/store/layer-slice';

export function LayersPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
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
          className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer border-b border-separator
            transition-colors text-xs
            ${isActive ? 'bg-accent/10' : 'hover:bg-surface-secondary'}`}
          onClick={onSelect}
        >
          <GripVertical size={12} className="text-text-secondary/40 flex-shrink-0 cursor-grab" />

          {/* Thumbnail placeholder */}
          <div
            className={`w-6 h-6 rounded-sm border flex-shrink-0
              ${layer.visible ? 'border-separator bg-surface-secondary' : 'border-separator/50 bg-surface-secondary/50'}`}
          />

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
