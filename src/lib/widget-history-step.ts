/** Stepper position over a widget's (chronological, oldest→newest) timeline.
 *  `prevId`/`nextId` are the entries a back/forward press should restore to,
 *  or null at the ends. */
export interface StepState {
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
}

/**
 * Resolve the stepper position for a widget history timeline. `currentEntryId`
 * is the entry matching the widget's live params; when it's null or unknown we
 * treat the newest entry as current (the common case — the live state is the
 * latest edit). Back steps toward older entries, forward toward newer.
 */
export function resolveStep<T extends { id: string }>(
  entries: T[],
  currentEntryId: string | null,
): StepState {
  const total = entries.length;
  if (total === 0) {
    return { index: -1, total: 0, prevId: null, nextId: null };
  }
  let index = currentEntryId ? entries.findIndex((e) => e.id === currentEntryId) : -1;
  if (index === -1) index = total - 1; // null / unknown → newest
  return {
    index,
    total,
    prevId: index > 0 ? entries[index - 1].id : null,
    nextId: index < total - 1 ? entries[index + 1].id : null,
  };
}
