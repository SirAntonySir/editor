import { LlmToolRegistry } from './llm-tool-registry';
import { zodToJsonSchema } from './zod-to-json-schema';
import type { ToolManifest } from './types';

/**
 * Anthropic tool-use block shape. Matches the structure the Anthropic SDK
 * expects in `tools=[...]` calls.
 */
export interface AnthropicToolDescription {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Serialise a single manifest to the Anthropic tool description shape. The
 * usage hint, if present, is appended to the description so the LLM sees
 * it in the same blob it sees in tool listings.
 */
export function serializeManifest(manifest: ToolManifest): AnthropicToolDescription {
  const description = manifest.usage
    ? `${manifest.description}\n\nUsage: ${manifest.usage}`
    : manifest.description;
  return {
    name: manifest.name,
    description,
    input_schema: zodToJsonSchema(manifest.inputSchema),
  };
}

/**
 * Serialise every registered manifest. The order is stable across calls
 * (insertion order), which is the right behavior for prompt-caching —
 * Anthropic's cache breaks on any byte change to the tool block.
 */
export function serializeAllManifests(): AnthropicToolDescription[] {
  return LlmToolRegistry.getAll().map(serializeManifest);
}
