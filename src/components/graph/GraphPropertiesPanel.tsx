import { useEditorStore } from '@/store';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useGraphAdjustmentParam } from '@/lib/use-graph-adjustment';
import { CurvesPanel } from '@/tools/curves-tool';
import { FiltersPanel } from '@/tools/filters-tool';
import type { ProcessingNode, ProcessingNodeType } from '@/types/graph';
import type { ProcessingGraph } from '@/types/graph';

// ─── Slider editors per node type ────────────────────────────────────

function LightEditor({ adjustmentId }: { adjustmentId: string }) {
  const [brightness, setBrightness] = useGraphAdjustmentParam(adjustmentId, 'brightness', 0);
  const [contrast, setContrast] = useGraphAdjustmentParam(adjustmentId, 'contrast', 0);
  return (
    <div className="flex flex-col gap-3">
      <AdjustmentSlider label="Brightness" value={brightness} min={-100} max={100} defaultValue={0} onChange={setBrightness} />
      <AdjustmentSlider label="Contrast" value={contrast} min={-100} max={100} defaultValue={0} onChange={setContrast} />
    </div>
  );
}

function ColorEditor({ adjustmentId }: { adjustmentId: string }) {
  const [saturation, setSaturation] = useGraphAdjustmentParam(adjustmentId, 'saturation', 0);
  const [hue, setHue] = useGraphAdjustmentParam(adjustmentId, 'hue', 0);
  return (
    <div className="flex flex-col gap-3">
      <AdjustmentSlider label="Saturation" value={saturation} min={-100} max={100} defaultValue={0} onChange={setSaturation} />
      <AdjustmentSlider label="Hue" value={hue} min={0} max={360} defaultValue={0} onChange={setHue} formatValue={(v) => `${Math.round(v)}\u00B0`} />
    </div>
  );
}

function KelvinEditor({ adjustmentId }: { adjustmentId: string }) {
  const [kelvin, setKelvin] = useGraphAdjustmentParam(adjustmentId, 'kelvin', 6500);
  const [tint, setTint] = useGraphAdjustmentParam(adjustmentId, 'tint', 0);
  return (
    <div className="flex flex-col gap-3">
      <AdjustmentSlider label="White Balance" value={kelvin} min={2000} max={12000} defaultValue={6500} onChange={setKelvin} formatValue={(v) => `${Math.round(v)}K`} />
      <AdjustmentSlider label="Tint" value={tint} min={-100} max={100} defaultValue={0} onChange={setTint} />
    </div>
  );
}

function LevelsEditor({ adjustmentId }: { adjustmentId: string }) {
  const [inBlack, setInBlack] = useGraphAdjustmentParam(adjustmentId, 'inBlack', 0);
  const [inWhite, setInWhite] = useGraphAdjustmentParam(adjustmentId, 'inWhite', 255);
  const [gamma, setGamma] = useGraphAdjustmentParam(adjustmentId, 'gamma', 1.0);
  const [outBlack, setOutBlack] = useGraphAdjustmentParam(adjustmentId, 'outBlack', 0);
  const [outWhite, setOutWhite] = useGraphAdjustmentParam(adjustmentId, 'outWhite', 255);
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-medium text-text-secondary">Input Levels</div>
      <AdjustmentSlider label="Black Point" value={inBlack} min={0} max={255} defaultValue={0} onChange={setInBlack} />
      <AdjustmentSlider label="Midtones" value={gamma} min={0.1} max={10} step={0.01} defaultValue={1.0} onChange={setGamma} formatValue={(v) => v.toFixed(2)} />
      <AdjustmentSlider label="White Point" value={inWhite} min={0} max={255} defaultValue={255} onChange={setInWhite} />
      <div className="h-px bg-separator" />
      <div className="text-xs font-medium text-text-secondary">Output Levels</div>
      <AdjustmentSlider label="Output Black" value={outBlack} min={0} max={255} defaultValue={0} onChange={setOutBlack} />
      <AdjustmentSlider label="Output White" value={outWhite} min={0} max={255} defaultValue={255} onChange={setOutWhite} />
    </div>
  );
}

function SourceInfo({ node }: { node: ProcessingNode }) {
  const layer = useEditorStore((s) =>
    node.data.layerId ? s.layers.find((l) => l.id === node.data.layerId) : undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-text-primary font-medium">{layer?.name ?? 'Source'}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-text-secondary w-fit capitalize">
        {layer?.type ?? 'image'}
      </span>
    </div>
  );
}

function BlendEditor({ node }: { node: ProcessingNode }) {
  const blendMode = node.data.blendMode ?? 'normal';
  const opacity = Math.round((node.data.opacity ?? 1) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-text-secondary">Blend Mode</div>
      <span className="text-xs text-text-primary capitalize">{blendMode}</span>
      <div className="text-xs text-text-secondary">Opacity</div>
      <span className="text-xs text-text-primary tabular-nums">{opacity}%</span>
    </div>
  );
}

// ─── Properties panel ────────────────────────────────────────────────

function NodeEditor({ node }: { node: ProcessingNode }) {
  const t = node.type as ProcessingNodeType;
  const adjId = node.data.adjustmentId;

  switch (t) {
    case 'source':
      return <div className="p-3"><SourceInfo node={node} /></div>;
    case 'light':
      return adjId ? <div className="p-3"><LightEditor adjustmentId={adjId} /></div> : null;
    case 'color':
      return adjId ? <div className="p-3"><ColorEditor adjustmentId={adjId} /></div> : null;
    case 'kelvin':
      return adjId ? <div className="p-3"><KelvinEditor adjustmentId={adjId} /></div> : null;
    case 'levels':
      return adjId ? <div className="p-3"><LevelsEditor adjustmentId={adjId} /></div> : null;
    case 'curves':
      return node.data.layerId ? <CurvesPanel layerId={node.data.layerId} /> : null;
    case 'filter':
      return node.data.layerId ? <FiltersPanel layerId={node.data.layerId} /> : null;
    case 'blend':
      return <div className="p-3"><BlendEditor node={node} /></div>;
    case 'output':
      return (
        <div className="p-3 text-[10px] text-text-secondary">Final composited output.</div>
      );
    default:
      return null;
  }
}

export function GraphPropertiesPanel({ graph }: { graph: ProcessingGraph }) {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const selectedNode = selectedNodeId
    ? graph.nodes.find((n) => n.id === selectedNodeId)
    : null;

  if (!selectedNode) return null;

  return (
    <div className="absolute top-12 right-2 bottom-8 z-20 w-56 glass-panel overflow-y-auto overflow-x-hidden flex flex-col">
      <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator">
        {selectedNode.data.label}
      </div>
      <NodeEditor node={selectedNode} />
    </div>
  );
}
