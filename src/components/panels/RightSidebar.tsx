import { usePreferencesStore } from '@/store/preferences-store';
import { useEditorStore } from '@/store';
import { SidebarShell } from './SidebarShell';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';

/** The right sidebar wraps the inspector (adjustments, info tab, crop). Every
 *  panel inside it gates on `activeLayerId` / an open image — without one the
 *  inspector renders empty rows + disabled affordances, which read as
 *  "broken UI" rather than "no work to do". Drop the whole sidebar from the
 *  layout while there are no layers; the main canvas reclaims that space.
 *  The sidebar reappears the instant the user opens an image. */
export function RightSidebar() {
  const collapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const toggle = usePreferencesStore((s) => s.toggleRightSidebar);
  const width = usePreferencesStore((s) => s.rightSidebarWidth);
  const setWidth = usePreferencesStore((s) => s.setRightSidebarWidth);
  const hasImage = useEditorStore((s) => s.layers.length > 0);

  if (!hasImage) return null;

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
