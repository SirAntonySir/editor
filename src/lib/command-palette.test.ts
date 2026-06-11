import { describe, it, expect } from 'vitest';
import {
  buildToolCommands,
  filterCommands,
  fuzzyScore,
  imageNodeLabel,
  resolveInitialTargetId,
  nextTargetId,
} from './command-palette';
import type { ToolDefinition } from '@/types/tool';
import type { ImageNodeState } from '@/types/workspace';
import type { Layer } from '@/store/layer-slice';

const Icon = () => null;
const tool = (name: string, label: string, processingId?: string): ToolDefinition =>
  ({ name, label, icon: Icon, category: 'adjust', processingId }) as ToolDefinition;

describe('buildToolCommands', () => {
  it('keeps only tools with a processingId and maps them to commands', () => {
    const tools = [tool('light', 'Light', 'light'), tool('move', 'Move')];
    const cmds = buildToolCommands(tools);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ id: 'tool:light', kind: 'tool', toolName: 'light', label: 'Light' });
    expect(typeof cmds[0].description).toBe('string');
  });
});

describe('fuzzyScore', () => {
  it('scores prefix matches highest, then later substrings, then subsequences', () => {
    const prefix = fuzzyScore(['Exposure'], 'exp');
    const mid    = fuzzyScore(['Auto exposure'], 'exp');
    const subseq = fuzzyScore(['Exposure'], 'epsr');
    expect(prefix).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(0);
  });
  it('tolerates small typos via Levenshtein', () => {
    expect(fuzzyScore(['Exposure'], 'expsoure')).toBeGreaterThan(0);
  });
  it('returns 0 for unrelated queries', () => {
    expect(fuzzyScore(['Exposure'], 'qzx')).toBe(0);
  });
});

describe('filterCommands ranks title over description', () => {
  const cmds: ReturnType<typeof buildToolCommands> = [
    // Title-match candidate: label is "Curves"
    { id: 'tool:curves', kind: 'tool', label: 'Curves', description: 'RGB curves', icon: Icon, toolName: 'curves' },
    // Description-only match: label is "Light", description contains "curve"
    { id: 'tool:light', kind: 'tool', label: 'Light', description: 'Curve-like exposure controls', icon: Icon, toolName: 'light' },
  ];
  it('puts the title match ahead of the description-only match', () => {
    const out = filterCommands(cmds, 'curve');
    expect(out.map((c) => c.toolName)).toEqual(['curves', 'light']);
  });
});

describe('filterCommands', () => {
  const cmds = buildToolCommands([
    tool('light', 'Light', 'light'),
    tool('curves', 'Curves', 'curves'),
    tool('color', 'Color', 'color'),
  ]);
  it('returns all commands for an empty query', () => {
    expect(filterCommands(cmds, '')).toHaveLength(3);
  });
  it('matches case-insensitively on label substring', () => {
    expect(filterCommands(cmds, 'cur').map((c) => c.toolName)).toEqual(['curves']);
  });
  it('returns empty when nothing matches', () => {
    expect(filterCommands(cmds, 'zzz')).toEqual([]);
  });
});

describe('imageNodeLabel', () => {
  const node = (id: string, layerIds: string[]): ImageNodeState =>
    ({ id, layerIds, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
  const layer = (id: string, name: string): Layer =>
    ({ id, name, type: 'raster', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 }) as Layer;
  it("uses the node's first layer name", () => {
    expect(imageNodeLabel(node('in-1', ['l1']), [layer('l1', 'Foto.jpg')])).toBe('Foto.jpg');
  });
  it('falls back to a friendly label when no layer matches (never the raw node uuid)', () => {
    // Previous behaviour returned the node id, which surfaced raw UUIDs in
    // the palette's target chip — looked broken. Now we use a stable label.
    expect(imageNodeLabel(node('in-2', ['lx']), [])).toBe('Untitled image');
  });
});

describe('resolveInitialTargetId', () => {
  it('prefers the active id when present', () => {
    expect(resolveInitialTargetId(['in-1', 'in-2'], 'in-2')).toBe('in-2');
  });
  it('auto-selects the only node when none active', () => {
    expect(resolveInitialTargetId(['in-9'], null)).toBe('in-9');
  });
  it('falls back to the first node for multiple with none active', () => {
    expect(resolveInitialTargetId(['in-1', 'in-2'], null)).toBe('in-1');
  });
  it('returns null when there are no nodes', () => {
    expect(resolveInitialTargetId([], null)).toBeNull();
  });
});

describe('nextTargetId', () => {
  it('cycles to the next id and wraps around', () => {
    expect(nextTargetId(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextTargetId(['a', 'b', 'c'], 'c')).toBe('a');
  });
  it('returns the only id unchanged', () => {
    expect(nextTargetId(['a'], 'a')).toBe('a');
  });
  it('returns the first id when current is unknown/null', () => {
    expect(nextTargetId(['a', 'b'], null)).toBe('a');
  });
  it('returns null when there are no ids', () => {
    expect(nextTargetId([], 'a')).toBeNull();
  });
});
