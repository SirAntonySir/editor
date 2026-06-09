import type { ComponentType, ReactNode } from 'react';
import { Pin } from 'lucide-react';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { toast } from '@/components/ui/Toast';
import type { InfoPinnedItem } from '@/types/workspace';

interface SectionHeaderProps {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  count?: number;
  right?: ReactNode;
  /** When provided, a small Pin button renders at the right of the header.
   *  Clicking it spawns ONE fused info widget on the canvas containing
   *  every supplied item. No-op when the array is empty. */
  pinnable?: InfoPinnedItem[];
}

/** Shared section header for the Info tab. Hairline divider + tiny icon +
 *  uppercase label + optional count chip / right-side content. When
 *  `pinnable` is provided, also renders a Pin button that fuses every
 *  chip in the section into a single info widget on the canvas. */
export function SectionHeader({ icon: Icon, label, count, right, pinnable }: SectionHeaderProps) {
  const hasPinnable = pinnable && pinnable.length > 0;
  function handlePinSection() {
    if (!pinnable || pinnable.length === 0) return;
    const editor = useEditorStore.getState();
    const activeId = editor.activeImageNodeId;
    const node = activeId ? editor.imageNodes[activeId] : undefined;
    const position = node
      ? { x: node.position.x + node.size.w + 32, y: node.position.y }
      : { x: 200, y: 200 };
    editorDocument.workspace.addInfoNode(
      { kind: 'stats', items: pinnable },
      { position, title: label, targetImageNodeId: activeId ?? undefined },
    );
    toast.info(`Pinned ${label} (${pinnable.length})`);
  }

  return (
    <div className="flex items-center gap-1.5 mb-2 text-text-secondary">
      <Icon size={11} className="opacity-80" />
      <span className="text-[9px] uppercase tracking-[0.08em] font-medium">{label}</span>
      {count !== undefined && (
        <span className="text-[9px] tabular-nums px-1 py-px rounded-sm bg-surface-secondary text-text-secondary">
          {count}
        </span>
      )}
      <span className="flex-1 h-px bg-separator" aria-hidden />
      {hasPinnable && (
        <button
          type="button"
          onClick={handlePinSection}
          title={`Pin ${label} (${pinnable!.length} items) to canvas as one widget`}
          aria-label={`Pin ${label} section to canvas`}
          className="inline-flex items-center text-text-secondary
            hover:text-text-primary hover:bg-surface-secondary
            p-0.5 rounded-[3px] transition-colors"
        >
          <Pin size={11} aria-hidden />
        </button>
      )}
      {right}
    </div>
  );
}
