import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ChevronDown, Crosshair, ArrowUp, Check } from 'lucide-react';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { pixelStore } from '@/core/pixel-store';
import { LayerCompositor } from '@/lib/layer-compositor';
import { PipelineManager } from '@/lib/pipeline-manager';
import { resolveSmartTarget, humanLabelFor } from '@/lib/target-ref';
import { targetRefEquals } from '@/types/ai-target';
import { setPaletteSeed } from '@/lib/palette-bus';
import type { TargetRef, InsertionIntent } from '@/types/ai-target';
import type { CandidateRegion, RegionPolygon } from '@/types/image-context';

interface AiCommandPaletteProps {
  onSubmit: (text: string) => void | Promise<void>;
  disabled?: boolean;
  initialTarget?: TargetRef;
  initialIntent?: InsertionIntent;
}

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

/**
 * Build a Path2D from normalised-coordinate polygons, scaled to a canvas of
 * (destW × destH). Multiple polygons are appended into one path so a single
 * fill/stroke covers them all (even-odd rule cuts out nested holes).
 */
function buildRegionPath(paths: RegionPolygon[], destW: number, destH: number): Path2D {
  const path = new Path2D();
  for (const poly of paths) {
    if (poly.length < 3) continue;
    path.moveTo(poly[0][0] * destW, poly[0][1] * destH);
    for (let i = 1; i < poly.length; i++) {
      path.lineTo(poly[i][0] * destW, poly[i][1] * destH);
    }
    path.closePath();
  }
  return path;
}

/** Fill + stroke a region's polygon path in the chip's hue. */
function paintRegionPaths(
  ctx: CanvasRenderingContext2D,
  paths: RegionPolygon[],
  hue: number,
  destW: number,
  destH: number,
): void {
  const path = buildRegionPath(paths, destW, destH);
  ctx.fillStyle = `hsla(${hue}, 85%, 60%, 0.4)`;
  ctx.fill(path, 'evenodd');
  ctx.strokeStyle = `hsl(${hue}, 85%, 65%)`;
  ctx.lineWidth = 2;
  ctx.stroke(path);
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
  onSubmit,
  disabled,
  initialTarget,
  initialIntent,
}: AiCommandPaletteProps) {
  // Persistent in-sidebar palette — always "open" for effects gating.
  const open = true;
  const context = useAiSession((s) => s.context);
  // Only show chips for regions where SAM produced polygon paths — bbox-only
  // regions can't be rendered as the overlay any more and would feel hollow.
  const candidateRegions = (context?.candidateRegions ?? []).filter(
    (r) => r.paths && r.paths.length > 0,
  );
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
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
  // Preview canvas bleeds full panel width (preview is the only section
  // without horizontal padding). Subtract 1px for the inner border.
  const sidebarWidth = usePreferencesStore((s) => s.rightSidebarWidth);
  const previewMaxW = Math.max(160, sidebarWidth - 1);

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

  // Escape closes the target picker (the palette itself is always-on).
  useEffect(() => {
    if (!open || !targetPickerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setTargetPickerOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, targetPickerOpen]);

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

    // Persistent sidebar palette — preview fits the (resizable) sidebar.
    // Keep the preview from dominating tall panels by capping height
    // proportionally; full sidebar width otherwise.
    const maxW = previewMaxW;
    const maxH = Math.min(420, Math.round(previewMaxW * 0.95));

    function paint() {
      const source = previewCanvasFor(target);
      if (!source || source.width === 0 || source.height === 0) return;
      const ratio = source.height / source.width;
      let w = maxW;
      let h = Math.round(w * ratio);
      if (h > maxH) {
        h = maxH;
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
      if (region.paths && region.paths.length > 0) {
        paintRegionPaths(ctx, region.paths, hue, w, h);
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
  }, [open, target, pixelVersion, hoveredLabel, candidateRegions, previewMaxW]);

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

  const armMaskFromRegion = useCallback((region: CandidateRegion) => {
    if (!region.maskRef) return;
    useEditorStore.getState().setActiveMask(region.maskRef);
    useEditorStore.getState().commitMask();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled || busy) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      setValue('');
    } finally {
      setBusy(false);
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

  const canSubmit = value.trim().length > 0 && !disabled && !busy;

  const body = (
    <>
      {/* Preview canvas — bleeds to the panel edges, viewport-style */}
      <div className="bg-canvas-bg border-b border-separator flex items-center justify-center">
        <canvas ref={previewRef} className="block" />
      </div>

      {/* Target chip — calm pill, intent folded inside */}
      <div className="px-3 pt-3">
        <div className="relative inline-block" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setTargetPickerOpen((v) => !v)}
            title="Change AI target (⌘T)"
            className="inline-flex items-center gap-1.5 rounded-md border border-separator
              bg-surface-secondary/60 hover:bg-surface-secondary px-2 py-1 text-[11px]
              text-text-primary transition-colors cursor-default"
          >
            <Crosshair size={11} className="text-text-secondary" />
            <span className="truncate max-w-[160px]">{humanLabelFor(target)}</span>
            <span className="text-text-secondary/70 text-[10px]">
              · {targetIntent === 'splice' ? 'splice' : 'append'}
            </span>
            <ChevronDown size={11} className="text-text-secondary" />
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
                          ? 'bg-accent/20 text-text-primary'
                          : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary',
                        opt.ref.kind === 'node' ? 'pl-5' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        commitTargetChange(opt.ref);
                        setTargetPickerOpen(false);
                      }}
                    >
                      {isActive ? (
                        <Check size={11} className="shrink-0 text-accent" />
                      ) : (
                        <span className="w-[11px] shrink-0" />
                      )}
                      <span className="truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Suggested regions — chip border carries the per-region hue */}
      {candidateRegions.length > 0 && (
        <div className="px-3 flex flex-wrap gap-1.5">
          {candidateRegions.map((region) => {
            const hue = hueForLabel(region.label);
            const isHovered = hoveredLabel === region.label;
            return (
              <Tooltip.Root key={region.label}>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      if (e.shiftKey) {
                        armMaskFromRegion(region);
                        return;
                      }
                      insertToken(region.label);
                    }}
                    onMouseEnter={() => setHoveredLabel(region.label)}
                    onMouseLeave={() => setHoveredLabel((l) => (l === region.label ? null : l))}
                    onFocus={() => setHoveredLabel(region.label)}
                    onBlur={() => setHoveredLabel((l) => (l === region.label ? null : l))}
                    title="Click to add to prompt · Shift-click to use as selection"
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px]
                      transition-colors cursor-default
                      ${isHovered ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                    style={{
                      borderColor: `hsla(${hue}, 75%, 60%, ${isHovered ? 0.95 : 0.5})`,
                      background: isHovered
                        ? `hsla(${hue}, 70%, 55%, 0.12)`
                        : 'transparent',
                    }}
                  >
                    <span className="truncate max-w-[140px]">@{region.label}</span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="bottom"
                    sideOffset={6}
                    className="glass-panel z-[60] max-w-[240px] px-2 py-1 text-[11px] text-text-secondary shadow-lg"
                  >
                    {region.description}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}
        </div>
      )}

      {/* Composer — multi-line textarea pinned to the bottom, fills remaining height */}
      <form
        onSubmit={handleSubmit}
        className="flex-1 min-h-[140px] flex flex-col px-3 pb-3 pt-1"
      >
        <div className="flex-1 flex flex-col rounded-md border border-separator
          bg-surface-secondary/60 transition-colors
          focus-within:border-accent/60 focus-within:bg-surface-secondary overflow-hidden">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit(e as unknown as FormEvent);
              }
            }}
            placeholder="Describe your edit…"
            disabled={disabled || busy}
            data-palette-input="sidebar"
            className="flex-1 resize-none bg-transparent px-2 pt-2 pb-1 text-sm
              text-text-primary placeholder:text-text-secondary outline-none disabled:opacity-50"
          />
          <div className="flex-none flex items-center justify-between gap-2 border-t border-separator/60 px-2 py-1">
            <span className="text-[10px] text-text-secondary/80 truncate">
              {statusHint ?? <span className="text-text-secondary/50">⏎ newline · ⌘⏎ send</span>}
            </span>
            <button
              type="submit"
              disabled={!canSubmit}
              aria-label="Send"
              className={`p-1 rounded-sm transition-colors cursor-default flex-none
                ${canSubmit
                  ? 'bg-accent text-white hover:bg-accent-hover'
                  : 'bg-surface text-text-secondary/40'
                }`}
            >
              <ArrowUp size={12} />
            </button>
          </div>
        </div>
      </form>
    </>
  );

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex w-full h-full flex-col gap-2">{body}</div>
    </Tooltip.Provider>
  );
}
