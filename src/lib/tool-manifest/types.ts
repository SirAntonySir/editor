import type { z } from 'zod';

/**
 * Categorisation of what kind of effect a tool has. Lets the future agent
 * loop reason about ordering (queries first, side effects later) and lets
 * the UI present tools with appropriate semantics.
 *
 * - `query`   — read-only; returns information about the document or
 *                editor state. Safe to call freely.
 * - `mutate`  — changes editor state (applies an adjustment, arms a mask,
 *                modifies a layer).
 * - `emit`    — produces structured output for the UI (a dynamic panel, a
 *                suggestion, an annotation). Does not directly mutate the
 *                document.
 */
export type ToolKind = 'query' | 'mutate' | 'emit';

/**
 * A single MCP-style tool exposed to the LLM. Manifests are language- and
 * transport-agnostic by design: they describe the *capability* the LLM has,
 * not how it's invoked.
 *
 * The handler is the canonical runtime: parsed input in, output out. The
 * LLM never sees the handler — it only sees `name`, `description`, and the
 * input/output schemas serialised to JSON Schema by the prompt generator.
 */
export interface ToolManifest<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Stable identifier used in the LLM's tool_use blocks. snake_case. */
  name: string;

  /** Human/LLM-facing one-liner describing what calling this tool does. */
  description: string;

  /** Optional long-form guidance shown to the LLM for nuanced usage. */
  usage?: string;

  /** What kind of effect this tool has. Drives agent-loop scheduling. */
  kind: ToolKind;

  /** Zod schema for the tool's input arguments. */
  inputSchema: TInput;

  /** Zod schema for the tool's return value. */
  outputSchema: TOutput;

  /**
   * Execute the tool. Input is pre-parsed against `inputSchema` by the
   * registry. The handler should throw on irrecoverable errors.
   */
  handler: (input: z.infer<TInput>) => Promise<z.infer<TOutput>> | z.infer<TOutput>;
}
