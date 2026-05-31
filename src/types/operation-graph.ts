import type { Scope } from './scope';
import type { CurvesValue } from './curve';
export type { Scope, MaskRef } from './scope';

export interface Node {
  id: string;
  type: string;
  scope: Scope;
  // CurvesValue lets a curves node carry its per-channel control points.
  params: Record<string, number | string | boolean | CurvesValue>;
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
