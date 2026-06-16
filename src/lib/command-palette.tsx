import type { ComponentType } from 'react';
import { Sun, Moon, Monitor, Square, PenLine, Layers } from 'lucide-react';
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
  type VisualStyle,
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

/** Levenshtein edit distance with an early-out cap. Returns `maxDist + 1`
 *  once the running row minimum exceeds the cap, so callers can treat any
 *  result `> maxDist` as "too far". */
function _levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Score one (already-lowercased) haystack against one (already-lowercased)
 *  needle. Higher = better. Tiers (descending):
 *    1000  prefix match
 *     800  substring match (later positions score lower)
 *     400  subsequence — needle chars appear in order, consecutive bonus
 *     200  Levenshtein within ⌊len/3⌋ on any whitespace/punct word
 *       0  no match
 */
function _scoreField(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  const idx = haystack.indexOf(needle);
  if (idx === 0) return 1000;
  if (idx > 0) return 800 - Math.min(idx, 100);
  let hi = 0, lastIdx = -2, bonus = 0, matched = true;
  for (const c of needle) {
    const f = haystack.indexOf(c, hi);
    if (f < 0) { matched = false; break; }
    if (f === lastIdx + 1) bonus += 3;
    lastIdx = f;
    hi = f + 1;
  }
  if (matched) return 400 + bonus;
  if (needle.length >= 3) {
    const maxDist = Math.max(1, Math.floor(needle.length / 3));
    for (const word of haystack.split(/[\s\-_:.]+/)) {
      if (word.length < 2) continue;
      const d = _levenshtein(word, needle, maxDist);
      if (d <= maxDist) return 200 - d * 10;
    }
  }
  return 0;
}

/** Fuzzy score for a command against a needle. Tries each field separately
 *  and returns the best match — so a typo in the label can still match the
 *  op id or an alias. Returns 0 for no match. */
export function fuzzyScore(haystacks: ReadonlyArray<string>, needle: string): number {
  if (!needle) return 1;
  const n = needle.toLowerCase();
  let best = 0;
  for (const h of haystacks) {
    const s = _scoreField(h.toLowerCase(), n);
    if (s > best) best = s;
  }
  return best;
}

/** Score one command against a needle with field-tiered weighting:
 *    title   — the tool's display name (top priority by user request)
 *    synonym — aliases + op/preset ids (treated as alt names for the title)
 *    desc    — the human-prose description (lowest priority)
 *  `primary` is true when the match came from title OR synonym; false when
 *  the row only survived on a description match. The palette uses this to
 *  shove description-only matches below the AI "Send as a prompt" row. */
function _scoreCommand(c: PaletteCommand, needle: string): { score: number; primary: boolean } {
  const title = _scoreField(c.label.toLowerCase(), needle);
  if (title > 0) return { score: title * 100, primary: true };
  let synonym = 0;
  if (c.opId)     synonym = Math.max(synonym, _scoreField(c.opId.toLowerCase(), needle));
  if (c.presetId) synonym = Math.max(synonym, _scoreField(c.presetId.toLowerCase(), needle));
  for (const a of c.aliases ?? []) synonym = Math.max(synonym, _scoreField(a.toLowerCase(), needle));
  if (synonym > 0) return { score: synonym * 10, primary: true };
  const desc = c.description ? _scoreField(c.description.toLowerCase(), needle) : 0;
  if (desc > 0) return { score: desc, primary: false };
  return { score: 0, primary: false };
}

/** Apply a query to a list of sections, partitioning by match strength so
 *  the palette can render: title-matches → AI fallback → description-only
 *  matches. Within each bucket, rows sort by fuzzy score (prefix > substring
 *  > subsequence > Levenshtein). Empty sections are pruned. */
export function filterSections(
  sections: PaletteSection[],
  query: string,
): { primary: PaletteSection[]; secondary: PaletteSection[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { primary: sections, secondary: [] };
  const primary: PaletteSection[] = [];
  const secondary: PaletteSection[] = [];
  for (const s of sections) {
    const prim: { c: PaletteCommand; score: number }[] = [];
    const sec:  { c: PaletteCommand; score: number }[] = [];
    for (const c of s.commands) {
      const { score, primary: isPrim } = _scoreCommand(c, q);
      if (score <= 0) continue;
      (isPrim ? prim : sec).push({ c, score });
    }
    if (prim.length) {
      prim.sort((a, b) => b.score - a.score);
      primary.push({ ...s, commands: prim.map((x) => x.c) });
    }
    if (sec.length) {
      sec.sort((a, b) => b.score - a.score);
      secondary.push({ ...s, commands: sec.map((x) => x.c) });
    }
  }
  return { primary, secondary };
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

const VISUAL_STYLE_OPTIONS: { style: VisualStyle; label: string; description: string; icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { style: 'classic',  label: 'Classic',  description: 'Vercel / Radix flat register (default).', icon: Layers },
  { style: 'drafting', label: 'Drafting', description: 'Architectural drafting — marginalia, ochre ink, Fraunces display.', icon: PenLine },
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

  sections.push({
    id: 'prefs:visual-style',
    title: 'Visual style',
    commands: VISUAL_STYLE_OPTIONS.map(({ style, label, description, icon }) => ({
      id: `prefs:visual-style:${style}`,
      kind: 'menu' as const,
      label: `Style: ${label}`,
      description,
      icon,
      aliases: ['style', 'visual', 'register', 'restyle', 'theme', label.toLowerCase()],
      run: () => usePreferencesStore.getState().setVisualStyle(style),
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
  return commands
    .map((c) => ({ c, ...(_scoreCommand(c, q)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
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
