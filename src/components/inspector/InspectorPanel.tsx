import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { usePreferencesStore, type InspectorTab } from '@/store/preferences-store';
import { useEditorStore } from '@/store';
import { track } from '@/lib/telemetry';
import { AdjustmentsAccordion } from './adjustments/AdjustmentsAccordion';
import { InfoTab } from './info/InfoTab';
import { LayerTab } from './layer/LayerTab';
import { CropTab } from './crop/CropTab';

// The active inner tab is store-driven (preferences-store.inspectorTab) so other
// chrome — e.g. the BackendStatusBar "Show context" button via showImageContext()
// — can select it AND open the sidebar, even while this panel is unmounted.
export function InspectorPanel() {
  const tab = usePreferencesStore((s) => s.inspectorTab);
  const setTab = usePreferencesStore((s) => s.setInspectorTab);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const cropDisabled = activeImageNodeId === null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ToggleGroup.Root
        type="single"
        value={tab}
        onValueChange={(v) => {
          if (!v) return;
          if (v !== tab) track('inspector.tab', { from: tab, to: v });
          setTab(v as InspectorTab);
        }}
        className="flex-none flex border-b border-separator"
      >
        <TabButton value="adjustments" label="Adjustments" active={tab === 'adjustments'} />
        <TabButton value="info" label="Info" active={tab === 'info'} />
        <TabButton value="layer" label="Layer" active={tab === 'layer'} />
        <TabButton value="crop" label="Crop" active={tab === 'crop'} disabled={cropDisabled} />
      </ToggleGroup.Root>
      {tab === 'adjustments' && <AdjustmentsAccordion />}
      {tab === 'info' && <InfoTab />}
      {tab === 'layer' && <LayerTab />}
      {tab === 'crop' && <CropTab />}
    </div>
  );
}

function TabButton({
  value, label, active, disabled = false,
}: { value: string; label: string; active: boolean; disabled?: boolean }) {
  return (
    <ToggleGroup.Item value={value} asChild disabled={disabled}>
      <button
        type="button"
        disabled={disabled}
        className={`relative flex-1 text-[11px] py-1.5 transition-colors duration-150 ${
          disabled
            ? 'text-text-tertiary cursor-not-allowed'
            : active
              ? 'text-text-primary'
              : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        {label}
        {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[var(--color-accent)]" />}
      </button>
    </ToggleGroup.Item>
  );
}

export const InspectorPanelBody = InspectorPanel;
