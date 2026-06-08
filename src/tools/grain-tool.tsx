import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const GrainIcon = createMaterialIcon('grain');

export const GrainTool: ToolDefinition = {
  name: 'grain',
  label: 'Grain',
  icon: GrainIcon,
  category: 'adjust',
  processingId: 'grain',
  onActivate: () => {},
};
