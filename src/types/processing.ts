import type { ComponentType } from 'react';

// ─── Parameter definitions ──────────────────────────────────────────

export interface ParamDefinition {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  format?: (v: number) => string;
}

// ─── Panel props — unified across inspector, graph nodes, properties panel ──

export interface ProcessingPanelProps {
  layerId: string;
  adjustmentId?: string;
}

// ─── Processing definition ──────────────────────────────────────────

export interface ProcessingDefinition {
  /** Unique ID — also used as the graph node type. */
  id: string;
  /** Display label shown in UI. */
  label: string;
  /** Icon component (Lucide). */
  icon: ComponentType<{ size?: number }>;
  /** Category for grouping. */
  category: 'adjust' | 'filter' | 'ai' | 'segment' | 'generate' | 'transform';

  /**
   * Maps to `Adjustment.type` in the store.
   * Multiple ProcessingDefinitions can share an adjustmentType
   * (e.g., 'light' and 'color' both map to 'basic').
   */
  adjustmentType: string;

  /**
   * When multiple defs share an adjustmentType, paramKeys specifies
   * which params this definition owns. Used for graph node splitting
   * and param filtering.
   */
  paramKeys?: string[];

  /** Parameter definitions — drives scrubbers, ranges, and auto-generated UI. */
  params: ParamDefinition[];

  /**
   * Panel component rendered in the inspector (develop/compose mode),
   * graph properties panel, and expanded graph nodes.
   * Receives layerId + optional adjustmentId so it works in any context.
   */
  Panel: ComponentType<ProcessingPanelProps>;

  /** Whether the graph node can expand to show full editor. */
  expandable?: boolean;

  /**
   * Optional custom component for the expanded node view in the graph.
   * If not provided, Panel is used. Useful when the graph needs a
   * compact variant (e.g., smaller curves editor).
   */
  NodeExpandedPanel?: ComponentType<ProcessingPanelProps>;

  /**
   * Optional custom component for compact node display.
   * If not provided, auto-generated scrubbers are used for params.
   */
  NodeCompactDisplay?: ComponentType<ProcessingPanelProps>;

  /** Optional: this processing creates a new layer type. */
  layerType?: string;
  createLayer?: () => Record<string, unknown>;

  /** Optional: custom async processing hook (for AI/WASM ops). */
  useProcessing?: (layerId: string) => { status: string; progress: number; cancel: () => void };
}
