import type { Scope } from './scope';
export type { Scope, MaskRef } from './scope';

export interface Node {
  id: string;
  type: string;
  scope: Scope;
  params: Record<string, number | string | boolean>;
  inputs: string[];
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
