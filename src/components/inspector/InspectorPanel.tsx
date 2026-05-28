import { AnimatePresence, motion } from 'framer-motion';
import { useEditor } from '@/components/EditorProvider';
import { useEditorStore } from '@/store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { useBackendState } from '@/store/backend-state-slice';
import { SuggestionsRail } from './SuggestionsRail';
import { WidgetCard } from './widget/WidgetCard';

export function InspectorPanel() {
  const { toolContext, getActiveTool } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const toolDef = getActiveTool();

  const processingDef = toolDef?.processingId
    ? ProcessingRegistry.get(toolDef.processingId)
    : undefined;

  const hasPanel = !!(processingDef?.Panel || toolDef?.OptionsPanel);

  const snapshot = useBackendState((s) => s.snapshot);
  const accepted = useBackendState((s) => s.acceptedSuggestions);

  const widgets = snapshot?.widgets.filter((w) => w.status === 'active') ?? [];
  const suggestions = widgets.filter(
    (w) => w.origin.kind === 'mcp_autonomous' && !accepted.has(w.id),
  );
  const actives = widgets.filter((w) => !suggestions.includes(w));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      {hasPanel && (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTool}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator">
              {processingDef?.label ?? toolDef?.label}
            </div>
            {processingDef?.Panel && activeLayerId ? (
              <processingDef.Panel layerId={activeLayerId} />
            ) : toolDef?.OptionsPanel ? (
              <toolDef.OptionsPanel
                config={toolDef.defaultConfig ?? {}}
                onConfigChange={() => {}}
                ctx={toolContext}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      )}
      <div className="flex flex-col gap-4 p-3">
        <SuggestionsRail suggestions={suggestions} />
        {actives.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">
              Active widgets
            </h3>
            <div className="flex flex-col gap-2">
              {actives.map((w) => <WidgetCard key={w.id} widget={w} isSuggestion={false} />)}
            </div>
          </section>
        )}
        {!hasPanel && widgets.length === 0 && (
          <div className="flex items-center justify-center px-6 py-8">
            <p className="text-xs text-text-secondary text-center leading-relaxed">
              Select a tool with options to see its controls here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
