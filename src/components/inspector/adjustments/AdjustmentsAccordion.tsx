import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { EditTargetPreview } from '@/components/ui/EditTargetPreview';
import type { ProcessingDefinition } from '@/types/processing';
import { ToolSection } from './ToolSection';
import { PresetsSection } from './PresetsSection';

// Per-def label overrides for the accordion. Most defs use their own `.label`
// directly; a few need a slightly different toolrail-style name here. Empty
// today now that "White Balance" is the canonical name for the kelvin def.
const SECTION_LABELS: Record<string, string> = {};

// Tool grouping. Each inner array is a contiguous group of rows; only the
// gaps BETWEEN groups get a separator. Within a group rows have no internal
// dividers. Order inside a group is user-friendly (not registration order).
//   1) Tonal / luminance shaping
//   2) Colour
//   3) Detail
//   4) Finishing effects
//   5) Filter presets (LUTs)
const TOOL_GROUPS: string[][] = [
  ['light', 'levels', 'curves'],
  ['color', 'kelvin', 'hsl'],
  ['sharpen', 'clarity', 'blur'],
  ['splitTone', 'vignette', 'grain'],
];

function sectionDef(def: ProcessingDefinition): ProcessingDefinition {
  const label = SECTION_LABELS[def.id];
  return label && label !== def.label ? { ...def, label } : def;
}

export function AdjustmentsAccordion() {
  const layerId = useEditorStore((s) => s.activeLayerId);
  // Baseline command-palette launcher can request a section be scrolled into
  // view (aiAccess=false routes op/preset rows here instead of spawning a
  // canvas widget). Consume the request after scrolling.
  const scrollTarget = useEditorStore((s) => s.sectionScrollTarget);
  const consumeSectionScroll = useEditorStore((s) => s.consumeSectionScroll);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollTarget) return;
    const raf = requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`[data-section-id="${scrollTarget}"]`);
      (el as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      consumeSectionScroll();
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTarget, consumeSectionScroll]);

  // Build the ordered list of (def, isLastInGroup) tuples so the renderer can
  // decide where to drop separators. Defs not in TOOL_GROUPS are ignored —
  // adding a new processing def requires adding it to a group explicitly.
  const allDefs = new Map(
    ProcessingRegistry.getByCategory('adjust').map((d) => [d.id, d]),
  );
  const groups = TOOL_GROUPS.map((ids) =>
    ids.map((id) => allDefs.get(id)).filter((d): d is ProcessingDefinition => Boolean(d)),
  ).filter((g) => g.length > 0);

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-h-0">
      <EditTargetPreview />
      <ScrollArea className="flex-1 min-h-0">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary px-2.5 pt-2 pb-1">
        Tools
      </div>
      {groups.map((group, gi) => (
        <div
          key={gi}
          className={gi < groups.length - 1 ? 'border-b border-separator' : ''}
        >
          {group.map((def) => (
            <ToolSection key={def.id} def={sectionDef(def)} layerId={layerId} />
          ))}
        </div>
      ))}
      <div className="border-t border-separator">
        <div className="text-[10px] uppercase tracking-wide text-text-secondary px-2 pt-2 pb-1">
          Presets
        </div>
        <PresetsSection />
      </div>
    </ScrollArea>
    </div>
  );
}
