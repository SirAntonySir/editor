import { LlmToolRegistry } from './llm-tool-registry';
import { getImageContextTool } from './tools/get-image-context';
import { listNamedRegionsTool } from './tools/list-named-regions';
import { getActiveSelectionTool } from './tools/get-active-selection';
import { selectNamedRegionTool } from './tools/select-named-region';
import { clearSelectionTool } from './tools/clear-selection';
import { applyAdjustmentTool } from './tools/apply-adjustment';
import { proposeStackTool } from './tools/propose-stack';
import { listLayersTool } from './tools/list-layers';
import { highlightRegionTool } from './tools/highlight-region';
import { addNoteTool } from './tools/add-note';

export { LlmToolRegistry } from './llm-tool-registry';
export type { ToolManifest, ToolKind } from './types';
export { serializeManifest, serializeAllManifests, type AnthropicToolDescription } from './serialize';
export { zodToJsonSchema, type JsonSchema } from './zod-to-json-schema';

/**
 * Register all initial tool manifests. Call once at app startup (alongside
 * `registerAllProcessing` etc.).
 */
export function registerAllToolManifests(): void {
  // Query (4)
  LlmToolRegistry.register(getImageContextTool);
  LlmToolRegistry.register(listNamedRegionsTool);
  LlmToolRegistry.register(getActiveSelectionTool);
  LlmToolRegistry.register(listLayersTool);
  // Selection (2)
  LlmToolRegistry.register(selectNamedRegionTool);
  LlmToolRegistry.register(clearSelectionTool);
  // Action (2)
  LlmToolRegistry.register(applyAdjustmentTool);
  LlmToolRegistry.register(proposeStackTool);
  // Annotation (2)
  LlmToolRegistry.register(highlightRegionTool);
  LlmToolRegistry.register(addNoteTool);
}
