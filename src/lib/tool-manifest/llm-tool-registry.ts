import type { z } from 'zod';
import type { ToolManifest, ToolKind } from './types';

/**
 * In-memory registry of tool manifests. Same pattern as `CanvasToolRegistry` and
 * `ProcessingRegistry` — registered once at app startup, queried by name
 * at agent-loop time.
 *
 * Calling tools always goes through `invoke()` rather than the handler
 * directly so input validation is uniform: malformed LLM tool_use blocks
 * are rejected at the registry boundary instead of leaking into handlers.
 */
class LlmToolRegistryImpl {
  private manifests = new Map<string, ToolManifest>();

  register<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
    manifest: ToolManifest<TIn, TOut>,
  ): void {
    if (this.manifests.has(manifest.name)) {
      throw new Error(`LlmToolRegistry: duplicate registration for "${manifest.name}"`);
    }
    this.manifests.set(manifest.name, manifest as unknown as ToolManifest);
  }

  get(name: string): ToolManifest | undefined {
    return this.manifests.get(name);
  }

  getAll(): ToolManifest[] {
    return Array.from(this.manifests.values());
  }

  getByKind(kind: ToolKind): ToolManifest[] {
    return this.getAll().filter((m) => m.kind === kind);
  }

  /** The manifest's declared kind, or undefined if the tool is unknown. The
   *  SSE handler uses this as the AUTHORITATIVE kind (not the event payload)
   *  so approval gating can't be bypassed by a malformed request. */
  getKind(name: string): ToolKind | undefined {
    return this.manifests.get(name)?.kind;
  }

  /**
   * Validate the raw input against the manifest's input schema and run the
   * handler. Throws if the manifest is missing or if input fails validation.
   * Handler exceptions propagate.
   */
  async invoke(name: string, rawInput: unknown): Promise<unknown> {
    const manifest = this.manifests.get(name);
    if (!manifest) throw new Error(`LlmToolRegistry: unknown tool "${name}"`);
    const parsed = manifest.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`LlmToolRegistry: input validation failed for "${name}": ${parsed.error.message}`);
    }
    return manifest.handler(parsed.data);
  }

  clear(): void {
    this.manifests.clear();
  }
}

export const LlmToolRegistry = new LlmToolRegistryImpl();
