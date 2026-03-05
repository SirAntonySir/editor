import { ToolRegistry } from './tool-registry';
import { useEditorStore } from '@/store';

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

  // Tool shortcuts from registry
  for (const tool of ToolRegistry.getAll()) {
    if (tool.shortcut) {
      shortcuts.push({
        key: tool.shortcut.toLowerCase(),
        action: () => useEditorStore.getState().setActiveTool(tool.name),
        label: tool.label,
      });
    }
  }

  // Global shortcuts
  shortcuts.push({
    key: 'z',
    ctrl: true,
    action: () => useEditorStore.temporal.getState().undo(),
    label: 'Undo',
  });
  shortcuts.push({
    key: 'z',
    ctrl: true,
    shift: true,
    action: () => useEditorStore.temporal.getState().redo(),
    label: 'Redo',
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
