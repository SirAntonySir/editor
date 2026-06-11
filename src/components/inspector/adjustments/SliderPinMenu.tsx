import { useMemo } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Pin, PlusSquare } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { toast } from '@/components/ui/Toast';
import { promoteSingleParamToCanvas } from './promote';
import type { Widget } from '@/types/widget';

interface Props {
  /** ProcessingDefinition.id — the registry op id used to spawn the widget. */
  toolId: string;
  /** The op's adjustment node-type (`def.adjustmentType`). Used to match
   *  existing widgets on the same op/layer. */
  opAdjustmentType: string;
  layerId: string | null;
  paramKey: string;
  paramLabel: string;
}

/**
 * Pin button + dropdown for adjustment sliders.
 *
 * Mirrors the Info-tab `MetricChipMenu` pattern: when the user clicks the Pin
 * icon next to a slider's label they get a menu with one row per existing
 * single-param widget on the same op/layer ("Add to <title>") plus a
 * "Pin to new widget" option that spawns a fresh one. "Add to" appends the
 * slider's param key to the target widget's `pinnedWidgetParams` so the
 * canvas shell grows another row inline.
 */
export function SliderPinMenu({
  toolId,
  opAdjustmentType,
  layerId,
  paramKey,
  paramLabel,
}: Props) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  const widgetNodes = useEditorStore((s) => s.widgetNodes);
  const pinnedWidgetParams = useEditorStore((s) => s.pinnedWidgetParams);
  const setPinnedWidgetParams = useEditorStore((s) => s.setPinnedWidgetParams);

  // Candidate widgets to append to. Constraints:
  //   - Same op / layer (so the param applies).
  //   - Status active (visible to the user).
  //   - Has a workspace position (it's actually on the canvas).
  //   - Has a pinnedWidgetParams entry (a one-control / multi-control pin
  //     widget — we don't want to silently narrow a full op widget that the
  //     user has been editing).
  //   - Doesn't already include this paramKey.
  const candidates: Widget[] = useMemo(() => {
    if (!layerId) return [];
    const out: Widget[] = [];
    for (const w of widgets) {
      if (w.status !== 'active') continue;
      if (!widgetNodes[w.id]) continue;
      const sameOp = w.nodes.some((n) => n.layerId === layerId && n.type === opAdjustmentType);
      if (!sameOp) continue;
      const pinned = pinnedWidgetParams[w.id];
      if (!pinned || pinned.length === 0) continue;
      if (pinned.includes(paramKey)) continue;
      out.push(w);
    }
    return out;
  }, [widgets, widgetNodes, pinnedWidgetParams, layerId, opAdjustmentType, paramKey]);

  const handleAddToExisting = (widgetId: string) => {
    const existing = pinnedWidgetParams[widgetId] ?? [];
    setPinnedWidgetParams(widgetId, [...existing, paramKey]);
    const w = widgets.find((x) => x.id === widgetId);
    toast.info(`Added ${paramLabel} to ${w?.intent ?? 'widget'}`);
  };

  const handlePinNew = () => {
    promoteSingleParamToCanvas(sessionId, toolId, opAdjustmentType, layerId, paramKey);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={offline || !layerId}
          title={`Pin "${paramLabel}" to canvas`}
          aria-label={`Pin ${paramLabel} to canvas`}
          className="inline-flex items-center text-text-secondary
            hover:text-text-primary hover:bg-surface-secondary
            p-0.5 rounded-[3px] disabled:opacity-40 disabled:cursor-not-allowed
            opacity-0 group-hover:opacity-100 focus-visible:opacity-100
            data-[state=open]:opacity-100 transition-opacity"
        >
          <Pin size={10} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="overlay z-50 min-w-[180px] p-[3px] text-[11px] text-text-primary"
        >
          {/* "Add to <title>" entries above the create-new entry so the
              natural reading order matches the fuse-first behaviour the user
              expects after pinning their first slider. */}
          {candidates.map((w) => (
            <MenuItem
              key={w.id}
              icon={PlusSquare}
              label={`Add to ${w.intent}`}
              onSelect={() => handleAddToExisting(w.id)}
            />
          ))}
          {candidates.length > 0 && (
            <DropdownMenu.Separator className="my-[2px] h-px bg-separator" />
          )}
          <MenuItem icon={Pin} label="Pin to new widget" onSelect={handlePinNew} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="relative flex cursor-default select-none items-center gap-1.5
        rounded-[3px] px-2 h-[22px] outline-none text-[11px] text-text-primary
        data-[highlighted]:bg-accent data-[highlighted]:text-white"
    >
      <Icon size={11} aria-hidden />
      {label}
    </DropdownMenu.Item>
  );
}

const EMPTY_WIDGETS: Widget[] = [];
