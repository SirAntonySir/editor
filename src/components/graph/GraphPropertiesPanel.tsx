import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGraphStore } from '@/store/graph-store';
import { NodeRegistry } from '@/lib/node-registry';
import { useNodePreview } from '@/hooks/useNodePreview';
import type { ProcessingGraph } from '@/types/graph';

const PANEL_W = 288; // w-72 = 18rem = 288px

export function GraphPropertiesPanel({ graph }: { graph: ProcessingGraph }) {
  const highlightedNodeId = useGraphStore((s) => s.highlightedNodeId);
  const selectedNode = highlightedNodeId
    ? graph.nodes.find((n) => n.id === highlightedNodeId)
    : null;

  // Track the container width for full-size preview rendering
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
    0, // live — no debounce for the inspector
  );

  if (!selectedNode) return null;

  const def = NodeRegistry.get(selectedNode.type);
  const Panel = def?.Panel;

  return (
    <motion.div
      ref={containerRef}
      className="absolute top-12 right-2 z-20 max-h-[calc(100vh-5rem)] glass-panel overflow-y-auto overflow-x-hidden flex flex-col"
      style={{ width: PANEL_W }}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {/* Full-size per-node preview */}
      <div className="border-b border-separator">
        <canvas
          ref={canvasRef}
          className="block w-full"
          style={{ width: previewW, height }}
        />
      </div>

      {/* Node label header */}
      <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator">
        {selectedNode.data.label}
      </div>

      {/* Node panel content */}
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
    </motion.div>
  );
}
