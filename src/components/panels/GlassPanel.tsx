import { type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

interface GlassPanelProps extends HTMLMotionProps<'div'> {
  children: ReactNode;
  animate?: boolean;
}

export function GlassPanel({ children, animate = true, className = '', ...props }: GlassPanelProps) {
  if (!animate) {
    return (
      <div className={`glass-panel ${className}`} {...(props as React.HTMLAttributes<HTMLDivElement>)}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={`glass-panel ${className}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 30,
        duration: 0.25,
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
