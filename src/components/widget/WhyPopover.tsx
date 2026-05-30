import { type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { Widget } from '@/types/widget';

interface WhyPopoverProps {
  open: boolean;
  widget: Widget;
  onOpenChange: (open: boolean) => void;
  children: ReactNode; // the trigger element (wrapped via Trigger asChild)
}

export function WhyPopover({ open, widget, onOpenChange, children }: WhyPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="overlay w-[260px] p-2.5 text-[11px] text-text-primary z-[60]"
          side="right"
          align="start"
          sideOffset={8}
        >
          {widget.reasoning && (
            <p className="leading-snug mb-2 text-text-secondary">{widget.reasoning}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
            <span className="bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-0.5">
              {widget.origin.kind}
            </span>
            {widget.origin.prompt && (
              <span className="bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-0.5">
                "{widget.origin.prompt}"
              </span>
            )}
            <span className="num bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-0.5">
              {widget.created_at.slice(0, 10)}
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
