import { Sun } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { TimeOfDayWidgetBody } from '@/components/workspace/TimeOfDayWidgetBody';
import { useBackendState } from '@/store/backend-state-slice';

function TimeOfDayPanel({ adjustmentId }: ProcessingPanelProps) {
  const widget = useBackendState((s) => s.snapshot?.widgets.find((w) => w.id === adjustmentId));
  if (!widget) return null;
  return <TimeOfDayWidgetBody widget={widget} />;
}

export const timeOfDayProcessing: ProcessingDefinition = {
  id: 'time-of-day',
  label: 'Time of Day',
  icon: Sun,
  category: 'adjust',
  adjustmentType: 'compound',
  paramKeys: ['time_of_day.position'],
  params: [{ key: 'time_of_day.position', label: 'Time', min: 0, max: 1, default: 0.30 }],
  Panel: TimeOfDayPanel,
};
