import { useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useEditorStore } from '@/store';
import { loadRegistry } from '@/lib/registry/loader';
import { dispatchPreset } from '@/lib/palette-inspector-route';
import { PresetThumb } from './PresetThumb';

const PRESET_CATEGORY_ORDER = ['tone', 'color', 'bw', 'film', 'detail', 'mood', 'look'];

const CATEGORY_LABELS: Record<string, string> = {
  tone: 'Tone',
  color: 'Color',
  bw: 'B&W',
  film: 'Film',
  detail: 'Detail',
  mood: 'Mood',
  look: 'Looks',
};

/**
 * Preset category → strand token (CSS custom property name).
 *
 * IMPORTANT: preset categories (tone, color, bw, film, detail, mood, look)
 * are a DIFFERENT vocabulary from op categories (tone, color, detail, texture,
 * effect) defined in tether-strands.ts. This is a nearest-family mapping only.
 *   film  → --strand-texture  (film grain / texture family)
 *   mood  → --strand-effect   (creative-effect family)
 *   bw    → --strand-default  (no dedicated bw token)
 *   look  → --strand-default  (catch-all creative looks)
 */
const PRESET_STRAND_TOKEN: Record<string, string> = {
  tone:   '--strand-tone',
  color:  '--strand-color',
  detail: '--strand-detail',
  film:   '--strand-texture',
  mood:   '--strand-effect',
  bw:     '--strand-default',
  look:   '--strand-default',
};

function presetStrandVar(category: string): string {
  const token = PRESET_STRAND_TOKEN[category] ?? '--strand-default';
  return `var(${token})`;
}

interface PresetRow {
  id: string;
  display_name: string;
  description: string;
  category: string;
}

/** Inspector section that lists preset categories as accordion rows — the
 *  same collapsible pattern as the tool sections above (ToolSection).
 *  Expanding a category shows its presets as thumbnail rows; clicking a
 *  preset dispatches it via the same helper Cmd+K uses. */
export function PresetsSection() {
  const grouped = useMemo(() => {
    const reg = loadRegistry();
    const byCat = new Map<string, PresetRow[]>();
    for (const [id, p] of Object.entries(reg.presets)) {
      const cat = p.category ?? 'look';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push({
        id,
        display_name: p.display_name,
        description: p.description,
        category: cat,
      });
    }
    const known = PRESET_CATEGORY_ORDER.filter((c) => byCat.has(c));
    const extra = [...byCat.keys()].filter((c) => !PRESET_CATEGORY_ORDER.includes(c)).sort();
    const ordered: { cat: string; items: PresetRow[] }[] = [];
    for (const cat of [...known, ...extra]) {
      const items = byCat.get(cat)!;
      items.sort((a, b) => a.display_name.localeCompare(b.display_name));
      ordered.push({ cat, items });
    }
    return ordered;
  }, []);

  return (
    <div className="flex flex-col">
      {grouped.map(({ cat, items }) => (
        <CategorySection key={cat} category={cat} items={items} />
      ))}
    </div>
  );
}

function CategorySection({ category, items }: { category: string; items: PresetRow[] }) {
  const sectionId = `preset:${category}`;
  const expanded = useEditorStore((s) => s.expandedSectionIds.has(sectionId));
  const toggle = useEditorStore((s) => s.toggleSectionExpanded);
  const layerId = useEditorStore((s) => s.activeLayerId);
  const colorVar = presetStrandVar(category);
  return (
    <div data-section-id={sectionId}>
      <button
        type="button"
        onClick={() => toggle(sectionId)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left min-w-0"
      >
        {/* Chevron leads the row so the disclosure state is the first thing
            the eye lands on — same rhythm as ToolSection. The strand swatch
            takes the tool icon's slot. */}
        <span className="text-text-secondary inline-flex items-center w-3">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span
          className="inline-block w-[7px] h-[7px] rounded-sm flex-shrink-0"
          style={{ background: colorVar }}
          data-strand-swatch={category}
          aria-hidden
        />
        <span className="flex-1 truncate text-xs font-medium text-text-primary">
          {CATEGORY_LABELS[category] ?? category}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {items.map((p) => (
            <PresetRowButton key={p.id} preset={p} layerId={layerId} />
          ))}
        </div>
      )}
    </div>
  );
}

function PresetRowButton({ preset, layerId }: { preset: PresetRow; layerId: string | null }) {
  const colorVar = presetStrandVar(preset.category);
  return (
    <button
      type="button"
      onClick={() => {
        // dispatchPreset routes on aiAccess: widget canvas when the AI layer
        // is on, straight-to-inspector param application in the baseline
        // study condition. Never spawn directly from here.
        dispatchPreset(preset.id, preset.display_name);
      }}
      className="flex items-center gap-2 text-left px-1.5 py-1 rounded-[3px]
        hover:bg-surface-secondary"
      title={preset.description}
    >
      <PresetThumb presetId={preset.id} layerId={layerId} />
      <span className="flex flex-col min-w-0">
        <span className="flex items-center gap-1 text-[11px] text-text-primary">
          <span
            className="inline-block w-[7px] h-[7px] rounded-sm flex-shrink-0"
            style={{ background: colorVar }}
            data-strand-swatch={preset.category}
            aria-hidden
          />
          <span className="truncate">{preset.display_name}</span>
        </span>
        <span className="text-[10px] text-text-secondary truncate">
          {preset.description}
        </span>
      </span>
    </button>
  );
}
