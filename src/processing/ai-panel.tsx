import { Sparkles } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { AiPanelSection } from '@/components/inspector/AiPanelSection';

function AiPanelProcessingPanel({ layerId }: ProcessingPanelProps) {
  return <AiPanelSection layerId={layerId} />;
}

export const aiPanelProcessing: ProcessingDefinition = {
  id: 'ai-panel',
  label: 'AI Suggestion',
  icon: Sparkles,
  category: 'ai',
  adjustmentType: 'ai-panel',
  paramKeys: [],
  params: [],
  Panel: AiPanelProcessingPanel,
};
