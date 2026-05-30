import { useImageContextFull } from '@/hooks/useImageContextFull';
import { SemanticSection } from './SemanticSection';
import { HistogramsSection } from './HistogramsSection';
import { ColorSection } from './ColorSection';
import { RegionsSection } from './RegionsSection';

export function InfoTab() {
  const ctx = useImageContextFull();
  if (!ctx) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-[10px] text-text-secondary">
        No image context yet.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <SemanticSection ctx={ctx} />
      <HistogramsSection ctx={ctx} />
      <ColorSection ctx={ctx} />
      <RegionsSection ctx={ctx} />
    </div>
  );
}
