import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { WidgetCard } from './widget/WidgetCard';
import type { Widget } from '@/types/widget';

interface SuggestionsRailProps {
  suggestions: Widget[];
}

export function SuggestionsRail({ suggestions }: SuggestionsRailProps) {
  const [open, setOpen] = useState(true);
  if (suggestions.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-text-secondary uppercase tracking-wide"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Suggestions ({suggestions.length})
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {suggestions.map((w) => <WidgetCard key={w.id} widget={w} isSuggestion />)}
        </div>
      )}
    </section>
  );
}
