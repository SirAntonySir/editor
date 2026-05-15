import { AnimatePresence, motion } from 'framer-motion';
import { useEditor } from '@/components/EditorProvider';
import { useEditorStore } from '@/store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { AiPanelSection } from './AiPanelSection';
import { AiStepSection } from './AiStepSection';

export function InspectorPanel() {
  const { toolContext, getActiveTool } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const layers = useEditorStore((s) => s.layers);
  const toolDef = getActiveTool();

  // Determine which panel to render:
  // 1. If the tool links to a ProcessingDefinition, use its Panel
  // 2. Otherwise, use the tool's own OptionsPanel
  const processingDef = toolDef?.processingId
    ? ProcessingRegistry.get(toolDef.processingId)
    : undefined;

  const hasPanel = !!(processingDef?.Panel || toolDef?.OptionsPanel);
  const aiPanelLayers = layers.filter((l) => l.type === 'ai-panel' && l.visible);
  const aiStepLayers = layers.filter(
    (l) => l.type !== 'ai-panel' && l.visible && l.aiSteps && Object.keys(l.aiSteps).length > 0,
  );

  if (!hasPanel && aiPanelLayers.length === 0 && aiStepLayers.length === 0) return null;

  return (
    <motion.div
      className="absolute top-12 right-2 z-20 w-56 max-h-[calc(100vh-5rem)] glass-panel overflow-y-auto overflow-x-hidden"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
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
    </motion.div>
  );
}
