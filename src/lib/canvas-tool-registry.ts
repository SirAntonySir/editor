import type { ToolDefinition, EditorMode } from '@/types/tool';

class CanvasToolRegistryImpl {
  private tools = new Map<string, ToolDefinition>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(tool: ToolDefinition<any>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Get tools available in the given editor mode. */
  getForMode(mode: EditorMode): ToolDefinition[] {
    return this.getAll().filter((t) => {
      if (!t.modes) return true; // available in all modes by default
      return t.modes.includes(mode);
    });
  }

  getByCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return this.getAll().filter((t) => t.category === category);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export const CanvasToolRegistry = new CanvasToolRegistryImpl();
