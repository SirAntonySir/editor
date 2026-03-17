import { type ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';

interface CanvasContextMenuProps {
  children: ReactNode;
}

export function CanvasContextMenu({ children }: CanvasContextMenuProps) {
  const undo = () => editorDocument.undo();
  const redo = () => editorDocument.redo();

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="glass-panel p-1 min-w-[160px] z-50">
          <ContextMenu.Item
            className="px-2 py-1 text-xs text-text-primary hover:bg-surface-secondary rounded-sm outline-none cursor-pointer flex justify-between"
            onSelect={undo}
          >
            Undo
            <span className="text-text-secondary ml-4">Cmd+Z</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="px-2 py-1 text-xs text-text-primary hover:bg-surface-secondary rounded-sm outline-none cursor-pointer flex justify-between"
            onSelect={redo}
          >
            Redo
            <span className="text-text-secondary ml-4">Cmd+Shift+Z</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px bg-separator my-1" />
          <ContextMenu.Item
            className="px-2 py-1 text-xs text-text-primary hover:bg-surface-secondary rounded-sm outline-none cursor-pointer"
            onSelect={() => {
              const canvas = document.querySelector('canvas');
              if (canvas) {
                const store = useEditorStore.getState();
                store.setZoom(1);
                store.setPan(0, 0);
              }
            }}
          >
            Zoom to 100%
          </ContextMenu.Item>
          <ContextMenu.Item
            className="px-2 py-1 text-xs text-text-primary hover:bg-surface-secondary rounded-sm outline-none cursor-pointer"
            onSelect={() => useEditorStore.getState().resetViewport()}
          >
            Reset Viewport
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
