import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layers } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import type { ProcessingNodeData } from '@/types/graph';
import type { BlendMode } from '@/store/layer-slice';

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'soft-light', 'hard-light',
];

/** Movement threshold (px) to distinguish click from drag */
const DRAG_THRESHOLD = 3;

function BlendNodeInner({ id, data, selected }: NodeProps & { data: ProcessingNodeData }) {
  const isHighlighted = useGraphStore((s) => s.highlightedNodeId === id);
  const setHighlightedNode = useGraphStore((s) => s.setHighlightedNode);
  const layer = useEditorStore((s) =>
    data.layerId ? s.layers.find((l) => l.id === data.layerId) : undefined,
  );
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const blendMode = layer?.blendMode ?? 'normal';
  const opacity = layer?.opacity ?? 1;
  const opacityPct = Math.round(opacity * 100);

  // ── Blend mode dropdown ──────────────────────────────────────────
  const [showDropdown, setShowDropdown] = useState(false);

  const handleBlendModeChange = useCallback((mode: BlendMode) => {
    if (data.layerId) updateLayer(data.layerId, { blendMode: mode });
    setShowDropdown(false);
  }, [data.layerId, updateLayer]);

  // ── Opacity scrubber ─────────────────────────────────────────────
  const scrubRef = useRef<HTMLSpanElement>(null);
  const startXRef = useRef(0);
  const startValueRef = useRef(0);
  const isDraggingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    e.stopPropagation();
    scrubRef.current?.setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startValueRef.current = opacityPct;
    isDraggingRef.current = false;
  }, [opacityPct, editing]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (editing || !scrubRef.current?.hasPointerCapture(e.pointerId)) return;
    const deltaX = e.clientX - startXRef.current;
    if (!isDraggingRef.current) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD) return;
      isDraggingRef.current = true;
    }
    const sensitivity = e.shiftKey ? 0.1 : 1;
    const newPct = startValueRef.current + deltaX * sensitivity * (100 / 300);
    const clamped = Math.max(0, Math.min(100, newPct));
    if (data.layerId) updateLayer(data.layerId, { opacity: clamped / 100 });
  }, [data.layerId, updateLayer, editing]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    if (scrubRef.current?.hasPointerCapture(e.pointerId)) {
      scrubRef.current.releasePointerCapture(e.pointerId);
    }
    if (!isDraggingRef.current) {
      setEditValue(String(opacityPct));
      setEditing(true);
    }
    isDraggingRef.current = false;
  }, [opacityPct, editing]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.layerId) updateLayer(data.layerId, { opacity: 1 });
  }, [data.layerId, updateLayer]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed) && data.layerId) {
      updateLayer(data.layerId, { opacity: Math.max(0, Math.min(100, parsed)) / 100 });
    }
  }, [editValue, data.layerId, updateLayer]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  return (
    <div
      className={`glass-panel min-w-[160px] transition-shadow ${
        isHighlighted ? 'node-focused' : selected ? 'ring-1 ring-accent/40' : ''
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Layers size={14} className="text-accent flex-none" />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          {/* Blend mode — click to open dropdown */}
          <div className="relative nodrag">
            <span
              className="text-xs font-medium text-text-primary capitalize cursor-pointer hover:text-accent transition-colors"
              onClick={(e) => { e.stopPropagation(); setShowDropdown(!showDropdown); }}
              onDoubleClick={(e) => { e.stopPropagation(); setHighlightedNode(isHighlighted ? null : id); }}
            >
              {blendMode}
            </span>
            {showDropdown && (
              <div className="absolute top-full left-0 mt-1 z-50 glass-panel py-1 min-w-[120px] shadow-lg">
                {BLEND_MODES.map((mode) => (
                  <button
                    key={mode}
                    onClick={(e) => { e.stopPropagation(); handleBlendModeChange(mode); }}
                    className={`block w-full text-left px-3 py-1 text-[11px] capitalize transition-colors ${
                      mode === blendMode
                        ? 'text-accent bg-accent/10'
                        : 'text-text-primary hover:bg-surface-secondary'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Opacity — scrubber / editable input */}
          <div className="nodrag">
            {editing ? (
              <div className="flex items-center gap-0.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  className="w-10 text-right text-[10px] tabular-nums bg-surface-secondary border border-separator rounded-sm px-1 py-0 text-text-primary outline-none focus:border-accent"
                />
                <span className="text-[10px] text-text-secondary">%</span>
              </div>
            ) : (
              <span
                ref={scrubRef}
                className="text-[10px] text-text-secondary tabular-nums cursor-ew-resize select-none hover:text-text-primary transition-colors"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={handleDoubleClick}
              >
                {opacityPct}% opacity
              </span>
            )}
          </div>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="base"
        style={{ top: '30%' }}
        className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="overlay"
        style={{ top: '70%' }}
        className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white"
      />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const BlendNode = memo(BlendNodeInner);
