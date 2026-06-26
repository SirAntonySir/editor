import { motion } from 'framer-motion';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { BackendStatusBar } from '@/components/ui/BackendStatusBar';
import { SuggestionChips } from '@/components/ui/SuggestionChips';
import { ClientToolApproval } from '@/components/ui/ClientToolApproval';
import { CommandTrigger } from '@/components/ui/CommandTrigger';

/**
 * Bottom-center floating stack: pending AI suggestion pills above the cmd+K
 * bar. Canvas-aligned via the same sidebar offset the command palette uses,
 * so the stack lives over the visible canvas column.
 *
 * The outer container is `pointer-events-none` so the empty whitespace
 * between rows doesn't swallow canvas drags; each row opts back in with
 * `pointer-events-auto` on its own surface.
 */
export function FloatingDock() {
  const layers = useEditorStore((s) => s.layers);
  const rightSidebarWidth = usePreferencesStore((s) => s.rightSidebarWidth);
  const rightSidebarCollapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const sidebarOffset =
    layers.length > 0 && !rightSidebarCollapsed ? rightSidebarWidth : 0;

  return (
    <motion.div
      layout
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col
        items-center gap-1 pointer-events-none"
      style={{ marginLeft: -sidebarOffset / 2 }}
      transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
    >
      <BackendStatusBar />
      <ClientToolApproval />
      <SuggestionChips />
      <CommandTrigger />
    </motion.div>
  );
}
