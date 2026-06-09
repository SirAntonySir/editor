import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { loadRegistry } from '@/lib/registry/loader';
import { spawnRegistryPreset } from '@/lib/toolrail-spawn';

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
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="text-[11px] px-2 py-1 rounded-[var(--radius-button)]
            bg-surface border border-separator text-text-primary
            hover:bg-surface-secondary transition-colors"
        >
          {CATEGORY_LABELS[category] ?? category}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="overlay w-[260px] p-1 z-[60]"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <div className="flex flex-col">
            {items.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  spawnRegistryPreset(p.id, p.display_name);
                  setOpen(false);
                }}
                className="text-left px-2 py-1.5 rounded-[3px]
                  hover:bg-surface-secondary text-[11px]"
                title={p.description}
              >
                <div className="text-text-primary">{p.display_name}</div>
                <div className="text-[10px] text-text-secondary truncate">
                  {p.description}
                </div>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
