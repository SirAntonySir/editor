import { ToolManifestRegistry } from './registry';
import { getImageContextTool } from './tools/get-image-context';
import { listNamedRegionsTool } from './tools/list-named-regions';
import { getActiveSelectionTool } from './tools/get-active-selection';
import { selectNamedRegionTool } from './tools/select-named-region';
import { clearSelectionTool } from './tools/clear-selection';
import { applyAdjustmentTool } from './tools/apply-adjustment';
import { proposePanelTool } from './tools/propose-panel';
import { listLayersTool } from './tools/list-layers';
import { highlightRegionTool } from './tools/highlight-region';
import { addNoteTool } from './tools/add-note';

export { ToolManifestRegistry } from './registry';
export type { ToolManifest, ToolKind } from './types';
export { serializeManifest, serializeAllManifests, type AnthropicToolDescription } from './serialize';
export { zodToJsonSchema, type JsonSchema } from './zod-to-json-schema';

/**
 * Register all initial tool manifests. Call once at app startup (alongside
 * `registerAllProcessing` etc.).
 */
export function registerAllToolManifests(): void {
  // Query (4)
  ToolManifestRegistry.register(getImageContextTool);
  ToolManifestRegistry.register(listNamedRegionsTool);
  ToolManifestRegistry.register(getActiveSelectionTool);
  ToolManifestRegistry.register(listLayersTool);
  // Selection (2)
  ToolManifestRegistry.register(selectNamedRegionTool);
  ToolManifestRegistry.register(clearSelectionTool);
  // Action (2)
  ToolManifestRegistry.register(applyAdjustmentTool);
  ToolManifestRegistry.register(proposePanelTool);
  // Annotation (2)
  ToolManifestRegistry.register(highlightRegionTool);
  ToolManifestRegistry.register(addNoteTool);
}
