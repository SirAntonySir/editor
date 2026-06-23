/**
 * PreferencesDialog — a dedicated screen for editor preferences.
 *
 * The palette still surfaces every individual preference as a searchable
 * command (Theme: Dark / Accent: Pink / Radius: Small / …). Running one
 * sets the value AND fires `prefs:open`, so this dialog opens to show the
 * result — discoverability of the *other* preferences without leaving the
 * keyboard flow.
 *
 * Three groups are rendered as side-by-side pill rows. Selection is the
 * live store value; tapping a pill is a one-shot `set*` call.
 */
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ACCENT_COLORS,
  usePreferencesStore,
  type RadiusScale,
  type ThemeMode,
} from '@/store/preferences-store';
import {
  BACKEND_BASE_URL,
  getBackendUrlOverride,
  setBackendUrlOverride,
} from '@/lib/backend-url';

const THEME_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light',  label: 'Light' },
  { mode: 'dark',   label: 'Dark' },
  { mode: 'system', label: 'System' },
];

const RADIUS_OPTIONS: { scale: RadiusScale; label: string }[] = [
  { scale: 'none',   label: 'None' },
  { scale: 'small',  label: 'Small' },
  { scale: 'medium', label: 'Medium' },
  { scale: 'large',  label: 'Large' },
  { scale: 'full',   label: 'Full' },
];

export function PreferencesDialog() {
  const [open, setOpen] = useState(false);

  // External open via `prefs:open` so the palette's preference commands can
  // open this dialog when they set a value, the menu can wire to it, and
  // Cmd+, can route here too.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);
    window.addEventListener('prefs:open', onOpen);
    window.addEventListener('prefs:close', onClose);
    return () => {
      window.removeEventListener('prefs:open', onOpen);
      window.removeEventListener('prefs:close', onClose);
    };
  }, []);

  const themeMode = usePreferencesStore((s) => s.themeMode);
  const accentColor = usePreferencesStore((s) => s.accentColor);
  const radiusScale = usePreferencesStore((s) => s.radiusScale);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);
  const setAccentColor = usePreferencesStore((s) => s.setAccentColor);
  const setRadiusScale = usePreferencesStore((s) => s.setRadiusScale);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 bg-black/40 z-40"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                className="fixed top-[18vh] left-1/2 -translate-x-1/2 z-50 overlay p-0
                  flex flex-col w-[min(36rem,92vw)]"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              >
                <div className="px-4 py-3 border-b border-separator">
                  <Dialog.Title className="text-[13px] font-semibold text-text-primary">
                    Preferences
                  </Dialog.Title>
                  <div className="text-[10px] text-text-secondary mt-0.5">
                    Tweak appearance — everything here is also searchable in Cmd+K.
                  </div>
                </div>

                <div className="flex flex-col gap-4 px-4 py-4">
                  <Section label="Theme">
                    <PillRow>
                      {THEME_OPTIONS.map((t) => (
                        <Pill
                          key={t.mode}
                          active={themeMode === t.mode}
                          onClick={() => setThemeMode(t.mode)}
                        >
                          {t.label}
                        </Pill>
                      ))}
                    </PillRow>
                  </Section>

                  <Section label="Accent color">
                    <div className="flex flex-wrap items-center gap-2">
                      {ACCENT_COLORS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setAccentColor(c.value)}
                          aria-label={c.name}
                          aria-pressed={accentColor === c.value}
                          title={c.name}
                          className={`size-6 rounded-full transition-transform
                            ${accentColor === c.value
                              ? 'ring-2 ring-offset-2 ring-offset-[var(--color-surface)] ring-[var(--color-accent)] scale-105'
                              : 'hover:scale-105'}`}
                          style={{ background: c.value }}
                        />
                      ))}
                    </div>
                  </Section>

                  <Section label="Corner radius">
                    <PillRow>
                      {RADIUS_OPTIONS.map((r) => (
                        <Pill
                          key={r.scale}
                          active={radiusScale === r.scale}
                          onClick={() => setRadiusScale(r.scale)}
                        >
                          {r.label}
                        </Pill>
                      ))}
                    </PillRow>
                  </Section>

                  <BackendSection />
                </div>

                <div className="flex items-center justify-end px-4 py-2 border-t border-separator text-[10px] text-text-secondary">
                  <span>esc close</span>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** Open the preferences dialog from anywhere — palette commands, menu items,
 *  keyboard shortcuts. Kept as a named helper so callers don't depend on the
 *  event name string. */
export function openPreferencesDialog() {
  window.dispatchEvent(new CustomEvent('prefs:open'));
}

/** Backend URL override. Persisted to localStorage; a reload is required to
 *  re-establish the session + SSE stream, so Save reloads the app. */
function BackendSection() {
  const saved = getBackendUrlOverride();
  const [draft, setDraft] = useState(saved);
  const trimmed = draft.trim();
  const dirty = trimmed !== saved;

  const save = () => {
    if (!dirty) return;
    setBackendUrlOverride(trimmed);
    window.location.reload();
  };
  const reset = () => {
    setBackendUrlOverride('');
    window.location.reload();
  };

  return (
    <Section label="Backend URL">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
            placeholder={BACKEND_BASE_URL}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            className="flex-1 min-w-0 rounded-[5px] bg-surface-secondary border border-separator
              px-2 py-1 text-[11px] text-text-primary placeholder:text-text-secondary
              outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="px-2.5 py-1 rounded-[5px] text-[11px] bg-accent text-white whitespace-nowrap
              transition-opacity disabled:opacity-40"
          >
            Save & reload
          </button>
          {saved && (
            <button
              type="button"
              onClick={reset}
              className="px-2.5 py-1 rounded-[5px] text-[11px] text-text-secondary
                hover:text-text-primary transition-colors"
            >
              Reset
            </button>
          )}
        </div>
        <div className="text-[10px] text-text-secondary">
          {saved
            ? 'Overriding the build default. Reset to fall back to the bundled URL.'
            : `Currently using ${BACKEND_BASE_URL}. Saving reloads the app.`}
        </div>
      </div>
    </Section>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</div>
      {children}
    </div>
  );
}

function PillRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center rounded-[6px] bg-surface-secondary p-0.5 text-[11px] w-fit">
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-[5px] transition-colors ${
        active
          ? 'bg-[var(--color-surface)] text-text-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}
