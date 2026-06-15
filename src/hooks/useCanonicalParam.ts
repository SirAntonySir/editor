import { useParam } from '@/lib/use-param';
import type { ControlValue } from '@/types/widget';

/** Thin wrapper over {@link useParam} preserving the legacy positional
 *  signature for inspector adjustment panels. All real work lives in
 *  `useParam` — fix bugs there, not here. */
export function useCanonicalParam<T extends ControlValue = number>(
  layerId: string | null,
  op: string,
  param: string,
  defaultValue: T,
): [T, (v: T) => void] {
  return useParam<T>({ kind: 'canonical', layerId, op, param }, defaultValue);
}
