import { Spline } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { CurvesPanel as CurvesPanelImpl } from '@/tools/curves-tool';

function CurvesPanel({ layerId }: ProcessingPanelProps) {
  return <CurvesPanelImpl layerId={layerId} />;
}

function CurvesNodeCompact({ layerId, adjustmentId }: ProcessingPanelProps) {
  // Compact: just label, no scrubbers (curves doesn't have simple scalar params)
  void layerId;
  void adjustmentId;
  return (
    <div className="px-3 py-1.5">
      <span className="text-[10px] text-text-secondary">Curves</span>
    </div>
  );
}

export const curvesProcessing: ProcessingDefinition = {
  id: 'curves',
  label: 'Curves',
  icon: Spline,
  category: 'adjust',
  adjustmentType: 'curves',
  params: [], // Curves uses Float32Array LUTs, not scalar params
  Panel: CurvesPanel,
  NodeCompactDisplay: CurvesNodeCompact,
};
