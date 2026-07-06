# Atelier — command palette rework (branding, modes, scroll)

**Date:** 2026-07-06
**Status:** Approved (design) — pending spec review before implementation plan.
**Scope:** Rebrand the app + ⌘K palette as **Atelier**; rename the default palette
mode "Agent" → "Edit"; un-gate Ask so the mode row is identical in both study
conditions; fix the results list not scrolling. One coherent spec.

---

## Background / current state

- The palette (`src/components/CommandPalette.tsx`) has three modes,
  `type PaletteMode = 'agent' | 'ask' | 'genfill'` (:57), shown by `ModeToggle`
  as **Agent · Ask · Fill**.
- The `aiAccess` study gate currently (from the prior rework):
  - forces Ask off in the baseline (`if (!aiAccess && mode === 'ask') setMode('agent')`, :406)
  - hides the **Ask** button when `!aiAccess` (the `aiAccess` prop I added to `ModeToggle`).
  So the mode row differs by condition, which leaks the condition to participants.
- The app has no product name: `index.html` `<title>` is the placeholder
  `editor-temp`; the ⌘K trigger pill reads "Search tools or ask AI…" /
  "Search tools…" (`CommandTrigger.tsx:87`). No scattered "Photo Editor" strings.
- Results list: a Radix `ScrollArea` inside `flex-1 min-h-0 overflow-hidden`
  (`CommandPalette.tsx:826-827`), inside a Framer `motion.div` with `layoutId`
  and `max-h-[min(40rem,76vh)]` but **no definite height** (:696-703). A wheel
  handler forwards deltaY to the viewport when the cursor is outside it (:721).
  Users report the list does not scroll.

---

## A. Branding — "Atelier" (app + palette)

Atelier is the product name; the ⌘K bar is its namesake command bar.

- `index.html` `<title>` → `Atelier`.
- ⌘K trigger pill (`CommandTrigger.tsx:87`): drop the "…ask AI" split for a single
  brand-forward label — **`Search Atelier…`** — the same string in both conditions
  (no `aiAccess` branch, so it never leaks the condition).
- Palette chrome: a small `Atelier` identity label at the top-left of the mode
  row (`CommandPalette.tsx` ~:738-752), styled as quiet brand text (not a button).
- **Do NOT** rename the npm package id (`photo-editor` in `package.json`) — churns
  scripts/CI for no user benefit. User-facing strings + `<title>` + docs only.
- Update `CLAUDE.md` / docs references from "command palette" to "Atelier (⌘K)"
  where it reads naturally; keep "command palette" as the generic term where apt.

## B. Modes — Edit · Ask · Fill, identical in both conditions

- **Rename "Agent" → "Edit"**: the `ModeButton` label (`CommandPalette.tsx:1174-1177`)
  and the internal id `'agent'` → `'edit'` across all sites (:57, :81, :392, :406,
  :764, :1174-1175, and the `mode === 'agent'` checks). Full rename — no lingering
  `'agent'`.
- **Un-gate Ask (both conditions):**
  - Remove the baseline mode-forcing guard at :406 entirely (Ask is allowed in both;
    the only mode that never existed for a reason was none — genfill was already exempt).
  - Remove the `aiAccess` prop from `ModeToggle` (added in the prior rework) and
    always render all three buttons. The chrome row already renders unconditionally.
- **Result:** the mode toggle is byte-identical in both conditions → it no longer
  signals the study condition. What still differs by `aiAccess` is unchanged and
  lives BELOW the toggle:
  - **Edit** mode: AI on → spawns tool_invoked/AI widgets and shows the "send as a
    prompt" AI row (`aiCommand`, :194-204) + `smart_match`; baseline → deterministic
    tool/preset search that routes op/preset rows into the inspector
    (`routeOpToInspector` / `routePresetToInspector`, from the prior rework), no
    "send as a prompt" row, no smart_match.
  - **Ask**: AI grounded Q&A (`ask_about_image`) in BOTH conditions.
  - **Fill**: generative fill in BOTH conditions (already exempt).
- **Placeholders** (`CommandPalette.tsx:765-777`): Edit → "Search adjustments or
  type an intent…"; Ask/Fill copy unchanged. The Edit placeholder no longer branches
  on `aiAccess` (or branches only on the sub-hint, never on mode visibility).

### Thesis note (documented, not a code concern)

Keeping Ask in the baseline means "no-AI" is precisely "no AI *widget layer*":
baseline participants can ask grounded questions but cannot compose parametric
widgets or pin to canvas. The study-measures classifier already treats Ask answers
as non-edits (`ai.answer`, not a surface edit), so `manual_edit_share` is
unaffected. State this framing explicitly in the thesis method section.

## C. Scroll fix

**Root-cause first (systematic-debugging):** reproduce the non-scroll with an
overflowing list before changing code, to confirm the theory: the results
viewport never gets a stable bounded height because the height chain terminates
at a Framer `layoutId`-animated `motion.div` that is `max-height`-only (no definite
height). During/after the shared-layout size animation, the `flex-1` results box
doesn't resolve to a clipping height, so `scrollHeight <= clientHeight` and neither
native wheel nor the forwarded `scrollBy` moves anything.

**Fix (minimal, chosen after repro):** give the scroll boundary a height that does
not depend on the animated shell. Preferred: a definite-height inner results
container (e.g. an explicit `max-h`/height on the `flex-1 min-h-0 overflow-hidden`
wrapper, or a non-animated inner wrapper between the `motion.div` and the
ScrollArea) so Radix's Viewport always has a real height to clip against —
mirroring the "definite-height container" note already in the code (:815-819).
Keep the wheel-forwarding handler (:721) for cursor-over-input scrolling.

**Verify:** overflow the Edit results (many tools/presets) in both a short (~600px)
and tall window; wheel over the input row AND over the list; confirm the thumb
appears and the list scrolls in both.

## Testing

- **B:** extend `CommandPalette.test.tsx` — with `aiAccess=false` the toggle shows
  **all three** (Edit, Ask, Fill); with `aiAccess=true` likewise; picking Edit in
  baseline still routes to the inspector (existing router test) and does not spawn a
  widget; the `'agent'`→`'edit'` rename leaves no `'agent'` references (grep gate).
  Update the prior test that asserted "Ask hidden in baseline" — it now asserts Ask
  present.
- **C:** a focused test that the results container exposes a bounded, scrollable
  viewport when content overflows (jsdom can't measure layout, so assert the
  structural invariant: the ScrollArea sits in a definite-height wrapper, not
  directly under the animated shell). Primary verification is the manual repro above.
- **A:** assert the trigger pill / title copy is `Atelier` and does not branch on
  `aiAccess`.

## Out of scope

- No change to Edit mode's underlying behavior (widget spawn vs inspector route) —
  that shipped in the prior `aiAccess` rework.
- No renaming of the npm package or backend service names.
- No new palette modes; no change to Ask/Fill behavior beyond the un-gate + labels.
