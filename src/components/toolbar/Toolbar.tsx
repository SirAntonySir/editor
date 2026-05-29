import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useEditor } from '@/components/EditorProvider';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState } from '@/store/backend-state-slice';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Separator from '@radix-ui/react-separator';
import type { ToolDefinition } from '@/types/tool';

const CATEGORY_ORDER: ToolDefinition['category'][] = ['adjust', 'filter', 'draw', 'transform'];

export function Toolbar() {
  const { registry } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const editorMode = useEditorStore((s) => s.editorMode);
  const hasAiContext = useAiSession((s) => s.context !== null);
  const sseStatus = useBackendState((s) => s.sseStatus);
  const backendOpen = sseStatus === 'open';
  const tools = registry.getForMode(editorMode);

  const grouped = useMemo(() => {
    const visible = hasAiContext ? tools : tools.filter((t) => !t.requiresAiContext);
    const groups: { category: string; tools: ToolDefinition[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const catTools = visible.filter((t) => t.category === cat);
      if (catTools.length > 0) groups.push({ category: cat, tools: catTools });
    }
    return groups;
  }, [tools, hasAiContext]);

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex-none w-10 flex flex-col items-center py-1.5 gap-0.5 bg-surface border-r border-separator">
        <ToggleGroup.Root
          type="single"
          value={activeTool}
          onValueChange={(value) => {
            if (!value) return;
            const tool = registry.get(value);
            // Widget tools (have a processingId) → start cursor-bind, the
            // canvas drop site commits an adjustment with the captured scope.
            // Mode tools (text, crop) → keep legacy setActiveTool behavior.
            if (tool?.processingId) {
              useEditorStore.getState().startToolBind(value);
              return;
            }
            setActiveTool(value);
          }}
          orientation="vertical"
          className="flex flex-col items-center gap-0.5"
        >
          {grouped.map((group, gi) => (
            <div key={group.category} className="flex flex-col items-center gap-0.5">
              {gi > 0 && (
                <Separator.Root
                  orientation="horizontal"
                  className="w-3 h-px bg-separator my-0.5"
                />
              )}
              {group.tools.map((tool) => (
                <ToolButton
                  key={tool.name}
                  tool={tool}
                  isActive={activeTool === tool.name}
                  disabled={!!tool.processingId && !backendOpen}
                />
              ))}
            </div>
          ))}
        </ToggleGroup.Root>
      </div>
    </Tooltip.Provider>
  );
}

function ToolButton({ tool, isActive, disabled }: { tool: ToolDefinition; isActive: boolean; disabled?: boolean }) {
  const Icon = tool.icon;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <ToggleGroup.Item
          value={tool.name}
          disabled={disabled}
          asChild
        >
          <motion.button
            disabled={disabled}
            className={`
              relative flex items-center justify-center w-7 h-7
              transition-colors duration-150
              ${disabled
                ? 'text-text-secondary opacity-30 cursor-not-allowed'
                : isActive
                  ? 'text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }
            `}
            style={{ borderRadius: 'var(--radius-button)' }}
            whileHover={disabled ? {} : { scale: 1.05 }}
            whileTap={disabled ? {} : { scale: 0.95 }}
          >
            {isActive && (
              <motion.div
                className="absolute inset-0 bg-accent rounded-[var(--radius-button)]"
                layoutId="toolbar-active"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative z-10"><Icon size={14} /></span>
          </motion.button>
        </ToggleGroup.Item>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="overlay px-2 py-1 text-xs text-text-primary z-[60]"
          side="right"
          sideOffset={8}
        >
          {tool.label}
          {tool.shortcut && (
            <kbd className="ml-1.5 text-text-secondary font-mono text-[10px]">{tool.shortcut}</kbd>
          )}
          <Tooltip.Arrow className="fill-glass-bg" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
