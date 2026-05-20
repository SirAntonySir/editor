import { useAiSession, bindSessionFromFirstImageLayer } from '@/hooks/useImageContext';
import { generatePanel } from '@/lib/ai-client';
import { resolveSmartTarget, renderTargetSnapshot } from '@/lib/target-ref';
import { addAiStepNode } from '@/store/ai-panel-actions';
import type { TargetRef, InsertionIntent } from '@/types/ai-target';

/**
 * Shared submit handler used by every palette integration variant.
 * Pure module function — no React state — so it can be invoked from any
 * mount point (modal, dropdown, sheet, sidebar) without prop-drilling.
 */
export async function submitPaletteText(
  text: string,
  seed: { target: TargetRef; intent: InsertionIntent } | null,
): Promise<void> {
  const session = useAiSession.getState();
  let sid = session.sessionId;
  if (!sid && session.context) {
    await bindSessionFromFirstImageLayer();
    sid = useAiSession.getState().sessionId;
  }
  if (!sid) return;

  const target: TargetRef = seed?.target ?? resolveSmartTarget();
  const intent: InsertionIntent = seed?.intent ?? 'append';

  try {
    const snapshot = await renderTargetSnapshot(target);
    const graph = await generatePanel(sid, text, {
      targetSnapshotPng: snapshot,
      targetRef: target,
      insertionIntent: intent,
    });
    addAiStepNode(target, graph);
  } catch (err) {
    console.error('[Palette] generate failed:', err);
  }
}
