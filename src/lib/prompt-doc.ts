/**
 * PromptDoc — the source-of-truth model for the command-palette prompt.
 *
 * The prompt is an ordered list of segments rather than a flat string, so a
 * region reference can live *inline* as an atomic chip at the exact spot the
 * user typed it (Cursor-style). `PromptEditor` renders this model into a
 * `contenteditable` and parses the DOM back into it on every edit.
 *
 * Chips reuse the palette's existing `sourceId` convention:
 *   "region:object:<maskId>"  — a committed segmentation object
 *   "region:ai:<label>"       — an AI-proposed candidate region
 */
export type PromptSegment =
  | { kind: 'text'; text: string }
  | { kind: 'chip'; label: string; sourceId: string };

export type PromptDoc = PromptSegment[];

/** Render a doc to plain prompt text, with each chip rendered as its label
 *  inline. This is what the LLM sees — the region word sits in place, e.g.
 *  "separate the shoes and brighten them". */
export function docToPlainText(doc: PromptDoc): string {
  return doc.map((s) => (s.kind === 'text' ? s.text : s.label)).join('');
}

/** The contiguous word-token immediately left of the caret. Word chars are
 *  letters, digits and hyphens; a space (or any other char) ends the token.
 *  Returns '' when the char before the caret isn't a word char. */
export function wordBeforeCaret(textBeforeCaret: string): string {
  const m = /[A-Za-z0-9-]+$/.exec(textBeforeCaret);
  return m ? m[0] : '';
}

/** Detect an explicit `@` element-mention under the caret. Returns the
 *  trigger + the (possibly empty) query typed after it. A bare `@` opens the
 *  full element list; `@sk` filters it. When there's no `@`, falls back to the
 *  plain word token so plain typing keeps its region-only fuzzy behaviour.
 *
 *  The `@` must start a token (line start or after whitespace) so an email-ish
 *  "a@b" doesn't trigger the picker. */
export function triggerBeforeCaret(
  textBeforeCaret: string,
): { trigger: '@' | null; query: string } {
  const m = /(?:^|\s)@([A-Za-z0-9-]*)$/.exec(textBeforeCaret);
  if (m) return { trigger: '@', query: m[1] };
  return { trigger: null, query: wordBeforeCaret(textBeforeCaret) };
}

/** The exact text to delete when accepting a chip at the caret: an `@mention`
 *  token (including the `@`), or the plain in-progress word. Keeps the editor's
 *  strip-then-insert logic trigger-aware so "fix the @sk" → "fix the [chip]". */
export function caretTokenToReplace(textBeforeCaret: string): string {
  const m = /(?:^|\s)(@[A-Za-z0-9-]*)$/.exec(textBeforeCaret);
  if (m) return m[1];
  return wordBeforeCaret(textBeforeCaret);
}

/** A target reference parsed from a `target:node:<id>` / `target:layer:<id>`
 *  chip sourceId. Targets are image nodes or layers selected via the `@`
 *  picker; they drive `forced_targets` (not `attached_objects`). */
export type TargetRef = { kind: 'node' | 'layer'; id: string };

export function parseTargetSourceId(sourceId: string | undefined): TargetRef | null {
  const s = sourceId ?? '';
  if (s.startsWith('target:node:')) return { kind: 'node', id: s.slice('target:node:'.length) };
  if (s.startsWith('target:layer:')) return { kind: 'layer', id: s.slice('target:layer:'.length) };
  return null;
}

/** Pull an object/mask id out of a chip's `sourceId`. Region chips carry the
 *  identifier in the trailing segment; other chip kinds return null. */
function objectIdFromSourceId(sourceId: string | undefined): string | null {
  const src = sourceId ?? '';
  if (src.startsWith('region:object:')) return src.slice('region:object:'.length);
  if (src.startsWith('region:ai:')) return src.slice('region:ai:'.length);
  return null;
}

/** Pull object/mask ids out of a list of chip-shaped items, in order. Used by
 *  both the inline doc chips and the legacy tray chips. */
export function extractObjectIds(items: ReadonlyArray<{ sourceId?: string }>): string[] {
  const out: string[] = [];
  for (const item of items) {
    const id = objectIdFromSourceId(item.sourceId);
    if (id !== null) out.push(id);
  }
  return out;
}

/** Serialize a doc (plus any legacy tray chips) into the backend `agent_turn`
 *  arguments. `intent` is the trimmed inline text; `attachedObjects` is the
 *  deduped parsed-id list (doc chips first then tray chips, for the legacy
 *  fallback contract); `chipSourceIds` is the deduped raw `sourceId` list (same
 *  order) the agent turn needs to resolve + force-extract each region. */
export function serializePromptDoc(
  doc: PromptDoc,
  trayChips: ReadonlyArray<{ sourceId?: string }> = [],
): { intent: string; attachedObjects: string[]; chipSourceIds: string[] } {
  const intent = docToPlainText(doc).trim();
  const chipSources: Array<{ sourceId?: string }> = [
    ...doc.filter((s): s is Extract<PromptSegment, { kind: 'chip' }> => s.kind === 'chip'),
    ...trayChips,
  ];
  const seen = new Set<string>();
  const attachedObjects: string[] = [];
  for (const id of extractObjectIds(chipSources)) {
    if (seen.has(id)) continue;
    seen.add(id);
    attachedObjects.push(id);
  }
  const seenSrc = new Set<string>();
  const chipSourceIds: string[] = [];
  for (const s of chipSources) {
    if (!s.sourceId || seenSrc.has(s.sourceId)) continue;
    seenSrc.add(s.sourceId);
    chipSourceIds.push(s.sourceId);
  }
  return { intent, attachedObjects, chipSourceIds };
}
