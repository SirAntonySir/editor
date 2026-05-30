import type { ComponentType } from 'react';
import type { EditorState } from '@/store';
import type { EditorMode } from '@/store/tool-slice';

export type { EditorState, EditorMode };

export interface CanvasPointerEvent {
  x: number;
  y: number;
  rawEvent: PointerEvent;
}

export interface ToolContext {
  getState: () => EditorState;
  setState: (partial: Partial<EditorState> | ((state: EditorState) => void)) => void;
  dispatchCommand: (toolName: string, commandName: string, payload?: unknown) => void;
}

export interface ToolOptionsPanelProps<TConfig = unknown> {
  config: TConfig;
  onConfigChange: (config: Partial<TConfig>) => void;
  ctx: ToolContext;
}

export interface CanvasOverlayProps {
  ctx: ToolContext;
}

export interface ToolModalProps {
  ctx: ToolContext;
  onClose: () => void;
}

export interface EditorCommand<TState = EditorState> {
  execute: (state: TState, payload?: unknown) => { newState: Partial<TState>; undoData?: unknown };
  undo: (state: TState, undoData: unknown) => Partial<TState>;
}

export interface ToolDefinition<TConfig = unknown> {
  name: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  category: 'select' | 'draw' | 'adjust' | 'filter' | 'ai' | 'transform';
  /** Which editor modes this tool is available in. Defaults to both. */
  modes?: EditorMode[];
  shortcut?: string;
  cursor?: string;
  defaultConfig?: TConfig;
  /** Link to a ProcessingDefinition ID. When set, the processing's Panel is used for the inspector. */
  processingId?: string;
  /** When true, the tool is hidden from the toolbar and shortcuts are inert until an AI image context is bound. */
  requiresAiContext?: boolean;

  OptionsPanel?: ComponentType<ToolOptionsPanelProps<TConfig>>;
  CanvasOverlay?: ComponentType<CanvasOverlayProps>;
  Modal?: ComponentType<ToolModalProps>;
  ToolbarExtras?: ComponentType;

  onActivate?: (ctx: ToolContext) => void | (() => void);
  onDeactivate?: (ctx: ToolContext) => void;

  onPointerDown?: (e: CanvasPointerEvent, ctx: ToolContext) => void;
  onPointerMove?: (e: CanvasPointerEvent, ctx: ToolContext) => void;
  onPointerUp?: (e: CanvasPointerEvent, ctx: ToolContext) => void;

  commands?: Record<string, EditorCommand>;
}
