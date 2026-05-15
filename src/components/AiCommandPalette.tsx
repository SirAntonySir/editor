import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import { pixelStore } from '@/core/pixel-store';
import { LayerCompositor } from '@/lib/layer-compositor';

interface AiCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

const IMAGE_MAX_HEIGHT = 560;
const IMAGE_MAX_WIDTH = 720;

/** Deterministic hue (0–360) per label. Stable across reloads, distinct
 *  per word, no palette setup required. */
function hueForLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/**
 * Choose what to show in the palette preview. Priority:
 *  1. In graph mode with a highlighted node — that node's output.
 *  2. Final composited canvas (= what the user sees, includes crop + edits).
 *  3. Raw layer source as last resort.
 */
function pickPreviewSource(
  imageLayerId: string | undefined,
  highlightedNodeId: string | null,
  editorMode: string,
): HTMLCanvasElement | OffscreenCanvas | null {
  if (editorMode === 'graph' && highlightedNodeId) {
    if (highlightedNodeId.startsWith('source:')) {
      const lid = highlightedNodeId.slice('source:'.length);
      const src = pixelStore.getSource(lid);
      if (src && src.width > 0) return src;
    }
    // crop:, blend:, output:, adjustment defId: — all show the final composite.
    // (A finer per-node preview is the same logic useNodePreview does; once
    // we extract that into a shared helper this branch can call it.)
  }
  const composite = LayerCompositor.compositeSync();
  if (composite.width > 0 && composite.height > 0) return composite;
  return imageLayerId ? (pixelStore.getSource(imageLayerId) ?? null) : null;
}

export function AiCommandPalette({ open, onClose, onSubmit, disabled }: AiCommandPaletteProps) {
  const context = useAiSession((s) => s.context);
  const candidateRegions = context?.candidateRegions ?? [];
  const imageLayerId = useEditorStore((s) => s.layers.find((l) => l.type === 'image')?.id);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const editorMode = useEditorStore((s) => s.editorMode);
  const highlightedNodeId = useGraphStore((s) => s.highlightedNodeId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const baseDimsRef = useRef<{ w: number; h: number } | null>(null);
  const [value, setValue] = useState('');
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setHoveredLabel(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Single source of truth: paints base + hover overlay together.
  useEffect(() => {
    if (!open) return;
    const canvas = previewRef.current;
    if (!canvas) return;

    function paint() {
      const source = pickPreviewSource(imageLayerId, highlightedNodeId, editorMode);
      if (!source || source.width === 0 || source.height === 0) return;
      const ratio = source.height / source.width;
      let w = IMAGE_MAX_WIDTH;
      let h = Math.round(w * ratio);
      if (h > IMAGE_MAX_HEIGHT) {
        h = IMAGE_MAX_HEIGHT;
        w = Math.round(h / ratio);
      }
      if (!canvas) return;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);
      baseDimsRef.current = { w, h };

      if (!hoveredLabel) return;
      const region = candidateRegions.find((r) => r.label === hoveredLabel);
      if (!region) return;
      const hue = hueForLabel(region.label);
      const stroke = `hsl(${hue}, 85%, 65%)`;
      const fill = `hsla(${hue}, 85%, 60%, 0.18)`;
      if (region.bbox) {
        const [nx, ny, nw, nh] = region.bbox;
        const x = nx * w;
        const y = ny * h;
        const rw = nw * w;
        const rh = nh * h;
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, rw, rh);
      }
      if (region.representativePoint) {
        const [px, py] = region.representativePoint;
        ctx.beginPath();
        ctx.arc(px * w, py * h, 5, 0, Math.PI * 2);
        ctx.fillStyle = stroke;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    paint();
    // Live-update when the compositor produces new output (crop committed,
    // slider dragged, layer visibility toggled, etc).
    const unsub = LayerCompositor.subscribe(() => paint());
    return () => unsub();
  }, [open, imageLayerId, pixelVersion, hoveredLabel, candidateRegions, highlightedNodeId, editorMode]);

  function insertToken(label: string) {
    const input = inputRef.current;
    const token = `@${label}`;
    if (!input) {
      setValue((v) => (v ? `${v.replace(/\s+$/, '')} ${token} ` : `${token} `));
      return;
    }
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    const prefix = value.slice(0, start);
    const suffix = value.slice(end);
    const lead = prefix.length > 0 && !/\s$/.test(prefix) ? ' ' : '';
    const trail = suffix.length > 0 && !/^\s/.test(suffix) ? ' ' : ' ';
    const inserted = `${lead}${token}${trail}`;
    const next = prefix + inserted + suffix;
    setValue(next);
    requestAnimationFrame(() => {
      input.focus();
      const caret = prefix.length + inserted.length;
      input.setSelectionRange(caret, caret);
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
    onClose();
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto pt-[8vh] pb-[4vh] bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <motion.div
              className="glass-panel flex w-[760px] max-w-[92vw] flex-col gap-2 p-3"
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              {imageLayerId && (
                <div className="flex items-center justify-center">
                  <canvas
                    ref={previewRef}
                    className="rounded-md bg-surface-secondary/40"
                  />
                </div>
              )}

              {candidateRegions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {candidateRegions.map((region) => {
                    const hue = hueForLabel(region.label);
                    const isHovered = hoveredLabel === region.label;
                    return (
                      <Tooltip.Root key={region.label}>
                        <Tooltip.Trigger asChild>
                          <button
                            type="button"
                            onClick={() => insertToken(region.label)}
                            onMouseEnter={() => setHoveredLabel(region.label)}
                            onMouseLeave={() => setHoveredLabel((l) => (l === region.label ? null : l))}
                            onFocus={() => setHoveredLabel(region.label)}
                            onBlur={() => setHoveredLabel((l) => (l === region.label ? null : l))}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] text-text-primary transition-colors"
                            style={{
                              background: `hsla(${hue}, 80%, 60%, ${isHovered ? 0.45 : 0.22})`,
                              boxShadow: isHovered ? `inset 0 0 0 1px hsla(${hue}, 85%, 70%, 0.9)` : 'none',
                            }}
                          >
                            @{region.label}
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content
                            side="bottom"
                            sideOffset={4}
                            className="glass-panel z-[60] max-w-[240px] px-2 py-1 text-[11px] text-text-secondary"
                          >
                            {region.description}
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    );
                  })}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Describe your edit…"
                  disabled={disabled}
                  className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-secondary outline-none"
                />
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Tooltip.Provider>
  );
}
