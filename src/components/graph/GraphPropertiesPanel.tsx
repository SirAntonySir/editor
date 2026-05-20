import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGraphStore } from '@/store/graph-store';
import { NodeRegistry } from '@/lib/node-registry';
import { useNodePreview } from '@/hooks/useNodePreview';
import { useDerivedGraph } from '@/core/derived-graph';

const PANEL_W = 264; // matches the right sidebar inner width

/**
 * Body of the graph node properties panel — used inside the docked right
 * sidebar (Inspector tab) when the editor is in graph mode.
 */
export function GraphPropertiesPanelBody() {
  const graph = useDerivedGraph();
  const highlightedNodeId = useGraphStore((s) => s.highlightedNodeId);
  const selectedNode = highlightedNodeId && graph
    ? graph.nodes.find((n) => n.id === highlightedNodeId)
    : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = useState(PANEL_W);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPreviewW(Math.round(entry.contentRect.width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { height } = useNodePreview(
    canvasRef,
    selectedNode?.type ?? 'source',
    selectedNode?.data.layerId,
    selectedNode?.data.adjustmentId,
    previewW,
    0,
  );

  if (!selectedNode) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <p className="text-xs text-text-secondary text-center leading-relaxed">
          Select a node in the graph to inspect its parameters.
        </p>
      </div>
    );
  }

  const def = NodeRegistry.get(selectedNode.type);
  const Panel = def?.Panel;

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
      <div className="border-b border-separator">
        <canvas
          ref={canvasRef}
          className="block w-full"
          style={{ width: previewW, height }}
        />
      </div>

      <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator">
        {selectedNode.data.label}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={selectedNode.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {Panel ? <Panel node={selectedNode} /> : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
