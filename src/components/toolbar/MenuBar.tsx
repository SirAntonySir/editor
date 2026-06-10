import * as Menubar from '@radix-ui/react-menubar';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useSyncExternalStore } from 'react';
import { Undo2, Redo2, RotateCcw } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { useEditorStore } from '@/store';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { revertToOriginal } from '@/lib/revert';
import { editorDocument } from '@/core/document';
import { useFileIO } from '@/hooks/useFileIO';
import { BackendStatusBadge } from '@/components/ui/BackendStatusBadge';
import { useAiSession, analyseFirstImageLayer } from '@/hooks/useImageContext';
import { useCanvasZoom } from '@/hooks/useCanvasZoom';
import { useImageTransform } from '@/hooks/useImageTransform';
import { spawnRegistryOp } from '@/lib/toolrail-spawn';
import { loadRegistry } from '@/lib/registry/loader';
import { useLiveMechanicalContext } from '@/hooks/useLiveMechanicalContext';
import { autoLight, autoColor, autoTone, autoContrast } from '@/lib/auto-tune';
import type { HistoryStoreState } from '@/core/history';
// EditorMode type only used by disabled ModeBtn — kept for future reference.
// import type { EditorMode } from '@/store/tool-slice';

/* ------------------------------------------------------------------ */
/*  Shared primitives                                                 */
/* ------------------------------------------------------------------ */

const menuContentClass =
  'z-50 min-w-[190px] rounded-[var(--radius-panel)] bg-surface border border-border-strong shadow-overlay p-[3px] text-[11px] text-text-primary';

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
  const { handleOpen, handleClose, handleExport } = useFileIO();
  const { transformImage } = useImageTransform();
  const { applyZoom, fitOnScreen, zoomIn, zoomOut } = useCanvasZoom();

  return (
    <>
      <div className="flex items-center w-full">
        <Menubar.Root className="flex items-center gap-0 text-sm text-text-primary">
          <FileMenu onOpen={handleOpen} onExport={handleExport} onClose={handleClose} />
          <EditMenu />
          <ImageMenu transformImage={transformImage} />
          <LayerMenu />
          <ViewMenu applyZoom={applyZoom} fitOnScreen={fitOnScreen} zoomIn={zoomIn} zoomOut={zoomOut} />
          {/* Filters used to live in their own top-level menu; they're now
              part of Image → Adjustments via the SSoT registry. */}
          <AiMenu />
          <HelpMenu />
        </Menubar.Root>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Backend connection status */}
        <BackendStatusBadge />
        <div className="w-px h-3 bg-separator mx-1.5" />

        {/* Undo / Redo */}
        <UndoRedoButtons />

        {/* Mode switcher disabled — only Develop remained, made redundant. */}
        {/* <ModeSwitcherButtons /> */}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  File                                                              */
/* ------------------------------------------------------------------ */

function FileMenu({
  onOpen,
  onExport,
  onClose,
}: {
  onOpen: () => void;
  onExport: (format: 'png' | 'jpeg' | 'webp') => void;
  onClose: () => void;
}) {
  const hasLayers = useEditorStore((s) => s.layers.length > 0);
  return (
    <Menubar.Menu>
      <TriggerButton>File</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Item keys={['mod', 'O']} onSelect={onOpen}>
            Open...
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
          <Item keys={['mod', ',']} onSelect={() => window.dispatchEvent(new CustomEvent('spawn-palette:open'))}>
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

function AiMenu() {
  const status = useAiSession((s) => s.status);
  const hasContext = useAiSession((s) => s.context != null);
  const hasLayers = useEditorStore((s) => s.layers.length > 0);
  const analysing = status === 'uploading' || status === 'analysing';

  const handleReanalyse = () => {
    void analyseFirstImageLayer();
  };

  return (
    <Menubar.Menu>
      <TriggerButton>AI</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Item
            onSelect={handleReanalyse}
            disabled={!hasLayers || analysing}
            keys={['mod', 'alt', 'A']}
          >
            {hasContext ? 'Re-analyze image' : 'Analyze image'}
          </Item>
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
            <Tooltip.Content className="overlay px-1.5 py-0.5 text-[10px] text-text-primary z-[60]" sideOffset={6}>
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
            <Tooltip.Content className="overlay px-1.5 py-0.5 text-[10px] text-text-primary z-[60]" sideOffset={6}>
              Redo <Kbd keys={['mod', 'shift', 'Z']} className="inline-flex ml-1" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button disabled={!hasLayers} onClick={revertToOriginal} className={btnClass}>
              <RotateCcw size={12} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="overlay px-1.5 py-0.5 text-[10px] text-text-primary z-[60]" sideOffset={6}>
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
