import { useCallback, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '@/store/preferences-store';

interface SidebarShellProps {
  side: 'left' | 'right';
  collapsed: boolean;
  onToggle: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  minWidth?: number;
  maxWidth?: number;
  children: ReactNode;
}

export function SidebarShell({
  side,
  collapsed,
  onToggle,
  width,
  onWidthChange,
  minWidth = SIDEBAR_MIN_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH,
  children,
}: SidebarShellProps) {
  const isLeft = side === 'left';
  const borderSide = isLeft ? 'border-r' : 'border-l';
  const tabAlign = isLeft ? 'right-0 translate-x-full' : 'left-0 -translate-x-full';
  const tabRadius = isLeft ? 'rounded-r-md' : 'rounded-l-md';
  const handleEdge = isLeft ? 'right-0' : 'left-0';

  const ExpandedChevron = isLeft ? ChevronLeft : ChevronRight;
  const CollapsedChevron = isLeft ? ChevronRight : ChevronLeft;

  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  // The inner edge is the resize affordance: tint the panel border in the
  // accent colour while the handle is hovered or being dragged.
  const edgeActive = dragging || hovering;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (collapsed) return;
      e.preventDefault();
      setDragging(true);
      const startX = e.clientX;
      const startW = width;
      // Left sidebar grows when pointer moves right; right sidebar grows when
      // pointer moves left.
      const sign = isLeft ? 1 : -1;

      const onMove = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) * sign;
        const next = Math.max(minWidth, Math.min(maxWidth, startW + delta));
        onWidthChange(next);
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.removeProperty('cursor');
      };
      document.body.style.cursor = 'ew-resize';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [collapsed, width, isLeft, minWidth, maxWidth, onWidthChange],
  );

  return (
    <aside
      className={`relative flex-none h-full bg-surface ${borderSide}
        ${edgeActive ? 'border-accent' : 'border-separator'} transition-colors duration-150 overflow-visible
        ${dragging ? 'select-none' : 'transition-[width] duration-200 ease-out'}`}
      style={{ width: collapsed ? 0 : width }}
    >
      {/* Body */}
      <div className="h-full overflow-hidden" style={{ width }}>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              key="body"
              className="h-full flex flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Resize handle — thin invisible hit zone on the inner edge. The visual
          affordance is the accent-tinted panel border (see edgeActive) plus the
          resize cursor; no filled bar. */}
      {!collapsed && (
        <div
          onPointerDown={handlePointerDown}
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${side} sidebar`}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          className={`absolute ${handleEdge} top-0 bottom-0 w-1 z-20 cursor-ew-resize bg-transparent`}
        />
      )}

      {/* Collapse/expand chevron tab — sits just past the inner edge */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={`${collapsed ? 'Show' : 'Hide'} ${side} sidebar`}
        className={`absolute top-1/2 -translate-y-1/2 ${tabAlign} z-30
          flex items-center justify-center w-4 h-10
          bg-surface ${isLeft ? 'border-r' : 'border-l'} border-y border-separator ${tabRadius}
          text-text-secondary hover:text-text-primary hover:bg-surface-secondary
          transition-colors cursor-default`}
      >
        {collapsed ? <CollapsedChevron size={12} /> : <ExpandedChevron size={12} />}
      </button>
    </aside>
  );
}

interface SidebarSectionProps {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  flex?: string;
  children: ReactNode;
}

export function SidebarSection({
  title,
  open,
  onToggle,
  actions,
  flex,
  children,
}: SidebarSectionProps) {
  return (
    <section
      className="flex flex-col min-h-0 border-b border-separator last:border-b-0"
      style={flex ? { flex } : undefined}
    >
      <header className="flex-none flex items-center justify-between px-3 py-2 border-b border-separator">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 text-xs font-medium text-text-secondary
            hover:text-text-primary transition-colors cursor-default"
        >
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.15 }}
            className="inline-flex"
          >
            <ChevronRight size={12} />
          </motion.span>
          {title}
        </button>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </header>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            className="flex-1 min-h-0 overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="h-full overflow-y-auto">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
