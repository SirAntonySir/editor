import * as Menubar from '@radix-ui/react-menubar';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useSyncExternalStore, type CSSProperties } from 'react';
import { Undo2, Redo2, RotateCcw } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { revertToOriginal } from '@/lib/revert';
import { editorDocument } from '@/core/document';
import { useFileIO } from '@/hooks/useFileIO';
import { BackendStatusBadge } from '@/components/ui/BackendStatusBadge';
import { useAiSession, analyseImageLayer } from '@/hooks/useImageContext';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { useCanvasZoom } from '@/hooks/useCanvasZoom';
import { useImageTransform } from '@/hooks/useImageTransform';
import { UI } from '@/config';
import { useAiAccess } from '@/lib/ai-access';
import { spawnRegistryOp } from '@/lib/toolrail-spawn';
import { openPreferencesDialog } from '@/components/PreferencesDialog';
import { loadRegistry } from '@/lib/registry/loader';
import { useLiveMechanicalContext } from '@/hooks/useLiveMechanicalContext';
import { autoLight, autoColor, autoTone, autoContrast } from '@/lib/auto-tune';
import type { HistoryStoreState } from '@/core/history';
import { HistoryDropdown } from './HistoryDropdown';
// EditorMode type only used by disabled ModeBtn — kept for future reference.
// import type { EditorMode } from '@/store/tool-slice';

/* ------------------------------------------------------------------ */
/*  Shared primitives                                                 */
/* ------------------------------------------------------------------ */

const menuContentClass =
  'z-50 min-w-[190px] rounded-[var(--radius-panel)] bg-surface border border-border-strong shadow-overlay p-[3px] text-[11px] text-text-primary';

// Space reserved at the window edge so the OS window controls don't overlap the
// menus. macOS draws the traffic lights top-left (hiddenInset); Windows draws
// the caption buttons top-right (via titleBarOverlay in electron/main.cjs). The
// web build reserves nothing. Widths cover the control cluster on a 24px bar.
const MAC_TRAFFIC_LIGHT_INSET = 64;
const WIN_CAPTION_INSET = 140;

const menuItemClass =
  'relative flex cursor-default select-none items-center gap-1.5 rounded-[3px] px-2 h-[22px] outline-none text-[11px] data-[highlighted]:bg-accent data-[highlighted]:text-white data-[disabled]:opacity-40 data-[disabled]:pointer-events-none';

const separatorClass = 'my-[2px] h-px bg-separator';

const subTriggerClass =
  'relative flex cursor-default select-none items-center gap-1.5 rounded-[3px] px-2 h-[22px] outline-none text-[11px] data-[highlighted]:bg-accent data-[highlighted]:text-white data-[state=open]:bg-surface-secondary';

const labelClass = 'px-2 h-[18px] flex items-center text-[10px] font-medium text-text-secondary';

function Item({
  children,
  keys,
  disabled,
  onSelect,
}: {
  children: React.ReactNode;
  keys?: string | string[];
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <Menubar.Item className={menuItemClass} disabled={disabled} onSelect={onSelect}>
      <span className="flex-1">{children}</span>
      {keys && <Kbd keys={keys} />}
    </Menubar.Item>
  );
}

function Sep() {
  return <Menubar.Separator className={separatorClass} />;
}

function Sub({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Menubar.Sub>
      <Menubar.SubTrigger className={subTriggerClass}>
        <span className="flex-1">{label}</span>
        <span className="text-text-secondary text-xs">&#9656;</span>
      </Menubar.SubTrigger>
      <Menubar.Portal>
        <Menubar.SubContent className={menuContentClass} sideOffset={4} alignOffset={-4}>
          {children}
        </Menubar.SubContent>
      </Menubar.Portal>
    </Menubar.Sub>
  );
}

function TriggerButton({ children }: { children: React.ReactNode }) {
  return (
    <Menubar.Trigger className="flex items-center px-1.5 py-px rounded-[3px] text-[11px] leading-tight font-medium text-text-secondary data-[state=open]:bg-surface-secondary data-[state=open]:text-text-primary hover:text-text-primary transition-colors cursor-default select-none outline-none">
      {children}
    </Menubar.Trigger>
  );
}

/* ------------------------------------------------------------------ */
/*  Menu Bar                                                          */
/* ------------------------------------------------------------------ */

export function MenuBar() {
  const { handleOpen, handleAddImage, handleClose, handleExport } = useFileIO();
  const { transformImage } = useImageTransform();
  const { applyZoom, fitOnScreen, zoomIn, zoomOut } = useCanvasZoom();
  // Study control condition hides the AI menu entirely (see useAiAccess).
  const aiAccess = useAiAccess();

  const platform = typeof window !== 'undefined' ? window.electron?.platform : undefined;
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';
  // The whole bar is the window drag region; interactive clusters opt out with
  // `no-drag`. Reserve space on the side where the OS draws its window controls.
  const barStyle = {
    WebkitAppRegion: 'drag',
    paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_INSET : undefined,
    paddingRight: isWin ? WIN_CAPTION_INSET : undefined,
  } as CSSProperties;
  const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

  return (
    <div className="flex items-center w-full" style={barStyle}>
      <Menubar.Root style={noDrag} className="flex items-center gap-0 text-sm text-text-primary">
        <FileMenu onOpen={handleOpen} onAddImage={handleAddImage} onExport={handleExport} onClose={handleClose} />
        <EditMenu />
        <ImageMenu transformImage={transformImage} />
        <LayerMenu />
        <ViewMenu applyZoom={applyZoom} fitOnScreen={fitOnScreen} zoomIn={zoomIn} zoomOut={zoomOut} />
        {/* Filters used to live in their own top-level menu; they're now
            part of Image → Adjustments via the SSoT registry. */}
        {aiAccess && <AiMenu />}
        <HelpMenu />
      </Menubar.Root>

      {/* Spacer (stays draggable) */}
      <div className="flex-1" />

      {/* Right-side controls — opt out of the drag region so they stay clickable */}
      <div className="flex items-center" style={noDrag}>
        <BackendStatusBadge />
        <div className="w-px h-3 bg-separator mx-1.5" />
        <UndoRedoButtons />
        {/* Mode switcher disabled — only Develop remained, made redundant. */}
        {/* <ModeSwitcherButtons /> */}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File                                                              */
/* ------------------------------------------------------------------ */

function FileMenu({
  onOpen,
  onAddImage,
  onExport,
  onClose,
}: {
  onOpen: () => void;
  onAddImage: () => void;
  onExport: (format: 'png' | 'jpeg' | 'webp') => void;
  onClose: () => void;
}) {
  const hasLayers = useEditorStore((s) => s.layers.length > 0);
  const hasDocument = useEditorStore((s) => s.documentMeta !== null);
  const sseStatus = useBackendState((s) => s.sseStatus);
  const canAddImage = hasDocument && sseStatus === 'open';
  return (
    <Menubar.Menu>
      <TriggerButton>File</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Item keys={['mod', 'O']} onSelect={onOpen}>
            Open...
          </Item>
          <Item keys={['mod', 'shift', 'O']} disabled={!canAddImage} onSelect={onAddImage}>
            Add image...
          </Item>
          <Sep />
          <Sub label="Export As">
            <Item onSelect={() => onExport('png')} keys={['mod', 'shift', 'E']}>
              PNG
            </Item>
            <Item onSelect={() => onExport('jpeg')}>JPEG</Item>
            <Item onSelect={() => onExport('webp')}>WebP</Item>
          </Sub>
          <Sep />
          <Item disabled={!hasLayers} onSelect={onClose} keys={['mod', 'W']}>Close</Item>
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  Edit                                                              */
/* ------------------------------------------------------------------ */

function EditMenu() {
  const hasLayers = useEditorStore((s) => s.layers.length > 0);

  return (
    <Menubar.Menu>
      <TriggerButton>Edit</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Item keys={['mod', 'Z']} onSelect={() => editorDocument.undo()}>
            Undo
          </Item>
          <Item keys={['mod', 'shift', 'Z']} onSelect={() => editorDocument.redo()}>
            Redo
          </Item>
          <Sep />
          <Item keys={['mod', 'alt', 'R']} disabled={!hasLayers} onSelect={revertToOriginal}>
            Revert to Original
          </Item>
          <Sep />
          <Item keys={['mod', 'X']} disabled>
            Cut
          </Item>
          <Item keys={['mod', 'C']} disabled>
            Copy
          </Item>
          <Item keys={['mod', 'V']} disabled>
            Paste
          </Item>
          <Sep />
          <Item keys={['mod', 'A']} disabled>
            Select All
          </Item>
          <Item keys={['mod', 'D']} disabled>
            Deselect
          </Item>
          <Sep />
          <Item keys={['mod', ',']} onSelect={() => openPreferencesDialog()}>
            Preferences...
          </Item>
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  Image                                                             */
/* ------------------------------------------------------------------ */

function ImageMenu({ transformImage }: { transformImage: (mode: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => void }) {
  const hasLayers = useEditorStore((s) => s.layers.length > 0);

  return (
    <Menubar.Menu>
      <TriggerButton>Image</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Sub label="Adjustments">
            <AdjustmentItems />
          </Sub>
          <AutoSubmenu />
          <Sep />
          <Item disabled>Image Size...</Item>
          <Item disabled>Canvas Size...</Item>
          <Sep />
          <Item disabled={!hasLayers} onSelect={() => transformImage('rotateCW')}>
            Rotate 90° CW
          </Item>
          <Item disabled={!hasLayers} onSelect={() => transformImage('rotateCCW')}>
            Rotate 90° CCW
          </Item>
          <Item disabled={!hasLayers} onSelect={() => transformImage('flipH')}>
            Flip Horizontal
          </Item>
          <Item disabled={!hasLayers} onSelect={() => transformImage('flipV')}>
            Flip Vertical
          </Item>
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/** Image → Auto: mechanically-derived starting values for Light / Color /
 *  Tone / Contrast. Each item disables when no mechanical snapshot is
 *  available (image not yet rendered into a canvas). The same handler runs
 *  whether the user picks via the menu or via Cmd+K. */
function AutoSubmenu() {
  const mech = useLiveMechanicalContext();
  const disabled = !mech;
  return (
    <Sub label="Auto">
      <Item disabled={disabled} onSelect={() => mech && (
        ((spec) => spawnRegistryOp(spec.opId, spec.intent, spec.params))(autoLight(mech))
      )}>Auto Light</Item>
      <Item disabled={disabled} onSelect={() => mech && (
        ((spec) => spawnRegistryOp(spec.opId, spec.intent, spec.params))(autoColor(mech))
      )}>Auto Color</Item>
      <Item disabled={disabled} onSelect={() => mech && (
        ((spec) => spawnRegistryOp(spec.opId, spec.intent, spec.params))(autoTone(mech))
      )}>Auto Tone</Item>
      <Item disabled={disabled} onSelect={() => mech && (
        ((spec) => spawnRegistryOp(spec.opId, spec.intent, spec.params))(autoContrast(mech))
      )}>Auto Contrast</Item>
    </Sub>
  );
}

/** Image → Adjustments: every registry op, grouped by `category`. Selecting
 *  an item spawns the op's widget on the active image node (same path Cmd+K
 *  takes via `spawnRegistryOp`). Submenu groups when there's >1 category. */
function AdjustmentItems() {
  const ops = Object.values(loadRegistry().ops);
  const byCategory = new Map<string, typeof ops>();
  for (const op of ops) {
    const cat = op.category ?? 'other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(op);
  }
  // Stable category ordering matches Cmd+K.
  const order = ['tone', 'color', 'detail', 'mood', 'texture', 'effect'];
  const cats = [
    ...order.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !order.includes(c)).sort(),
  ];
  const categoryTitle: Record<string, string> = {
    tone: 'Tone', color: 'Color', detail: 'Detail', mood: 'Mood',
    texture: 'Texture', effect: 'Effect', other: 'Other',
  };

  return (
    <>
      {cats.map((cat, i) => {
        const list = byCategory.get(cat)!
          .sort((a, b) => a.engine.render_order - b.engine.render_order);
        return (
          <Sub key={cat} label={categoryTitle[cat] ?? cat}>
            {list.map((op) => (
              <Item key={op.id} onSelect={() => spawnRegistryOp(op.id, op.display_name)}>
                {op.display_name}
              </Item>
            ))}
            {/* Trailing sep only if not the last group — keeps overflow clean. */}
            {i < cats.length - 1 ? null : null}
          </Sub>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Layer                                                             */
/* ------------------------------------------------------------------ */

function LayerMenu() {
  const hasLayers = useEditorStore((s) => s.layers.length > 0);

  return (
    <Menubar.Menu>
      <TriggerButton>Layer</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Item disabled>New Layer</Item>
          <Item disabled={!hasLayers}>Duplicate Layer</Item>
          <Item disabled={!hasLayers}>Delete Layer</Item>
          <Sep />
          <Item disabled={!hasLayers}>Flatten Image</Item>
          <Item disabled={!hasLayers}>Merge Visible</Item>
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  View                                                              */
/* ------------------------------------------------------------------ */

function ViewMenu({
  applyZoom,
  fitOnScreen,
  zoomIn,
  zoomOut,
}: {
  applyZoom: (zoom: number) => void;
  fitOnScreen: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}) {
  return (
    <Menubar.Menu>
      <TriggerButton>View</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Item keys={['mod', '+']} onSelect={zoomIn}>
            Zoom In
          </Item>
          <Item keys={['mod', '-']} onSelect={zoomOut}>
            Zoom Out
          </Item>
          <Sep />
          <Item keys={['mod', '0']} onSelect={fitOnScreen}>
            Fit on Screen
          </Item>
          <Item keys={['mod', '1']} onSelect={() => applyZoom(1)}>
            Actual Pixels (100%)
          </Item>
          <Item onSelect={() => applyZoom(2)}>200%</Item>
          <Item onSelect={() => applyZoom(0.5)}>50%</Item>
          {/* Mode switcher disabled — only Develop remains; new workflow TBD.
          <Sep />
          <Menubar.Label className={labelClass}>Mode</Menubar.Label>

          <CheckItem
            checked={editorMode === 'develop'}
            onCheckedChange={() => setEditorMode('develop')}
            keys={['tab']}
          >
            Develop
          </CheckItem>
          <CheckItem
            checked={editorMode === 'compose'}
            onCheckedChange={() => setEditorMode('compose')}
            keys={['tab']}
          >
            Compose
          </CheckItem>
          <CheckItem
            checked={editorMode === 'graph'}
            onCheckedChange={() => setEditorMode('graph')}
            keys={['tab']}
          >
            Graph
          </CheckItem>
          */}
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  AI                                                                */
/* ------------------------------------------------------------------ */

function formatHistoryTime(ms: number): string {
  // Compact "HH:MM" so a 50-entry submenu stays readable. Locale-aware so
  // 24h vs 12h matches the user's environment.
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function SuggestionHistorySubmenu() {
  const history = useSuggestionsUi((s) => s.suggestionHistory);
  if (history.length === 0) {
    return (
      <Sub label="Suggestion history">
        <Menubar.Item className={menuItemClass} disabled>
          <span className="flex-1 text-text-secondary italic">No decisions yet</span>
        </Menubar.Item>
      </Sub>
    );
  }
  return (
    <Sub label="Suggestion history">
      {history.map((entry) => (
        <Menubar.Item
          key={`${entry.id}:${entry.decidedAt}`}
          className={menuItemClass}
          // Read-only entries — selecting one does nothing today. Future:
          // re-show the SuggestionChip / re-tether an allowed widget.
          disabled
          title={entry.reasoning ?? undefined}
        >
          <span
            className={
              entry.decision === 'allowed'
                ? 'text-ai shrink-0 mr-1.5'
                : 'text-text-secondary shrink-0 mr-1.5'
            }
            aria-hidden
          >
            {entry.decision === 'allowed' ? '✓' : '✗'}
          </span>
          <span className="flex-1 truncate">{entry.intent}</span>
          <span className="ml-3 text-text-secondary text-[10px] tabular-nums">
            {formatHistoryTime(entry.decidedAt)}
          </span>
        </Menubar.Item>
      ))}
    </Sub>
  );
}

function AiMenu() {
  const status = useAiSession((s) => s.status);
  const analysedIds = useAiSession((s) => s.analysedImageNodeIds);
  const imageNodes = useEditorStore((s) => s.imageNodes);
  const layers = useEditorStore((s) => s.layers);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const hasLayers = layers.length > 0;
  const analysing = status === 'uploading' || status === 'analysing';

  /** Open the command palette in Ask mode. Attaches the named image-node
   *  as a context chip when one is given so the LLM grounds on a
   *  specific image; otherwise opens Ask with no chip and the user
   *  can type a freeform question. */
  function openAsk(imageNodeId?: string) {
    const node = imageNodeId ? imageNodes[imageNodeId] : undefined;
    const attachContext = node
      ? [{
          label: 'Image',
          value: node.name
            ?? layers.find((l) => l.id === node.layerIds[0])?.name
            ?? imageNodeId!,
          sourceId: `imageNode:${imageNodeId}`,
        }]
      : [];
    window.dispatchEvent(new CustomEvent('spawn-palette:open', {
      detail: { mode: 'ask', attachContext },
    }));
  }

  const nodeIds = Object.keys(imageNodes);

  // Human-readable name for an image-node: node.name → first layer's name → id.
  const nameFor = (id: string): string => {
    const node = imageNodes[id];
    if (!node) return id;
    if (node.name) return node.name;
    const firstLayer = node.layerIds[0]
      ? layers.find((l) => l.id === node.layerIds[0])
      : undefined;
    return firstLayer?.name ?? id;
  };

  const labelFor = (id: string): string => {
    const verb = analysedIds.includes(id) ? 'Re-analyze' : 'Analyze';
    return `${verb} "${nameFor(id)}"`;
  };

  const runAnalyse = (id: string) => void analyseImageLayer(id);

  // Single-image (or no image) case: simple one-item shape with the shortcut.
  if (nodeIds.length <= 1) {
    const onlyId = nodeIds[0] ?? null;
    return (
      <Menubar.Menu>
        <TriggerButton>AI</TriggerButton>
        <Menubar.Portal>
          <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
            <Item
              onSelect={() => onlyId && runAnalyse(onlyId)}
              disabled={!hasLayers || analysing || !onlyId}
              keys={['mod', 'alt', 'A']}
            >
              {onlyId ? labelFor(onlyId) : 'Analyze image'}
            </Item>
            <Item
              onSelect={() => openAsk(onlyId ?? undefined)}
              disabled={!hasLayers || !onlyId}
            >
              Ask about the image…
            </Item>
            <Sep />
            <SuggestionHistorySubmenu />
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>
    );
  }

  // Multi-image case: a top-level shortcut row for the active image (keeps
  // Cmd+Alt+A discoverable) plus a submenu listing every image-node.
  return (
    <Menubar.Menu>
      <TriggerButton>AI</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          {/* Active-image shortcut row — always visible so Cmd+Alt+A is shown. */}
          {activeImageNodeId && imageNodes[activeImageNodeId] && (
            <Item
              onSelect={() => runAnalyse(activeImageNodeId)}
              disabled={!hasLayers || analysing}
              keys={['mod', 'alt', 'A']}
            >
              <span
                className="inline-block w-1.5 h-1.5 mr-2 rounded-full bg-[var(--color-accent)] align-middle"
                aria-hidden
              />
              {labelFor(activeImageNodeId)}
            </Item>
          )}
          {/* Ask shortcut row mirrors the Analyze row above so both the
              "what" (analyze) and the "ask" affordances are one click
              from the menu's first action. Targets the active image so
              the LLM grounds on the same node the active row analyses. */}
          {activeImageNodeId && imageNodes[activeImageNodeId] && (
            <Item
              onSelect={() => openAsk(activeImageNodeId)}
              disabled={!hasLayers}
            >
              <span className="inline-block w-1.5 h-1.5 mr-2" aria-hidden />
              Ask about the active image…
            </Item>
          )}
          {/* Submenu listing all image-nodes so the user can target any one. */}
          <Sub label="Analyze image…">
            {nodeIds.map((id) => (
              <Item
                key={id}
                onSelect={() => runAnalyse(id)}
                disabled={analysing}
              >
                {id === activeImageNodeId ? (
                  <span
                    className="inline-block w-1.5 h-1.5 mr-2 rounded-full bg-[var(--color-accent)] align-middle"
                    aria-hidden
                  />
                ) : (
                  <span className="inline-block w-1.5 h-1.5 mr-2" aria-hidden />
                )}
                {labelFor(id)}
              </Item>
            ))}
          </Sub>
          <Sep />
          <SuggestionHistorySubmenu />
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  Help                                                              */
/* ------------------------------------------------------------------ */

function HelpMenu() {
  const tools = CanvasToolRegistry.getAll();

  return (
    <Menubar.Menu>
      <TriggerButton>Help</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Menubar.Label className={labelClass}>Keyboard Shortcuts</Menubar.Label>
          {tools
            .filter((t) => t.shortcut)
            .map((t) => (
              <Item key={t.name} keys={[t.shortcut!]} disabled>
                {t.label}
              </Item>
            ))}
          <Sep />
          <Item keys={['mod', 'Z']} disabled>
            Undo
          </Item>
          <Item keys={['mod', 'shift', 'Z']} disabled>
            Redo
          </Item>
          <Item keys={['tab']} disabled>
            Toggle Mode
          </Item>
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  Undo / Redo buttons                                               */
/* ------------------------------------------------------------------ */

function useHistoryStore<T>(selector: (state: HistoryStoreState) => T): T {
  const store = editorDocument.historyStore;
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

function UndoRedoButtons() {
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const hasLayers = useEditorStore((s) => s.layers.length > 0);

  const btnClass =
    'flex items-center justify-center w-5 h-5 rounded-[3px] transition-colors text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary cursor-default';

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-px">
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button disabled={!canUndo} onClick={() => editorDocument.undo()} className={btnClass}>
              <Undo2 size={12} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="overlay px-1.5 py-0.5 text-[10px] text-text-primary" style={{ zIndex: UI.zPopover }} sideOffset={6}>
              Undo <Kbd keys={['mod', 'Z']} className="inline-flex ml-1" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button disabled={!canRedo} onClick={() => editorDocument.redo()} className={btnClass}>
              <Redo2 size={12} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="overlay px-1.5 py-0.5 text-[10px] text-text-primary" style={{ zIndex: UI.zPopover }} sideOffset={6}>
              Redo <Kbd keys={['mod', 'shift', 'Z']} className="inline-flex ml-1" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <HistoryDropdown />
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button disabled={!hasLayers} onClick={revertToOriginal} className={btnClass}>
              <RotateCcw size={12} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="overlay px-1.5 py-0.5 text-[10px] text-text-primary" style={{ zIndex: UI.zPopover }} sideOffset={6}>
              Revert to Original <Kbd keys={['mod', 'alt', 'R']} className="inline-flex ml-1" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </Tooltip.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Mode switcher                                                     */
/* ------------------------------------------------------------------ */

// Mode switcher disabled — component preserved for future reference.
// function ModeSwitcherButtons() {
//   const editorMode = useEditorStore((s) => s.editorMode);
//   const setEditorMode = useEditorStore((s) => s.setEditorMode);
//
//   return (
//     <Tooltip.Provider delayDuration={300}>
//       <div className="flex items-center gap-px">
//         <ModeBtn mode="develop" label="Develop" icon={<SlidersHorizontal size={11} />} isActive={editorMode === 'develop'} onClick={() => setEditorMode('develop')} />
//         <ModeBtn mode="compose" label="Compose" icon={<Layers size={11} />} isActive={editorMode === 'compose'} onClick={() => setEditorMode('compose')} />
//         <ModeBtn mode="graph" label="Graph" icon={<Workflow size={11} />} isActive={editorMode === 'graph'} onClick={() => setEditorMode('graph')} />
//       </div>
//     </Tooltip.Provider>
//   );
// }

// ModeBtn disabled — preserved for future reference.
// function ModeBtn({ label, icon, isActive, onClick }: {
//   mode: EditorMode;
//   label: string;
//   icon: React.ReactNode;
//   isActive: boolean;
//   onClick: () => void;
// }) {
//   return (
//     <Tooltip.Root>
//       <Tooltip.Trigger asChild>
//         <button
//           className={`flex items-center gap-1 px-1.5 py-px rounded-[3px] text-[11px] leading-tight font-medium transition-colors cursor-default
//             ${isActive ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
//           onClick={onClick}
//         >
//           {icon}
//           {label}
//         </button>
//       </Tooltip.Trigger>
//       <Tooltip.Portal>
//         <Tooltip.Content className="overlay px-1.5 py-0.5 text-[10px] text-text-primary z-[60]" sideOffset={6}>
//           {label} <Kbd keys={['tab']} className="inline-flex ml-1" />
//         </Tooltip.Content>
//       </Tooltip.Portal>
//     </Tooltip.Root>
//   );
// }
