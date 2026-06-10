import { useEditorStore } from '@/store';

interface ObjectModeFooterProps {
  imageNodeId: string;
  layerCount: number;
  objectCount: number;
  currentMode: 'layers' | 'objects';
}

function PillButton({
  active, label, onClick,
}: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'px-1.5 py-0.5 rounded-[3px] text-[9px] font-sans leading-none transition-[background,color] duration-[120ms]',
        active
          ? 'bg-accent-selected/15 text-text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary/40',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function ObjectModeFooter({
  imageNodeId, layerCount, objectCount, currentMode,
}: ObjectModeFooterProps) {
  const setMode = useEditorStore((s) => s.setImageNodeMode);
  return (
    <div className="flex items-center gap-1">
      <PillButton
        active={currentMode === 'layers'}
        label={`Layers · ${layerCount}`}
        onClick={() => setMode(imageNodeId, 'layers')}
      />
      <PillButton
        active={currentMode === 'objects'}
        label={`Objects · ${objectCount}`}
        onClick={() => setMode(imageNodeId, 'objects')}
      />
    </div>
  );
}
