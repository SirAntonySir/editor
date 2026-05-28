import { Sun } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { useEditorStore } from '@/store';
import { useSegmentSelection } from '@/store/segment-selection-slice';

export const LightTool: ToolDefinition = {
  name: 'light',
  label: 'Light',
  icon: Sun,
  category: 'adjust',
  shortcut: 'B',
  processingId: 'light',
  onActivate: () => {
    const sid = useSegmentSelection.getState().selectedSegmentId;
    useEditorStore.getState().setActiveScope(
      sid ? { kind: 'mask', mask_id: sid } : null,
    );
  },
};
