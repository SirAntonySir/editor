import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { ProcessingNode } from './graph';

// ─── Node panel props ────────────────────────────────────────────────

export interface NodePanelProps {
  /** Full node data (layerId, adjustmentId, params, etc.) */
  node: ProcessingNode;
}

// React Flow's own `NodeTypes` registry types the data field as `any` so node
// components with narrowed data shapes can be registered. Mirror that here so
// custom nodes typed as `NodeProps<Node<ProcessingNodeData>>` are assignable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNodeComponent = ComponentType<NodeProps & { data: any; type: any }>;

// ─── Node definition ─────────────────────────────────────────────────

export interface NodeDefinition {
  /** Matches the React Flow node `type` string. */
  id: string;
  /** Display label for the node type. */
  label: string;
  /** Icon component (Lucide). */
  icon: ComponentType<{ size?: number }>;
  /** The React Flow node renderer component. */
  NodeComponent: AnyNodeComponent;
  /** Inspector panel rendered when the node is selected. */
  Panel?: ComponentType<NodePanelProps>;
}
