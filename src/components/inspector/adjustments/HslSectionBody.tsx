import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { HSL_BANDS } from './hsl-bands';
import { HslPanelView } from './HslPanelView';
import { HslParamSlider } from './HslParamSlider';

const CHANNELS = ['hue', 'sat', 'lum'] as const;
const ALL_PARAMS = HSL_BANDS.flatMap((b) => CHANNELS.map((c) => `${b.key}_${c}`));
const EMPTY: Record<string, number> = {};

/** Inspector adapter: drives the shared HslPanelView from canonical params
 *  (`useCanonicalParam` → `set_param`). */
export function HslSectionBody({ layerId }: { layerId: string }) {
  const nodeId = `canon:${layerId}:hsl`;
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const params = useBackendState(
    (s) => (s.snapshot?.operationGraph.nodes.find((n) => n.id === nodeId)?.params ?? EMPTY) as Record<string, number>,
  );
  const opt = useBackendState((s) => s.optimistic.get(nodeId));

  const bandEdited = (band: string) =>
    CHANNELS.some((c) => {
      const key = `${band}_${c}`;
      const hit = opt?.bindings.find((b) => b.paramKey === key);
      const v = hit ? (hit.value as number) : (params[key] ?? 0);
      return v !== 0;
    });

  const renderSlider = (param: string, label: string, trackGradient: string) => (
    <HslParamSlider layerId={layerId} param={param} label={label} trackGradient={trackGradient} />
  );

  function reset() {
    if (!sessionId || offline) return;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    for (const param of ALL_PARAMS) {
      useBackendState.getState().applyOptimistic(nodeId, { bindings: [{ paramKey: param, value: 0 }], baseRevision });
      void backendTools.set_param(sessionId, { layerId, op: 'hsl', param, value: 0 });
    }
  }

  return (
    <div className="px-2.5 py-2">
      <HslPanelView renderSlider={renderSlider} bandEdited={bandEdited} onReset={reset} />
    </div>
  );
}
