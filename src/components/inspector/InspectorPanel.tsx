import { AnimatePresence, motion } from 'framer-motion';
import { useEditor } from '@/components/EditorProvider';
import { useEditorStore } from '@/store';
import { LayerProperties } from './LayerProperties';

export function InspectorPanel() {
  const { toolContext, getActiveTool } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const editorMode = useEditorStore((s) => s.editorMode);
  const toolDef = getActiveTool();

  const hasToolPanel = !!toolDef?.OptionsPanel;
  const showLayerProps = !hasToolPanel && editorMode === 'compose';
  const visible = hasToolPanel || showLayerProps;

  if (!visible) return null;

  return (
    <motion.div
      className="absolute top-12 right-2 bottom-8 z-20 w-56 glass-panel overflow-y-auto overflow-x-hidden"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTool}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {hasToolPanel && toolDef.OptionsPanel ? (
            <>
              <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator">
                {toolDef.label}
              </div>
              {(() => {
                const Panel = toolDef.OptionsPanel;
                return (
                  <Panel
                    config={toolDef.defaultConfig ?? {}}
                    onConfigChange={() => {}}
                    ctx={toolContext}
                  />
                );
              })()}
            </>
          ) : (
            <LayerProperties />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
