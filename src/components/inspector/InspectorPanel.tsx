import { AnimatePresence, motion } from 'framer-motion';
import { useEditor } from '@/components/EditorProvider';
import { useEditorStore } from '@/store';

export function InspectorPanel() {
  const { toolContext, getActiveTool } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const toolDef = getActiveTool();

  const hasToolPanel = !!toolDef?.OptionsPanel;

  if (!hasToolPanel) return null;

  return (
    <motion.div
      className="absolute top-12 right-2 z-20 w-56 max-h-[calc(100vh-5rem)] glass-panel overflow-y-auto overflow-x-hidden"
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
          <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator">
            {toolDef.label}
          </div>
          {(() => {
            const Panel = toolDef.OptionsPanel!;
            return (
              <Panel
                config={toolDef.defaultConfig ?? {}}
                onConfigChange={() => {}}
                ctx={toolContext}
              />
            );
          })()}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
