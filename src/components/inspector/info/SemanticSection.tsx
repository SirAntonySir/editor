import { Fragment } from 'react';
import { Tag } from 'lucide-react';
import type { EnrichedImageContext } from '@/types/enriched-context';
import { SectionHeader } from './SectionHeader';

interface Props {
  ctx: EnrichedImageContext;
}

export function SemanticSection({ ctx }: Props) {
  const facts: [string, string | null | undefined][] = [
    ['Lighting', ctx.lighting],
    ['Mood', ctx.mood],
    ['Grade', ctx.grade_character && ctx.grade_character !== 'neutral' ? ctx.grade_character : null],
  ];
  return (
    <section className="px-3 py-2.5 border-b border-separator">
      <SectionHeader icon={Tag} label="Semantic" />
      {ctx.subjects.length > 0 && <Chips items={ctx.subjects} />}
      {ctx.dominant_tones.length > 0 && <Chips items={ctx.dominant_tones} muted />}
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {facts.map(([k, v]) =>
          v ? (
            <Fragment key={k}>
              <dt className="text-[10px] text-text-secondary">{k}</dt>
              <dd className="text-[10px] text-text-primary text-right truncate">{v}</dd>
            </Fragment>
          ) : null,
        )}
      </dl>
    </section>
  );
}

function Chips({ items, muted }: { items: string[]; muted?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {items.map((s) => (
        <span
          key={s}
          className={`text-[10px] px-1.5 py-0.5 rounded-[3px] ${
            muted
              ? 'bg-surface-secondary text-text-secondary'
              : 'bg-accent/15 text-text-primary border border-accent/20'
          }`}
        >
          {s}
        </span>
      ))}
    </div>
  );
}
