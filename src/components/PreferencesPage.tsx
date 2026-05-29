import { useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Check, Monitor, Sun, Moon } from 'lucide-react';
import {
  usePreferencesStore,
  applyPreferences,
  ACCENT_COLORS,
  type ThemeMode,
  type RadiusScale,
} from '@/store/preferences-store';

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
];

const RADIUS_OPTIONS: { scale: RadiusScale; label: string }[] = [
  { scale: 'none', label: 'None' },
  { scale: 'small', label: 'Small' },
  { scale: 'medium', label: 'Medium' },
  { scale: 'large', label: 'Large' },
  { scale: 'full', label: 'Full' },
];

export function PreferencesPage() {
  const { themeMode, accentColor, radiusScale, setThemeMode, setAccentColor, setRadiusScale, setShowPreferences } =
    usePreferencesStore();

  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setShowPreferences(false);
  }, [setShowPreferences]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Apply preferences live as they change
  useEffect(() => {
    applyPreferences({ themeMode, accentColor, radiusScale });
  }, [themeMode, accentColor, radiusScale]);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyPreferences({ themeMode, accentColor, radiusScale });
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode, accentColor, radiusScale]);

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--color-canvas-bg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="overlay w-[480px] max-h-[80vh] overflow-y-auto"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-separator">
          <h2 className="text-sm font-semibold text-text-primary">Preferences</h2>
          <button
            onClick={() => setShowPreferences(false)}
            className="flex items-center justify-center w-5 h-5 rounded-full hover:bg-surface-secondary transition-colors text-text-secondary hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* Appearance */}
          <Section title="Appearance">
            <div className="flex gap-2">
              {THEME_OPTIONS.map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => setThemeMode(mode)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border transition-colors cursor-default
                    ${themeMode === mode
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-separator text-text-secondary hover:border-text-secondary hover:text-text-primary'
                    }`}
                >
                  <Icon size={18} />
                  <span className="text-[11px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* Accent Color */}
          <Section title="Accent Color">
            <div className="flex gap-2 flex-wrap">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setAccentColor(color.value)}
                  className="relative w-8 h-8 rounded-full transition-transform hover:scale-110 cursor-default"
                  style={{ background: color.value }}
                  title={color.name}
                >
                  {accentColor === color.value && (
                    <span className="absolute inset-0 flex items-center justify-center text-white">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Section>

          {/* Border Radius */}
          <Section title="Border Radius">
            <div className="flex gap-1">
              {RADIUS_OPTIONS.map(({ scale, label }) => (
                <button
                  key={scale}
                  onClick={() => setRadiusScale(scale)}
                  className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors cursor-default
                    ${radiusScale === scale
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <PreviewCard />
          </Section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function PreviewCard() {
  return (
    <div className="mt-2 bg-surface-secondary border border-separator rounded-[var(--radius-panel)] p-3 space-y-2">
      <div className="text-[11px] font-medium text-text-primary">Preview</div>
      <div className="flex gap-2">
        <div className="h-6 flex-1 rounded-[var(--radius-button)] bg-accent" />
        <div className="h-6 flex-1 rounded-[var(--radius-button)] bg-surface-secondary" />
      </div>
      <div className="flex gap-1.5">
        <div className="h-4 w-12 rounded-[var(--radius-sm)] bg-surface-secondary" />
        <div className="h-4 w-16 rounded-[var(--radius-sm)] bg-surface-secondary" />
        <div className="h-4 w-10 rounded-[var(--radius-sm)] bg-surface-secondary" />
      </div>
    </div>
  );
}
