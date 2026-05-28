import { usePreferencesStore } from '@/store/preferences-store';
import { SidebarShell } from './SidebarShell';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';

export function RightSidebar() {
  const collapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const toggle = usePreferencesStore((s) => s.toggleRightSidebar);
  const width = usePreferencesStore((s) => s.rightSidebarWidth);
  const setWidth = usePreferencesStore((s) => s.setRightSidebarWidth);

  return (
    <SidebarShell
      side="right"
      collapsed={collapsed}
      onToggle={toggle}
      width={width}
      onWidthChange={setWidth}
    >
      <div className="flex flex-col h-full">
        <InspectorPanel />
      </div>
    </SidebarShell>
  );
}
