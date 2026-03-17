import { useRef, useCallback, useState, useEffect } from 'react';
import { getParamRange } from '@/lib/param-ranges';
import { useGraphAdjustmentParam } from '@/lib/use-graph-adjustment';
import { editorDocument } from '@/core/document';

interface NodeScrubberProps {
  nodeType: string;
  adjustmentId: string;
  paramKey: string;
  label: string;
}

/** Movement threshold (px) to distinguish click from drag */
const DRAG_THRESHOLD = 3;

/**
 * Scrubber: drag-to-adjust a parameter value inline.
 * Click (without drag) → editable text input.
 * Click+drag horizontally → scrub value. Shift = 10x precision.
 * Double-click → reset to default.
 */
export function NodeScrubber({ nodeType, adjustmentId, paramKey, label }: NodeScrubberProps) {
  const range = getParamRange(nodeType, paramKey);
  const [value, setValue] = useGraphAdjustmentParam(adjustmentId, paramKey, range.default);
  const scrubRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startXRef = useRef(0);
  const startValueRef = useRef(0);
  const isDraggingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const formatValue = range.format ?? ((v: number) => {
    const sign = v > 0 ? '+' : '';
    return `${sign}${Math.round(v)}`;
  });

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    e.stopPropagation();
    const el = scrubRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startValueRef.current = value;
    isDraggingRef.current = false;
  }, [value, editing]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    if (!scrubRef.current?.hasPointerCapture(e.pointerId)) return;

    const deltaX = e.clientX - startXRef.current;

    if (!isDraggingRef.current) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD) return;
      isDraggingRef.current = true;
    }

    const sensitivity = e.shiftKey ? 0.1 : 1;
    const range_ = range.max - range.min;
    const newValue = startValueRef.current + (deltaX * sensitivity * range_) / 300;
    const clamped = Math.max(range.min, Math.min(range.max, newValue));

    if (!editorDocument.hasActiveInteraction) {
      editorDocument.beginInteraction(`Scrub ${label}`);
    }
    editorDocument.tickInteraction();
    setValue(range.step != null ? Math.round(clamped / range.step) * range.step : clamped);
  }, [range, label, setValue, editing]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    if (scrubRef.current?.hasPointerCapture(e.pointerId)) {
      scrubRef.current.releasePointerCapture(e.pointerId);
    }
    if (isDraggingRef.current) {
      editorDocument.endInteraction();
    } else {
      // Click without drag → enter edit mode
      setEditValue(String(Math.round(value * 100) / 100));
      setEditing(true);
    }
    isDraggingRef.current = false;
  }, [value, editing]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (editing) return;
    setValue(range.default);
    editorDocument.endInteraction();
  }, [range.default, setValue, editing]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      setValue(Math.max(range.min, Math.min(range.max, parsed)));
    }
  }, [editValue, range, setValue]);

  // Auto-focus + select on entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const isDefault = Math.abs(value - range.default) < 0.01;

  return (
    <div className="flex items-center justify-between px-3 py-1 border-b border-separator last:border-b-0 nodrag">
      <span className="text-[10px] text-text-secondary select-none">{label}</span>
      {editing ? (
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
          className="w-12 text-right text-[10px] tabular-nums bg-surface-secondary border border-separator rounded-sm px-1 py-0 text-text-primary outline-none focus:border-accent nodrag"
        />
      ) : (
        <div
          ref={scrubRef}
          className="text-[10px] tabular-nums select-none cursor-ew-resize px-1 rounded hover:bg-surface-secondary transition-colors"
          style={{ color: isDefault ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          {formatValue(value)}
        </div>
      )}
    </div>
  );
}
