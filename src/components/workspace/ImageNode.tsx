import { Image, Split } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ImageNodeBody } from './ImageNodeBody';
import { ImageNodeSelectionPopover } from './ImageNodeSelectionPopover';
import { editorDocument } from '@/core/document';

export interface ImageNodeData extends Record<string, unknown> {
  name?: string;
  layerIds: string[];
  size: { w: number; h: number };
  activeLayerIndex?: number;
}

interface ImageNodeProps {
  id: string;
  data: ImageNodeData;
  selected: boolean;
}

export function ImageNode({ id, data, selected }: ImageNodeProps) {
  const stacked = data.layerIds.length > 1;
  const showStrip = stacked && selected;
  const canSplit = data.layerIds.length >= 2;

  function handleSplit() {
    if (!canSplit) return;
    const lastLayerId = data.layerIds[data.layerIds.length - 1];
    editorDocument.workspace.splitImageNode(id, lastLayerId);
  }

  function handleDelete() {
    editorDocument.workspace.removeImageNode(id);
  }

  return (
    <div className="relative" style={{ width: data.size.w + 2 /* outer border */ }}>
      <div
        className={`overlay overflow-hidden ${selected ? 'outline-2 outline outline-accent -outline-offset-1' : ''}`}
      >
        <ImageNodeSelectionPopover layerIds={data.layerIds}>
          <div className="flex items-center gap-1.5 px-2 py-1 border-b border-separator">
            <Image size={11} className="text-text-secondary" aria-hidden />
            <span className="text-[10px] font-medium flex-1 truncate">{data.name ?? 'Image'}</span>
            <span className="text-[8px] font-semibold bg-surface-secondary border border-separator rounded-full px-1.5 py-px text-text-secondary uppercase">
              {data.layerIds.length} LAYER{data.layerIds.length === 1 ? '' : 'S'}
            </span>
          </div>
        </ImageNodeSelectionPopover>
        <ImageNodeBody imageNodeId={id} layerIds={data.layerIds} width={data.size.w} height={data.size.h} />
        <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] text-text-secondary border-t border-separator">
          <span className="num">{data.size.w} × {data.size.h}</span>
          <span className="flex-1" />
          <span>Layer {(data.activeLayerIndex ?? 0) + 1}</span>
        </div>
        {showStrip && (
          <div aria-label="Layer strip" className="flex gap-1 px-2 py-1 bg-surface-secondary border-t border-separator">
            {data.layerIds.map((lid, i) => (
              <div
                key={lid}
                className={`flex-1 h-[18px] rounded-[3px] border border-separator bg-surface ${i === (data.activeLayerIndex ?? 0) ? 'outline-[1.5px] outline outline-accent' : ''}`}
              />
            ))}
          </div>
        )}
      </div>
      {selected && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Split or merge"
              className="absolute -top-2 -right-2 w-[18px] h-[18px] rounded-full bg-surface border border-border-strong shadow-[0_2px_6px_rgba(0,0,0,0.06)] flex items-center justify-center text-text-secondary"
            >
              <Split size={10} aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="overlay p-1 min-w-[140px] z-50" sideOffset={4} align="end">
              <DropdownMenu.Item
                className={`px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
                  ${canSplit
                    ? 'text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary'
                    : 'text-text-tertiary cursor-not-allowed'
                  }`}
                disabled={!canSplit}
                onSelect={handleSplit}
              >
                Split last layer
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
                  text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
                onSelect={handleDelete}
              >
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <Handle type="source" position={Position.Left} id="tether-out" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="tether-in" style={{ opacity: 0 }} />
    </div>
  );
}
