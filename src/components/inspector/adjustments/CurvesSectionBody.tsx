import { CurveControl } from '@/components/inspector/widget/primitives/CurveControl';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { IDENTITY_CURVES, type CurvesValue } from '@/types/curve';
import { useBackendState } from '@/store/backend-state-slice';

interface CurvesSectionBodyProps { layerId: string; }

export function CurvesSectionBody({ layerId }: CurvesSectionBodyProps) {
  const [value, setValue] = useCanonicalParam<CurvesValue>(layerId, 'curves', 'curves', IDENTITY_CURVES);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const sessionId = useBackendState((s) => s.sessionId);
  function reset() {
    if (!sessionId || offline) return;
    setValue(IDENTITY_CURVES);
  }
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <CurveControl label="Curves" value={value} onChange={setValue} />
      <div className="flex justify-end">
        <button type="button" onClick={reset} className="text-[10px] bg-surface text-text-primary border border-border-strong rounded-[4px] px-2 py-0.5 hover:bg-surface-secondary">Reset</button>
      </div>
    </div>
  );
}
