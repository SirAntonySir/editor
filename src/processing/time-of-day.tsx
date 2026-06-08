import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition } from '@/types/processing';

const TimeOfDayIcon = createMaterialIcon('wb_twilight');

export const timeOfDayProcessing: ProcessingDefinition = {
  id: 'time-of-day',
  label: 'Time of Day',
  icon: TimeOfDayIcon,
  category: 'adjust',
  adjustmentType: 'compound',
  paramKeys: ['time_of_day.position'],
  params: [{ key: 'time_of_day.position', label: 'Time', min: 0, max: 1, default: 0.30 }],
  Panel: () => null,
};
