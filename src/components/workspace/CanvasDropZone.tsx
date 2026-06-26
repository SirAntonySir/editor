import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ImagePlus } from 'lucide-react';
import { openDroppedFiles } from '@/lib/canvas-file-drop';

/** Wraps the canvas area and accepts image/RAW files dragged in from the OS.
 *  Shows a drop-target highlight while a file drag is over the canvas and
 *  hands the dropped files to {@link openDroppedFiles}. */
export function CanvasDropZone({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child crossing; a depth counter keeps
  // the highlight stable instead of flickering as the cursor moves inside.
  const depth = useRef(0);

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); // required for the drop event to fire
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    void openDroppedFiles(e.dataTransfer.files);
  }, []);

  return (
    <div
      className={className}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {dragging && (
        <div
          className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center
            m-2 rounded-[var(--radius-panel)] border-2 border-dashed border-[var(--color-accent)]
            bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] backdrop-blur-[1px]"
          aria-hidden
        >
          <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-accent)]">
            <ImagePlus size={16} />
            Drop image to open
          </div>
        </div>
      )}
    </div>
  );
}
