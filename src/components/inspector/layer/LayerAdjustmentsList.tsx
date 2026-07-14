import { ChevronRight, ChevronDown, Eye, EyeOff, MoreHorizontal } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useLayerAdjustments, type LayerAdjustmentEntry } from '@/hooks/useLayerAdjustments';
import {
  copyCanonicalToLayer,
  editCanonicalInAdjustments,
  moveCanonicalToLayer,
  resetCanonicalOnLayer,
  setWidgetTargetChecked,
} from './layer-adjustment-actions';

const ITEM_CLS =
  'px-2 py-1 text-[11px] rounded-[3px] cursor-pointer outline-none text-text-primary ' +
  'hover:bg-surface-secondary data-[disabled]:opacity-40 data-[disabled]:pointer-events-none';
const LABEL_CLS = 'px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wide text-text-secondary';

/**
 * "Adjustments · N" collapsible list inside a LayerRow: everything hitting
 * this layer (canonical tool edits + widgets), each with an eye and a ⋯ menu
 * for reassignment. Data is derived from the backend snapshot; mutations go
 * through set_param / update_widget_targets — canonical stays the SSoT.
 */
export function LayerAdjustmentsList({
  layerId,
  imageNodeId,
}: {
  layerId: string;
  imageNodeId: string;
}) {
  const sectionId = `layeradj:${layerId}`;
  const entries = useLayerAdjustments(layerId);
  const expanded = useEditorStore((s) => s.expandedSectionIds.has(sectionId));
  const toggle = useEditorStore((s) => s.toggleSectionExpanded);
  const nodeLayerIds = useEditorStore((s) => s.imageNodes[imageNodeId]?.layerIds);
  const layers = useEditorStore((s) => s.layers);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  if (entries.length === 0) return null;

  // Sibling layers of the same image node — Move/Copy targets + the widget
  // "Applies to" checklist. Ordered top → bottom like the Layers tab.
  const nodeLayers = (nodeLayerIds ?? [])
    .map((id) => layers.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => Boolean(l))
    .sort((a, b) => b.order - a.order);

  return (
    <div className="flex flex-col" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => toggle(sectionId)}
        className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-text-secondary
          hover:text-text-primary py-0.5 text-left"
      >
        <span className="inline-flex items-center w-3">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
        Adjustments · {entries.length}
      </button>
      {expanded && (
        <div className="flex flex-col">
          {entries.map((e) => (
            <EntryRow
              // defId-qualified: light + color share one canon node id.
              key={e.defId ? `${e.id}:${e.defId}` : e.id}
              entry={e}
              layerId={layerId}
              nodeLayers={nodeLayers}
              offline={offline}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface EntryRowProps {
  entry: LayerAdjustmentEntry;
  layerId: string;
  nodeLayers: { id: string; name: string }[];
  offline: boolean;
}

function EntryRow({ entry, layerId, nodeLayers, offline }: EntryRowProps) {
  const hiddenCanon = useEditorStore((s) => s.hiddenCanonNodeIds.has(entry.id));
  const hiddenWidget = useEditorStore((s) => s.hiddenWidgetIds.has(entry.id));
  const toggleCanonHidden = useEditorStore((s) => s.toggleCanonNodeHidden);
  const toggleWidgetHidden = useEditorStore((s) => s.toggleWidgetHidden);
  const isWidget = entry.kind === 'widget';
  const hidden = isWidget ? hiddenWidget : hiddenCanon;
  const targetCount = entry.targetLayerIds?.length ?? 0;

  return (
    <div
      className={`flex items-center gap-1.5 pl-3 pr-0.5 py-[3px] rounded-[3px]
        hover:bg-surface-secondary ${hidden ? 'opacity-60' : ''}`}
    >
      <span
        className="inline-block w-[7px] h-[7px] rounded-sm flex-shrink-0"
        style={{ background: entry.colorVar }}
        aria-hidden
      />
      <span className="flex-1 truncate text-[11px] text-text-primary">
        {entry.label}
        {isWidget && (
          <span className="text-text-secondary">
            {' '}◇{targetCount > 1 ? ` · ${targetCount} layers` : ''}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => (isWidget ? toggleWidgetHidden(entry.id) : toggleCanonHidden(entry.id))}
        aria-label={`${hidden ? 'Show' : 'Hide'} ${entry.label}`}
        className="inline-flex items-center text-text-secondary hover:text-text-primary p-0.5 rounded-[3px]"
      >
        {hidden ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Options for ${entry.label}`}
            className="inline-flex items-center text-text-secondary hover:text-text-primary p-0.5 rounded-[3px]"
          >
            <MoreHorizontal size={11} aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="overlay p-1 min-w-[170px] z-50" sideOffset={4} align="end">
            {isWidget ? (
              <WidgetMenuItems entry={entry} layerId={layerId} nodeLayers={nodeLayers} offline={offline} />
            ) : (
              <CanonicalMenuItems entry={entry} layerId={layerId} nodeLayers={nodeLayers} offline={offline} />
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function CanonicalMenuItems({ entry, layerId, nodeLayers, offline }: EntryRowProps) {
  const toggleCanonHidden = useEditorStore((s) => s.toggleCanonNodeHidden);
  const otherLayers = nodeLayers.filter((l) => l.id !== layerId);
  return (
    <>
      <DropdownMenu.Item className={ITEM_CLS} onSelect={() => editCanonicalInAdjustments(layerId, entry.defId!)}>
        Edit in Adjustments ↗
      </DropdownMenu.Item>
      <DropdownMenu.Item className={ITEM_CLS} onSelect={() => toggleCanonHidden(entry.id)}>
        Hide on this layer
      </DropdownMenu.Item>
      <DropdownMenu.Separator className="h-px bg-separator my-1" />
      <MoveCopySub label="Move to layer" disabled={offline || otherLayers.length === 0} layers={otherLayers}
        onPick={(to) => moveCanonicalToLayer(entry, layerId, to)} />
      <MoveCopySub label="Copy to layer" disabled={offline || otherLayers.length === 0} layers={otherLayers}
        onPick={(to) => copyCanonicalToLayer(entry, to)} />
      <DropdownMenu.Separator className="h-px bg-separator my-1" />
      <DropdownMenu.Item
        className={`${ITEM_CLS} text-[var(--color-danger,#e5484d)]`}
        data-disabled={offline || undefined}
        disabled={offline}
        onSelect={() => resetCanonicalOnLayer(entry, layerId)}
      >
        Reset on this layer
      </DropdownMenu.Item>
    </>
  );
}

function MoveCopySub({
  label,
  disabled,
  layers,
  onPick,
}: {
  label: string;
  disabled: boolean;
  layers: { id: string; name: string }[];
  onPick: (layerId: string) => void;
}) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={`${ITEM_CLS} flex items-center justify-between`} disabled={disabled}>
        {label}
        <ChevronRight size={10} aria-hidden />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className="overlay p-1 min-w-[120px] z-50" sideOffset={4}>
          {layers.map((l) => (
            <DropdownMenu.Item key={l.id} className={ITEM_CLS} onSelect={() => onPick(l.id)}>
              {l.name}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function WidgetMenuItems({ entry, nodeLayers, offline }: EntryRowProps) {
  const toggleWidgetHidden = useEditorStore((s) => s.toggleWidgetHidden);
  const focusWidget = useEditorStore((s) => s.focusWidget);
  const targets = entry.targetLayerIds ?? [];
  return (
    <>
      <DropdownMenu.Item className={ITEM_CLS} onSelect={() => focusWidget(entry.id)}>
        Focus on canvas ↗
      </DropdownMenu.Item>
      <DropdownMenu.Item className={ITEM_CLS} onSelect={() => toggleWidgetHidden(entry.id)}>
        Hide widget
      </DropdownMenu.Item>
      <DropdownMenu.Separator className="h-px bg-separator my-1" />
      <DropdownMenu.Label className={LABEL_CLS}>Applies to</DropdownMenu.Label>
      {nodeLayers.map((l) => {
        const checked = targets.includes(l.id);
        // The widget's last target can't be unchecked — a widget needs ≥1 layer.
        const disabled = offline || (checked && targets.length === 1);
        return (
          <DropdownMenu.CheckboxItem
            key={l.id}
            className={`${ITEM_CLS} flex items-center gap-1.5`}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => setWidgetTargetChecked(entry.widget!, l.id, next === true)}
          >
            <span className="w-3 text-[10px]">{checked ? '☑' : '☐'}</span>
            {l.name}
          </DropdownMenu.CheckboxItem>
        );
      })}
    </>
  );
}
