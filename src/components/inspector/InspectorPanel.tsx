import { AnimatePresence, motion } from 'framer-motion';
import { useEditor } from '@/components/EditorProvider';
import { useEditorStore } from '@/store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { AiPanelSection } from './AiPanelSection';
import { AiStepSection } from './AiStepSection';
import { useBackendState } from '@/store/backend-state-slice';
import { SuggestionsRail } from './SuggestionsRail';
import { WidgetCard } from './widget/WidgetCard';

const BACKEND_WIDGETS = import.meta.env.VITE_BACKEND_WIDGETS === '1';

export function InspectorPanelBody() {
  const { toolContext, getActiveTool } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const layers = useEditorStore((s) => s.layers);
  const toolDef = getActiveTool();

  const processingDef = toolDef?.processingId
    ? ProcessingRegistry.get(toolDef.processingId)
    : undefined;

  const hasPanel = !!(processingDef?.Panel || toolDef?.OptionsPanel);
  const aiPanelLayers = layers.filter((l) => l.type === 'ai-panel' && l.visible);
  const aiStepLayers = layers.filter(
    (l) => l.type !== 'ai-panel' && l.visible && l.aiSteps && Object.keys(l.aiSteps).length > 0,
  );

  const isEmpty = !hasPanel && aiPanelLayers.length === 0 && aiStepLayers.length === 0;

  if (isEmpty) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <p className="text-xs text-text-secondary text-center leading-relaxed">
          Select a tool with options to see its controls here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
      {aiPanelLayers.length > 0 && (
        <div className="border-t border-separator">
          {aiPanelLayers.map((layer) => (
            <div key={layer.id} className="border-b border-separator last:border-b-0">
              <AiPanelSection layerId={layer.id} />
            </div>
          ))}
        </div>
      )}
      {aiStepLayers.map((layer) =>
        Object.keys(layer.aiSteps ?? {}).map((graphId) => (
          <AiStepSection key={`${layer.id}-${graphId}`} layerId={layer.id} graphId={graphId} />
        )),
      )}
    </div>
  );
}

// ── Widget-driven inspector (VITE_BACKEND_WIDGETS=1) ──────────────────────────

/**
 * @internal — exported only to allow direct rendering in unit tests.
 * `BACKEND_WIDGETS` is captured at module load (Vite resolves
 * `import.meta.env.VITE_BACKEND_WIDGETS` at build time), so `vi.stubEnv`
 * in `beforeEach` cannot flip the dispatcher branch after import.
 * Production call sites should use `InspectorPanel` instead.
 */
export function InspectorPanelWidgets() {
  const snapshot = useBackendState((s) => s.snapshot);
  const accepted = useBackendState((s) => s.acceptedSuggestions);

  const widgets = snapshot?.widgets.filter((w) => w.status === 'active') ?? [];
  const suggestions = widgets.filter(
    (w) => w.origin.kind === 'mcp_autonomous' && !accepted.has(w.id),
  );
  const actives = widgets.filter((w) => !suggestions.includes(w));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-3">
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
    </div>
  );
}

/**
 * Dispatch wrapper: renders the widget-driven UI when VITE_BACKEND_WIDGETS=1,
 * otherwise delegates to the legacy InspectorPanelBody.
 */
export function InspectorPanel() {
  if (!BACKEND_WIDGETS) return <InspectorPanelBody />;
  return <InspectorPanelWidgets />;
}
