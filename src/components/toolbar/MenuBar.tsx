import { useCallback, useRef } from 'react';
import * as Menubar from '@radix-ui/react-menubar';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Point } from 'fabric';
import type * as fabric from 'fabric';
import { useStore } from 'zustand';
import { Undo2, Redo2, SlidersHorizontal, Layers, RotateCcw } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { useEditorStore } from '@/store';
import { loadImageToCanvas } from '@/components/canvas/EditorCanvas';
import { exportImage, saveAs } from '@/lib/export';
import { ToolRegistry } from '@/lib/tool-registry';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { revertToOriginal } from '@/lib/revert';
import type { EditorMode } from '@/store/tool-slice';

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

/* ------------------------------------------------------------------ */
/*  Menu Bar                                                          */
/* ------------------------------------------------------------------ */

export function MenuBar({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        await loadImageToCanvas(file, canvasRef.current);
      }
      // reset so same file can be re-selected
      e.target.value = '';
    },
    [canvasRef],
  );

  const handleExport = useCallback(
    async (format: 'png' | 'jpeg' | 'webp') => {
      const blob = await exportImage({ format, quality: format === 'jpeg' ? 0.92 : 1 });
      if (blob) {
        await saveAs(blob, `export.${format === 'jpeg' ? 'jpg' : format}`);
      }
    },
    [],
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex items-center w-full">
        <Menubar.Root className="flex items-center gap-0 text-sm text-text-primary">
          <FileMenu onOpen={handleOpen} onExport={handleExport} />
          <EditMenu />
          <ImageMenu canvasRef={canvasRef} />
          <LayerMenu />
          <ViewMenu canvasRef={canvasRef} />
          <FilterMenu />
          <HelpMenu />
        </Menubar.Root>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo / Redo */}
        <UndoRedoButtons />

        {/* Separator */}
        <div className="w-px h-3 bg-separator mx-1.5" />

        {/* Mode switcher */}
        <ModeSwitcherButtons />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  File                                                              */
/* ------------------------------------------------------------------ */

function TriggerButton({ children }: { children: React.ReactNode }) {
  return (
    <Menubar.Trigger className="flex items-center px-1.5 py-px rounded-[3px] text-[11px] leading-tight font-medium text-text-secondary data-[state=open]:bg-surface-secondary data-[state=open]:text-text-primary hover:text-text-primary transition-colors cursor-default select-none outline-none">
      {children}
    </Menubar.Trigger>
  );
}

function FileMenu({
  onOpen,
  onExport,
}: {
  onOpen: () => void;
  onExport: (format: 'png' | 'jpeg' | 'webp') => void;
}) {
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
          <Item keys={['mod', 'shift', 'S']} disabled>
            Save As...
          </Item>
          <Sep />
          <Item disabled>Close</Item>
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  Edit                                                              */
/* ------------------------------------------------------------------ */

function EditMenu() {
  const undo = useCallback(() => useEditorStore.temporal.getState().undo(), []);
  const redo = useCallback(() => useEditorStore.temporal.getState().redo(), []);
  const hasLayers = useEditorStore((s) => s.layers.length > 0);

  return (
    <Menubar.Menu>
      <TriggerButton>Edit</TriggerButton>
      <Menubar.Portal>
        <Menubar.Content className={menuContentClass} align="start" sideOffset={4}>
          <Item keys={['mod', 'Z']} onSelect={undo}>
            Undo
          </Item>
          <Item keys={['mod', 'shift', 'Z']} onSelect={redo}>
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
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

/* ------------------------------------------------------------------ */
/*  Image                                                             */
/* ------------------------------------------------------------------ */

function ImageMenu({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
  const layers = useEditorStore((s) => s.layers);
  const hasLayers = layers.length > 0;

  const transformImage = useCallback(
    (mode: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => {
      const { activeLayerId } = useEditorStore.getState();
      if (!activeLayerId) return;
      const source = CanvasRegistry.get(activeLayerId);
      if (!source) return;

      const srcW = source.width;
      const srcH = source.height;
      const isRotate = mode === 'rotateCW' || mode === 'rotateCCW';
      const dstW = isRotate ? srcH : srcW;
      const dstH = isRotate ? srcW : srcH;

      const dst = new OffscreenCanvas(dstW, dstH);
      const ctx = dst.getContext('2d')!;
      ctx.save();
      ctx.translate(dstW / 2, dstH / 2);

      if (mode === 'rotateCW') ctx.rotate(Math.PI / 2);
      else if (mode === 'rotateCCW') ctx.rotate(-Math.PI / 2);
      else if (mode === 'flipH') ctx.scale(-1, 1);
      else if (mode === 'flipV') ctx.scale(1, -1);

      ctx.drawImage(source, -srcW / 2, -srcH / 2);
      ctx.restore();

      CanvasRegistry.replaceSource(activeLayerId, dst);

      // Update Fabric image
      const canvas = canvasRef.current;
      if (!canvas) return;
      const fabricImg = canvas.getObjects()[0] as import('fabric').FabricImage | undefined;
      if (!fabricImg) return;

      const tmp = document.createElement('canvas');
      tmp.width = dstW;
      tmp.height = dstH;
      tmp.getContext('2d')!.drawImage(dst, 0, 0);

      fabricImg.setElement(tmp);
      const canvasW = canvas.getWidth();
      const canvasH = canvas.getHeight();
      const scale = Math.min(canvasW / dstW, canvasH / dstH) * 0.9;
      fabricImg.set({
        scaleX: scale,
        scaleY: scale,
        left: canvasW / 2,
        top: canvasH / 2,
      });
      fabricImg.setCoords();
      canvas.requestRenderAll();
    },
    [canvasRef],
  );

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
  const layers = useEditorStore((s) => s.layers);
  const hasLayers = layers.length > 0;

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

function ViewMenu({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
  const editorMode = useEditorStore((s) => s.editorMode);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);

  const applyZoom = useCallback(
    (newZoom: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const clamped = Math.max(0.1, Math.min(32, newZoom));
      const center = new Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
      canvas.zoomToPoint(center, clamped);
      useEditorStore.getState().setZoom(clamped);
      canvas.requestRenderAll();
    },
    [canvasRef],
  );

  const fitOnScreen = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obj = canvas.getObjects()[0];
    if (!obj) return;

    // Reset viewport first
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const canvasW = canvas.getWidth();
    const canvasH = canvas.getHeight();
    const objW = obj.width * (obj.scaleX ?? 1);
    const objH = obj.height * (obj.scaleY ?? 1);
    const zoom = Math.min(canvasW / objW, canvasH / objH) * 0.9;

    // Zoom to center
    const center = new Point(canvasW / 2, canvasH / 2);
    canvas.zoomToPoint(center, zoom);

    // Pan so object center is at canvas center
    const objCenter = obj.getCenterPoint();
    const vpt = canvas.viewportTransform;
    if (vpt) {
      vpt[4] = canvasW / 2 - objCenter.x * zoom;
      vpt[5] = canvasH / 2 - objCenter.y * zoom;
    }

    useEditorStore.getState().setZoom(zoom);
    useEditorStore.getState().setFitMode('fit');
    useEditorStore.getState().setPan(vpt?.[4] ?? 0, vpt?.[5] ?? 0);
    canvas.requestRenderAll();
  }, [canvasRef]);

  const zoomIn = useCallback(() => {
    const currentZoom = canvasRef.current?.getZoom() ?? 1;
    applyZoom(currentZoom * 1.25);
  }, [canvasRef, applyZoom]);

  const zoomOut = useCallback(() => {
    const currentZoom = canvasRef.current?.getZoom() ?? 1;
    applyZoom(currentZoom / 1.25);
  }, [canvasRef, applyZoom]);

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

function useTemporalStore<T>(selector: (state: { pastStates: unknown[]; futureStates: unknown[]; undo: (steps?: number) => void; redo: (steps?: number) => void }) => T): T {
  return useStore(useEditorStore.temporal, selector);
}

function UndoRedoButtons() {
  const canUndo = useTemporalStore((s) => s.pastStates.length > 0);
  const canRedo = useTemporalStore((s) => s.futureStates.length > 0);
  const undo = useTemporalStore((s) => s.undo);
  const redo = useTemporalStore((s) => s.redo);
  const hasLayers = useEditorStore((s) => s.layers.length > 0);

  const btnClass =
    'flex items-center justify-center w-5 h-5 rounded-[3px] transition-colors text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary cursor-default';

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-px">
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button disabled={!canUndo} onClick={() => undo()} className={btnClass}>
              <Undo2 size={12} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-50" sideOffset={6}>
              Undo <Kbd keys={['mod', 'Z']} className="inline-flex ml-1" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button disabled={!canRedo} onClick={() => redo()} className={btnClass}>
              <Redo2 size={12} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-50" sideOffset={6}>
              Redo <Kbd keys={['mod', 'shift', 'Z']} className="inline-flex ml-1" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <div className="w-px h-3 bg-separator mx-0.5" />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button disabled={!hasLayers} onClick={revertToOriginal} className={btnClass}>
              <RotateCcw size={12} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-50" sideOffset={6}>
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

function ModeSwitcherButtons() {
  const editorMode = useEditorStore((s) => s.editorMode);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex items-center gap-px">
        <ModeBtn mode="develop" label="Develop" icon={<SlidersHorizontal size={11} />} isActive={editorMode === 'develop'} onClick={() => setEditorMode('develop')} />
        <ModeBtn mode="compose" label="Compose" icon={<Layers size={11} />} isActive={editorMode === 'compose'} onClick={() => setEditorMode('compose')} />
      </div>
    </Tooltip.Provider>
  );
}

function ModeBtn({ label, icon, isActive, onClick }: {
  mode: EditorMode;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          className={`flex items-center gap-1 px-1.5 py-px rounded-[3px] text-[11px] leading-tight font-medium transition-colors cursor-default
            ${isActive ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
          onClick={onClick}
        >
          {icon}
          {label}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="glass-panel px-1.5 py-0.5 text-[10px] text-text-primary z-50" sideOffset={6}>
          {label} <Kbd keys={['tab']} className="inline-flex ml-1" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
