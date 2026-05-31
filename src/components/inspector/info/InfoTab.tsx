import { useImageContextFull } from '@/hooks/useImageContextFull';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { SemanticSection } from './SemanticSection';
import { HistogramsSection } from './HistogramsSection';
import { ColorSection } from './ColorSection';
import { RegionsSection } from './RegionsSection';
import { AnalysisProgressSection } from './AnalysisProgressSection';
import { NoContextState } from './NoContextState';

export function InfoTab() {
  const ctx = useImageContextFull();
  const phases = useBackendState((s) => s.phases);
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);
  const aiStatus = useAiSession((s) => s.status);

  const preAnalyze = aiStatus === 'uploading' || aiStatus === 'analysing';
  const inAnalyze = preAnalyze || (phases !== null && !mcpComplete);
  const livePhases = mcpComplete ? null : phases;
  const prePhaseText =
    livePhases
      ? null
      : aiStatus === 'uploading'
      ? 'Uploading image…'
      : aiStatus === 'analysing'
      ? 'Connecting to backend…'
      : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      {inAnalyze && (
        <AnalysisProgressSection phases={livePhases} prePhaseText={prePhaseText} />
      )}
      {ctx ? (
        <>
          <SemanticSection ctx={ctx} />
          <HistogramsSection ctx={ctx} />
          <ColorSection ctx={ctx} />
          <RegionsSection ctx={ctx} />
        </>
      ) : (
        !inAnalyze && <NoContextState />
      )}
    </div>
  );
}
