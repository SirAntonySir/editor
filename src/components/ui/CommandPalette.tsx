import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CommandPalette({
  open,
  onClose,
  onSubmit,
  placeholder = 'Describe your edit…',
  disabled,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) {
      // Clear input via startTransition so the synchronous setState inside
      // an effect body doesn't trigger a cascading-render warning.
      startTransition(() => setValue(''));
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-start justify-center pt-[20vh] bg-black/20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.form
            className="glass-panel w-[480px] px-3 py-2"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-secondary outline-none"
            />
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
