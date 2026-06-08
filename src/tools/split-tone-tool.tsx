import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const SplitToneIcon = createMaterialIcon('gradient');

export const SplitToneTool: ToolDefinition = {
  name: 'splitTone',
  label: 'Split Tone',
  icon: SplitToneIcon,
  category: 'adjust',
  processingId: 'splitTone',
  onActivate: () => {},
};
