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
  | 'kelvin_strip'
  | 'tint_strip';

export interface SliderSchema {
  controlType: 'slider';
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface ToggleSchema {
  controlType: 'toggle';
  onLabel: string;
  offLabel: string;
}

export interface ChoiceSchema {
  controlType: 'choice';
  options: { value: string; label: string; description?: string }[];
}

export interface ColorSchema {
  controlType: 'color';
  mode: 'rgb' | 'hex';
}

export interface RegionPickerSchema {
  controlType: 'region_picker';
}

export interface MaskThumbnailSchema {
  controlType: 'mask_thumbnail';
}

export interface CurveSchema {
  controlType: 'curve';
  minPoints?: number;
  maxPoints?: number;
}

// Registry-vocab schema interfaces (aligned with backend registry-vocab additions).

export interface SwatchSchema {
  controlType: 'swatch';
  space?: 'rgb' | 'lab' | 'hsl';
  showAlpha?: boolean;
  presets?: number[][];
}

export interface HueWheelSchema {
  controlType: 'hue_wheel';
  min: number;
  max: number;
}

export interface CurveEditorSchema {
  controlType: 'curve_editor';
  channel?: 'luma' | 'r' | 'g' | 'b' | null;
  minPoints?: number;
  maxPoints?: number;
}

export interface PointListSchema {
  controlType: 'point_list';
  minPoints?: number;
  maxPoints?: number;
}

export interface EnumSelectSchema {
  controlType: 'enum_select';
  options: { value: string; label: string }[];
  allowCustom?: boolean;
}

export interface BoolToggleSchema {
  controlType: 'bool_toggle';
  onLabel?: string;
  offLabel?: string;
}

export interface KelvinStripSchema {
  controlType: 'kelvin_strip';
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface TintStripSchema {
  controlType: 'tint_strip';
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
  | KelvinStripSchema
  | TintStripSchema;

// Curve value model lives in its own leaf module (cycle-free); re-exported here
// so existing `@/types/widget` imports keep working.
import type { CurvesValue } from './curve';
export type { CurvePoint, CurvesValue } from './curve';
export { IDENTITY_CURVES } from './curve';

export type ControlValue = number | string | boolean | CurvesValue;

export interface NodeParamTarget {
  nodeId: string;
  paramKey: string;
}

export interface ControlBinding {
  paramKey: string;
  label: string;
  controlType: ControlType;
  target: NodeParamTarget;
  controlSchema: ControlSchema;
  value: ControlValue;
  default: ControlValue;
  reasoning?: string;
}

export type ParamValue = number | string | boolean | CurvesValue;

export interface WidgetNode {
  id: string;
  type: string;
  opId?: string | null;
  params: Record<string, ParamValue>;
  scope: Scope;
  inputs: string[];
  widgetId: string;
  layerId?: string;
  /** Replicate target set: the layers this node applies to independently.
   *  Absent → implicit single target (`layerId`). One tether edge is drawn per
   *  entry. Mirrors backend `WidgetNode.layer_ids` (JSON `null` reads as absent
   *  and is handled with `?? [layerId]` at every use site). */
  layerIds?: string[];
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
  parentWidgetId?: string | null;
  anchor?: WidgetAnchor;
}

export interface WidgetPreview {
  kind: 'thumbnail' | 'histogram_delta' | 'color_swatches' | 'none';
  autoBeforeAfter: boolean;
}

export type GenfillStatus = 'compose' | 'generating' | 'ready' | 'error';

export interface GenfillResultInfo {
  assetId: string;
  width: number;
  height: number;
}

export interface GenfillErrorInfo {
  kind: 'moderation' | 'timeout' | 'api_error' | 'not_configured';
  message: string;
}

/** One anchor of a widget-local compound block (fused intent widgets).
 *  `values` keys are node-qualified: `"{nodeId}:{paramKey}"`. */
export interface WidgetCompoundAnchor {
  position: number;
  name: string;
  values: Record<string, number>;
  color?: string | null;
}

/** Widget-local compound block — same shape as the registry op `compound`
 *  block, synthesized per-widget by the backend for LLM-proposed widgets.
 *  See docs/superpowers/specs/2026-07-11-fused-intent-widgets-design.md. */
export interface WidgetCompound {
  driver: string;
  label?: string | null;
  interpolation?: 'catmull_rom_1d' | 'linear_1d';
  anchors: WidgetCompoundAnchor[];
  topology?: 'linear' | 'wheel';
}

/** State block for generative-fill widgets (Replicate flux-fill-pro).
 *  Non-null marks the widget as genfill: bespoke body, no op-graph nodes,
 *  pixels land on a NEW layer at Accept. FLUX Fill has no negative prompt. */
export interface GenfillState {
  status: GenfillStatus;
  prompt: string;
  seed: number;
  maskId: string;
  imageNodeId: string;
  result?: GenfillResultInfo | null;
  error?: GenfillErrorInfo | null;
}

export interface Widget {
  id: string;
  intent: string;
  reasoning?: string;
  scope: Scope;
  origin: WidgetOrigin;
  opId?: string;
  composed: boolean;
  nodes: WidgetNode[];
  bindings: ControlBinding[];
  preview: WidgetPreview;
  rejectedAttempts: unknown[];
  status: 'active' | 'dismissed' | 'accepted';
  revision: number;
  /** Param keys the user has explicitly edited; bundle-recompute paths
   *  (e.g. Time-of-Day dial) skip these so manual values aren't overwritten.
   *  Cleared via the `unlock_widget_param` backend tool. */
  lockedParams: string[];
  /** Fused intent widget block — present ⇒ WidgetShell renders FusedWidgetBody. */
  compound?: WidgetCompound | null;
  /** Driver position t in [0, 1.5]; UI renders ×100 (proposal = 100). */
  driverValue?: number | null;
  displayName?: string | null;
  category?: string | null;
  createdAt: string;
  updatedAt: string;
  genfill?: GenfillState | null;
}

export interface MaskSummary {
  id: string;
  width: number;
  height: number;
  source: string;
  label: string | null;
  /**
   * ImageNode this mask belongs to. Optional for backwards-compat — legacy
   * fixtures and pre-multi-image masks leave it undefined, in which case
   * consumers treat the mask as global and render it for every ImageNode.
   */
  imageNodeId?: string | null;
}

// Re-export the existing OperationGraph type for the snapshot.
import type { OperationGraph } from './operation-graph';
import type { ImageContext } from './image-context';

export interface SessionStateSnapshot {
  sessionId: string;
  imageContext: ImageContext | null;
  widgets: Widget[];
  masksIndex: MaskSummary[];
  operationGraph: OperationGraph;
  revision: number;
  /** Study-design session constant. True = AI features available; false =
   *  control condition (analysis / command-palette AI / suggestions hidden).
   *  Set per-session via the admin cockpit. Optional on the wire for forward
   *  compat — readers default to true (see `useAiAccess` / `getAiAccess`). */
  aiAccess?: boolean;
}

export type StateEventKind =
  | 'widget.created'
  | 'widget.updated'
  | 'widget.deleted'
  | 'widget.accepted'
  | 'widget.restored'
  | 'mask.created'
  | 'mask.deleted'
  | 'mask.renamed'
  | 'selection.changed'
  | 'context.updated'
  | 'dismissal.added'
  | 'phase.started'
  | 'phase.progress'
  | 'phase.completed'
  | 'phase.cancelled'
  | 'mcp.usage'
  | 'state.gap'
  | 'history.applied'
  | 'session.ai_access'
  | 'client.tool_request';

export interface StateEvent {
  revision: number;
  kind: StateEventKind;
  payload: Record<string, unknown>;
  emittedAt: string;
}
