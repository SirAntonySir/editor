import { useCallback, useState } from 'react';
import type { SplitDirection } from '@/store/graph-positions-slice';

interface GraphSplitDividerProps {
  direction: SplitDirection;
  onRatioChange: (ratio: number) => void;
}

export function GraphSplitDivider({ direction, onRatioChange }: GraphSplitDividerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const isVertical = direction === 'vertical';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = (e.currentTarget as HTMLElement).parentElement;
      if (!container) return;
      setIsDragging(true);

      const handleMove = (me: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const pos = isVertical
          ? (me.clientX - rect.left) / rect.width
          : (me.clientY - rect.top) / rect.height;
        onRatioChange(Math.max(0.15, Math.min(0.85, pos)));
      };

      const handleUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    },
    [isVertical, onRatioChange],
  );

  return (
    <div
      className={`flex-none select-none transition-colors ${
        isVertical ? 'w-[2px] cursor-col-resize' : 'h-[2px] cursor-row-resize'
      } ${isDragging ? 'bg-accent' : 'bg-separator hover:bg-accent/60'}`}
      onMouseDown={handleMouseDown}
    />
  );
}
