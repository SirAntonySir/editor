import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { NodeDefinition, NodePanelProps } from '@/types/node-definition';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

/**
 * Adapts a ProcessingDefinition's Panel (which expects ProcessingPanelProps)
 * into a NodePanelProps-compatible wrapper by extracting layerId/adjustmentId
 * from the node data.
 *
 * Defined at module scope so each call to `registerFromProcessing` doesn't
 * re-create a component type. The per-definition Panel reference is resolved
 * at render time via the registry's processingPanels map, keyed by node type.
 */
function ProcessingNodePanel({ node }: NodePanelProps) {
  const ProcessingPanel = processingPanels.get(node.type);
  if (!ProcessingPanel || !node.data.layerId) return null;
  return (
    <ProcessingPanel
      layerId={node.data.layerId}
      adjustmentId={node.data.adjustmentId}
    />
  );
}

/** Maps node-type id → ProcessingDefinition's Panel component. */
const processingPanels = new Map<string, ComponentType<ProcessingPanelProps>>();

class NodeRegistryImpl {
  private defs = new Map<string, NodeDefinition>();

  register(def: NodeDefinition): void {
    this.defs.set(def.id, def);
  }

  get(id: string): NodeDefinition | undefined {
    return this.defs.get(id);
  }

  getAll(): NodeDefinition[] {
    return Array.from(this.defs.values());
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  /**
   * Wrap a ProcessingDefinition into a NodeDefinition.
   * The Panel field points at the module-scope ProcessingNodePanel adapter,
   * which resolves the underlying ProcessingDefinition.Panel via the
   * processingPanels map at render time.
   */
  registerFromProcessing(
    def: ProcessingDefinition,
    NodeComponent: ComponentType<NodeProps>,
  ): void {
    let Panel: ComponentType<NodePanelProps> | undefined;

    if (def.Panel) {
      processingPanels.set(def.id, def.Panel);
      Panel = ProcessingNodePanel;
    }

    this.register({
      id: def.id,
      label: def.label,
      icon: def.icon,
      NodeComponent,
      Panel,
    });
  }
}

export const NodeRegistry = new NodeRegistryImpl();
