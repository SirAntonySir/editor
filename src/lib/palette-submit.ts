import { serializePromptDoc, type PromptDoc } from '@/lib/prompt-doc';
import { runAgentTurn } from '@/lib/palette-actions.agent';
import { dismissAllPendingSuggestions } from '@/lib/suggestions-actions';
import { analyseActiveImageLayer, useAiSession } from '@/hooks/useImageContext';
import { usePaletteRuntime } from '@/store/palette-runtime';
import type { AttachedContextItem } from '@/lib/command-palette';

/**
 * Drive an Agent-mode prompt to completion against {@link usePaletteRuntime}.
 *
 * Lives at module scope (not inside `CommandPalette`) so the turn keeps running
 * after the palette closes — the whole point of "close on submit, load on the
 * pill". The palette fires this and immediately closes; the pill reads the
 * store for the spinner; a failure leaves the store in an error state with the
 * `restore` snapshot so reopening can repopulate the prompt.
 */
export async function submitAgentPrompt(
  doc: PromptDoc,
  attachedContext: AttachedContextItem[],
): Promise<void> {
  const runtime = usePaletteRuntime.getState();
  if (runtime.pending) return; // a turn is already in flight — ignore double-submit
  const { intent, chipSourceIds } = serializePromptDoc(doc, attachedContext);
  if (!intent) return;

  runtime.start(intent, { doc, attachedContext });

  // A direct prompt means the user is driving — clear any lingering autonomous
  // suggestion chips so they don't follow the prompt. Awaited so a denied
  // suggestion can't race the turn's own proposals.
  await dismissAllPendingSuggestions();

  // Backend's propose_stack(mcp_user_prompt) rejects with `missing_context`
  // when the image hasn't been analyzed. Auto-run analyze first so the user
  // gets a single pending state for both the analyze and the AI call.
  if (!useAiSession.getState().context) {
    usePaletteRuntime.getState().setPhase('analyze');
    try {
      // Analysis-only: the user's prompt (the turn below) drives proposals,
      // not the implicit analyze that precedes it.
      await analyseActiveImageLayer({ suggest: false });
    } catch (err) {
      usePaletteRuntime.getState().fail({
        message: err instanceof Error ? err.message : 'Analyze failed.',
      });
      return;
    }
    // User ESC'd mid-analyze — quietly stand down (no error).
    if (useAiSession.getState().context == null) {
      usePaletteRuntime.getState().finish();
      return;
    }
    usePaletteRuntime.getState().setPhase('propose');
  }

  try {
    const turn = await runAgentTurn(intent, chipSourceIds);
    if (turn.ok) usePaletteRuntime.getState().finish();
    else usePaletteRuntime.getState().fail({ message: 'The agent could not complete that request.' });
  } catch (err) {
    usePaletteRuntime.getState().fail({
      message: err instanceof Error ? err.message : 'The agent could not complete that request.',
    });
  }
}
