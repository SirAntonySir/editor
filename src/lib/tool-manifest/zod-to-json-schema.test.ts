// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './zod-to-json-schema';
import { serializeAllManifests } from './serialize';
import { registerAllToolManifests, LlmToolRegistry } from './index';

describe('zodToJsonSchema', () => {
  it('handles primitives', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' });
    expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' });
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
  });

  it('handles object with required and optional fields', () => {
    const s = z.object({
      a: z.string(),
      b: z.number().optional(),
      c: z.boolean().default(true),
    });
    const out = zodToJsonSchema(s);
    expect(out.type).toBe('object');
    expect(out.required).toEqual(['a']);
    expect((out.properties as Record<string, unknown>).b).toEqual({ type: 'number' });
    expect((out.properties as Record<string, { default?: unknown }>).c.default).toBe(true);
  });

  it('handles literal and enum', () => {
    expect(zodToJsonSchema(z.literal('foo'))).toEqual({ const: 'foo' });
    expect(zodToJsonSchema(z.enum(['a', 'b']))).toEqual({ type: 'string', enum: ['a', 'b'] });
  });

  it('handles discriminated union', () => {
    const s = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('global') }),
      z.object({ kind: z.literal('named_region'), label: z.string() }),
    ]);
    const out = zodToJsonSchema(s);
    expect(out.oneOf).toHaveLength(2);
  });

  it('handles array and record', () => {
    expect(zodToJsonSchema(z.array(z.string()))).toEqual({ type: 'array', items: { type: 'string' } });
    expect(zodToJsonSchema(z.record(z.number()))).toEqual({ type: 'object', additionalProperties: { type: 'number' } });
  });

  it('carries description through', () => {
    const out = zodToJsonSchema(z.string().describe('a name'));
    expect(out.description).toBe('a name');
  });
});

describe('serializeAllManifests', () => {
  it('produces an Anthropic-shaped tool block for every registered manifest', () => {
    LlmToolRegistry.clear();
    registerAllToolManifests();
    const tools = serializeAllManifests();
    expect(tools.length).toBe(13);
    for (const t of tools) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.input_schema.type).toBe('object');
    }
    expect(tools.map((t) => t.name)).toContain('apply_adjustment');
    expect(tools.map((t) => t.name)).toContain('select_named_region');
    expect(tools.map((t) => t.name)).toContain('propose_stack');
  });
});
