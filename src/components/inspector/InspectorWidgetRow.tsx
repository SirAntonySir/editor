import { useFocusedWidget } from '@/store/focus-slice';
import type { UnifiedWidget } from '@/lib/widget-projection';

interface InspectorWidgetRowProps {
  uw: UnifiedWidget;
}

export function InspectorWidgetRow({ uw }: InspectorWidgetRowProps) {
  const focusedId = useFocusedWidget((s) => s.focusedId);
  const isFocused = focusedId === uw.id;

  function onRowClick() {
    useFocusedWidget.getState().setFocused(isFocused ? null : uw.id);
  }

  const reasoning = uw._widget?.reasoning;

  return (
    <>
      <div
        onClick={onRowClick}
        onMouseEnter={() => useFocusedWidget.getState().setHovered(uw.id)}
        onMouseLeave={() => useFocusedWidget.getState().setHovered(null)}
        className={
          'grid items-center cursor-pointer text-[10px] py-1 border-b border-separator ' +
          (isFocused ? 'text-text-primary' : 'hover:bg-surface-secondary text-text-primary')
        }
        style={{ gridTemplateColumns: '14px 1fr 50px 14px', gap: 6 }}
      >
        <span className={
          'w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[7px] font-semibold leading-none ' +
          (uw.variant === 'ai' ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary')
        }>
          {uw.variant === 'ai' ? 'AI' : '·'}
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

function scopeLabel(scope: UnifiedWidget['scope']): string {
  const kind = (scope as { kind: string }).kind;
  switch (kind) {
    case 'global': return 'global';
    case 'named_region':
    case 'mask:proposed':
      return (scope as { label: string }).label;
    case 'mask:click':
      return (scope as { mask_id?: string }).mask_id ? 'segment' : 'global';
    case 'mask':
      return (scope as { maskRef?: string }).maskRef ? 'segment' : 'global';
    default: return 'global';
  }
}
