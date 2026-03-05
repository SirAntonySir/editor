import type { ComponentProps } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);

const modMap: Record<string, string> = isMac
  ? { mod: '\u2318', shift: '\u21E7', alt: '\u2325', ctrl: '\u2303', delete: '\u232B', enter: '\u21A9', tab: '\u21E5' }
  : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', delete: 'Del', enter: 'Enter', tab: 'Tab' };

function formatKey(key: string): string {
  const lower = key.toLowerCase();
  return modMap[lower] ?? key.toUpperCase();
}

export function Kbd({
  keys,
  className = '',
  ...props
}: ComponentProps<'kbd'> & { keys: string | string[] }) {
  const parts = Array.isArray(keys) ? keys : keys.split('+');
  return (
    <kbd
      className={`pointer-events-none ml-auto flex items-center gap-px text-[10px] tracking-wide text-text-secondary ${className}`}
      {...props}
    >
      {parts.map((k, i) => (
        <span
          key={i}
          className="inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-[2px] bg-surface-secondary/60 px-0.5 font-sans text-[10px] leading-none"
        >
          {formatKey(k.trim())}
        </span>
      ))}
    </kbd>
  );
}
