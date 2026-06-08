import type { Scope } from './scope';
import type { CurvesValue } from './curve';
export type { Scope, MaskRef } from './scope';

export interface Node {
  id: string;
  type: string;
  scope: Scope;
  // Numeric scalars, strings (e.g. blend mode), booleans (e.g. enabled),
  // CurvesValue (legacy per-channel curve points), or a flat curve_points
  // array (`[[x, y], ...]` in 0..1 space, used by fused-tool curve bindings).
  params: Record<string, number | string | boolean | CurvesValue | [number, number][]>;
  inputs: string[];
  layer_id?: string;
  layer_ids?: string[];  // node-scope: applied to composite of these layers
  widget_id?: string;
}

export interface PanelBinding {
  nodeId: string;
  paramKey: string;
  label: string;
  control: 'slider' | 'toggle' | 'picker';
  min?: number;
  max?: number;
  default?: number | string | boolean;
  step?: number;
  reasoning?: string;
}

export interface OperationGraph {
  id: string;
  userGoal: string;
  reasoning?: string;
  nodes: Node[];
  panelBindings: PanelBinding[];
  metadata: Record<string, string>;
}
