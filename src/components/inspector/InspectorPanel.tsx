import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { usePreferencesStore, type InspectorTab } from '@/store/preferences-store';
import { AdjustmentsAccordion } from './adjustments/AdjustmentsAccordion';
import { InfoTab } from './info/InfoTab';

// The active inner tab is store-driven (preferences-store.inspectorTab) so other
// chrome — e.g. the BackendStatusBar "Show context" button via showImageContext()
// — can select it AND open the sidebar, even while this panel is unmounted.
export function InspectorPanel() {
  const tab = usePreferencesStore((s) => s.inspectorTab);
  const setTab = usePreferencesStore((s) => s.setInspectorTab);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ToggleGroup.Root
        type="single"
        value={tab}
        onValueChange={(v) => v && setTab(v as InspectorTab)}
        className="flex-none flex border-b border-separator"
      >
        <TabButton value="adjustments" label="Adjustments" active={tab === 'adjustments'} />
        <TabButton value="info" label="Info" active={tab === 'info'} />
      </ToggleGroup.Root>
      {tab === 'adjustments' ? (
        <AdjustmentsAccordion />
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
