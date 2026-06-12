import { type ReactNode } from 'react';
import * as RTooltip from '@radix-ui/react-tooltip';
import { UI } from '@/config';

interface TooltipProps {
  /** The element that triggers the tooltip on hover/focus. Must be a single
   *  focusable element — Radix mounts via Trigger asChild. */
  children: ReactNode;
  /** Tooltip body. Strings render as a single line; pass JSX for richer
   *  content (avoid making it large — tooltips are not panels). */
  label: ReactNode;
  /** Preferred side relative to the trigger. Defaults to `top`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Gap between trigger and tooltip in px. Defaults to 6. */
  sideOffset?: number;
  /** Open-delay in ms. Defaults to 250 — long enough that quick mouse
   *  traverses across an icon row don't flash a stack of tooltips. */
  delayDuration?: number;
}

/** Thin wrapper around Radix Tooltip with the project's overlay styling.
 *
 *  Lives at the primitive tier — no app state, no domain knowledge. Wraps any
 *  button-shaped child with a hover/focus tooltip. Multiple tooltips on the
 *  same surface share the inner `RTooltip.Provider` here; if a parent already
 *  declares a Provider, this one no-ops (Radix dedupes nested providers).
 */
export function Tooltip({
  children,
  label,
  side = 'top',
  sideOffset = 6,
  delayDuration = 250,
}: TooltipProps) {
  return (
    <RTooltip.Provider delayDuration={delayDuration} disableHoverableContent>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            side={side}
            sideOffset={sideOffset}
            style={{ zIndex: UI.zTooltip }}
            className="overlay px-2 py-1 text-[11px] text-text-primary
              data-[state=delayed-open]:animate-in data-[state=closed]:animate-out
              data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0"
          >
            {label}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}
