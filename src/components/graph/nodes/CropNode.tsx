import { memo, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Crop, Eye, EyeOff } from 'lucide-react';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import type { CropMeta } from '@/store/layer-slice';
import type { ProcessingNodeData } from '@/types/graph';

function CropNodeInner({ id, data, selected }: NodeProps & { data: ProcessingNodeData }) {
  const isHighlighted = useEditorStore((s) => s.highlightedNodeId === id);
  const setHighlightedNode = useEditorStore((s) => s.setHighlightedNode);

  // Read cropMeta from the layer
  const cropMeta = useEditorStore((s) => {
    if (!data.layerId) return undefined;
    return s.layers.find((l) => l.id === data.layerId)?.cropMeta;
  });

  const hasCrop = !!cropMeta;
  const setEditorMode = useEditorStore((s) => s.setEditorMode);

  // Store last cropMeta so we can re-enable after disabling
  const lastCropRef = useRef<CropMeta | undefined>(cropMeta);
  if (cropMeta) lastCropRef.current = cropMeta;

  const toggleCrop = () => {
    if (!data.layerId) return;
    const layerId = data.layerId;
    if (hasCrop) {
      // Disable: clear cropMeta (undoable)
      editorDocument.recordAction('Disable Crop', () => {
        useEditorStore.getState().updateLayer(layerId, { cropMeta: undefined });
      });
    } else if (lastCropRef.current) {
      // Re-enable: restore last known crop
      const restored = lastCropRef.current;
      editorDocument.recordAction('Enable Crop', () => {
        useEditorStore.getState().updateLayer(layerId, { cropMeta: restored });
      });
    }
  };

  // Format crop info for display
  const info = cropMeta
    ? `${Math.round(cropMeta.rw * 100)}% × ${Math.round(cropMeta.rh * 100)}%`
    : 'No crop';

  const rotation = cropMeta
    ? cropMeta.baseRotation + cropMeta.straighten
    : 0;

  return (
    <div
      className={`glass-panel transition-shadow ${
        isHighlighted ? 'ring-2 ring-accent shadow-lg' : selected ? 'ring-1 ring-accent/40' : ''
      }`}
      style={{ width: 160 }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <Crop size={12} className={`flex-none ${hasCrop ? 'text-accent' : 'text-text-secondary'}`} />
        <span
          className="text-[11px] font-medium text-text-primary truncate flex-1 cursor-default"
          onDoubleClick={(e) => {
            e.stopPropagation();
            // Double-click to enter crop mode
            setEditorMode('crop');
          }}
        >
          {data.label ?? 'Crop'}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); toggleCrop(); }}
          className="flex-none cursor-default hover:text-text-primary transition-colors"
        >
          {hasCrop ? (
            <Eye size={11} className="text-text-secondary" />
          ) : (
            <EyeOff size={11} className="text-text-secondary/40" />
          )}
        </button>
      </div>

      {hasCrop && (
        <div className="px-2.5 pb-2 text-[10px] text-text-secondary space-y-0.5">
          <div className="flex justify-between">
            <span>Region</span>
            <span className="tabular-nums">{info}</span>
          </div>
          {rotation !== 0 && (
            <div className="flex justify-between">
              <span>Rotation</span>
              <span className="tabular-nums">{rotation.toFixed(1)}°</span>
            </div>
          )}
          {(cropMeta?.flipX || cropMeta?.flipY) && (
            <div className="flex justify-between">
              <span>Flip</span>
              <span>{[cropMeta.flipX && 'H', cropMeta.flipY && 'V'].filter(Boolean).join('+')}</span>
            </div>
          )}
        </div>
      )}

      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const CropNode = memo(CropNodeInner);
