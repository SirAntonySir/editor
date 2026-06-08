import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const TimeOfDayIcon = createMaterialIcon('wb_twilight');

export const TimeOfDayTool: ToolDefinition = {
  name: 'time-of-day',
  label: 'Time of Day',
  icon: TimeOfDayIcon,
  category: 'adjust',
  processingId: 'time-of-day',
  onActivate: () => {},
};
