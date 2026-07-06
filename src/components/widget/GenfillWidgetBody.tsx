import { useMemo, useState } from 'react';
import { Command, Pin, RefreshCw, Sparkles } from 'lucide-react';
import type { Widget } from '@/types/widget';
import { backendTools } from '@/lib/backend-tools';
import {
  acceptGenfill,
  discardGenfill,
  genfillAspectMatches,
  genfillNodeDims,
} from '@/store/genfill-actions';
import { GenfillRegionPreview } from './GenfillRegionPreview';
import { useBackendState } from '@/store/backend-state-slice';

interface GenfillWidgetBodyProps {
  widget: Widget;
}

export function GenfillWidgetBody({ widget }: GenfillWidgetBodyProps) {
  const g = widget.genfill;
  const sessionId = useBackendState((s) => s.snapshot?.sessionId);
  const [prompt, setPrompt] = useState(g?.prompt ?? '');
  const [clip, setClip] = useState(true);
  const [seedPinned, setSeedPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const dims = useMemo(
    () => (g ? genfillNodeDims(g.imageNodeId) : null),
    [g],
  );
  if (!g || !sessionId) return null;

  const generating = g.status === 'generating';
  // The model caps output resolution but preserves framing, so accept scales
  // the result to source dimensions whenever the ASPECT matches. Clipping is
  // only impossible when the aspect genuinely differs (nothing to align against).
  const dimsMatch =
    g.status === 'ready' && !!g.result && !!dims &&
    genfillAspectMatches(g.result, dims);

  const submit = async (seed?: number) => {
    if (!prompt.trim() || generating) return;
    setBusy(true);
    await backendTools.genfill_regenerate(sessionId, {
      widgetId: widget.id,
      prompt: prompt.trim(),
      ...(seed !== undefined ? { seed } : {}),
    });
    setBusy(false);
  };

  const handleAccept = async () => {
    setBusy(true);
    await acceptGenfill(widget.id, { clip: clip && dimsMatch });
    setBusy(false);
  };

  // Move this fill's context (target region + typed prompt) into Cmd+K in
  // genfill mode, then dismiss the widget — continue composing there.
  const continueInPalette = () => {
    if (!g) return;
    const label =
      useBackendState.getState().snapshot?.masksIndex?.find((m) => m.id === g.maskId)?.label
      ?? 'Region';
    window.dispatchEvent(new CustomEvent('spawn-palette:open', {
      detail: {
        mode: 'genfill',
        promptText: prompt,
        // `region:object:<maskId>` so the palette's genfillTarget resolves.
        attachContext: [{ label, value: g.maskId, sourceId: `region:object:${g.maskId}` }],
      },
    }));
    void backendTools.delete_widget(sessionId, { widgetId: widget.id, suppressSimilar: false });
  };

  return (
    <div className="px-1.5 py-1 flex flex-col gap-1.5">
      {/* Prompt */}
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void submit(); }
        }}
        placeholder="Describe what to generate…"
        disabled={generating || busy}
        autoFocus={g.status === 'compose'}
        className="w-full bg-transparent text-[12px] text-text-primary border border-separator rounded-[3px] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
      />
      {/* Hand off to the command palette (genfill mode) and close this widget. */}
      {(g.status === 'compose' || g.status === 'ready') && (
        <button
          type="button"
          onClick={continueInPalette}
          className="self-start inline-flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary"
        >
          <Command size={10} aria-hidden /> Continue in command palette
        </button>
      )}
      {/* Compose: Generate. Otherwise seed row + regenerate. */}
      {g.status === 'compose' ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!prompt.trim() || busy}
          className="inline-flex items-center gap-1 self-end text-[11px] px-2 py-1 rounded-[3px] bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          <Sparkles size={11} /> Generate
        </button>
      ) : (
        <div className="flex items-center justify-between text-[10px] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            Seed {g.seed}
            <button
              type="button"
              aria-label={seedPinned ? 'Unpin seed' : 'Pin seed'}
              onClick={() => setSeedPinned((p) => !p)}
              className={seedPinned ? 'text-[var(--color-accent)]' : 'hover:text-text-primary'}
            >
              <Pin size={10} />
            </button>
          </span>
          <button
            type="button"
            disabled={generating || busy || !prompt.trim()}
            onClick={() => void submit(seedPinned ? g.seed : undefined)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[3px] border border-separator hover:bg-surface-secondary disabled:opacity-50"
          >
            <RefreshCw size={10} className={generating ? 'animate-spin' : ''} /> Regenerate
          </button>
        </div>
      )}

      {/* Preview / skeleton / error */}
      {generating && (
        <div
          data-testid="genfill-skeleton"
          className="w-full aspect-video rounded-[3px] bg-surface-secondary animate-pulse"
        />
      )}
      {g.status === 'ready' && g.result && (
        <GenfillRegionPreview widget={widget} sessionId={sessionId} />
      )}
      {g.status === 'error' && g.error && (
        <div className="text-[11px] text-[var(--color-danger,#e5484d)] flex items-center justify-between gap-2">
          <span>{g.error.message}</span>
          {g.error.kind !== 'not_configured' && (
            <button
              type="button"
              onClick={() => void submit(g.seed)}
              className="px-2 py-1 rounded-[3px] border border-separator hover:bg-surface-secondary shrink-0"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Ready: clip toggle + Accept / Discard */}
      {g.status === 'ready' && g.result && (
        <>
          <label className="flex items-center gap-1.5 text-[11px] text-text-primary">
            <input
              type="checkbox"
              aria-label="Clip to region"
              checked={clip && dimsMatch}
              disabled={!dimsMatch}
              onChange={(e) => setClip(e.target.checked)}
            />
            Clip to region
            {!dimsMatch && (
              <span className="text-[10px] text-text-secondary">(aspect ratio differs)</span>
            )}
          </label>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void discardGenfill(widget.id)}
              className="text-[11px] px-2 py-1 rounded-[3px] border border-separator hover:bg-surface-secondary"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAccept()}
              className="text-[11px] px-2 py-1 rounded-[3px] bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              Accept
            </button>
          </div>
        </>
      )}
    </div>
  );
}
