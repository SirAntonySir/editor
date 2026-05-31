import type { ComponentType } from 'react';
import type { ToolDefinition } from '@/types/tool';
import type { ImageNodeState } from '@/types/workspace';
import type { Layer } from '@/store/layer-slice';

export interface PaletteCommand {
  id: string;
  kind: 'tool' | 'ai';
  label: string;
  description: string;
  icon?: ComponentType<{ size?: number }>;
  /** Present for `kind: 'tool'` — the registry tool name to spawn. */
  toolName?: string;
}

/** Short, human descriptions per tool name. Keyed by ToolDefinition.name. */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  light: 'Exposure, contrast, highlights, shadows',
  color: 'Saturation, vibrance, hue',
  kelvin: 'White balance / temperature',
  curves: 'RGB curves',
  levels: 'Levels with histogram',
  filters: 'LUT colour grading',
};

export function buildToolCommands(tools: ToolDefinition[]): PaletteCommand[] {
  return tools
    .filter((t) => !!t.processingId)
    .map((t) => ({
      id: `tool:${t.name}`,
      kind: 'tool' as const,
      label: t.label,
      description: TOOL_DESCRIPTIONS[t.name] ?? '',
      icon: t.icon,
      toolName: t.name,
    }));
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
  );
}

export function imageNodeLabel(node: ImageNodeState, layers: Layer[]): string {
  const firstLayerId = node.layerIds[0];
  const layer = layers.find((l) => l.id === firstLayerId);
  return layer?.name ?? node.id;
}

export function resolveInitialTargetId(ids: string[], activeId: string | null): string | null {
  if (activeId && ids.includes(activeId)) return activeId;
  if (ids.length === 0) return null;
  return ids[0];
}

export function nextTargetId(ids: string[], currentId: string | null): string {
  if (ids.length === 0) return '';
  const idx = currentId ? ids.indexOf(currentId) : -1;
  return ids[(idx + 1) % ids.length];
}
