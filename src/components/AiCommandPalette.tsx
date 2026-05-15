import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ChevronDown } from 'lucide-react';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import { LayerCompositor } from '@/lib/layer-compositor';
import { PipelineManager } from '@/lib/pipeline-manager';
import { resolveSmartTarget, humanLabelFor } from '@/lib/target-ref';
import { targetRefEquals } from '@/types/ai-target';
import { setPaletteSeed } from '@/lib/palette-bus';
import type { TargetRef, InsertionIntent } from '@/types/ai-target';

interface AiCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void | Promise<void>;
  disabled?: boolean;
  initialTarget?: TargetRef;
  initialIntent?: InsertionIntent;
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

function buildTargetOptions(): { ref: TargetRef; label: string }[] {
  const layers = useEditorStore.getState().layers.filter((l) => l.type !== 'ai-panel');
  const out: { ref: TargetRef; label: string }[] = [];
  for (const layer of layers) {
    out.push({ ref: { kind: 'layer', layerId: layer.id }, label: layer.name });
    for (const adj of layer.adjustmentStack?.adjustments ?? []) {
      out.push({
        ref: { kind: 'node', layerId: layer.id, adjustmentId: adj.id },
        label: `${layer.name} · ${adj.name}`,
      });
    }
  }
  out.push({ ref: { kind: 'composite' }, label: 'Whole composite' });
  return out;
}

function previewCanvasFor(target: TargetRef): HTMLCanvasElement | OffscreenCanvas | null {
  if (target.kind === 'composite') {
    const c = LayerCompositor.compositeSync();
    return c.width > 0 ? c : null;
  }
  const layer = useEditorStore.getState().layers.find((l) => l.id === target.layerId);
  if (layer) {
    const rendered = LayerCompositor.renderLayer(layer);
    if (rendered && rendered.width > 0) return rendered;
  }
  const out = PipelineManager.getOutput();
  if (out && out.width > 0) return out;
  return 'layerId' in target ? (pixelStore.getSource(target.layerId) ?? null) : null;
}

export function AiCommandPalette({
  open,
  onClose,
  onSubmit,
  disabled,
  initialTarget,
  initialIntent,
}: AiCommandPaletteProps) {
  const context = useAiSession((s) => s.context);
  const candidateRegions = context?.candidateRegions ?? [];
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const baseDimsRef = useRef<{ w: number; h: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState('');
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<TargetRef>(() => initialTarget ?? resolveSmartTarget());
  const [targetIntent] = useState<InsertionIntent>(initialIntent ?? 'append');
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  // Mirror the AI session status so we can show "Analysing…" while a
  // reanalyse triggered by stale-fingerprint runs.
  const aiStatus = useAiSession((s) => s.status);

  // Re-resolve target when palette opens (in case selection changed since last open).
  useEffect(() => {
    if (open && !initialTarget) {
      setTarget(resolveSmartTarget());
    }
  }, [open, initialTarget]);

  useEffect(() => {
    if (open) {
      setValue('');
      setHoveredLabel(null);
      setBusy(false);
      setTargetPickerOpen(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Escape closes the palette; also closes the picker first if it's open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (targetPickerOpen) {
          setTargetPickerOpen(false);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, targetPickerOpen]);

  // ⌘T cycles forward through targets.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        const opts = buildTargetOptions();
        const idx = opts.findIndex((o) => targetRefEquals(o.ref, target));
        const next = opts[(idx + 1) % opts.length];
        if (next) commitTargetChange(next.ref);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  // Outside-click closes the target picker dropdown.
  useEffect(() => {
    if (!targetPickerOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTargetPickerOpen(false);
      }
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => window.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [targetPickerOpen]);

  // Single source of truth: paints base + hover overlay together.
  useEffect(() => {
    if (!open) return;
    const canvas = previewRef.current;
    if (!canvas) return;

    function paint() {
      const source = previewCanvasFor(target);
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
  }, [open, target, pixelVersion, hoveredLabel, candidateRegions]);

  function commitTargetChange(next: TargetRef) {
    setTarget(next);
    setPaletteSeed({ target: next, intent: targetIntent });
  }

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled || busy) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
    } finally {
      setBusy(false);
      onClose();
    }
  }

  const statusHint = (() => {
    if (!busy) return null;
    if (aiStatus === 'uploading') return 'Uploading image…';
    if (aiStatus === 'analysing') return 'Re-analysing image…';
    return 'Generating panel…';
  })();

  const targetOptions = buildTargetOptions();
  const hasLayers = useEditorStore.getState().layers.some((l) => l.type !== 'ai-panel');

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
              {/* Target chip header */}
              <div className="flex items-center gap-2 px-1 py-1 border-b border-border/40 text-[11px]">
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 hover:bg-accent/25 px-2.5 py-1 text-xs text-text-primary transition-colors"
                    onClick={() => setTargetPickerOpen((v) => !v)}
                    title="Change AI target (⌘T)"
                  >
                    <span aria-hidden>🎯</span>
                    <span>{humanLabelFor(target)}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>

                  <AnimatePresence>
                    {targetPickerOpen && (
                      <motion.div
                        className="absolute left-0 top-full mt-1 z-50 glass-panel flex flex-col gap-0.5 p-1 min-w-[220px] max-h-[260px] overflow-y-auto"
                        initial={{ opacity: 0, scale: 0.96, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -4 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      >
                        {!hasLayers && (
                          <div className="px-2 py-1 text-[11px] text-text-secondary">
                            No layers available
                          </div>
                        )}
                        {targetOptions.map((opt) => {
                          const isActive = targetRefEquals(opt.ref, target);
                          return (
                            <button
                              key={JSON.stringify(opt.ref)}
                              type="button"
                              className={[
                                'flex items-center gap-2 rounded px-2 py-1 text-[12px] text-left transition-colors',
                                isActive
                                  ? 'bg-accent/30 text-text-primary'
                                  : 'text-text-secondary hover:bg-accent/15 hover:text-text-primary',
                                opt.ref.kind === 'node' ? 'pl-5' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onClick={() => {
                                commitTargetChange(opt.ref);
                                setTargetPickerOpen(false);
                              }}
                            >
                              {isActive && (
                                <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-accent" />
                              )}
                              <span className={isActive ? '' : 'ml-3.5'}>{opt.label}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <span className="text-text-secondary text-[10px]">
                  {targetIntent === 'splice' ? 'splice' : 'append'}
                </span>
              </div>

              {/* Preview canvas */}
              <div className="flex items-center justify-center">
                <canvas
                  ref={previewRef}
                  className="rounded-md bg-surface-secondary/40"
                />
              </div>

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

              <form onSubmit={handleSubmit} className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Describe your edit…"
                  disabled={disabled || busy}
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary outline-none disabled:opacity-50"
                />
                {statusHint && (
                  <span className="text-[11px] text-text-secondary">{statusHint}</span>
                )}
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Tooltip.Provider>
  );
}
