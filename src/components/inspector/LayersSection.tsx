import { LayersPanelBody } from '@/components/panels/LayersPanel';

export function LayersSection() {
  return (
    <section className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary px-2 pt-2 pb-1">
        Layers
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LayersPanelBody />
      </div>
    </section>
  );
}
