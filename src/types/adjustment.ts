import type { Scope } from './scope';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'soft-light' | 'hard-light';

export interface AiSource {
  widgetId: string;      // originating widget id (for log/trace)
  intent: string;        // human label, e.g. "Warm skin"
  reasoning?: string;    // optional Claude reasoning
  acceptedAt: string;    // ISO 8601 timestamp
}

export interface Adjustment {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  params: Record<string, number | Float32Array>;
  /** Scope of this adjustment — defaults to global when absent. */
  scope?: Scope;
  /** Provenance metadata if accepted from an AI widget. */
  aiSource?: AiSource;
}
