import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ArrowUp,
  BoxSelect,
  Crosshair,
  MousePointerClick,
  Pencil,
  X,
} from 'lucide-react';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import { maskStore } from '@/core/mask-store';
import { maskUnion } from '@/lib/mask-overlap';
import {
  useAiChips,
  chipKey,
  layerKey,
  type TargetKey,
} from '@/store/ai-chips-store';
import { submitPaletteText } from '@/lib/ai-palette-submit';
import type { Layer } from '@/store/layer-slice';
import type { AiChip } from '@/store/ai-chips-store';
import type { TargetRef } from '@/types/ai-target';

interface AiCommandPaletteProps {
  disabled?: boolean;
}

type TargetItem =
  | { kind: 'layer'; layer: Layer }
  | { kind: 'chip'; chip: AiChip };

export function AiCommandPalette({ disabled }: AiCommandPaletteProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const chips = useAiChips((s) => s.chips);
  const selectedTargets = useAiChips((s) => s.selectedTargets);
  const toggleTarget = useAiChips((s) => s.toggleTarget);
  const selectTarget = useAiChips((s) => s.selectTarget);
  const removeChip = useAiChips((s) => s.removeChip);
  const renameChip = useAiChips((s) => s.renameChip);

  const layers = useEditorStore((s) => s.layers);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const aiStatus = useAiSession((s) => s.status);

  const visibleLayers = layers
    .filter((l) => l.type !== 'ai-panel')
    .sort((a, b) => b.order - a.order);

  // Flat list of all @-mentionable names + their store key, in display order.
  const allMentionable = [
    ...visibleLayers.map((l) => ({ label: l.name, key: layerKey(l.id) })),
    ...chips.map((c) => ({ label: c.label, key: chipKey(c.id) })),
  ];

  // Filtered options when a mention is active.
  const mentionOptions = mention
    ? allMentionable
        .filter((t) => t.label.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 8)
    : [];

  const clampedMentionIdx = mentionOptions.length > 0
    ? Math.min(mentionIdx, mentionOptions.length - 1)
    : 0;

  function updateValue(next: string, cursor: number) {
    setValue(next);
    setMention(findActiveMention(next, cursor));
    setMentionIdx(0);
  }

  function insertMention(opt: { label: string; key: TargetKey }) {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(mention.start + 1 + mention.query.length);
    const inserted = `@${opt.label} `;
    const next = `${before}${inserted}${after}`;
    const cursor = before.length + inserted.length;
    setValue(next);
    setMention(null);
    selectTarget(opt.key);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  // No more "Whole image" entry — empty selection means composite at submit.
  const items: TargetItem[] = [
    ...visibleLayers.map((l) => ({ kind: 'layer' as const, layer: l })),
    ...chips.map((c) => ({ kind: 'chip' as const, chip: c })),
  ];

  const canSubmit = value.trim().length > 0 && !disabled && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    const target = buildTargetRef(selectedTargets, chips, layers);
    try {
      await submitPaletteText(value.trim(), target ? { target, intent: 'append' } : null);
      setValue('');
    } finally {
      setBusy(false);
    }
  }

  const statusHint = (() => {
    if (busy) return 'Generating panel…';
    if (aiStatus === 'uploading') return 'Uploading image…';
    if (aiStatus === 'analysing') return 'Analysing image…';
    return null;
  })();

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex w-full h-full flex-col">
        {/* Selection buttons — compact icon row */}
        <div className="flex-none flex items-center gap-0.5 px-2 py-1.5 border-b border-separator">
          <SelectionButton
            icon={MousePointerClick}
            label="Point"
            tooltip="Click on the canvas to select an object"
            onClick={() => setActiveTool('select-point')}
          />
          <SelectionButton
            icon={Crosshair}
            label="Multi"
            tooltip="Click multiple points; press Enter to confirm"
            onClick={() => setActiveTool('select-multi-point')}
          />
          <SelectionButton
            icon={BoxSelect}
            label="Box"
            tooltip="Drag a rectangle to select"
            onClick={() => setActiveTool('select-box')}
          />
        </div>

        {/* Target list — multi-select via click toggle.
            Empty selection = composite (implicit). */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {items.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-text-secondary/70 leading-snug">
              Use Point / Multi / Box to create selections. Edits with no
              selection apply to the whole image.
            </div>
          ) : null}
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const key = keyFor(item);
              const active = selectedTargets.has(keyForStore(item));
              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                >
                  <TargetRow
                    item={item}
                    active={active}
                    onSelect={() => toggleTarget(keyForStore(item))}
                    onRemove={item.kind === 'chip' ? () => removeChip(item.chip.id) : undefined}
                    onRename={
                      item.kind === 'chip'
                        ? (label) => renameChip(item.chip.id, label)
                        : undefined
                    }
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="relative flex-none min-h-[100px] flex flex-col px-3 pb-3 pt-2 border-t border-separator"
        >
          {/* @-mention popup — floats above the textarea while a mention
              query is active and there's at least one match. */}
          {mention && mentionOptions.length > 0 && (
            <div
              className="absolute left-3 right-3 bottom-full mb-1 glass-panel z-50
                max-h-48 overflow-y-auto p-1 text-[11px] shadow-lg"
            >
              {mentionOptions.map((opt, i) => {
                const active = i === clampedMentionIdx;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(opt);
                    }}
                    onMouseEnter={() => setMentionIdx(i)}
                    className={`w-full text-left px-2 py-1 rounded-sm truncate cursor-default
                      ${active
                        ? 'bg-accent/20 text-text-primary'
                        : 'text-text-secondary hover:bg-surface-secondary'
                      }`}
                  >
                    @{opt.label}
                  </button>
                );
              })}
            </div>
          )}

          <div
            className="flex-1 flex flex-col rounded-md border border-separator
              bg-surface-secondary/60 transition-colors
              focus-within:border-accent/60 focus-within:bg-surface-secondary overflow-hidden"
          >
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => updateValue(e.target.value, e.target.selectionStart)}
              onSelect={(e) => {
                const el = e.currentTarget;
                setMention(findActiveMention(el.value, el.selectionStart));
              }}
              onKeyDown={(e) => {
                // Mention navigation first — only when popup is showing.
                if (mention && mentionOptions.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIdx((i) => (i + 1) % mentionOptions.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIdx((i) =>
                      (i - 1 + mentionOptions.length) % mentionOptions.length,
                    );
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    insertMention(mentionOptions[clampedMentionIdx]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMention(null);
                    return;
                  }
                }
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit(e as unknown as FormEvent);
                }
              }}
              placeholder="Describe your edit… (type @ to mention a target)"
              disabled={disabled || busy}
              data-palette-input="sidebar"
              rows={2}
              className="flex-1 resize-none bg-transparent px-2 pt-2 pb-1 text-sm
                text-text-primary placeholder:text-text-secondary outline-none disabled:opacity-50"
            />
            <div className="flex-none flex items-center justify-between gap-2 border-t border-separator/60 px-2 py-1">
              <span className="text-[10px] text-text-secondary/80 truncate">
                {statusHint ?? (
                  <span className="text-text-secondary/50">⏎ newline · ⌘⏎ send</span>
                )}
              </span>
              <button
                type="submit"
                disabled={!canSubmit}
                aria-label="Send"
                className={`p-1 rounded-sm transition-colors cursor-default flex-none
                  ${
                    canSubmit
                      ? 'bg-accent text-white hover:bg-accent-hover'
                      : 'bg-surface text-text-secondary/40'
                  }`}
              >
                <ArrowUp size={12} />
              </button>
            </div>
          </div>
        </form>
      </div>
    </Tooltip.Provider>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Detect whether the textarea cursor is inside an active @-mention zone.
 * A mention is "active" when there's an unfinished `@token` ending at the
 * cursor: the `@` is at the start of the input or preceded by whitespace,
 * and only non-whitespace characters lie between the `@` and the cursor.
 */
function findActiveMention(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      if (i === 0 || /\s/.test(text[i - 1])) {
        return { start: i, query: text.slice(i + 1, cursor) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/** React key for the row's <motion.div>. */
function keyFor(item: TargetItem): string {
  return item.kind === 'layer' ? `layer:${item.layer.id}` : `chip:${item.chip.id}`;
}

/** Store-side TargetKey for the selection set. */
function keyForStore(item: TargetItem): TargetKey {
  return item.kind === 'layer' ? layerKey(item.layer.id) : chipKey(item.chip.id);
}

/**
 * Translate the multi-selection set into a single TargetRef for submit.
 *
 *  - empty                                  → composite
 *  - 1 layer (no chips)                     → layer
 *  - 1 chip  (no layers)                    → mask
 *  - many chips (any layers ignored here)   → register a fresh OR-merged
 *                                              mask in maskStore and return
 *                                              a mask TargetRef pointing at it
 *  - 1 chip + 1+ layers (mixed)             → mask of the chip (layer
 *                                              ignored — the mask is more
 *                                              specific)
 *  - many chips + 1+ layers                 → merged chip mask
 *  - only layers (multiple)                 → composite (no useful single
 *                                              layer to pick)
 */
function buildTargetRef(
  selected: Set<TargetKey>,
  chips: AiChip[],
  layers: Layer[],
): TargetRef | null {
  if (selected.size === 0) return { kind: 'composite' };

  const selectedChips: AiChip[] = [];
  const selectedLayers: Layer[] = [];
  for (const k of selected) {
    if (k.startsWith('chip:')) {
      const id = k.slice(5);
      const c = chips.find((x) => x.id === id);
      if (c) selectedChips.push(c);
    } else if (k.startsWith('layer:')) {
      const id = k.slice(6);
      const l = layers.find((x) => x.id === id);
      if (l) selectedLayers.push(l);
    }
  }

  if (selectedChips.length === 0) {
    if (selectedLayers.length === 1) {
      return { kind: 'layer', layerId: selectedLayers[0].id };
    }
    return { kind: 'composite' };
  }

  if (selectedChips.length === 1) {
    const chip = selectedChips[0];
    return { kind: 'mask', layerId: chip.sourceLayerId, maskRef: chip.maskRef };
  }

  // Multiple chips → union into a new mask.
  let merged: { data: Uint8Array; width: number; height: number } | null = null;
  for (const chip of selectedChips) {
    const m = maskStore.get(chip.maskRef);
    if (!m) continue;
    if (merged === null) {
      merged = { data: m.data.slice(), width: m.width, height: m.height };
    } else {
      // Reuse maskUnion: we need a `Mask` shape on both sides.
      const result = maskUnion(
        { id: '', layerId: '', width: merged.width, height: merged.height, data: merged.data, source: 'sam-points', createdAt: 0 },
        m,
      );
      merged = result;
    }
  }
  if (!merged) return { kind: 'composite' };
  const firstChip = selectedChips[0];
  const mergedRef = maskStore.register({
    layerId: firstChip.sourceLayerId,
    label: selectedChips.map((c) => c.label).join(' + '),
    width: merged.width,
    height: merged.height,
    data: merged.data,
    source: 'sam-points',
    createdAt: Date.now(),
  });
  return { kind: 'mask', layerId: firstChip.sourceLayerId, maskRef: mergedRef };
}

// ─── SelectionButton ─────────────────────────────────────────────────

function SelectionButton({
  icon: Icon,
  label,
  tooltip,
  onClick,
}: {
  icon: typeof MousePointerClick;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="flex-1 flex items-center justify-center gap-1 px-1.5 py-1 text-[10px]
            rounded-sm text-text-secondary
            hover:bg-surface-secondary hover:text-text-primary transition-colors cursor-default"
        >
          <Icon size={11} />
          {label}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={6}
          className="glass-panel z-[60] max-w-[220px] px-2 py-1 text-[11px] text-text-secondary shadow-lg leading-snug"
        >
          {tooltip}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// ─── TargetRow ────────────────────────────────────────────────────────

function TargetRow({
  item,
  active,
  onSelect,
  onRemove,
  onRename,
}: {
  item: TargetItem;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  onRename?: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const label = labelFor(item);

  const beginRename = () => {
    if (!onRename) return;
    setDraft(label);
    setEditing(true);
  };

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== label) onRename?.(next);
    setEditing(false);
  };

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 pl-2 pr-2 py-1 border-l-2
        cursor-default transition-colors
        ${active
          ? 'border-l-accent bg-accent/10 text-text-primary'
          : 'border-l-transparent hover:bg-surface-secondary text-text-primary'
        }`}
    >
      <TargetThumbnail item={item} />
      <div className="flex-1 min-w-0 flex items-center">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              }
              if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-surface px-1 py-0.5 text-[11px] text-text-primary
              border border-accent/60 rounded-sm outline-none"
          />
        ) : (
          <span className="flex-1 truncate text-[11px]">{label}</span>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {onRename && !editing && (
          <button
            type="button"
            aria-label="Rename"
            onClick={(e) => {
              e.stopPropagation();
              beginRename();
            }}
            className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
          >
            <Pencil size={10} />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label="Remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function labelFor(item: TargetItem): string {
  if (item.kind === 'layer') return item.layer.name;
  return item.chip.label;
}

// ─── Thumbnails ──────────────────────────────────────────────────────

function TargetThumbnail({ item }: { item: TargetItem }) {
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Re-render whenever the underlying pixels change (composite recomputes,
  // layer pixels update, or a mask is replaced).
  useThumbnail(ref, item, pixelVersion);
  return (
    <canvas
      ref={ref}
      width={32}
      height={24}
      className="block w-8 h-6 rounded-sm border border-separator bg-canvas-bg shrink-0"
    />
  );
}

function useThumbnail(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  item: TargetItem,
  pixelVersion: number,
) {
  // Extract item-specific scalars so the dep array is a flat list of primitives.
  const itemKind = item.kind;
  const itemLayerId = item.kind === 'layer' ? item.layer.id : '';
  const itemChipId = item.kind === 'chip' ? item.chip.id : '';
  const itemMaskRef = item.kind === 'chip' ? item.chip.maskRef : '';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const source = sourceCanvasFor(item);
    if (!source || source.width === 0 || source.height === 0) return;

    if (item.kind === 'chip') {
      // Cutout: show just the masked segment, cropped to its bbox.
      // No surrounding image, no colored mask tint.
      const mask = maskStore.get(item.chip.maskRef);
      if (mask) drawMaskedCrop(ctx, source, mask, w, h);
    } else {
      drawContain(ctx, source, w, h);
    }
    // `item` is a fresh object every render; deps use the inner ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, itemKind, itemLayerId, itemChipId, itemMaskRef, pixelVersion]);
}

function sourceCanvasFor(item: TargetItem): HTMLCanvasElement | OffscreenCanvas | null {
  if (item.kind === 'layer') {
    return pixelStore.get(item.layer.id) ?? null;
  }
  // chip
  return pixelStore.get(item.chip.sourceLayerId) ?? null;
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement | OffscreenCanvas,
  destW: number,
  destH: number,
) {
  const ratio = Math.min(destW / src.width, destH / src.height);
  const drawW = src.width * ratio;
  const drawH = src.height * ratio;
  const dx = (destW - drawW) / 2;
  const dy = (destH - drawH) / 2;
  ctx.drawImage(src, dx, dy, drawW, drawH);
}

/**
 * Paint just the masked segment, cropped to its bbox, "contain"-fit into the
 * destination rect. No surrounding image; transparent outside the mask.
 */
function drawMaskedCrop(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement | OffscreenCanvas,
  mask: { width: number; height: number; data: Uint8Array },
  destW: number,
  destH: number,
) {
  // Find mask bounding box in mask coordinates.
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    const row = y * mask.width;
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[row + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  // Map mask bbox into source pixel coords (mask & source may differ in size).
  const sx = src.width / mask.width;
  const sy = src.height / mask.height;
  const srcX = Math.round(minX * sx);
  const srcY = Math.round(minY * sy);
  const srcW = Math.max(1, Math.round(cropW * sx));
  const srcH = Math.max(1, Math.round(cropH * sy));

  // Compose source crop into a tmp canvas, then clip by the mask.
  const tmp = new OffscreenCanvas(srcW, srcH);
  const tctx = tmp.getContext('2d');
  if (!tctx) return;
  tctx.drawImage(src, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

  // Build the alpha-clip from the mask bbox.
  const maskCrop = new OffscreenCanvas(cropW, cropH);
  const mctx = maskCrop.getContext('2d');
  if (!mctx) return;
  const img = mctx.createImageData(cropW, cropH);
  for (let y = 0; y < cropH; y++) {
    const srcRow = (y + minY) * mask.width;
    const dstRow = y * cropW;
    for (let x = 0; x < cropW; x++) {
      const i = (dstRow + x) * 4;
      const v = mask.data[srcRow + (x + minX)];
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = v > 0 ? v : 0;
    }
  }
  mctx.putImageData(img, 0, 0);

  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(maskCrop, 0, 0, srcW, srcH);

  // Contain-fit into the thumbnail rect.
  const ratio = Math.min(destW / srcW, destH / srcH);
  const drawW = srcW * ratio;
  const drawH = srcH * ratio;
  const dx = (destW - drawW) / 2;
  const dy = (destH - drawH) / 2;
  ctx.drawImage(tmp, dx, dy, drawW, drawH);
}

export type { AiCommandPaletteProps as _AiCommandPaletteProps };
// Re-export for callers that don't need other types.
export type AiCommandPaletteRef = ReactNode;
