import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { loadRegistry } from '@/lib/registry/loader';
import { spawnRegistryPreset } from '@/lib/toolrail-spawn';
import { UI } from '@/config';

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

/** Inspector section that lists preset categories. Each category opens a
 *  popover with that category's presets; clicking a preset spawns it via
 *  the same helper Cmd+K uses. Replaces the temporarily removed Filters
 *  section. */
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
    <div className="flex flex-wrap gap-1.5 px-2 py-1.5">
      {grouped.map(({ cat, items }) => (
        <CategoryButton key={cat} category={cat} items={items} />
      ))}
    </div>
  );
}

function CategoryButton({ category, items }: { category: string; items: PresetRow[] }) {
  const [open, setOpen] = useState(false);
  const colorVar = presetStrandVar(category);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-[var(--radius-button)]
            bg-surface border border-separator text-text-primary
            hover:bg-surface-secondary transition-colors"
        >
          <span
            className="inline-block w-[7px] h-[7px] rounded-sm flex-shrink-0"
            style={{ background: colorVar }}
            data-strand-swatch={category}
            aria-hidden
          />
          {CATEGORY_LABELS[category] ?? category}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="overlay w-[260px] p-1"
          style={{ zIndex: UI.zPopover }}
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <div className="flex flex-col">
            {items.map((p) => (
              <PresetRowButton key={p.id} preset={p} onSelect={() => setOpen(false)} />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PresetRowButton({ preset, onSelect }: { preset: PresetRow; onSelect: () => void }) {
  const colorVar = presetStrandVar(preset.category);
  return (
    <button
      type="button"
      onClick={() => {
        spawnRegistryPreset(preset.id, preset.display_name);
        onSelect();
      }}
      className="text-left px-2 py-1.5 rounded-[3px]
        hover:bg-surface-secondary text-[11px]"
      title={preset.description}
    >
      <div className="flex items-center gap-1 text-text-primary">
        <span
          className="inline-block w-[7px] h-[7px] rounded-sm flex-shrink-0"
          style={{ background: colorVar }}
          data-strand-swatch={preset.category}
          aria-hidden
        />
        {preset.display_name}
      </div>
      <div className="text-[10px] text-text-secondary truncate">
        {preset.description}
      </div>
    </button>
  );
}
