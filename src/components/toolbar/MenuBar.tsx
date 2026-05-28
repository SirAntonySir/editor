import * as Menubar from '@radix-ui/react-menubar';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useSyncExternalStore } from 'react';
import { Undo2, Redo2, RotateCcw } from 'lucide-react';
import { useGraphStore } from '@/store/graph-store';
import { Kbd } from '@/components/ui/kbd';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { ToolRegistry } from '@/lib/tool-registry';
import { revertToOriginal } from '@/lib/revert';
import { editorDocument } from '@/core/document';
import { useFileIO } from '@/hooks/useFileIO';
import { useAiSession, analyseFirstImageLayer } from '@/hooks/useImageContext';
import { useCanvasZoom } from '@/hooks/useCanvasZoom';
import { useImageTransform } from '@/hooks/useImageTransform';
import type { HistoryStoreState } from '@/core/history';
// EditorMode type only used by disabled ModeBtn — kept for future reference.
// import type { EditorMode } from '@/store/tool-slice';
import type * as fabric from 'fabric';

/* ------------------------------------------------------------------ */
/*  Shared primitives                                                 */
/* ------------------------------------------------------------------ */

const menuContentClass =
  'z-50 min-w-[190px] rounded-[6px] bg-glass-bg/95 backdrop-blur-xl border border-glass-border shadow-panel p-[3px] text-[11px] text-text-primary';

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

function CheckItem({
  children,
  checked,
  onCheckedChange,
  keys,
}: {
  children: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  keys?: string | string[];
}) {
  return (
    <Menubar.CheckboxItem
      className={menuItemClass}
      checked={checked}
      onCheckedChange={onCheckedChange}
    >
      <span className="flex items-center gap-2 flex-1">
        <Menubar.ItemIndicator className="inline-flex w-4 justify-center">
          <span className="text-xs">&#10003;</span>
        </Menubar.ItemIndicator>
        <span>{children}</span>
      </span>
      {keys && <Kbd keys={keys} />}
    </Menubar.CheckboxItem>
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

export function MenuBar({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
  const { fileInputRef, handleOpen, handleFileChange, handleSaveAs, handleClose, handleExport } = useFileIO(canvasRef);
  const { transformImage } = useImageTransform(canvasRef);
  const { applyZoom, fitOnScreen, zoomIn, zoomOut } = useCanvasZoom(canvasRef);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.edp,application/octet-stream"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex items-center w-full">
        <Menubar.Root className="flex items-center gap-0 text-sm text-text-primary">
          <FileMenu onOpen={handleOpen} onExport={handleExport} onSaveAs={handleSaveAs} onClose={handleClose} />
          <EditMenu />
          <ImageMenu transformImage={transformImage} />
          <LayerMenu />
          <ViewMenu applyZoom={applyZoom} fitOnScreen={fitOnScreen} zoomIn={zoomIn} zoomOut={zoomOut} />
          <FilterMenu />
          <AiMenu />
          <HelpMenu />
        </Menubar.Root>

        {/* Spacer */}
        <div className="flex-1" />

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
  onSaveAs,
  onClose,
}: {
  onOpen: () => void;
  onExport: (format: 'png' | 'jpeg' | 'webp') => void;
  onSaveAs: () => void;
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
          <Item keys={['mod', 'shift', 'S']} disabled={!hasLayers} onSelect={onSaveAs}>
            Save As...
          </Item>
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
          <Item keys={['mod', 'shift', 'R']} disabled={!hasLayers} onSelect={revertToOriginal}>
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
          <Item keys={['mod', ',']} onSelect={() => usePreferencesStore.getState().setShowPreferences(true)}>
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
          <Sub label="Auto">
            <Item disabled>Auto Tone</Item>
            <Item disabled>Auto Contrast</Item>
            <Item disabled>Auto Color</Item>
          </Sub>
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

function AdjustmentItems() {
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const adjustTools = ToolRegistry.getAll().filter((t) => t.category === 'adjust');

  return (
    <>
      {adjustTools.map((tool) => (
        <Item key={tool.name} keys={tool.shortcut ? [tool.shortcut] : undefined} onSelect={() => setActiveTool(tool.name)}>
          {tool.label}
        </Item>
      ))}
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
  // Mode switcher disabled — editorMode/setEditorMode no longer needed here.
  // const editorMode = useEditorStore((s) => s.editorMode);
  // const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const showHistoryPanel = useEditorStore((s) => s.showHistoryPanel);
  const toggleHistoryPanel = useEditorStore((s) => s.toggleHistoryPanel);
  const showGraphPreview = useGraphStore((s) => s.showGraphPreview);
  const toggleGraphPreview = useGraphStore((s) => s.toggleGraphPreview);

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
          <Sep />
          <CheckItem
            checked={showHistoryPanel}
            onCheckedChange={() => toggleHistoryPanel()}
          >
            History
          </CheckItem>
          <CheckItem
            checked={showGraphPreview}
            onCheckedChange={() => toggleGraphPreview()}
            keys={['P']}
          >
            Preview
          </CheckItem>
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
/*  Filter                                                            */
/* ------------------------------------------------------------------ */

function FilterMenu() {
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const filterTools = ToolRegistry.getAll().filter((t) => t.category === 'filter');

  return (
    <Menubar.Menu>
      <TriggerButton>Filter</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          {filterTools.length > 0 ? (
            filterTools.map((tool) => (
              <Item
                key={tool.name}
                keys={tool.shortcut ? [tool.shortcut] : undefined}
                onSelect={() => setActiveTool(tool.name)}
              >
                {tool.label}
              </Item>
            ))
          ) : (
            <Item disabled>No filters available</Item>
          )}
          <Sep />
          <Sub label="Blur">
            <Item disabled>Gaussian Blur...</Item>
            <Item disabled>Motion Blur...</Item>
            <Item disabled>Lens Blur...</Item>
          </Sub>
          <Sub label="Sharpen">
            <Item disabled>Sharpen</Item>
            <Item disabled>Unsharp Mask...</Item>
          </Sub>
          <Sub label="Noise">
            <Item disabled>Add Noise...</Item>
            <Item disabled>Reduce Noise...</Item>
          </Sub>
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
  const tools = ToolRegistry.getAll();

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
            <Tooltip.Content className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-[60]" sideOffset={6}>
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
            <Tooltip.Content className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-[60]" sideOffset={6}>
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
            <Tooltip.Content className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-[60]" sideOffset={6}>
              Revert to Original <Kbd keys={['mod', 'shift', 'R']} className="inline-flex ml-1" />
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
//         <Tooltip.Content className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-[60]" sideOffset={6}>
//           {label} <Kbd keys={['tab']} className="inline-flex ml-1" />
//         </Tooltip.Content>
//       </Tooltip.Portal>
//     </Tooltip.Root>
//   );
// }
