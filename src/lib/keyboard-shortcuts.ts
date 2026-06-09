import { CanvasToolRegistry } from './canvas-tool-registry';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { useAiSession, analyseFirstImageLayer } from '@/hooks/useImageContext';
import { revertToOriginal } from '@/lib/revert';
import { editorDocument } from '@/core/document';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);

interface ShortcutEntry {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  action: () => void;
  label: string;
}

function buildShortcuts(): ShortcutEntry[] {
  const shortcuts: ShortcutEntry[] = [];

  // Tool shortcuts from registry (only for tools available in current mode)
  for (const tool of CanvasToolRegistry.getAll()) {
    if (tool.shortcut) {
      shortcuts.push({
        key: tool.shortcut.toLowerCase(),
        action: () => {
          const state = useEditorStore.getState();
          // Only activate if tool is available in current mode
          if (tool.modes && !tool.modes.includes(state.editorMode)) return;
          if (tool.requiresAiContext && !useAiSession.getState().context) return;
          state.setActiveTool(tool.name);
        },
        label: tool.label,
      });
    }
  }

  // Mode toggle: Tab to cycle develop → compose
  shortcuts.push({
    key: 'tab',
    action: () => {
      const state = useEditorStore.getState();
      const modes = ['develop', 'compose'] as const;
      const idx = modes.indexOf(state.editorMode as typeof modes[number]);
      state.setEditorMode(modes[(idx + 1) % modes.length]);
    },
    label: 'Toggle Mode',
  });

  // Global shortcuts
  shortcuts.push({
    key: 'z',
    ctrl: true,
    action: () => editorDocument.undo(),
    label: 'Undo',
  });
  shortcuts.push({
    key: 'z',
    ctrl: true,
    shift: true,
    action: () => editorDocument.redo(),
    label: 'Redo',
  });

  shortcuts.push({
    key: 'r',
    ctrl: true,
    shift: true,
    action: () => revertToOriginal(),
    label: 'Revert to Original',
  });

  shortcuts.push({
    key: ',',
    ctrl: true,
    action: () => {
      const prefs = usePreferencesStore.getState();
      prefs.setShowPreferences(!prefs.showPreferences);
    },
    label: 'Preferences',
  });

  shortcuts.push({
    key: ']',
    ctrl: true,
    action: () => usePreferencesStore.getState().toggleRightSidebar(),
    label: 'Toggle Right Sidebar',
  });

  // Analyze image (AI) — same handler the AI menu and the Cmd+K AI-recovery
  // banner call. Gated softly: skip if there are no layers or if a previous
  // analyze is still in flight (the underlying hook is idempotent but the
  // shortcut shouldn't queue duplicates).
  shortcuts.push({
    key: 'a',
    ctrl: true,
    shift: true,
    action: () => {
      const layers = useEditorStore.getState().layers;
      if (layers.length === 0) return;
      const status = useAiSession.getState().status;
      if (status === 'uploading' || status === 'analysing') return;
      void analyseFirstImageLayer();
    },
    label: 'Analyze image',
  });

  return shortcuts;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}

export function installKeyboardShortcuts(): () => void {
  const shortcuts = buildShortcuts();

  const handler = (e: KeyboardEvent) => {
    if (isInputFocused()) return;

    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();

    for (const shortcut of shortcuts) {
      const needsCtrl = shortcut.ctrl ?? false;
      const needsShift = shortcut.shift ?? false;

      if (
        key === shortcut.key &&
        ctrl === needsCtrl &&
        shift === needsShift
      ) {
        e.preventDefault();
        shortcut.action();
        return;
      }
    }
  };

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

export function getShortcutEntries(): { key: string; label: string; display: string }[] {
  const shortcuts = buildShortcuts();
  const mod = isMac ? 'Cmd' : 'Ctrl';
  return shortcuts.map((s) => {
    const parts: string[] = [];
    if (s.ctrl) parts.push(mod);
    if (s.shift) parts.push('Shift');
    parts.push(s.key.toUpperCase());
    return { key: s.key, label: s.label, display: parts.join('+') };
  });
}
