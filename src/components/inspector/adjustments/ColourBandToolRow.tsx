import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { promoteSingleBand } from '@/lib/colour-band-spawn';
import { HSL_BANDS, bandDisplayColor } from './hsl-bands';

const CONIC = `conic-gradient(from 0deg, ${HSL_BANDS.map((b) => bandDisplayColor(b.centerHue)).join(', ')}, ${bandDisplayColor(HSL_BANDS[0].centerHue)})`;

/** Standalone Tools-list row: pick a colour from the popover to spawn a
 *  single-band HSL widget on the canvas (locked to that band). */
export function ColourBandToolRow() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const layerId = useEditorStore((s) => s.activeLayerId);
  const disabled = offline || !layerId;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (band: string) => {
    promoteSingleBand(sessionId, band, layerId);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative border-b border-separator">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left disabled:opacity-40"
      >
        <span className="w-3.5 h-3.5 rounded-[3px] flex-none" style={{ background: CONIC }} aria-hidden />
        <span className="flex-1 truncate text-xs font-medium text-text-primary">Colour band</span>
        <ChevronDown size={12} className="text-text-secondary" />
      </button>
      {open && (
        <div className="overlay absolute right-2.5 top-full z-[60] p-2">
          <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5">Pick a colour</div>
          <div className="grid grid-cols-4 gap-1.5">
            {HSL_BANDS.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-label={b.label}
                title={b.label}
                onClick={() => pick(b.key)}
                className="w-6 h-6 rounded-[5px]"
                style={{ background: bandDisplayColor(b.centerHue), boxShadow: 'inset 0 0 0 1px var(--color-separator)' }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
