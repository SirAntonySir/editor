import { usePreferencesStore } from '@/store/preferences-store';
import { useEditorStore } from '@/store';
import { SidebarShell } from './SidebarShell';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

/** The right sidebar wraps the inspector (adjustments, info tab, crop). Every
 *  panel inside it gates on a selected image-node — without one the inspector
 *  renders empty rows + disabled affordances, which read as "broken UI" rather
 *  than "no work to do". Drop the whole sidebar from the layout while no
 *  image-node is selected; the main canvas reclaims that space. The sidebar
 *  reappears the instant the user clicks an image-node. */
export function RightSidebar() {
  const collapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const toggle = usePreferencesStore((s) => s.toggleRightSidebar);
  const width = usePreferencesStore((s) => s.rightSidebarWidth);
  const setWidth = usePreferencesStore((s) => s.setRightSidebarWidth);
  const hasImageNodeSelected = useEditorStore((s) => s.activeImageNodeId !== null);

  if (!hasImageNodeSelected) return null;

  return (
    <SidebarShell
      side="right"
      collapsed={collapsed}
      onToggle={toggle}
      width={width}
      onWidthChange={setWidth}
    >
      <div className="flex flex-col h-full">
        <ErrorBoundary label="inspector">
          <InspectorPanel />
        </ErrorBoundary>
      </div>
    </SidebarShell>
  );
}
