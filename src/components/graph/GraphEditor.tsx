import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type OnNodeDrag,
  type OnSelectionChangeFunc,
  type Viewport,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Workflow, SeparatorVertical, SeparatorHorizontal } from 'lucide-react';

import { useDerivedGraph } from '@/core/derived-graph';
import { useEditorStore } from '@/store';
import { computeAutoLayout } from '@/lib/graph-layout';
import { nodeTypes } from './nodeTypes';
import { GraphPropertiesPanel } from './GraphPropertiesPanel';
import type { ProcessingGraph, NodePosition } from '@/types/graph';

function toRFNodes(graph: ProcessingGraph, positions: Record<string, NodePosition>): Node[] {
  return graph.nodes.map((pn) => ({
    id: pn.id,
    type: pn.type,
    position: positions[pn.id] ?? pn.position,
    data: pn.data,
  }));
}

function toRFEdges(graph: ProcessingGraph): Edge[] {
  return graph.edges.map((pe) => ({
    id: pe.id,
    source: pe.source,
    target: pe.target,
    sourceHandle: pe.sourceHandle,
    targetHandle: pe.targetHandle,
    type: 'smoothstep',
    animated: false,
    style: { stroke: 'var(--color-accent)', strokeWidth: 2, opacity: 0.6 },
  }));
}

/** Runs inside ReactFlow context to detect structural changes and auto-layout */
function AutoLayoutHandler({
  structureKey,
  onLayout,
}: {
  structureKey: string;
  onLayout: () => void;
}) {
  const { fitView } = useReactFlow();
  const graphLayoutKey = useEditorStore((s) => s.graphLayoutKey);
  const setGraphLayoutKey = useEditorStore((s) => s.setGraphLayoutKey);

  useEffect(() => {
    if (structureKey && structureKey !== graphLayoutKey) {
      setGraphLayoutKey(structureKey);
      onLayout();
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }));
    }
    // Only react to structureKey changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  return null;
}

/** Layout button rendered inside Controls */
function LayoutButton({ onLayout }: { onLayout: () => void }) {
  const { fitView } = useReactFlow();
  return (
    <button
      onClick={() => {
        onLayout();
        requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }));
      }}
      className="react-flow__controls-button"
      title="Auto Layout"
    >
      <Workflow size={14} />
    </button>
  );
}

/** Toggle split orientation (vertical / horizontal) */
function SplitToggle() {
  const splitDirection = useEditorStore((s) => s.graphSplitDirection);
  const setSplitDirection = useEditorStore((s) => s.setGraphSplitDirection);
  return (
    <>
      <button
        onClick={() => setSplitDirection('vertical')}
        className={`react-flow__controls-button ${splitDirection === 'vertical' ? '!bg-accent/20 !text-accent' : ''}`}
        title="Vertical Split"
      >
        <SeparatorVertical size={14} />
      </button>
      <button
        onClick={() => setSplitDirection('horizontal')}
        className={`react-flow__controls-button ${splitDirection === 'horizontal' ? '!bg-accent/20 !text-accent' : ''}`}
        title="Horizontal Split"
      >
        <SeparatorHorizontal size={14} />
      </button>
    </>
  );
}

export function GraphEditor() {
  const graph = useDerivedGraph();
  const graphPositions = useEditorStore((s) => s.graphPositions);
  const graphViewport = useEditorStore((s) => s.graphViewport);
  const updateNodePosition = useEditorStore((s) => s.updateNodePosition);
  const setGraphPositions = useEditorStore((s) => s.setGraphPositions);
  const setSelectedNode = useEditorStore((s) => s.setSelectedNode);
  const setHighlightedNode = useEditorStore((s) => s.setHighlightedNode);
  const setGraphViewport = useEditorStore((s) => s.setGraphViewport);

  // Compute auto-layout for unpositioned nodes
  const positions = useMemo(() => {
    if (!graph) return graphPositions;
    return computeAutoLayout(graph, graphPositions);
  }, [graph, graphPositions]);

  // Derive initial nodes from graph + positions
  const derivedNodes = useMemo(() => {
    if (!graph) return [];
    return toRFNodes(graph, positions);
  }, [graph, positions]);

  const edges = useMemo(() => {
    if (!graph) return [];
    return toRFEdges(graph);
  }, [graph]);

  // Structure fingerprint — changes when nodes/edges are added or removed
  const structureKey = useMemo(() => {
    if (!graph) return '';
    return graph.nodes.map((n) => n.id).join('|') + '||' + graph.edges.map((e) => e.id).join('|');
  }, [graph]);

  // Clear all stored positions → auto-layout recomputes from defaults
  const handleAutoLayout = useCallback(() => {
    setGraphPositions({});
  }, [setGraphPositions]);

  // Local node state so ReactFlow can update positions during drag
  const [nodes, setNodes] = useState<Node[]>(derivedNodes);
  const isDraggingRef = useRef(false);

  // Sync from derived graph when structure changes (skip during drag)
  useEffect(() => {
    if (!isDraggingRef.current) {
      setNodes(derivedNodes);
    }
  }, [derivedNodes]);

  // Handle all node changes (drag, select, etc.) for live updates
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onNodeDragStart: OnNodeDrag = useCallback(() => {
    isDraggingRef.current = true;
    setHighlightedNode(null);
  }, [setHighlightedNode]);

  // Persist final position to store on drag stop
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      isDraggingRef.current = false;
      updateNodePosition(node.id, { x: node.position.x, y: node.position.y });
    },
    [updateNodePosition],
  );

  // Track selection
  const onSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes }) => {
      setSelectedNode(selectedNodes.length === 1 ? selectedNodes[0].id : null);
    },
    [setSelectedNode],
  );

  // Click a node → highlight it and show properties panel
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setHighlightedNode(node.id);
    },
    [setHighlightedNode],
  );

  // Click empty space → clear highlight
  const onPaneClick = useCallback(() => {
    setHighlightedNode(null);
  }, [setHighlightedNode]);

  // Persist viewport on pan/zoom end
  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      setGraphViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    },
    [setGraphViewport],
  );

  if (!graph) return null;

  return (
    <div className="relative h-full w-full">
      {/* React Flow canvas — full area */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onMoveEnd={onMoveEnd}
        defaultViewport={graphViewport}
        fitView={!graphViewport.zoom}
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-canvas-bg"
      >
        <Controls
          showInteractive={false}
          className="!bg-glass-bg !border-glass-border !shadow-panel !rounded-panel [&>button]:!bg-transparent [&>button]:!border-separator [&>button]:!text-text-secondary [&>button:hover]:!text-text-primary"
        >
          <LayoutButton onLayout={handleAutoLayout} />
          <SplitToggle />
        </Controls>
        <AutoLayoutHandler structureKey={structureKey} onLayout={handleAutoLayout} />
      </ReactFlow>

      {/* Properties panel — floating, same position as InspectorPanel */}
      <GraphPropertiesPanel graph={graph} />
    </div>
  );
}
