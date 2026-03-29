import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { ProcessingNode } from './graph';

// ─── Node panel props ────────────────────────────────────────────────

export interface NodePanelProps {
  /** Full node data (layerId, adjustmentId, params, etc.) */
  node: ProcessingNode;
}

// ─── Node definition ─────────────────────────────────────────────────

export interface NodeDefinition {
  /** Matches the React Flow node `type` string. */
  id: string;
  /** Display label for the node type. */
  label: string;
  /** Icon component (Lucide). */
  icon: ComponentType<{ size?: number }>;
  /** The React Flow node renderer component. */
  NodeComponent: ComponentType<NodeProps>;
  /** Inspector panel rendered when the node is selected. */
  Panel?: ComponentType<NodePanelProps>;
}
