import { memo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Crop, Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import { useCropEditingStore } from '@/store/crop-editing-slice';
import { editorDocument } from '@/core/document';
import { useNodePreview } from '@/hooks/useNodePreview';
import type { CropMeta } from '@/store/layer-slice';
import type { ProcessingNodeData } from '@/types/graph';

const THUMB_W = 160;
const THUMB_DEBOUNCE = 300;

function CropNodeInner({ id, data, selected }: NodeProps & { data: ProcessingNodeData }) {
  const isHighlighted = useGraphStore((s) => s.highlightedNodeId === id);
  const [showThumb, setShowThumb] = useState(true);

  const cropMeta = useEditorStore((s) => {
    if (!data.layerId) return undefined;
    return s.layers.find((l) => l.id === data.layerId)?.cropMeta;
  });

  const hasCrop = !!cropMeta;
  const setIsCropEditing = useCropEditingStore((s) => s.setIsCropEditing);

  const lastCropRef = useRef<CropMeta | undefined>(cropMeta);
  if (cropMeta) lastCropRef.current = cropMeta;

  const thumbRef = useRef<HTMLCanvasElement>(null);
  const { height: thumbH } = useNodePreview(
    thumbRef, 'crop', data.layerId, undefined, THUMB_W, THUMB_DEBOUNCE,
  );

  const toggleCrop = () => {
    if (!data.layerId) return;
    const layerId = data.layerId;
    if (hasCrop) {
      editorDocument.recordAction('Disable Crop', () => {
        useEditorStore.getState().updateLayer(layerId, { cropMeta: undefined });
      });
    } else if (lastCropRef.current) {
      const restored = lastCropRef.current;
      editorDocument.recordAction('Enable Crop', () => {
        useEditorStore.getState().updateLayer(layerId, { cropMeta: restored });
      });
    }
  };

  const info = cropMeta
    ? `${Math.round(cropMeta.rw * 100)}% \u00d7 ${Math.round(cropMeta.rh * 100)}%`
    : 'No crop';

  const rotation = cropMeta
    ? cropMeta.baseRotation + cropMeta.straighten
    : 0;

  return (
    <div
      className={`glass-panel transition-shadow ${
        isHighlighted ? 'node-focused' : selected ? 'ring-1 ring-accent/40' : ''
      }`}
      style={{ width: THUMB_W }}
    >
      {showThumb && (
        <canvas
          ref={thumbRef}
          className="block rounded-t-[inherit]"
          style={{ width: THUMB_W, height: thumbH }}
        />
      )}

      <div className="flex items-center gap-1.5 px-2.5 py-2 nodrag">
        <Crop size={12} className={`flex-none ${hasCrop ? 'text-accent' : 'text-text-secondary'}`} />
        <span
          className="text-[11px] font-medium text-text-primary truncate flex-1 cursor-default"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setIsCropEditing(true);
          }}
        >
          {data.label ?? 'Crop'}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setShowThumb(!showThumb); }}
          className="flex-none cursor-default hover:text-text-primary transition-colors"
        >
          {showThumb ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
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
              <span className="tabular-nums">{rotation.toFixed(1)}&deg;</span>
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
