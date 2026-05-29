import type { EnrichedImageContext } from '@/types/enriched-context';

interface Props {
  ctx: EnrichedImageContext;
}

export function SemanticSection({ ctx }: Props) {
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5">
        Semantic
      </div>
      <Chips items={ctx.subjects} />
      <Chips items={ctx.dominantTones} muted />
      <Row k="Lighting" v={ctx.lighting} />
      <Row k="Mood" v={ctx.mood} />
      {ctx.grade_character && ctx.grade_character !== 'neutral' && (
        <Row k="Grade" v={ctx.grade_character} />
      )}
    </section>
  );
}

function Chips({ items, muted }: { items: string[]; muted?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {items.map((s) => (
        <span
          key={s}
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            muted ? 'bg-surface-secondary text-text-secondary' : 'bg-accent/20 text-text-primary'
          }`}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-[10px] mb-0.5">
      <span className="text-text-secondary">{k}</span>
      <span className="text-text-primary">{v}</span>
    </div>
  );
}
