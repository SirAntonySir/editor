import { type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { Widget, WidgetNode } from '@/types/widget';
import { loadRegistry } from '@/lib/registry/loader';

function opsForWidget(widget: Widget): { node: WidgetNode; label: string }[] {
  const reg = loadRegistry();
  return widget.nodes.map((node) => {
    let op = node.op_id ? reg.ops[node.op_id] : undefined;
    if (!op) {
      // Back-compat: nodes without op_id — match by node_type.
      op = Object.values(reg.ops).find((o) => o.engine.node_type === node.type);
    }
    return { node, label: op ? op.display_name : node.type };
  });
}

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
            {widget.created_at && (
              <span className="num bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-0.5">
                {widget.created_at.slice(0, 10)}
              </span>
            )}
          </div>
          {widget.nodes.length > 1 && (
            <div className="mt-2 pt-2 border-t border-separator">
              <p className="text-[9px] font-medium text-text-secondary mb-1">Ops in this widget</p>
              <div className="flex flex-col gap-0.5">
                {opsForWidget(widget).map(({ node, label }) => (
                  <span
                    key={node.id}
                    className="text-[10px] text-text-primary bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-0.5 self-start"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
