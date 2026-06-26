# Inline Region Chips in the Command Palette

**Date:** 2026-06-26
**Status:** Approved — ready for implementation
**Branch:** `feat/inline-region-chips`

## Problem

The command palette lets users attach image *regions* (segmentation masks / AI-proposed
regions) as context for an agent prompt. Today a selected region becomes a **chip in a
separate tray above the input** (`attachedContext`), and the region IDs ship to the
backend as a detached `attached_objects` array — disconnected from *where* in the prompt
the user meant them.

The user wants the Cursor-style experience: as you type, region suggestions surface with
fuzzy matching, and the selected region is inserted **inline, as a chip, at the caret
position inside the prompt text**. Example:

> separate the `[👟 shoes]` and apply lighting on them

## Decisions (from brainstorming)

1. **Trigger model: implicit.** No trigger character. As the user types any word, it is
   fuzzy-matched against region names and suggestions surface. (Noise is controlled by a
   threshold — see §3.)
2. **Acceptance: suggest, then Tab/Enter.** A caret-anchored dropdown shows ranked
   matches. The typed word stays plain prose unless the user presses `Tab`/`Enter` (or
   clicks) to convert it into a chip. Typing past it / hitting space leaves prose as prose.
3. **Coexistence: inline-primary, tray as fallback.** Keep the existing chip tray and the
   "Regions" section in the command list. Selecting a region from the list inserts it
   **inline at the caret** (or at the end if the editor isn't focused).
4. **Substrate: hand-rolled `contenteditable`.** No rich-text library. The `<input>` is
   replaced by a single-line `contenteditable` primitive that renders text + atomic chip
   spans. Floating UI (already in the stack) anchors the dropdown.

## 1. Architecture & Component Boundaries

The current `<input>` (`CommandPalette.tsx:615`) is replaced by:

- **`PromptEditor`** — new primitive in `src/components/ui/` (cross-domain, presentational).
  A single-line `contenteditable` div that owns DOM, caret, and chip rendering. It knows
  nothing about regions, fuzzy matching, or the backend.
  - Props:
    - `value: PromptDoc`
    - `onChange(doc: PromptDoc): void`
    - `onSubmit(): void`
    - `onCaretWordChange(word: string, caretRect: DOMRect | null): void`
    - `disabled?: boolean`
    - `placeholder?: string`
  - Imperative handle (`ref`):
    - `insertChipAtCaret(chip: { label: string; sourceId: string }): void`
    - `focus(): void`
- **`RegionSuggestions`** — new, topic-local to the palette
  (`src/components/` palette folder). The caret-anchored dropdown (Floating UI). Takes the
  current word + region list, runs the fuzzy scorer, renders ranked matches, reports
  acceptance up. Pure presentation + a pure ranking helper.
- **`CommandPalette.tsx`** — orchestrator. Holds the `PromptDoc`; wires
  `onCaretWordChange` → fuzzy ranking → `RegionSuggestions`; handles accept →
  `insertChipAtCaret`; on submit serializes the doc for the backend.

Rationale: `contenteditable` fiddliness is sealed inside `PromptEditor`; matching and
serialization are pure functions, testable in isolation.

## 2. Data Model — `PromptDoc`

The prompt's source of truth is an ordered segment list, **not** an HTML string:

```ts
type PromptSegment =
  | { kind: 'text'; text: string }
  | { kind: 'chip'; label: string; sourceId: string };
  // sourceId reuses the existing convention:
  //   "region:object:<maskId>" | "region:ai:<label>"

type PromptDoc = PromptSegment[];
```

- `PromptEditor` renders each segment (text node, or atomic
  `<span contenteditable="false">` pill) and, on every DOM mutation, parses the DOM back
  into a `PromptDoc` (DOM→doc walk). The doc is React state; the DOM is a view reconciled
  from it.
- Chips reuse the existing `sourceId` convention, so they carry the same identity the tray
  chips do today (`region:object:<maskId>` / `region:ai:<label>`).

### Serialization for the backend (on submit)

Preserves the current contract *and* adds positional context. Build both args from one
`PromptDoc` (folding in any tray-attached regions as trailing chips):

- `intent` (prompt text): segments joined; **each chip rendered as its label inline** →
  `"separate the shoes and apply lighting on them"`. The LLM sees the region word in place.
- `attached_objects`: `extractAttachedObjectIds()` run over chip segments → same deduped ID
  array as today.

The backend call shape is unchanged: `runAgentTurn(intent, objectIds)`.

## 3. Suggestion Logic & Noise Control

On each `onCaretWordChange(word, caretRect)`:

- **Reuse the existing `_scoreField` scorer** (`command-palette.tsx:198`) over region
  labels — no new fuzzy code.
- Build the region list once per palette open from the same merged source as
  `buildRegionsSections()` (maskStore objects + AI candidate regions, deduped, objects win
  on duplicate label).
- **Show the dropdown only when all hold:**
  - the caret word is **≥ 2 chars**, AND
  - at least one region scores **≥ the subsequence tier (~400)** — this excludes
    weak Levenshtein-only matches that would fire on common prose, AND
  - the caret word is **not already inside a chip**.
- **Ranked**, best first, **capped at 5**, first item pre-highlighted.
- The "caret word" is the contiguous token immediately left of the caret
  (`[A-Za-z0-9-]+`). A space commits the user to prose.

Effect: "the", "and", "apply" surface nothing; "sho" surfaces "shoes". Quiet by default,
helpful exactly when a region name is being typed.

## 4. Keyboard & Chip Interaction

Precedence rule: **when the region dropdown is open it owns navigation keys; otherwise
everything behaves as today.**

- **Dropdown open:**
  - `↑/↓` move the highlight
  - `Tab` / `Enter` accept the highlighted region: replace the caret word with a chip + a
    trailing space, close the dropdown
  - `Esc` dismiss the dropdown, keep the typed word as plain text
  - Click also accepts
- **Dropdown closed:**
  - `Enter` submits the prompt (current behavior)
  - `↑/↓` navigate the command list below (current behavior)
- **Chips are atomic:** `Backspace` immediately left of a chip selects it (first press),
  then deletes the whole chip (second press) — never leaves half a chip. Each chip also has
  a tiny `×` on hover/focus.
- **Caret can't land inside a chip** — `PromptEditor` normalizes the selection to the chip
  boundary.
- **Paste** is coerced to plain text (no nested HTML in the contenteditable).

The fallback **Regions list** (kept): clicking a region calls `insertChipAtCaret` (live
caret, or end of doc if the editor isn't focused).

## 5. Edge Cases & Error Handling

- **No regions available** (no masks, no AI context): dropdown never opens; pure prose. The
  existing auto-`analyseActiveImageLayer()` on submit is untouched.
- **Region deleted while its chip is in the doc:** `extractAttachedObjectIds` still emits
  the id; backend already tolerates unknown/stale ids (same as the tray today).
- **Duplicate region inserted twice:** allowed in text (reads naturally); ids dedup at
  extraction.
- **Empty doc submit:** same guard as today (no-op on empty/whitespace `intent`).
- **`mode === 'agent' && pending`:** editor becomes read-only (`disabled`), matching the
  current disabled-input behavior.
- **AI-proposed vs object regions:** identical chip rendering; only the `sourceId` prefix
  differs (already handled by extraction).

## 6. Testing

Vitest + Testing Library, matching `useImageNodeRender.test.tsx` style.

- **`PromptEditor`:** DOM↔`PromptDoc` round-trip; atomic backspace deletes a whole chip;
  caret normalization off chip boundaries; paste coercion; `insertChipAtCaret` at caret and
  at end.
- **Suggestion ranking (pure fn):** threshold gating (≥2 chars, score floor), ranking/cap,
  "and/the/apply" → no matches, "sho" → shoes.
- **Serialization (pure fn):** `PromptDoc` → `{ intent, attachedObjects }`; chips render as
  inline labels; ids extracted + deduped; tray chips folded in.
- **Integration:** type → suggest → Tab → chip appears inline; Enter with dropdown open
  accepts, with it closed submits.

## Out of Scope

- Trigger-character mode (`@`/`{`) — implicit only.
- Auto-convert on strong match — explicit Tab/Enter only.
- Inline chips for ops/presets/menu actions — regions only; the command list is unchanged.
- Backend contract changes — `agent_turn` payload shape is preserved.
