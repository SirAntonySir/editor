import { useEffect } from 'react';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import { usePreferencesStore, type RightSidebarTab } from '@/store/preferences-store';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { useAiChips } from '@/store/ai-chips-store';
import { setPaletteOpenHandler } from '@/lib/palette-bus';
import { SidebarShell } from './SidebarShell';
import { InspectorPanelBody } from '@/components/inspector/InspectorPanel';
import { GraphPropertiesPanelBody } from '@/components/graph/GraphPropertiesPanel';
import { AiCommandPalette } from '@/components/AiCommandPalette';

const TABS: { id: RightSidebarTab; label: string; Icon: typeof SlidersHorizontal }[] = [
  { id: 'inspector', label: 'Inspector', Icon: SlidersHorizontal },
  { id: 'ai', label: 'AI', Icon: Sparkles },
];

export function RightSidebar() {
  const collapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const toggle = usePreferencesStore((s) => s.toggleRightSidebar);
  const width = usePreferencesStore((s) => s.rightSidebarWidth);
  const setWidth = usePreferencesStore((s) => s.setRightSidebarWidth);
  const tab = usePreferencesStore((s) => s.rightSidebarTab);
  const setTab = usePreferencesStore((s) => s.setRightSidebarTab);
  const editorMode = useEditorStore((s) => s.editorMode);
  const sessionId = useAiSession((s) => s.sessionId);
  const hasContext = useAiSession((s) => s.context != null);

  // External code may request the AI palette via openPaletteWith(target, intent).
  // The palette already pushes its own target updates onto the palette-bus
  // (commitTargetChange → setPaletteSeed); here we just uncollapse the sidebar,
  // switch to the AI tab, and focus the input.
  useEffect(() => {
    setPaletteOpenHandler(() => {
      usePreferencesStore.setState({
        rightSidebarCollapsed: false,
        rightSidebarTab: 'ai',
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLTextAreaElement>('[data-palette-input="sidebar"]');
          el?.focus();
          el?.select();
        });
      });
    });
    return () => {
      setPaletteOpenHandler(null);
    };
  }, []);

  // Auto-open the right sidebar on the AI tab when a new chip is added.
  useEffect(() => {
    let prevLen = useAiChips.getState().chips.length;
    return useAiChips.subscribe((state) => {
      if (state.chips.length > prevLen) {
        usePreferencesStore.setState({
          rightSidebarCollapsed: false,
          rightSidebarTab: 'ai',
        });
      }
      prevLen = state.chips.length;
    });
  }, []);

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
            : <InspectorPanelBody />
        )}
        {tab === 'ai' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <AiCommandPalette disabled={!sessionId && !hasContext} />
          </div>
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
