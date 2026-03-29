import type { ComponentType } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { NodeDefinition, NodePanelProps } from '@/types/node-definition';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

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
   * Adapts the ProcessingDefinition's Panel (which expects ProcessingPanelProps)
   * into a NodePanelProps-compatible wrapper by extracting layerId/adjustmentId
   * from the node data.
   */
  registerFromProcessing(
    def: ProcessingDefinition,
    NodeComponent: ComponentType<NodeProps>,
  ): void {
    let Panel: ComponentType<NodePanelProps> | undefined;

    if (def.Panel) {
      const ProcessingPanel = def.Panel;
      // Create a wrapper that adapts NodePanelProps → ProcessingPanelProps
      Panel = function ProcessingNodePanel({ node }: NodePanelProps) {
        if (!node.data.layerId) return null;
        return (
          <ProcessingPanel
            layerId={node.data.layerId}
            adjustmentId={node.data.adjustmentId}
          />
        );
      };
      Panel.displayName = `${def.id}NodePanel`;
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
