import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';

interface AiCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

const IMAGE_MAX_HEIGHT = 560;
const IMAGE_MAX_WIDTH = 720;

export function AiCommandPalette({ open, onClose, onSubmit, disabled }: AiCommandPaletteProps) {
  // Select the stable context object — deriving `candidateRegions` inline in
  // the selector returns a new `[]` each render when context is null and
  // sends Zustand into an infinite re-render loop.
  const context = useAiSession((s) => s.context);
  const candidateRegions = context?.candidateRegions ?? [];
  const imageLayerId = useEditorStore((s) => s.layers.find((l) => l.type === 'image')?.id);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) {
      setValue('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Paint a downscaled preview of the active image into the palette.
  useEffect(() => {
    if (!open) return;
    const canvas = previewRef.current;
    if (!canvas || !imageLayerId) return;
    const source = pixelStore.getSource(imageLayerId);
    if (!source || source.width === 0 || source.height === 0) return;
    const ratio = source.height / source.width;
    let w = IMAGE_MAX_WIDTH;
    let h = Math.round(w * ratio);
    if (h > IMAGE_MAX_HEIGHT) {
      h = IMAGE_MAX_HEIGHT;
      w = Math.round(h / ratio);
    }
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, w, h);
  }, [open, imageLayerId, pixelVersion]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
                  {candidateRegions.map((region) => (
                    <Tooltip.Root key={region.label}>
                      <Tooltip.Trigger asChild>
                        <button
                          type="button"
                          onClick={() => insertToken(region.label)}
                          className="inline-flex items-center rounded-full bg-surface-secondary/60 px-2 py-0.5 text-[11px] text-text-primary hover:bg-surface-secondary"
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
                  ))}
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
