import { SuggestionsSection } from './SuggestionsSection';
import { ActiveSection } from './ActiveSection';
import { LayersSection } from './LayersSection';

export function InspectorPanel() {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SuggestionsSection />
      <ActiveSection />
      <LayersSection />
    </div>
  );
}

export const InspectorPanelBody = InspectorPanel;
