import { Palette } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { useEditorStore } from '@/store';
import { useSegmentSelection } from '@/store/segment-selection-slice';

export const ColorTool: ToolDefinition = {
  name: 'color',
  label: 'Color',
  icon: Palette,
  category: 'adjust',
  processingId: 'color',
  onActivate: () => {
    const sid = useSegmentSelection.getState().selectedSegmentId;
    useEditorStore.getState().setActiveScope(
      sid ? { kind: 'mask', maskRef: sid } : null,
    );
  },
};
