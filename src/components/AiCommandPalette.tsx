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
} from 'lucide-react';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import { proposeFromPalette } from '@/lib/palette-actions';
import type { Layer } from '@/store/layer-slice';

interface AiCommandPaletteProps {
  disabled?: boolean;
}

type TargetItem = { kind: 'layer'; layer: Layer };

export function AiCommandPalette({ disabled }: AiCommandPaletteProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const layers = useEditorStore((s) => s.layers);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const aiStatus = useAiSession((s) => s.status);

  const visibleLayers = layers
    .sort((a, b) => b.order - a.order);

  // Flat list of all @-mentionable layer names.
  const allMentionable = visibleLayers.map((l) => ({ label: l.name, key: `layer:${l.id}` }));

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

  function insertMention(opt: { label: string; key: string }) {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(mention.start + 1 + mention.query.length);
    const inserted = `@${opt.label} `;
    const next = `${before}${inserted}${after}`;
    const cursor = before.length + inserted.length;
    setValue(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  const items: TargetItem[] = visibleLayers.map((l) => ({ kind: 'layer', layer: l }));

  const canSubmit = value.trim().length > 0 && !disabled && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await proposeFromPalette(value.trim());
      setValue('');
    } finally {
      setBusy(false);
    }
  }

  const statusHint = (() => {
    if (busy) return 'Sending…';
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

        {/* Layer list — context reference for the user. */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {items.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-text-secondary/70 leading-snug">
              Use Point / Multi / Box to create selections. Edits with no
              selection apply to the whole image.
            </div>
          ) : null}
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const key = `layer:${item.layer.id}`;
              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                >
                  <LayerRow item={item} />
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
          {/* @-mention popup */}
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
              placeholder="Describe your edit… (type @ to mention a layer)"
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

// ─── LayerRow ─────────────────────────────────────────────────────────

function LayerRow({ item }: { item: TargetItem }) {
  return (
    <div
      className="group flex items-center gap-2 pl-2 pr-2 py-1 border-l-2
        cursor-default transition-colors
        border-l-transparent hover:bg-surface-secondary text-text-primary"
    >
      <LayerThumbnail layer={item.layer} />
      <span className="flex-1 truncate text-[11px]">{item.layer.name}</span>
    </div>
  );
}

// ─── LayerThumbnail ──────────────────────────────────────────────────

function LayerThumbnail({ layer }: { layer: Layer }) {
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const ref = useRef<HTMLCanvasElement | null>(null);
  useLayerThumbnail(ref, layer, pixelVersion);
  return (
    <canvas
      ref={ref}
      width={32}
      height={24}
      className="block w-8 h-6 rounded-sm border border-separator bg-canvas-bg shrink-0"
    />
  );
}

function useLayerThumbnail(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  layer: Layer,
  pixelVersion: number,
) {
  const layerId = layer.id;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const source = pixelStore.get(layerId) ?? null;
    if (!source || source.width === 0 || source.height === 0) return;
    drawContain(ctx, source, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, layerId, pixelVersion]);
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

export type { AiCommandPaletteProps as _AiCommandPaletteProps };
// Re-export for callers that don't need other types.
export type AiCommandPaletteRef = ReactNode;
