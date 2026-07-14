import { loadRegistry } from '@/lib/registry/loader';
import type { Widget } from '@/types/widget';

/** The user-facing widget title: explicit displayName, else the registry
 *  op's display_name, else the raw intent. Shared by the widget header and
 *  the Layers tab's adjustment list so the same widget never shows two
 *  different names. */
export function resolveWidgetTitle(widget: Widget): string {
  if (widget.displayName) return widget.displayName;
  const reg = loadRegistry();
  const op = widget.opId ? reg.ops[widget.opId] : undefined;
  if (op) return op.display_name;
  return widget.intent;
}
