import { useBackendState } from '@/store/backend-state-slice';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { loadRegistry } from '@/lib/registry/loader';
import { widgetTargetLayerIds } from '@/lib/widget-targets';
import { resolveWidgetTitle } from '@/lib/widget-title';
import { strandColorVarForCategory } from '@/lib/tether-strands';
import {
  CURVE_CHANNELS,
  IDENTITY_CURVE_PAIRS,
  isIdentityCurvePairs,
  sectionSummary,
} from '@/components/inspector/adjustments/section-summary';
import type { ControlValue, Widget } from '@/types/widget';

/** One touched param of a canonical entry, with the value a Move/Copy writes
 *  to the target layer and the value a Move resets the source back to. */
export interface TouchedParam {
  key: string;
  value: ControlValue;
  resetValue: ControlValue;
}

export interface LayerAdjustmentEntry {
  kind: 'canonical' | 'widget';
  /** Canon node id (`canon:<layer>:<op>`) or widget id. */
  id: string;
  label: string;
  /** `var(--strand-…)` for the entry's swatch. */
  colorVar: string;
  /** Canonical only — ProcessingDefinition id (accordion section key). */
  defId?: string;
  /** Canonical only — engine node type (set_param's `op`). */
  op?: string;
  /** Canonical only — params a Move/Copy carries. */
  touchedParams?: TouchedParam[];
  /** Widget only — full resolved target set. */
  targetLayerIds?: string[];
  /** Widget only — the snapshot widget. */
  widget?: Widget;
}

const EMPTY_PARAMS: Record<string, unknown> = {};

/**
 * Everything hitting `layerId`, derived from the backend snapshot:
 * canonical tool edits (`canon:<layerId>:<op>` nodes with ≥1 touched param)
 * followed by active widgets whose target set includes the layer. Touched
 * means the same thing as the Adjustments accordion's badge —
 * `sectionSummary` for scalars, non-identity channels for curves.
 */
export function useLayerAdjustments(layerId: string): LayerAdjustmentEntry[] {
  return useBackendState((s) => {
    const snap = s.snapshot;
    if (!snap) return EMPTY_ENTRIES;
    const entries: LayerAdjustmentEntry[] = [];

    for (const def of ProcessingRegistry.getByCategory('adjust')) {
      const nodeId = `canon:${layerId}:${def.adjustmentType}`;
      const node = snap.operationGraph.nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      const params = (node.params ?? EMPTY_PARAMS) as Record<string, unknown>;

      const touched: TouchedParam[] = [];
      if (def.adjustmentType === 'curves') {
        for (const ch of CURVE_CHANNELS) {
          if (!isIdentityCurvePairs(params[ch])) {
            touched.push({
              key: ch,
              value: params[ch] as ControlValue,
              resetValue: IDENTITY_CURVE_PAIRS as unknown as ControlValue,
            });
          }
        }
      } else {
        const { dirty } = sectionSummary(def.params, params);
        if (dirty) {
          for (const p of def.params) {
            const raw = params[p.key];
            const v = typeof raw === 'number' ? raw : (p.default as number);
            if (v !== p.default) {
              touched.push({ key: p.key, value: v, resetValue: p.default as number });
            }
          }
        }
      }
      if (touched.length === 0) continue;

      entries.push({
        kind: 'canonical',
        id: nodeId,
        label: def.label,
        colorVar: strandColorVarForCategory(loadRegistry().ops[def.id]?.category),
        defId: def.id,
        op: def.adjustmentType,
        touchedParams: touched,
      });
    }

    for (const w of snap.widgets) {
      // Accepted widgets still shape the layer's pixels — only dismissed
      // ones stop applying.
      if (w.status === 'dismissed') continue;
      const targets = widgetTargetLayerIds(w);
      if (!targets.includes(layerId)) continue;
      entries.push({
        kind: 'widget',
        id: w.id,
        label: resolveWidgetTitle(w),
        colorVar: strandColorVarForCategory(w.category),
        targetLayerIds: targets,
        widget: w,
      });
    }

    return entriesCache(layerId, entries);
  });
}

// Zustand selector must return a referentially-stable value when nothing
// changed, or every store write re-renders the consumer. Cache the last
// result per layer and reuse it when deep-equal.
const EMPTY_ENTRIES: LayerAdjustmentEntry[] = [];
const lastByLayer = new Map<string, LayerAdjustmentEntry[]>();

function entriesCache(layerId: string, next: LayerAdjustmentEntry[]): LayerAdjustmentEntry[] {
  if (next.length === 0) return EMPTY_ENTRIES;
  const prev = lastByLayer.get(layerId);
  if (prev && prev.length === next.length && prev.every((p, i) => sameEntry(p, next[i]))) {
    return prev;
  }
  lastByLayer.set(layerId, next);
  return next;
}

function sameEntry(a: LayerAdjustmentEntry, b: LayerAdjustmentEntry): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.kind === b.kind &&
    a.widget === b.widget &&
    JSON.stringify(a.touchedParams) === JSON.stringify(b.touchedParams) &&
    JSON.stringify(a.targetLayerIds) === JSON.stringify(b.targetLayerIds)
  );
}
