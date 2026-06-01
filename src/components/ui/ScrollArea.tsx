import { forwardRef, type ReactNode } from 'react';
import * as RadixScrollArea from '@radix-ui/react-scroll-area';

interface Props {
  children: ReactNode;
  className?: string;
  /** Inner viewport class — apply layout (`flex`, padding, etc.) here, not
   *  on the outer root. */
  viewportClassName?: string;
}

/**
 * Radix scroll-area wrapper styled to match the project register.
 *
 * The native browser scrollbar reserves track width and reflows content the
 * moment it appears — fine for big panes, jarring for narrow inspectors
 * (250-ish px) where the column visibly shrinks. Radix renders an OVERLAY
 * scrollbar absolutely positioned over the viewport, so content width stays
 * constant whether the scrollbar is visible or not.
 *
 * Use this anywhere an inspector / sidebar / popover needs to scroll.
 */
export const ScrollArea = forwardRef<HTMLDivElement, Props>(function ScrollArea(
  { children, className = '', viewportClassName = '' },
  ref,
) {
  return (
    <RadixScrollArea.Root
      ref={ref}
      type="auto"
      className={`relative overflow-hidden ${className}`}
    >
      <RadixScrollArea.Viewport
        // Radix appends a div with `display: table` inside the viewport by
        // default; `[&>div]:!block` lets descendant `flex`/`min-h-0` rules
        // work as expected on the children.
        className={`h-full w-full [&>div]:!block ${viewportClassName}`}
      >
        {children}
      </RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        orientation="vertical"
        className="flex select-none touch-none p-0.5 transition-colors duration-150
          ease-out hover:bg-surface-secondary/40 w-1.5"
      >
        <RadixScrollArea.Thumb
          className="relative flex-1 rounded-full bg-text-secondary/40
            hover:bg-text-secondary/60 transition-colors before:absolute
            before:top-1/2 before:left-1/2 before:-translate-x-1/2
            before:-translate-y-1/2 before:w-full before:h-full
            before:min-w-[44px] before:min-h-[44px]"
        />
      </RadixScrollArea.Scrollbar>
      <RadixScrollArea.Corner />
    </RadixScrollArea.Root>
  );
});
