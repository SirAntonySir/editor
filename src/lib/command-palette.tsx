import type { ComponentType } from 'react';
import { Sun, Moon, Monitor, Square } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import type { ImageNodeState } from '@/types/workspace';
import type { Layer } from '@/store/layer-slice';
import { loadRegistry } from '@/lib/registry/loader';
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import {
  usePreferencesStore,
  ACCENT_COLORS,
  type ThemeMode,
  type RadiusScale,
} from '@/store/preferences-store';

export type PaletteCommandKind = 'op' | 'preset' | 'tool' | 'menu' | 'ai';

export interface PaletteCommand {
  id: string;
  kind: PaletteCommandKind;
  label: string;
  description: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Set for kind: 'op' — registry op id (drives `forced_ops: [opId]`). */
  opId?: string;
  /** Set for kind: 'preset' — registry preset id (drives `preset_id`). */
  presetId?: string;
  /** Set for kind: 'tool' — CanvasToolRegistry name (legacy fast-path). */
  toolName?: string;
  /** Set for kind: 'menu' — direct closure to invoke on Enter / click. */
  run?: () => void;
  /** Set for kind: 'menu' — extra search terms beyond label (synonyms). */
  aliases?: string[];
  /** Set for kind: 'menu' — keyboard shortcut chip (e.g. ['mod', 'O']). */
  shortcut?: string[];
  /** Set for kind: 'menu' — dim + suppress click when true. */
  disabled?: boolean;
}

export interface PaletteSection {
  id: string;
  title: string;
  commands: PaletteCommand[];
}

/** Cache for createMaterialIcon — repeatedly calling it per render churns
 *  React components and breaks key stability. We compute once per icon name. */
const ICON_CACHE = new Map<string, ComponentType<{ size?: number; className?: string }>>();
function _materialIcon(name: string | undefined, fallback: string) {
  const key = name && name.length > 0 ? name : fallback;
  let Icon = ICON_CACHE.get(key);
  if (!Icon) {
    Icon = createMaterialIcon(key);
    ICON_CACHE.set(key, Icon);
  }
  return Icon;
}

/** Ordering of Adjustments subsections. Categories not listed here fall to
 *  the end in alphabetical order. */
const OP_CATEGORY_ORDER = ['tone', 'color', 'detail', 'mood', 'texture', 'effect'];

/** Ordering of Presets subsections, same idea. */
const PRESET_CATEGORY_ORDER = ['tone', 'color', 'bw', 'film', 'detail', 'mood', 'look'];

const CATEGORY_TITLES: Record<string, string> = {
  tone:    'Tone',
  color:   'Color',
  detail:  'Detail',
  mood:    'Mood',
  texture: 'Texture',
  effect:  'Effect',
  bw:      'Black & white',
  film:    'Film',
  look:    'Looks',
};

function _orderedCategories(seen: Set<string>, order: string[]): string[] {
  const known = order.filter((c) => seen.has(c));
  const extra = [...seen].filter((c) => !order.includes(c)).sort();
  return [...known, ...extra];
}

/** Build the Adjustments group from the SSoT registry. One section per op
 *  category, ops sorted by `engine.render_order` within each category.
 *  Icon comes from the op's `icon` field (Material name); falls back to
 *  `tune`. */
export function buildAdjustmentSections(): PaletteSection[] {
  const reg = loadRegistry();
  const byCategory = new Map<string, { id: string; op: typeof reg.ops[string] }[]>();
  for (const [id, op] of Object.entries(reg.ops)) {
    const cat = op.category ?? 'effect';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push({ id, op });
  }

  const sections: PaletteSection[] = [];
  for (const cat of _orderedCategories(new Set(byCategory.keys()), OP_CATEGORY_ORDER)) {
    const items = byCategory.get(cat)!;
    items.sort((a, b) => a.op.engine.render_order - b.op.engine.render_order);
    sections.push({
      id: `adjust:${cat}`,
      title: `Adjustments · ${CATEGORY_TITLES[cat] ?? cat}`,
      commands: items.map(({ id, op }) => ({
        id: `op:${id}`,
        kind: 'op' as const,
        label: op.display_name,
        description: op.llm.description,
        icon: _materialIcon(op.icon, 'tune'),
        opId: id,
      })),
    });
  }
  return sections;
}

/** Build the Presets group from the SSoT registry. One section per preset
 *  category, presets sorted alphabetically within. */
export function buildPresetSections(): PaletteSection[] {
  const reg = loadRegistry();
  const byCategory = new Map<string, { id: string; preset: typeof reg.presets[string] }[]>();
  for (const [id, preset] of Object.entries(reg.presets)) {
    const cat = preset.category ?? 'look';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push({ id, preset });
  }

  const sections: PaletteSection[] = [];
  for (const cat of _orderedCategories(new Set(byCategory.keys()), PRESET_CATEGORY_ORDER)) {
    const items = byCategory.get(cat)!;
    items.sort((a, b) => a.preset.display_name.localeCompare(b.preset.display_name));
    sections.push({
      id: `preset:${cat}`,
      title: `Presets · ${CATEGORY_TITLES[cat] ?? cat}`,
      commands: items.map(({ id, preset }) => ({
        id: `preset:${id}`,
        kind: 'preset' as const,
        label: preset.display_name,
        description: preset.description,
        icon: _materialIcon(preset.icon, 'auto_awesome'),
        presetId: id,
      })),
    });
  }
  return sections;
}

/** Apply a query to a list of sections — drops items that don't match and
 *  prunes empty sections. Matching is case-insensitive substring on label,
 *  description, op/preset id, and any aliases (so users can search "get
 *  context" → matches the Analyze action). */
export function filterSections(sections: PaletteSection[], query: string): PaletteSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((s) => ({
      ...s,
      commands: s.commands.filter((c) => {
        const haystack = [
          c.label,
          c.description ?? '',
          c.opId ?? '',
          c.presetId ?? '',
          ...(c.aliases ?? []),
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      }),
    }))
    .filter((s) => s.commands.length > 0);
}

/** Build sections from a flat list of MenuAction-shaped objects, grouped by
 *  `group`. Groups appear in the order they were first seen so the caller
 *  can dictate ordering by sorting their input list. */
export interface MenuActionLike {
  id: string;
  group: string;
  label: string;
  shortcut?: string[];
  aliases?: string[];
  disabled?: boolean;
  run: () => void;
}
export function buildMenuActionSections(actions: MenuActionLike[]): PaletteSection[] {
  const byGroup = new Map<string, MenuActionLike[]>();
  for (const a of actions) {
    if (!byGroup.has(a.group)) byGroup.set(a.group, []);
    byGroup.get(a.group)!.push(a);
  }
  const out: PaletteSection[] = [];
  for (const [group, items] of byGroup) {
    out.push({
      id: `menu:${group}`,
      title: group,
      commands: items.map((a) => ({
        id: `menu:${a.id}`,
        kind: 'menu' as const,
        label: a.label,
        description: '',
        run: a.run,
        aliases: a.aliases,
        shortcut: a.shortcut,
        disabled: a.disabled,
      })),
    });
  }
  return out;
}

// ─── Preferences sections (theme / accent / radius) ──────────────────
//
// The dedicated PreferencesPage modal was replaced by these palette commands
// so the user keeps a single search-driven surface. Each command sets a
// single preference value via `usePreferencesStore` and stays available for
// Cmd+K filtering ("theme dark", "accent purple", "radius small").
//
// Accent swatches are tiny CSS components built per color so the row reads
// as a swatch+label without pulling in a Material icon font glyph.

function _accentIconFor(color: string): ComponentType<{ size?: number; className?: string }> {
  return function AccentSwatchIcon({ size = 12, className = '' }) {
    return (
      <span
        aria-hidden
        className={`inline-block rounded-full ${className}`}
        style={{ width: size, height: size, background: color }}
      />
    );
  };
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { mode: 'light',  label: 'Light',  icon: Sun },
  { mode: 'dark',   label: 'Dark',   icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
];

const RADIUS_OPTIONS: { scale: RadiusScale; label: string }[] = [
  { scale: 'none',   label: 'None' },
  { scale: 'small',  label: 'Small' },
  { scale: 'medium', label: 'Medium' },
  { scale: 'large',  label: 'Large' },
  { scale: 'full',   label: 'Full' },
];

export function buildPreferencesSections(): PaletteSection[] {
  const sections: PaletteSection[] = [];

  sections.push({
    id: 'prefs:theme',
    title: 'Theme',
    commands: THEME_OPTIONS.map(({ mode, label, icon }) => ({
      id: `prefs:theme:${mode}`,
      kind: 'menu' as const,
      label: `Theme: ${label}`,
      description: 'Appearance',
      icon,
      aliases: ['theme', 'appearance', label.toLowerCase()],
      run: () => usePreferencesStore.getState().setThemeMode(mode),
    })),
  });

  sections.push({
    id: 'prefs:accent',
    title: 'Accent',
    commands: ACCENT_COLORS.map((c) => ({
      id: `prefs:accent:${c.value}`,
      kind: 'menu' as const,
      label: `Accent: ${c.name}`,
      description: 'Appearance',
      icon: _accentIconFor(c.value),
      aliases: ['accent', 'color', 'colour', c.name.toLowerCase()],
      run: () => usePreferencesStore.getState().setAccentColor(c.value),
    })),
  });

  sections.push({
    id: 'prefs:radius',
    title: 'Radius',
    commands: RADIUS_OPTIONS.map(({ scale, label }) => ({
      id: `prefs:radius:${scale}`,
      kind: 'menu' as const,
      label: `Radius: ${label}`,
      description: 'Appearance',
      icon: Square,
      aliases: ['radius', 'corners', 'rounded', label.toLowerCase()],
      run: () => usePreferencesStore.getState().setRadiusScale(scale),
    })),
  });

  return sections;
}

/** Flatten sections to a single array for keyboard arrow navigation. */
export function flattenSections(sections: PaletteSection[]): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  for (const s of sections) out.push(...s.commands);
  return out;
}

// ─── Legacy: kept for tests + the few call sites that still use them ──

/** Short, human descriptions per tool name. Kept for the toolrail-derived
 *  fast-path; new code reads descriptions from the registry. */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  light:         'Exposure, contrast, highlights, shadows',
  color:         'Saturation, vibrance, hue',
  kelvin:        'White balance / temperature',
  curves:        'RGB curves',
  levels:        'Levels with histogram',
  filters:       'LUT colour grading',
  'time-of-day': 'Dawn / noon / golden / blue / night',
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

// ─── Image-node label + cycling ───────────────────────────────────────

export function imageNodeLabel(node: ImageNodeState, layers: Layer[]): string {
  const firstLayerId = node.layerIds[0];
  const layer = layers.find((l) => l.id === firstLayerId);
  // Prefer the layer name; fall back to a friendly label rather than a
  // raw uuid — UUIDs make the target chip in the Cmd+K palette look broken.
  return layer?.name ?? 'Untitled image';
}

export function resolveInitialTargetId(ids: string[], activeId: string | null): string | null {
  if (activeId && ids.includes(activeId)) return activeId;
  if (ids.length === 0) return null;
  return ids[0];
}

export function nextTargetId(ids: string[], currentId: string | null): string | null {
  if (ids.length === 0) return null;
  const idx = currentId ? ids.indexOf(currentId) : -1;
  return ids[(idx + 1) % ids.length];
}
