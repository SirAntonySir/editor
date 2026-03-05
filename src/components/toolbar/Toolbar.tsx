import { useEditor } from '@/components/EditorProvider';
import { useEditorStore } from '@/store';
import { GlassPanel } from '@/components/panels/GlassPanel';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as Tooltip from '@radix-ui/react-tooltip';

export function Toolbar() {
  const { registry } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const tools = registry.getAll();

  return (
    <Tooltip.Provider delayDuration={300}>
      <GlassPanel className="flex items-center gap-0.5 px-1.5 py-1">
        <ToggleGroup.Root
          type="single"
          value={activeTool}
          onValueChange={(value) => {
            if (value) setActiveTool(value);
          }}
          className="flex items-center gap-0.5"
        >
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Tooltip.Root key={tool.name}>
                <Tooltip.Trigger asChild>
                  <ToggleGroup.Item
                    value={tool.name}
                    className={`
                      flex items-center justify-center w-8 h-8 rounded-button
                      transition-all duration-fast ease-apple
                      ${activeTool === tool.name
                        ? 'bg-accent text-white shadow-button'
                        : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'
                      }
                    `}
                    style={{ borderRadius: 'var(--radius-button)' }}
                  >
                    <Icon size={18} />
                  </ToggleGroup.Item>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="glass-panel px-2 py-1 text-xs text-text-primary"
                    sideOffset={8}
                  >
                    {tool.label}
                    {tool.shortcut && (
                      <span className="ml-1.5 text-text-secondary">{tool.shortcut}</span>
                    )}
                    <Tooltip.Arrow className="fill-glass-bg" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}
        </ToggleGroup.Root>
      </GlassPanel>
    </Tooltip.Provider>
  );
}
