import { Sparkles } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';

interface ReasoningBadgeProps {
  reasoning: string;
  modelName?: string;
  modelVersion?: string;
  timestamp?: string;
}

export function ReasoningBadge({ reasoning, modelName, modelVersion, timestamp }: ReasoningBadgeProps) {
  const meta = [modelName, modelVersion, timestamp].filter(Boolean).join(' · ');
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-[14px] items-center gap-px rounded-[6px] bg-surface-secondary/60 px-1 text-[10px] text-text-secondary"
          >
            <Sparkles className="h-2.5 w-2.5" />
            <span>AI</span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={4}
            className="glass-panel max-w-[240px] px-2 py-1 text-[11px] text-text-primary"
          >
            <p>{reasoning}</p>
            {meta && <p className="mt-1 text-[10px] text-text-secondary">{meta}</p>}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
