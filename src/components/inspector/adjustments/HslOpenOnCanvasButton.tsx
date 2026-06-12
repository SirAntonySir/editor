import { useEffect, useRef, useState } from 'react';
import { Pin } from 'lucide-react';
import { promoteToCanvas } from './promote';
import { promoteSingleBand } from '@/lib/colour-band-spawn';
import { HSL_BANDS, bandDisplayColor } from './hsl-bands';
import { UI } from '@/config';

const CONIC = `conic-gradient(from 0deg, ${HSL_BANDS.map((b) => bandDisplayColor(b.centerHue)).join(', ')}, ${bandDisplayColor(HSL_BANDS[0].centerHue)})`;

interface Props {
  sessionId: string | null;
  layerId: string | null;
  disabled: boolean;
}

/** HSL-specific "open on canvas" button. Replaces the single-action arrow
 *  used by other tools with a popover that lets the user pick all bands
 *  (full HSL widget) or one specific colour band (single-band widget).
 *
 *  Was previously a standalone "Colour band" row in the accordion list; now
 *  reachable only from this entry point. */
export function HslOpenOnCanvasButton({ sessionId, layerId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pickAll = () => {
    promoteToCanvas(sessionId, 'hsl', layerId);
    setOpen(false);
  };

  const pickBand = (band: string) => {
    promoteSingleBand(sessionId, band, layerId);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-label="Pin to canvas"
        title="Pin HSL to canvas"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center text-text-secondary hover:text-text-primary hover:bg-surface-secondary p-0.5 rounded-[3px] disabled:opacity-40"
      >
        <Pin size={13} aria-hidden />
      </button>
      {open && (
        <div
          className="overlay absolute right-0 top-full p-2 w-[170px]"
          style={{ zIndex: UI.zPopover }}
        >
          <button
            type="button"
            onClick={pickAll}
            className="w-full flex items-center gap-2 px-1.5 py-1 rounded-[3px] hover:bg-surface-secondary text-left"
          >
            <span className="w-3.5 h-3.5 rounded-[3px] flex-none" style={{ background: CONIC }} aria-hidden />
            <span className="text-xs text-text-primary">All bands</span>
          </button>
          <div className="h-px bg-separator my-1.5" />
          <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5 px-1.5">Single band</div>
          <div className="grid grid-cols-4 gap-1.5">
            {HSL_BANDS.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-label={b.label}
                title={b.label}
                onClick={() => pickBand(b.key)}
                className="w-6 h-6 rounded-[5px]"
                style={{
                  background: bandDisplayColor(b.centerHue),
                  boxShadow: 'inset 0 0 0 1px var(--color-separator)',
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
