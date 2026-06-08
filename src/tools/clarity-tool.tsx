import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const ClarityIcon = createMaterialIcon('auto_awesome');

export const ClarityTool: ToolDefinition = {
  name: 'clarity',
  label: 'Clarity',
  icon: ClarityIcon,
  category: 'adjust',
  processingId: 'clarity',
  onActivate: () => {},
};
