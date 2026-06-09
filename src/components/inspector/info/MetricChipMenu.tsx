import React, { useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Copy, Pin, PlusSquare, Sparkles } from 'lucide-react';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { toast } from '@/components/ui/Toast';
import { MetricChip } from './MetricChip';

interface Props {
  /** Stable identifier for what this chip represents (e.g.
   *  'mech:median_luma', 'doc:resolution'). Kept on the pinned item so a
   *  future "refresh" flow can re-resolve the value. */
  sourceId?: string;
  label: string;
  value: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}

/**
 * MetricChip + per-chip dropdown menu. Click the chip → open menu with:
 *   - Copy (writes `"label: value"` to the clipboard)
 *   - Pin to canvas (spawns a frontend info widget at the active image
 *     node's right edge, undo/redo capable)
 *   - Ask AI about this (opens the Cmd+K palette; full prompt attachment
 *     lands with the context strip in a follow-up)
 *
 * The chip stays a div under the hood so HTML5 drag (added next) keeps
 * working — Radix's trigger doesn't intercept drag events.
 */
export function MetricChipMenu({ sourceId, label, value, icon }: Props) {
  // Existing info widgets on the canvas — exposed in the menu as
  // "Add to <title>" items so users can fuse chips into already-pinned
  // widgets instead of accruing separate cards per pin.
  //
  // NB: select the record (stable when nothing changes) and project to an
  // array inside React.useMemo — `Object.values` inside the selector would
  // return a fresh array on every render and force-rerender forever.
  const infoNodesRecord = useEditorStore((s) => s.infoNodes);
  const existingInfoNodes = React.useMemo(
    () => Object.values(infoNodesRecord),
    [infoNodesRecord],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`);
      toast.info('Copied');
    } catch {
      toast.info('Copy unavailable');
    }
  }, [label, value]);

  const handlePinNew = useCallback(() => {
    // Place the new info widget near the active image node so it's visible
    // without panning, and tether it back to that image so the relationship
    // is rendered on the canvas. Falls back to an untethered widget at a
    // safe default position when no image is active.
    const editor = useEditorStore.getState();
    const activeId = editor.activeImageNodeId;
    const node = activeId ? editor.imageNodes[activeId] : undefined;
    const position = node
      ? { x: node.position.x + node.size.w + 32, y: node.position.y }
      : { x: 200, y: 200 };
    editorDocument.workspace.addInfoNode(
      {
        kind: 'stats',
        items: [{ id: `pin-${Date.now().toString(36)}`, label, value, sourceId }],
      },
      { position, title: label, targetImageNodeId: activeId ?? undefined },
    );
    toast.info(`Pinned ${label}`);
  }, [label, value, sourceId]);

  const handleAddToExisting = useCallback((nodeId: string) => {
    const node = useEditorStore.getState().infoNodes[nodeId];
    if (!node) return;
    // "Add to" only makes sense for stats widgets — visual widgets (palette,
    // histogram, cast) are single-payload, not collections. The menu hides
    // them via the `kind === 'stats'` filter at the call site, so this is
    // a belt-and-braces guard.
    if (node.content.kind !== 'stats') return;
    const existing = node.content.items;
    if (existing.some((i) => i.sourceId === sourceId && i.value === value)) {
      toast.info('Already pinned');
      return;
    }
    editorDocument.workspace.updateInfoNode(nodeId, {
      content: {
        kind: 'stats',
        items: [
          ...existing,
          { id: `pin-${Date.now().toString(36)}`, label, value, sourceId },
        ],
      },
    });
    toast.info(`Added to ${node.title ?? 'widget'}`);
  }, [label, value, sourceId]);

  const handleAskAi = useCallback(() => {
    // Open Cmd+K. The context-attachment strip reads detail.attachContext
    // and seeds the attached set above the input.
    window.dispatchEvent(new CustomEvent('spawn-palette:open', {
      detail: { attachContext: [{ label, value, sourceId }] },
    }));
  }, [label, value, sourceId]);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <MetricChipButton label={label} value={value} icon={icon} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="overlay z-50 min-w-[180px] p-[3px] text-[11px] text-text-primary"
        >
          <MenuItem icon={Sparkles} label="Ask AI about this" onSelect={handleAskAi} aiTone />
          <DropdownMenu.Separator className="my-[2px] h-px bg-separator" />
          {/* When existing widgets are on the canvas, offer "Add to …"
              entries above the create-new entry so the natural reading
              order matches the fuse-first behaviour the user expects
              after pinning their first chip. */}
          {existingInfoNodes
            .filter((n) => n.content.kind === 'stats')
            .map((n) => (
              <MenuItem
                key={n.id}
                icon={PlusSquare}
                label={`Add to ${n.title ?? 'widget'}`}
                onSelect={() => handleAddToExisting(n.id)}
              />
            ))}
          <MenuItem icon={Pin}  label="Pin to new widget" onSelect={handlePinNew} />
          <DropdownMenu.Separator className="my-[2px] h-px bg-separator" />
          <MenuItem icon={Copy} label="Copy value"        onSelect={handleCopy} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Single Radix item with our chrome. */
function MenuItem({
  icon: Icon,
  label,
  onSelect,
  aiTone,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onSelect: () => void;
  aiTone?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`relative flex cursor-default select-none items-center gap-1.5
        rounded-[3px] px-2 h-[22px] outline-none text-[11px]
        ${aiTone ? 'text-[var(--color-ai)]' : 'text-text-primary'}
        data-[highlighted]:bg-accent data-[highlighted]:text-white`}
    >
      <Icon size={11} aria-hidden />
      {label}
    </DropdownMenu.Item>
  );
}

/** Click-trigger variant of MetricChip. Same visual, rendered as a real
 *  `<button>` so Radix can measure it for popover positioning AND it
 *  participates in the parent auto-fit grid as a normal grid item. Earlier
 *  versions used `display: contents` on the button to "pass through" the
 *  layout — that broke Radix's anchoring (a zero-size trigger snaps the
 *  popover to the viewport's top-left). `block w-full` keeps the button
 *  in the grid cell with the chip box filling it. */
const MetricChipButton = React.forwardRef<
  HTMLButtonElement,
  Props & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function MetricChipButton({ sourceId, label, value, icon, ...rest }, ref) {
  void sourceId;
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className="block w-full text-left focus:outline-none rounded-[3px]
        focus-visible:[&>div]:ring-1 focus-visible:[&>div]:ring-accent
        hover:[&>div]:bg-surface-secondary/80"
    >
      <MetricChip label={label} value={value} icon={icon} />
    </button>
  );
});
