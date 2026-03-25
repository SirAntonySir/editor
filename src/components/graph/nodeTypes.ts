import { SourceNode } from './nodes/SourceNode';
import { AdjustmentNode } from './nodes/AdjustmentNode';
import { CropNode } from './nodes/CropNode';
import { BlendNode } from './nodes/BlendNode';
import { OutputNode } from './nodes/OutputNode';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type { NodeTypes } from '@xyflow/react';

/** Structural node types — always present. */
const structuralNodes: NodeTypes = {
  source: SourceNode,
  crop: CropNode,
  blend: BlendNode,
  output: OutputNode,
};

/**
 * Build the full nodeTypes map from the ProcessingRegistry.
 * Every registered ProcessingDefinition gets an AdjustmentNode renderer.
 * Call this after all ProcessingDefinitions are registered.
 */
export function buildNodeTypes(): NodeTypes {
  const types: NodeTypes = { ...structuralNodes };
  for (const def of ProcessingRegistry.getAll()) {
    types[def.id] = AdjustmentNode;
  }
  return types;
}

/** Default export — rebuilt when processing definitions change. */
export let nodeTypes: NodeTypes = { ...structuralNodes };

/** Call once after all ProcessingDefinitions are registered. */
export function initNodeTypes(): void {
  nodeTypes = buildNodeTypes();
}
