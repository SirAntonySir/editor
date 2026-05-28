// Mirrors backend/app/schemas/widget.py + state/snapshot.py + state/events.

import type { Scope } from './scope';
export type { Scope } from './scope';

export type ControlType =
  | 'slider'
  | 'toggle'
  | 'choice'
  | 'color'
  | 'region_picker'
  | 'mask_thumbnail';

export interface SliderSchema {
  control_type: 'slider';
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface ToggleSchema {
  control_type: 'toggle';
  on_label: string;
  off_label: string;
}

export interface ChoiceSchema {
  control_type: 'choice';
  options: { value: string; label: string; description?: string }[];
}

export interface ColorSchema {
  control_type: 'color';
  mode: 'rgb' | 'hex';
}

export interface RegionPickerSchema {
  control_type: 'region_picker';
}

export interface MaskThumbnailSchema {
  control_type: 'mask_thumbnail';
}

export type ControlSchema =
  | SliderSchema
  | ToggleSchema
  | ChoiceSchema
  | ColorSchema
  | RegionPickerSchema
  | MaskThumbnailSchema;

export type ControlValue = number | string | boolean;

export interface NodeParamTarget {
  node_id: string;
  param_key: string;
}

export interface ControlBinding {
  param_key: string;
  label: string;
  control_type: ControlType;
  target: NodeParamTarget;
  control_schema: ControlSchema;
  value: ControlValue;
  default: ControlValue;
  reasoning?: string;
}

export type ParamValue = number | string | boolean;

export interface WidgetNode {
  id: string;
  type: string;
  params: Record<string, ParamValue>;
  scope: Scope;
  inputs: string[];
  widget_id: string;
}

export type WidgetOriginKind =
  | 'mcp_user_prompt'
  | 'mcp_autonomous'
  | 'fused_expansion'
  | 'refine'
  | 'repeat'
  | 'tool_invoked';

export type WidgetAnchor =
  | { kind: 'region_label'; label: string }
  | { kind: 'mask_id'; mask_id: string }
  | { kind: 'image_point'; x: number; y: number }
  | { kind: 'global' };

export interface WidgetOrigin {
  kind: WidgetOriginKind;
  prompt?: string | null;
  parent_widget_id?: string | null;
  anchor?: WidgetAnchor;
}

export interface WidgetPreview {
  kind: 'thumbnail' | 'histogram_delta' | 'color_swatches' | 'none';
  auto_before_after: boolean;
}

export interface Widget {
  id: string;
  intent: string;
  reasoning?: string;
  scope: Scope;
  origin: WidgetOrigin;
  fused_tool_id?: string;
  composed: boolean;
  nodes: WidgetNode[];
  bindings: ControlBinding[];
  preview: WidgetPreview;
  rejected_attempts: unknown[];
  status: 'active' | 'dismissed';
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface MaskSummary {
  id: string;
  width: number;
  height: number;
  source: string;
  label: string | null;
}

// Re-export the existing OperationGraph type for the snapshot.
import type { OperationGraph } from './operation-graph';

export interface SessionStateSnapshot {
  session_id: string;
  image_context: unknown | null;     // EnrichedImageContext — opaque to the frontend
  widgets: Widget[];
  masks_index: MaskSummary[];
  operation_graph: OperationGraph;
  revision: number;
}

export type StateEventKind =
  | 'widget.created'
  | 'widget.updated'
  | 'widget.deleted'
  | 'widget.accepted'
  | 'widget.restored'
  | 'mask.created'
  | 'selection.changed'
  | 'context.updated'
  | 'dismissal.added'
  | 'phase.started'
  | 'phase.progress'
  | 'phase.completed';

export interface StateEvent {
  revision: number;
  kind: StateEventKind;
  payload: Record<string, unknown>;
  emitted_at: string;
}
