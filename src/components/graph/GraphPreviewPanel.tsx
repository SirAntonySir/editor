import { useRef } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGraphStore } from '@/store/graph-store';
import { useOutputPreview } from '@/hooks/useOutputPreview';

const PREVIEW_W = 240;

export function GraphPreviewPanel() {
  const showGraphPreview = useGraphStore((s) => s.showGraphPreview);
  const toggleGraphPreview = useGraphStore((s) => s.toggleGraphPreview);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { height } = useOutputPreview(canvasRef, PREVIEW_W);

  return (
    <AnimatePresence>
      {showGraphPreview && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="absolute bottom-2 left-2 z-20 glass-panel overflow-hidden"
          style={{ width: PREVIEW_W }}
        >
          {/* Title bar */}
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-separator">
            <span className="text-[11px] font-medium text-text-secondary">Preview</span>
            <button
              onClick={toggleGraphPreview}
              className="text-text-secondary hover:text-text-primary transition-colors cursor-default"
            >
              <X size={12} />
            </button>
          </div>

          {/* Preview canvas */}
          <canvas
            ref={canvasRef}
            className="block"
            style={{ width: PREVIEW_W, height }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
