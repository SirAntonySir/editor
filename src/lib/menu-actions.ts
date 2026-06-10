/**
 * Single source of truth for menu / palette actions.
 *
 * Each entry mirrors what the MenuBar's File / Edit / Image / View / AI
 * submenus expose, with explicit keyboard shortcuts (matching the global
 * listener in `keyboard-shortcuts.ts`) and a `run()` closure that binds the
 * relevant hook helpers at call time.
 *
 * `useMenuActions()` is the hook the CommandPalette consumes — it captures
 * the hook-derived helpers (useFileIO, useCanvasZoom, useImageTransform) so
 * the closures stay current as state changes. The MenuBar can adopt this
 * later; for now MenuBar keeps its inline definitions, this is the
 * Cmd+K-facing mirror.
 */

import { useMemo } from 'react';
import { useEditorStore } from '@/store';
import { useAiSession, analyseFirstImageLayer } from '@/hooks/useImageContext';
import { useFileIO } from '@/hooks/useFileIO';
import { useCanvasZoom } from '@/hooks/useCanvasZoom';
import { useImageTransform } from '@/hooks/useImageTransform';
import { useLiveMechanicalContext } from '@/hooks/useLiveMechanicalContext';
import { editorDocument } from '@/core/document';
import { revertToOriginal } from '@/lib/revert';
import { spawnRegistryOp } from '@/lib/toolrail-spawn';
import { autoLight, autoContrast, autoTone, autoColor, type AutoSpawnSpec } from '@/lib/auto-tune';
import type { MechanicalSnapshot } from '@/lib/mechanical-context';
import type { HistoryStoreState } from '@/core/history';
import { useSyncExternalStore } from 'react';

export type MenuActionGroup = 'File' | 'Edit' | 'Image' | 'View' | 'AI';

export interface MenuAction {
  /** Stable id used for keys + filter targeting. */
  id: string;
  group: MenuActionGroup;
  label: string;
  /** Mod / shift / alt keys plus a final key — same shape as the `Kbd`
   *  primitive consumes. Omitted entries render no shortcut chip. */
  shortcut?: string[];
  /** Searchable extras — synonyms / aliases (e.g. "get context" → Analyze). */
  aliases?: string[];
  disabled?: boolean;
  run: () => void;
}

/** Select a single primitive from the history store. We can NOT return a
 *  fresh `{canUndo, canRedo}` object from `getSnapshot` — `useSyncExternalStore`
 *  treats a new reference as a value change and re-fires the effect, looping
 *  forever. Two separate primitive selectors keep both values cache-stable. */
function useHistoryFlag(selector: (s: HistoryStoreState) => boolean): boolean {
  const store = editorDocument.historyStore;
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

/** Run one of the mechanical auto-tune specs by spawning the target op
 *  with the computed params. No-ops when mechanical isn't ready. */
function _runAutoSpec(spec: AutoSpawnSpec | null): void {
  if (!spec) return;
  spawnRegistryOp(spec.opId, spec.intent, spec.params);
}

function _autoAction(
  id: string, label: string, mech: MechanicalSnapshot | null,
  compute: (m: MechanicalSnapshot) => AutoSpawnSpec,
  aliases: string[],
): MenuAction {
  return {
    id, group: 'Image', label, aliases,
    disabled: !mech,
    run: () => _runAutoSpec(mech ? compute(mech) : null),
  };
}

export function useMenuActions(): MenuAction[] {
  const { handleOpen, handleClose, handleExport } = useFileIO();
  const { applyZoom, fitOnScreen, zoomIn, zoomOut } = useCanvasZoom();
  const { transformImage } = useImageTransform();
  const canUndo = useHistoryFlag((s) => s.canUndo);
  const canRedo = useHistoryFlag((s) => s.canRedo);
  const hasLayers = useEditorStore((s) => s.layers.length > 0);
  const aiStatus = useAiSession((s) => s.status);
  const hasContext = useAiSession((s) => s.context != null);
  const analysing = aiStatus === 'uploading' || aiStatus === 'analysing';
  // Mechanical snapshot drives the Auto Light/Color/Tone/Contrast actions.
  // When null (no canvas published yet) the auto entries render disabled.
  const mech = useLiveMechanicalContext();

  return useMemo<MenuAction[]>(() => [
    // ── File ────────────────────────────────────────────────────────
    { id: 'file:open',     group: 'File', label: 'Open…',
      shortcut: ['mod', 'O'], run: handleOpen },
    { id: 'file:export:png',  group: 'File', label: 'Export as PNG',
      shortcut: ['mod', 'shift', 'E'], disabled: !hasLayers,
      run: () => handleExport('png') },
    { id: 'file:export:jpeg', group: 'File', label: 'Export as JPEG',
      disabled: !hasLayers, run: () => handleExport('jpeg') },
    { id: 'file:export:webp', group: 'File', label: 'Export as WebP',
      disabled: !hasLayers, run: () => handleExport('webp') },
    { id: 'file:close',    group: 'File', label: 'Close',
      shortcut: ['mod', 'W'], disabled: !hasLayers, run: handleClose },

    // ── Edit ────────────────────────────────────────────────────────
    { id: 'edit:undo',   group: 'Edit', label: 'Undo',
      shortcut: ['mod', 'Z'], disabled: !canUndo, run: () => editorDocument.undo() },
    { id: 'edit:redo',   group: 'Edit', label: 'Redo',
      shortcut: ['mod', 'shift', 'Z'], disabled: !canRedo, run: () => editorDocument.redo() },
    { id: 'edit:revert', group: 'Edit', label: 'Revert to Original',
      shortcut: ['mod', 'alt', 'R'], disabled: !hasLayers, run: revertToOriginal },
    // Preferences live inside the palette now — see `buildPreferencesSections`.
    // The legacy modal entry has been removed; Cmd+, just opens the palette
    // (`spawn-palette:open`) via the keyboard-shortcut layer.

    // ── Image ───────────────────────────────────────────────────────
    // Auto-tune: deterministic, mechanical-only (no LLM). Each spawns the
    // matching registry op widget with starting values derived from the
    // current live mechanical snapshot.
    _autoAction('image:auto-light',    'Auto Light',    mech, autoLight,
      ['auto exposure', 'auto brightness']),
    _autoAction('image:auto-color',    'Auto Color',    mech, autoColor,
      ['auto white balance', 'auto wb', 'neutralise cast']),
    _autoAction('image:auto-tone',     'Auto Tone',     mech, autoTone,
      ['auto highlights', 'auto shadows', 'recover detail']),
    _autoAction('image:auto-contrast', 'Auto Contrast', mech, autoContrast,
      ['auto contrast']),
    { id: 'image:rotate-cw',  group: 'Image', label: 'Rotate 90° CW',
      disabled: !hasLayers, run: () => transformImage('rotateCW') },
    { id: 'image:rotate-ccw', group: 'Image', label: 'Rotate 90° CCW',
      disabled: !hasLayers, run: () => transformImage('rotateCCW') },
    { id: 'image:flip-h',     group: 'Image', label: 'Flip Horizontal',
      disabled: !hasLayers, run: () => transformImage('flipH') },
    { id: 'image:flip-v',     group: 'Image', label: 'Flip Vertical',
      disabled: !hasLayers, run: () => transformImage('flipV') },

    // ── View ────────────────────────────────────────────────────────
    { id: 'view:zoom-in',   group: 'View', label: 'Zoom In',
      shortcut: ['mod', '+'], run: zoomIn },
    { id: 'view:zoom-out',  group: 'View', label: 'Zoom Out',
      shortcut: ['mod', '-'], run: zoomOut },
    { id: 'view:fit',       group: 'View', label: 'Fit on Screen',
      shortcut: ['mod', '0'], run: fitOnScreen },
    { id: 'view:100',       group: 'View', label: 'Actual Pixels (100%)',
      shortcut: ['mod', '1'], run: () => applyZoom(1) },
    { id: 'view:200',       group: 'View', label: '200%',           run: () => applyZoom(2) },
    { id: 'view:50',        group: 'View', label: '50%',            run: () => applyZoom(0.5) },

    // ── AI ──────────────────────────────────────────────────────────
    { id: 'ai:analyze', group: 'AI',
      label: hasContext ? 'Re-analyze image' : 'Analyze image',
      aliases: ['get context', 'analyze with ai', 'reanalyze', 'image context'],
      shortcut: ['mod', 'alt', 'A'],
      disabled: !hasLayers || analysing,
      run: () => { void analyseFirstImageLayer(); } },
  ], [
    handleOpen, handleClose, handleExport, applyZoom, fitOnScreen, zoomIn, zoomOut,
    transformImage, hasLayers, canUndo, canRedo, hasContext, analysing, mech,
  ]);
}
