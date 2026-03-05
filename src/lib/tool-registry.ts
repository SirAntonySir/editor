import type { ToolDefinition } from '@/types/tool';

class ToolRegistryImpl {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return this.getAll().filter((t) => t.category === category);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export const ToolRegistry = new ToolRegistryImpl();
