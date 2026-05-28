import { SlidersHorizontal } from 'lucide-react';
import { usePreferencesStore, type RightSidebarTab } from '@/store/preferences-store';
import { useEditorStore } from '@/store';
import { SidebarShell } from './SidebarShell';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { GraphPropertiesPanelBody } from '@/components/graph/GraphPropertiesPanel';

const TABS: { id: RightSidebarTab; label: string; Icon: typeof SlidersHorizontal }[] = [
  { id: 'inspector', label: 'Inspector', Icon: SlidersHorizontal },
];

export function RightSidebar() {
  const collapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const toggle = usePreferencesStore((s) => s.toggleRightSidebar);
  const width = usePreferencesStore((s) => s.rightSidebarWidth);
  const setWidth = usePreferencesStore((s) => s.setRightSidebarWidth);
  const tab = usePreferencesStore((s) => s.rightSidebarTab);
  const setTab = usePreferencesStore((s) => s.setRightSidebarTab);
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
        <TabStrip activeTab={tab} onSelect={setTab} />
        {tab === 'inspector' && (
          editorMode === 'graph'
            ? <GraphPropertiesPanelBody />
            : <InspectorPanel />
        )}
      </div>
    </SidebarShell>
  );
}

function TabStrip({
  activeTab,
  onSelect,
}: {
  activeTab: RightSidebarTab;
  onSelect: (id: RightSidebarTab) => void;
}) {
  return (
    <div className="flex-none flex border-b border-separator">
      {TABS.map((t) => {
        const active = t.id === activeTab;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium
              border-b-2 -mb-px transition-colors cursor-default
              ${active
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-secondary'
              }`}
          >
            <t.Icon size={12} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
