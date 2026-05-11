interface ReasoningBadgeProps {
  reasoning: string;
}

/**
 * Stub — full Radix Tooltip badge lands in Phase 1 Task 19.
 */
export function ReasoningBadge({ reasoning }: ReasoningBadgeProps) {
  void reasoning;
  return <span className="text-[10px] text-text-secondary">AI</span>;
}
