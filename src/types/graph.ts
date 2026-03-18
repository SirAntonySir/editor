import type { BlendMode } from '@/store/layer-slice';

// ─── Node types (1:1 with editing tools) ─────────────────────────────
export type ProcessingNodeType =
  | 'source'   // Image/brush/text layer pixel data
  | 'light'    // Exposure, contrast, highlights, shadows
  | 'color'    // Saturation, vibrance
  | 'kelvin'   // Temperature, tint
  | 'curves'   // RGB curves
  | 'levels'   // Levels with histogram
  | 'filter'   // LUT-based color grading
  | 'crop'     // Non-destructive crop, rotation, flip
  | 'blend'    // Merge two inputs with blend mode + opacity
  | 'output';  // Final composited result

// ─── Data structures ─────────────────────────────────────────────────
export interface NodePosition {
  x: number;
  y: number;
}

export interface ProcessingNodeData {
  label: string;
  /** Source nodes: layer ID */
  layerId?: string;
  /** Adjustment nodes: which adjustment this syncs with */
  adjustmentId?: string;
  /** Which param keys this node owns (for basic adjustment split into light/color) */
  paramKeys?: string[];
  /** Adjustment parameters */
  params?: Record<string, number | Float32Array>;
  enabled?: boolean;
  blendMode?: BlendMode;
  opacity?: number;
}

export interface ProcessingNode {
  id: string;
  type: ProcessingNodeType;
  position: NodePosition;
  data: ProcessingNodeData;
}

export interface ProcessingEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface ProcessingGraph {
  nodes: ProcessingNode[];
  edges: ProcessingEdge[];
}

// ─── Mapping constants ───────────────────────────────────────────────

/** Param keys that belong to the 'light' node (subset of 'basic' adjustment) */
export const LIGHT_PARAM_KEYS = [
  'brightness', 'contrast', 'highlights', 'shadows', 'exposure',
] as const;

/** Param keys that belong to the 'color' node (subset of 'basic' adjustment) */
export const COLOR_PARAM_KEYS = [
  'saturation', 'vibrance',
] as const;

/** Node types that represent processing operations (not structural) */
export const ADJUSTMENT_NODE_TYPES: ProcessingNodeType[] = [
  'light', 'color', 'kelvin', 'curves', 'levels', 'filter',
];

/** Default labels for each node type */
export const NODE_LABELS: Record<ProcessingNodeType, string> = {
  source: 'Source',
  light: 'Light',
  color: 'Color',
  kelvin: 'White Balance',
  curves: 'Curves',
  levels: 'Levels',
  filter: 'Filter',
  crop: 'Crop',
  blend: 'Blend',
  output: 'Output',
};
