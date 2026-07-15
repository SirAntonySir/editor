import { suggestForImageNode } from '@/hooks/useImageContext';
import { toast } from '@/components/ui/Toast';

/** Toast text per zero-result reason from `suggest_widgets`. */
const ZERO_RESULT_TOAST: Record<string, string> = {
  nothing_to_suggest: 'No new suggestions — nothing stood out on this image.',
  cooldown: 'Suggestions were just refreshed — try again in a moment.',
  // Defensive: the bulb self-serves analyze, so this shouldn't be reachable
  // from that path — but the message stays truthful if it ever is.
  no_context: 'Analyze the image first.',
};

/**
 * "Suggest something" with completion feedback. A run that mints widgets
 * announces itself via the appearing SuggestionChips; a run that legitimately
 * produces nothing (below-threshold problems, cooldown, quota) used to end in
 * silence — indistinguishable from a broken button. Toast the reason instead.
 *
 * A null result means the analyze-with-suggest path ran — the status bar and
 * chips carry that feedback, no toast here.
 */
export async function suggestWithFeedback(imageNodeId: string): Promise<void> {
  const out = await suggestForImageNode(imageNodeId);
  if (!out || out.widgetIds.length > 0) return;
  toast.info(ZERO_RESULT_TOAST[out.reason ?? 'nothing_to_suggest']);
}
