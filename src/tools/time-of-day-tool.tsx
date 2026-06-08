import { Sun } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const TimeOfDayTool: ToolDefinition = {
  name: 'time-of-day',
  label: 'Time of Day',
  icon: Sun,
  category: 'adjust',
  processingId: 'time-of-day',
  onActivate: () => {},
};
