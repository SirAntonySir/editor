import { useParam } from '@/lib/use-param';

/** Thin wrapper over {@link useParam} preserving the legacy positional
 *  signature for widget bodies. All real work lives in `useParam`.
 *
 *  The first two positional arguments (`_layerId`, `_adjustmentType`)
 *  are kept for API compatibility with existing call sites; routing
 *  is via the widget id only. */
export function useProcessingParam(
  _layerId: string,
  _adjustmentType: string,
  adjustmentId: string | undefined,
  paramName: string,
  defaultValue: number,
): [number, (v: number) => void] {
  return useParam<number>({ kind: 'widget', widgetId: adjustmentId, paramKey: paramName }, defaultValue);
}
