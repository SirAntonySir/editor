import { useEffect, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { SuggestionsSection } from './SuggestionsSection';
import { LayersSection } from './LayersSection';
import { InfoTab } from './info/InfoTab';

type Tab = 'adjustments' | 'info';

// Cross-component signal: the BackendStatusBar "Show context" button dispatches
// this to flip the inspector to the Info tab. Matches the codebase's existing
// window-event convention (e.g. 'spawn-palette:open').
export const INSPECTOR_SHOW_INFO_EVENT = 'inspector:show-info';

export function InspectorPanel() {
  const [tab, setTab] = useState<Tab>('adjustments');

  useEffect(() => {
    const onShowInfo = () => setTab('info');
    window.addEventListener(INSPECTOR_SHOW_INFO_EVENT, onShowInfo);
    return () => window.removeEventListener(INSPECTOR_SHOW_INFO_EVENT, onShowInfo);
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ToggleGroup.Root
        type="single"
        value={tab}
        onValueChange={(v) => v && setTab(v as Tab)}
        className="flex-none flex border-b border-separator"
      >
        <TabButton value="adjustments" label="Adjustments" active={tab === 'adjustments'} />
        <TabButton value="info" label="Info" active={tab === 'info'} />
      </ToggleGroup.Root>
      {tab === 'adjustments' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          <SuggestionsSection />
          <LayersSection />
        </div>
      ) : (
        <InfoTab />
      )}
    </div>
  );
}

function TabButton({ value, label, active }: { value: string; label: string; active: boolean }) {
  return (
    <ToggleGroup.Item value={value} asChild>
      <button
        type="button"
        className={`relative flex-1 text-[11px] py-1.5 transition-colors duration-150 ${
          active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        {label}
        {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent" />}
      </button>
    </ToggleGroup.Item>
  );
}

export const InspectorPanelBody = InspectorPanel;
