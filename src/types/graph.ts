import type { BlendMode } from '@/store/layer-slice';

// ─── Node types ─────────────────────────────────────────────────────
// ProcessingNodeType is now a string — the ProcessingRegistry defines
// which node types exist. Structural node types (source, blend, crop,
// output) are built-in; processing node types come from the registry.
export type ProcessingNodeType = string;

/** Built-in structural node types (not from the ProcessingRegistry). */
export const STRUCTURAL_NODE_TYPES = ['source', 'blend', 'crop', 'output'] as const;

// ─── Data structures ─────────────────────────────────────────────────
export interface NodePosition {
  x: number;
  y: number;
}

// Indexable so React Flow's `NodeBase<NodeData extends Record<string, unknown>>`
// generic constraint is satisfied when this data shape is used directly with
// `NodeProps` in custom node components.
export interface ProcessingNodeData extends Record<string, unknown> {
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
