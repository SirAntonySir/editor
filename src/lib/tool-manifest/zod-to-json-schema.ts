import { z } from 'zod';

/**
 * Minimal Zod → JSON Schema (draft-07-ish) converter. Covers only the
 * shapes used by our tool manifests: object, string, number, boolean,
 * literal, enum, union/discriminatedUnion, array, record, optional,
 * default, and description.
 *
 * Not a general-purpose converter — if a manifest schema starts using a
 * shape this function doesn't handle, extend below rather than swapping in
 * a full library (we want this surface deliberately small to stay
 * predictable).
 */
export type JsonSchema = Record<string, unknown>;

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const desc = schema.description;
  const result = convert(schema);
  if (desc && result.description === undefined) result.description = desc;
  return result;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  // Unwrap modifier wrappers (optional, default, nullable) — handled at
  // the parent (object) level where needed.
  if (schema instanceof z.ZodOptional) return convert(schema.unwrap());
  if (schema instanceof z.ZodDefault) return convert(schema.removeDefault());
  if (schema instanceof z.ZodNullable) {
    const inner = convert(schema.unwrap());
    return { ...inner, type: arrayifyType(inner.type, 'null') };
  }
  if (schema instanceof z.ZodEffects) return convert(schema.innerType());

  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };

  if (schema instanceof z.ZodLiteral) {
    const v = (schema as z.ZodLiteral<unknown>).value;
    return { const: v };
  }
  if (schema instanceof z.ZodEnum) {
    const values = (schema as z.ZodEnum<[string, ...string[]]>).options;
    return { type: 'string', enum: values };
  }

  if (schema instanceof z.ZodArray) {
    const inner = (schema as z.ZodArray<z.ZodTypeAny>).element;
    return { type: 'array', items: zodToJsonSchema(inner) };
  }

  if (schema instanceof z.ZodRecord) {
    const inner = (schema as z.ZodRecord<z.ZodTypeAny>).valueSchema;
    return { type: 'object', additionalProperties: zodToJsonSchema(inner) };
  }

  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    const options = (schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options;
    return { oneOf: options.map((o) => zodToJsonSchema(o)) };
  }

  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, field] of Object.entries(shape)) {
      const f = field as z.ZodTypeAny;
      properties[key] = zodToJsonSchema(f);
      // Default values make a field non-required but populate `default`.
      if (f instanceof z.ZodDefault) {
        const defaultValue = (f as z.ZodDefault<z.ZodTypeAny>)._def.defaultValue();
        properties[key].default = defaultValue;
        continue;
      }
      if (!(f instanceof z.ZodOptional)) required.push(key);
    }
    const obj: JsonSchema = { type: 'object', properties };
    if (required.length > 0) obj.required = required;
    return obj;
  }

  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
    return {};
  }

  throw new Error(`zodToJsonSchema: unsupported schema kind ${schema.constructor.name}`);
}

function arrayifyType(existing: unknown, extra: string): unknown {
  if (existing === undefined) return extra;
  if (Array.isArray(existing)) return [...existing, extra];
  return [existing, extra];
}
