import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import { LlmToolRegistry } from './llm-tool-registry';
import { serializeForAgentLoop } from './serialize';

beforeEach(() => {
  LlmToolRegistry.clear();
  for (const name of ['list_objects', 'copy_object_to_image_node', 'add_note']) {
    LlmToolRegistry.register({
      name,
      description: `desc ${name}`,
      kind: name === 'list_objects' ? 'query' : 'mutate',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: () => ({}),
    });
  }
});

describe('serializeForAgentLoop', () => {
  it('includes only allowed tools, in allowed order', () => {
    const out = serializeForAgentLoop(['copy_object_to_image_node', 'list_objects']);
    expect(out.map((t) => t.name)).toEqual(['copy_object_to_image_node', 'list_objects']);
    // 'add_note' registered but not allowed → excluded.
  });

  it('skips allowed names that are not registered', () => {
    const out = serializeForAgentLoop(['list_objects', 'nope']);
    expect(out.map((t) => t.name)).toEqual(['list_objects']);
  });
});
