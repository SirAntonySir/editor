import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const VignetteIcon = createMaterialIcon('vignette');

export const VignetteTool: ToolDefinition = {
  name: 'vignette',
  label: 'Vignette',
  icon: VignetteIcon,
  category: 'adjust',
  processingId: 'vignette',
  onActivate: () => {},
};
