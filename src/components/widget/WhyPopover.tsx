import { type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { Widget } from '@/types/widget';
import { UI } from '@/config';

interface WhyPopoverProps {
  open: boolean;
  widget: Widget;
  onOpenChange: (open: boolean) => void;
  children: ReactNode; // the trigger element (wrapped via Trigger asChild)
}

/** Reasoning-only popover. The earlier version surfaced origin/prompt/date
 *  chips and an "ops in this widget" list, but that turned a one-sentence
 *  explanation into a panel; metadata belongs in the inspector if anywhere.
 *  Now: just the reasoning paragraph, or a small placeholder when missing. */
export function WhyPopover({ open, widget, onOpenChange, children }: WhyPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="overlay w-[260px] p-2.5 text-[11px] text-text-primary"
          style={{ zIndex: UI.zPopover }}
          side="right"
          align="start"
          sideOffset={8}
        >
          {widget.reasoning ? (
            <p className="leading-snug text-text-secondary">{widget.reasoning}</p>
          ) : (
            <p className="leading-snug text-text-secondary/70 italic">
              No reasoning available for this widget.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
