import { usePreferencesStore } from '@/store/preferences-store';
import { useEditorStore } from '@/store';
import { SidebarShell } from './SidebarShell';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { GraphPropertiesPanelBody } from '@/components/graph/GraphPropertiesPanel';

export function RightSidebar() {
  const collapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const toggle = usePreferencesStore((s) => s.toggleRightSidebar);
  const width = usePreferencesStore((s) => s.rightSidebarWidth);
  const setWidth = usePreferencesStore((s) => s.setRightSidebarWidth);
  const editorMode = useEditorStore((s) => s.editorMode);

  return (
    <SidebarShell
      side="right"
      collapsed={collapsed}
      onToggle={toggle}
      width={width}
      onWidthChange={setWidth}
    >
      <div className="flex flex-col h-full">
        {editorMode === 'graph' ? <GraphPropertiesPanelBody /> : <InspectorPanel />}
      </div>
    </SidebarShell>
  );
}
