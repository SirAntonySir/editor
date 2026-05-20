import { History as HistoryIcon, Layers as LayersIcon } from 'lucide-react';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { SidebarShell, SidebarSection } from './SidebarShell';
import { LayersPanelActions, LayersPanelBody } from './LayersPanel';
import { HistoryPanelBody } from './HistoryPanel';

export function LeftSidebar() {
  const collapsed = usePreferencesStore((s) => s.leftSidebarCollapsed);
  const toggle = usePreferencesStore((s) => s.toggleLeftSidebar);
  const width = usePreferencesStore((s) => s.leftSidebarWidth);
  const setWidth = usePreferencesStore((s) => s.setLeftSidebarWidth);
  const layersOpen = useEditorStore((s) => s.layersSectionOpen);
  const toggleLayers = useEditorStore((s) => s.toggleLayersSection);
  const historyOpen = useEditorStore((s) => s.showHistoryPanel);
  const toggleHistory = useEditorStore((s) => s.toggleHistoryPanel);

  const bothOpen = layersOpen && historyOpen;

  return (
    <SidebarShell
      side="left"
      collapsed={collapsed}
      onToggle={toggle}
      width={width}
      onWidthChange={setWidth}
    >
      <SidebarSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <LayersIcon size={11} /> Layers
          </span>
        }
        open={layersOpen}
        onToggle={toggleLayers}
        actions={layersOpen ? <LayersPanelActions /> : undefined}
        flex={bothOpen ? '1 1 60%' : layersOpen ? '1 1 100%' : '0 0 auto'}
      >
        <LayersPanelBody />
      </SidebarSection>

      <SidebarSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <HistoryIcon size={11} /> History
          </span>
        }
        open={historyOpen}
        onToggle={toggleHistory}
        flex={bothOpen ? '1 1 40%' : historyOpen ? '1 1 100%' : '0 0 auto'}
      >
        <HistoryPanelBody />
      </SidebarSection>
    </SidebarShell>
  );
}
