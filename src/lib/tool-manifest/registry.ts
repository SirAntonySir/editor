import type { z } from 'zod';
import type { ToolManifest, ToolKind } from './types';

/**
 * In-memory registry of tool manifests. Same pattern as `ToolRegistry` and
 * `ProcessingRegistry` — registered once at app startup, queried by name
 * at agent-loop time.
 *
 * Calling tools always goes through `invoke()` rather than the handler
 * directly so input validation is uniform: malformed LLM tool_use blocks
 * are rejected at the registry boundary instead of leaking into handlers.
 */
class ToolManifestRegistryImpl {
  private manifests = new Map<string, ToolManifest>();

  register<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
    manifest: ToolManifest<TIn, TOut>,
  ): void {
    if (this.manifests.has(manifest.name)) {
      throw new Error(`ToolManifestRegistry: duplicate registration for "${manifest.name}"`);
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

  /**
   * Validate the raw input against the manifest's input schema and run the
   * handler. Throws if the manifest is missing or if input fails validation.
   * Handler exceptions propagate.
   */
  async invoke(name: string, rawInput: unknown): Promise<unknown> {
    const manifest = this.manifests.get(name);
    if (!manifest) throw new Error(`ToolManifestRegistry: unknown tool "${name}"`);
    const parsed = manifest.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`ToolManifestRegistry: input validation failed for "${name}": ${parsed.error.message}`);
    }
    return manifest.handler(parsed.data);
  }

  clear(): void {
    this.manifests.clear();
  }
}

export const ToolManifestRegistry = new ToolManifestRegistryImpl();
