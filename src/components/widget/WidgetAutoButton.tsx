import { Wand2 } from 'lucide-react';
import type { Widget } from '@/types/widget';
import { useLiveMechanicalContext } from '@/hooks/useLiveMechanicalContext';
import { autoParamsForOp } from '@/lib/auto-tune';

interface Props {
  widget: Widget;
  /** Same closure WidgetShell uses for slider drags — handles optimistic
   *  patching + the set_widget_param round-trip. */
  setParam: (paramKey: string, value: number) => void;
}

/** Small "Auto" pill above the binding rows for widgets whose op_id has a
 *  mechanical auto recipe (light / color / kelvin / levels). Disabled when
 *  no mechanical snapshot exists yet. Deliberately *not* styled like AI —
 *  this is deterministic math over the live histogram + cast, no LLM. */
export function WidgetAutoButton({ widget, setParam }: Props) {
  const mech = useLiveMechanicalContext();
  const opId = widget.op_id ?? '';
  const recipeOps = new Set(['light', 'color', 'kelvin', 'levels']);
  if (!recipeOps.has(opId)) return null;
  const disabled = !mech;

  function handleClick() {
    if (!mech) return;
    const params = autoParamsForOp(opId, mech);
    if (!params) return;
    for (const [k, v] of Object.entries(params)) {
      if (widget.bindings.some((b) => b.paramKey === k)) setParam(k, v);
    }
  }

  return (
    <div className="flex items-center justify-end px-1.5 pt-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={
          disabled
            ? 'Mechanical analysis not ready yet'
            : 'Set sliders to mechanically-derived starting values'
        }
        className="inline-flex items-center gap-1 px-2 h-[18px] rounded-[3px]
          text-[10px] font-medium text-text-primary
          bg-surface-secondary hover:bg-surface-secondary/80
          border border-separator
          disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Wand2 size={10} aria-hidden />
        Auto
      </button>
    </div>
  );
}
