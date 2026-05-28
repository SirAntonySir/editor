import { Image, Layers, Flag } from 'lucide-react';
import { NodeRegistry } from '@/lib/node-registry';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { SourceNode } from './nodes/SourceNode';
import { BlendNode } from './nodes/BlendNode';
import { OutputNode } from './nodes/OutputNode';
import { AdjustmentNode } from './nodes/AdjustmentNode';
import { SourcePanel } from './panels/SourcePanel';
import { BlendPanel } from './panels/BlendPanel';
import { OutputPanel } from './panels/OutputPanel';

/**
 * Register all node definitions into the NodeRegistry.
 * Must be called after registerAllProcessing().
 */
export function registerAllNodes(): void {
  // Structural nodes
  NodeRegistry.register({
    id: 'source',
    label: 'Source',
    icon: Image,
    NodeComponent: SourceNode,
    Panel: SourcePanel,
  });

  NodeRegistry.register({
    id: 'blend',
    label: 'Blend',
    icon: Layers,
    NodeComponent: BlendNode,
    Panel: BlendPanel,
  });

  NodeRegistry.register({
    id: 'output',
    label: 'Output',
    icon: Flag,
    NodeComponent: OutputNode,
    Panel: OutputPanel,
  });

  // Processing nodes — wrap each ProcessingDefinition
  for (const def of ProcessingRegistry.getAll()) {
    NodeRegistry.registerFromProcessing(def, AdjustmentNode);
  }
}
