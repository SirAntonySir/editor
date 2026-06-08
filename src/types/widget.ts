// Mirrors backend/app/schemas/widget.py + state/snapshot.py + state/events.

import type { Scope } from './scope';
export type { Scope } from './scope';

export type ControlType =
  // Legacy widget-schema values (kept for backwards compat with old serialised state).
  | 'slider'
  | 'toggle'
  | 'choice'
  | 'color'
  | 'region_picker'
  | 'mask_thumbnail'
  | 'curve'
  // Registry-vocab additions (aligned with shared/registry/schema.ts CONTROL_TYPE).
  | 'swatch'
  | 'hue_wheel'
  | 'curve_editor'
  | 'point_list'
  | 'enum_select'
  | 'bool_toggle'
  | 'kelvin_strip';

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

export interface CurveSchema {
  control_type: 'curve';
  min_points?: number;
  max_points?: number;
}

// Registry-vocab schema interfaces (aligned with backend registry-vocab additions).

export interface SwatchSchema {
  control_type: 'swatch';
  space?: 'rgb' | 'lab' | 'hsl';
  show_alpha?: boolean;
  presets?: number[][];
}

export interface HueWheelSchema {
  control_type: 'hue_wheel';
  min: number;
  max: number;
}

export interface CurveEditorSchema {
  control_type: 'curve_editor';
  channel?: 'luma' | 'r' | 'g' | 'b' | null;
  min_points?: number;
  max_points?: number;
}

export interface PointListSchema {
  control_type: 'point_list';
  min_points?: number;
  max_points?: number;
}

export interface EnumSelectSchema {
  control_type: 'enum_select';
  options: { value: string; label: string }[];
  allow_custom?: boolean;
}

export interface BoolToggleSchema {
  control_type: 'bool_toggle';
  on_label?: string;
  off_label?: string;
}

export interface KelvinStripSchema {
  control_type: 'kelvin_strip';
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export type ControlSchema =
  | SliderSchema
  | ToggleSchema
  | ChoiceSchema
  | ColorSchema
  | RegionPickerSchema
  | MaskThumbnailSchema
  | CurveSchema
  | SwatchSchema
  | HueWheelSchema
  | CurveEditorSchema
  | PointListSchema
  | EnumSelectSchema
  | BoolToggleSchema
  | KelvinStripSchema;

// Curve value model lives in its own leaf module (cycle-free); re-exported here
// so existing `@/types/widget` imports keep working.
import type { CurvesValue } from './curve';
export type { CurvePoint, CurvesValue } from './curve';
export { IDENTITY_CURVES } from './curve';

export type ControlValue = number | string | boolean | CurvesValue;

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

export type ParamValue = number | string | boolean | CurvesValue;

export interface WidgetNode {
  id: string;
  type: string;
  params: Record<string, ParamValue>;
  scope: Scope;
  inputs: string[];
  widget_id: string;
  layer_id?: string;
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
  op_id?: string;
  composed: boolean;
  nodes: WidgetNode[];
  bindings: ControlBinding[];
  preview: WidgetPreview;
  rejected_attempts: unknown[];
  status: 'active' | 'dismissed' | 'accepted';
  revision: number;
  /** Param keys the user has explicitly edited; bundle-recompute paths
   *  (e.g. Time-of-Day dial) skip these so manual values aren't overwritten.
   *  Cleared via the `unlock_widget_param` backend tool. */
  locked_params: string[];
  display_name?: string | null;
  category?: string | null;
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
