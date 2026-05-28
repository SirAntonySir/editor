import { SlidersHorizontal } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { useEditorStore } from '@/store';
import { useSegmentSelection } from '@/store/segment-selection-slice';

export const LevelsTool: ToolDefinition = {
  name: 'levels',
  label: 'Levels',
  icon: SlidersHorizontal,
  category: 'adjust',
  processingId: 'levels',
  onActivate: () => {
    const sid = useSegmentSelection.getState().selectedSegmentId;
    useEditorStore.getState().setActiveScope(
      sid ? { kind: 'mask', mask_id: sid } : null,
    );
  },
};
