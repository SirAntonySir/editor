import { useFocusedWidget } from '@/store/focus-slice';
import type { UnifiedWidget } from '@/lib/widget-projection';

interface InspectorWidgetRowProps {
  uw: UnifiedWidget;
}

export function InspectorWidgetRow({ uw }: InspectorWidgetRowProps) {
  const focusedId = useFocusedWidget((s) => s.focusedId);
  const isFocused = focusedId === uw.id;

  function onClick() {
    useFocusedWidget.getState().setFocused(uw.id);
  }

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => useFocusedWidget.getState().setHovered(uw.id)}
      onMouseLeave={() => useFocusedWidget.getState().setHovered(null)}
      className={
        'flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer ' +
        (isFocused ? 'bg-accent/10 border-l-2 border-accent' : 'hover:bg-surface-secondary')
      }
    >
      <span className={
        'w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[8px] ' +
        (uw.variant === 'ai' ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary')
      }>
        {uw.variant === 'ai' ? 'AI' : '·'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-text-primary font-medium truncate">{uw.intent}</div>
        <div className="text-text-secondary text-[10px] truncate">
          scope · {scopeLabel(uw.scope)}
        </div>
      </div>
    </div>
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
