/**
 * A serialisable recipe — a named point in adjustment space.
 * `position` is a 1-D or 2-D coordinate in the dial's input space.
 * `params` keys are `${op}.${param}` strings (op = ProcessingDefinition id).
 */
export interface Anchor {
  id: string;
  label: string;
  position: number[];
  params: Record<string, number>;
}

/** Flat output of `interpolate`: the same `${op}.${param}` key shape as Anchor.params. */
export type CompoundParams = Record<string, number>;

/** Per-op patch produced by `compileToWidgetParams`. */
export interface OpPatch {
  op: string;                 // ProcessingDefinition id ('light', 'kelvin', …)
  params: Record<string, number>;
}
