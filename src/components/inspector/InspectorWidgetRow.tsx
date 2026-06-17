import { useEditorStore } from '@/store';
import type { Widget } from '@/types/widget';

interface InspectorWidgetRowProps {
  uw: Widget;
}

export function InspectorWidgetRow({ uw }: InspectorWidgetRowProps) {
  const focusedId = useEditorStore((s) => s.focusedWidgetId);
  const isFocused = focusedId === uw.id;

  function onRowClick() {
    useEditorStore.getState().focusWidget(isFocused ? null : uw.id);
  }

  const variant = uw.origin.kind === 'tool_invoked' ? 'tool' : 'ai';
  const reasoning = uw.reasoning;

  return (
    <>
      <div
        onClick={onRowClick}
        className={
          'grid items-center cursor-pointer text-[10px] py-1 border-b border-separator ' +
          (isFocused ? 'text-text-primary' : 'hover:bg-surface-secondary text-text-primary')
        }
        style={{ gridTemplateColumns: '14px 1fr 50px 14px', gap: 6 }}
      >
        <span className={
          'w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[7px] font-semibold leading-none ' +
          (variant === 'ai' ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary')
        }>
          {variant === 'ai' ? 'AI' : '·'}
        </span>
        <span className="truncate">{uw.intent}</span>
        <span className="text-text-secondary text-[9px] text-right truncate">
          {scopeLabel(uw.scope)}
        </span>
        <span className="text-text-secondary text-[9px] inline-block transition-transform" style={{ transform: isFocused ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▸
        </span>
      </div>
      {isFocused && reasoning && (
        <div className="bg-accent/5 px-2 py-1.5 border-b border-separator text-[9px] text-text-secondary leading-snug">
          {reasoning}
        </div>
      )}
    </>
  );
}

function scopeLabel(scope: Widget['scope']): string {
  switch (scope.kind) {
    case 'global': return 'global';
    case 'named_region':
    case 'mask:proposed':
      return scope.label;
    case 'mask':
      return scope.mask_id ? 'segment' : 'global';
    default: return 'global';
  }
}
