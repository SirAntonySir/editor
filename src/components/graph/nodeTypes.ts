import { NodeRegistry } from '@/lib/node-registry';
import type { NodeTypes } from '@xyflow/react';

/**
 * Build the full nodeTypes map from the NodeRegistry.
 * Every registered NodeDefinition gets its NodeComponent as the renderer.
 * Call this after all NodeDefinitions are registered.
 */
export function buildNodeTypes(): NodeTypes {
  const types: NodeTypes = {};
  for (const def of NodeRegistry.getAll()) {
    types[def.id] = def.NodeComponent;
  }
  return types;
}

/** Default export — rebuilt when node definitions change. */
export let nodeTypes: NodeTypes = {};

/** Call once after all NodeDefinitions are registered. */
export function initNodeTypes(): void {
  nodeTypes = buildNodeTypes();
}
