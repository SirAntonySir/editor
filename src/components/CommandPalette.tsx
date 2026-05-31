import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { toast } from '@/components/ui/Toast';
import { spawnToolWidget } from '@/lib/toolrail-spawn';
import { proposeFromPalette } from '@/lib/palette-actions';
import type { Scope } from '@/types/widget';
import {
  buildToolCommands,
  filterCommands,
  imageNodeLabel,
  resolveInitialTargetId,
  nextTargetId,
  type PaletteCommand,
} from '@/lib/command-palette';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const imageNodes = useEditorStore((s) => s.imageNodes);
  const layers = useEditorStore((s) => s.layers);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const setActiveImageNode = useEditorStore((s) => s.setActiveImageNode);

  const toolCommands = useMemo(() => buildToolCommands(CanvasToolRegistry.getAll()), []);
  const filtered = useMemo(() => filterCommands(toolCommands, query), [toolCommands, query]);

  const aiCommand = useMemo<PaletteCommand | null>(
    () => (query.trim()
      ? { id: 'ai', kind: 'ai', label: `"${query.trim()}" → ask AI`, description: 'Send as a prompt' }
      : null),
    [query],
  );
  const flat = useMemo<PaletteCommand[]>(
    () => (aiCommand ? [...filtered, aiCommand] : filtered),
    [filtered, aiCommand],
  );

  const nodeIds = useMemo(() => Object.keys(imageNodes), [imageNodes]);
  const targetNode = activeImageNodeId ? imageNodes[activeImageNodeId] : undefined;
  const targetLabel = targetNode ? imageNodeLabel(targetNode, layers) : '';

  // Open handler — gates on SSE + at least one image node.
  useEffect(() => {
    function onOpen() {
      const ids = Object.keys(useEditorStore.getState().imageNodes);
      if (useBackendState.getState().sseStatus !== 'open') return;
      if (ids.length === 0) {
        toast.info('Open an image first.');
        return;
      }
      const initial = resolveInitialTargetId(ids, useEditorStore.getState().activeImageNodeId);
      if (initial) setActiveImageNode(initial);
      setQuery('');
      setActiveIndex(0);
      setOpen(true);
    }
    window.addEventListener('spawn-palette:open', onOpen);
    return () => window.removeEventListener('spawn-palette:open', onOpen);
  }, [setActiveImageNode]);

  const cycleTarget = useCallback(() => {
    const next = nextTargetId(nodeIds, activeImageNodeId);
    if (next) setActiveImageNode(next);
  }, [nodeIds, activeImageNodeId, setActiveImageNode]);

  const run = useCallback(
    (cmd: PaletteCommand | undefined) => {
      if (!cmd) return;
      if (cmd.kind === 'tool' && cmd.toolName) {
        spawnToolWidget(cmd.toolName);
      } else if (cmd.kind === 'ai') {
        // Mirrors the former AskAiInput behavior: only mask scope is forwarded;
        // all other scopes collapse to global for AI prompts.
        const active = useEditorStore.getState().activeScope ?? { kind: 'global' as const };
        const scope: Scope = active.kind === 'mask'
          ? { kind: 'mask', mask_id: active.mask_id }
          : { kind: 'global' };
        void proposeFromPalette(query.trim(), scope);
      }
      setOpen(false);
    },
    [query],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleTarget();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && aiCommand) run(aiCommand);
        else run(flat[activeIndex]);
      }
    },
    [flat, activeIndex, aiCommand, cycleTarget, run],
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 bg-black/40 z-40"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              onKeyDown={onKeyDown}
              aria-describedby={undefined}
            >
              <motion.div
                className="fixed top-[18%] left-1/2 z-50 overlay w-[440px] p-0"
                initial={{ opacity: 0, x: '-50%', y: 4 }}
                animate={{ opacity: 1, x: '-50%', y: 0 }}
                exit={{ opacity: 0, x: '-50%', y: 4 }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                {/* Search row + target chip */}
                <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-separator">
                  <Search size={14} className="text-text-secondary" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
                    placeholder="Search tools or ask AI…"
                    className="flex-1 bg-transparent outline-none text-xs text-text-primary placeholder:text-text-secondary"
                  />
                  {targetLabel && (
                    <button
                      type="button"
                      onClick={cycleTarget}
                      title="Change target (Tab)"
                      className="text-[10px] text-text-secondary bg-surface-secondary px-2 py-1 rounded hover:text-text-primary"
                    >
                      → {targetLabel}
                    </button>
                  )}
                </div>

                {/* Results */}
                <div className="py-1.5 max-h-[50vh] overflow-y-auto">
                  {filtered.length > 0 && (
                    <div className="text-[9px] uppercase tracking-wide text-text-secondary px-3.5 py-1">
                      Adjustments
                    </div>
                  )}
                  {filtered.map((cmd, i) => (
                    <CommandRow
                      key={cmd.id}
                      command={cmd}
                      active={i === activeIndex}
                      onSelect={() => run(cmd)}
                    />
                  ))}
                  {aiCommand && (
                    <>
                      <div className="text-[9px] uppercase tracking-wide text-text-secondary px-3.5 py-1 mt-1">
                        AI
                      </div>
                      <CommandRow
                        command={aiCommand}
                        active={activeIndex === filtered.length}
                        onSelect={() => run(aiCommand)}
                      />
                    </>
                  )}
                  {flat.length === 0 && (
                    <div className="px-3.5 py-3 text-xs text-text-secondary">No matching tools.</div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3.5 px-3.5 py-2 border-t border-separator text-[10px] text-text-secondary">
                  <span>↑↓ navigate</span><span>↵ run</span><span>⇥ target</span><span>esc close</span>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function CommandRow({
  command,
  active,
  onSelect,
}: {
  command: PaletteCommand;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = command.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors
        ${active ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
    >
      <span className="w-4 flex justify-center text-text-secondary">
        {Icon ? <Icon size={14} /> : '✨'}
      </span>
      <span className="text-xs text-text-primary">{command.label}</span>
      {command.description && (
        <span className="text-[10px] text-text-secondary truncate">{command.description}</span>
      )}
    </button>
  );
}
