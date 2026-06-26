# Recent Changes — Handover (2026-06-24 → 2026-06-26)

> **Purpose.** Delta handover covering everything that landed *after* the
> 2026-06-24 handover (`docs/recent-changes-handover-2026-06-24.md`, tip
> `69b88a5`). 33 commits on `main`, all dated 2026-06-26, plus an in-progress
> **drag-and-drop external images** feature still in the working tree (§7).
>
> The 2026-06-24 handover and the 2026-06-20 series describe the *standing*
> architecture; this one is the **delta** — what changed, why, and where to look.
>
> Audience: the next agent picking up the editor, and the thesis chapters on the
> AI interaction surface and the study deployment.

The work clusters into seven themes. Reading order is by importance, not date; a
chronological commit index closes the document.

---

## 1 · The agentic client-tool loop — the thesis USP

By far the largest body of work in this batch (~20 commits across three planned
sub-projects). It turns the command-palette AI prompt from a **single-shot**
"propose a plan of adjustment ops" into a **multi-turn agent** that can invoke
the editor's own client-side tools *and* propose widgets, orchestrating freely.

**Motivating flow:** user attaches an object chip ("Sky") and prompts *"make it
dramatic on its own layer"* → the LLM calls `extract_object_to_image_node` (→ a
new image node) → then calls `propose_adjustment_widgets` targeting that new
node. This is the thesis USP: **AI composing/invoking the block-kit tools**, not
just emitting parameters.

**Spec:** `docs/superpowers/specs/2026-06-26-agentic-client-tool-loop-design.md`
(+ the original brainstorm `docs/superpowers/specs/8672189`-era spec). It was
built as three sequenced plans:

### 1.1 Plan 1 — client-tool round-trip transport

The one genuinely new piece of infrastructure. Until now: HTTP POST up
(one-shot), SSE down (one-way), no correlation IDs. We layered a
request/response channel on top.

- **Down (new SSE event):** `client.tool_request` with payload
  `{ request_id, name, input, kind: "query" | "mutate" }`. Registered as a
  `StateEventKind` (`9a9d370`).
- **Up (new endpoint):** `POST /api/state/{sid}/tool_result` with
  `{ request_id, ok, output?, error?, denied? }` (`ebd3e14`).
- **Backend correlation:** a per-session `pending_tool_calls` registry of
  `asyncio.Future`s on the session record (`d09545e`). The loop creates a
  `request_id`, registers a Future, emits the SSE event, and `await`s it with a
  timeout. The `tool_result` POST resolves the Future. Session cancel/disconnect
  rejects every pending Future and aborts the turn (cancel-drain in the same
  commit). The emit-and-await bridge is `request_client_tool` (`ea5ed18`).
- **Frontend:** `postToolResult` helper (`e8d965d`) + a **client-tool approval
  slice** (`e75f8bf`) holding pending requests.

### 1.2 Plan 2 — the agent loop + manifest sharing

- **`run_agent_turn`** multi-turn Anthropic tool-use loop emitting
  `agent_message` events (`1f0dfae`); `propose_adjustment_widgets` dispatches
  server-side to the existing `propose_stack` path (`71f3f6a`).
- **Filtered manifest serializer** (`5f1a954`): serialises the client-tool
  manifests the LLM is allowed to call into Anthropic tool schemas.
- **`POST /state/{sid}/agent_turn`** — a **non-locking** endpoint (`388f3da`),
  so an agent turn doesn't block other session reads.
- **Frontend:** `runAgentTurn` + the `agentTurn` request (`80060b8`); the
  palette's agent-mode prompt runs the loop (`aea25a0`).

### 1.3 Plan 3 — extract → new-node targeting

So the LLM can target the node it just created:

- `extractObjectToImageNode` returns `{ imageNodeId, layerId }` (`9cfa836`); the
  LLM tool surfaces the new `image_node_id` + `layer_ids` (`3762c0f`); those are
  threaded into `node_layers` (`6e30401`) and seeded from the active node
  (`1656494`).

### 1.4 Approval UX — `query` auto-runs, `mutate` asks

Locked decision: **query tools auto-execute; mutate tools pause for user
allow/deny** (reusing the suggestion-chip pattern). The SSE handler runs query
tools and queues mutate ones for approval (`94a8a98`); allow/deny chips render
in the `FloatingDock` (`c44aeda`, `src/components/ui/ClientToolApproval.tsx`).
The whole agent turn collapses to **one backend history entry** (single Cmd+Z).

### 1.5 "Make the loop actually act" — `93e7962` (read this one)

Live verification caught three bugs the unit tests missed — worth knowing
because they encode the loop's real contract:

1. `dispatch_propose_adjustment` read `envelope.data` / `error` dict, but the
   real `ToolResponseEnvelope` exposes `.output` / `.error.message`. Fixed, with
   a **real-envelope regression test** so the test fake can't drift again.
2. The loop fed the LLM only the bare prompt (no image context, weak system
   prompt), so it often ended the turn without calling a tool. Now feeds image
   context + target node ids + a directive to call tools.
3. `ClientToolApproval` chips were **unclickable** (missing `pointer-events-auto`
   under the dock's `pointer-events-none`) and read "Run select_object?"; now
   clickable and labelled "Allow to select object".

Verified live: *"increase contrast and warmth"* → LLM calls
`propose_adjustment_widgets` → 3 widgets land on the node.

> **Branch note:** this work came in via
> `Merge branch 'worktree-feat+client-tool-transport'` (`1b87cd6`).

---

## 2 · Camera RAW pipeline

Browsers can't decode camera RAW (`createImageBitmap` is web-formats only), so
RAW is now **developed server-side via LibRaw (`rawpy`)** and returned as an
image the frontend opens through its normal path.

- **Service + endpoint** (`dc30018`): `backend/app/services/raw_decode.py`
  (`develop_raw_to_jpeg()`: embedded-JPEG-preview fast path → demosaic fallback →
  clamp + re-encode) and a sessionless `POST /api/raw/develop` (RAW bytes in,
  image out, 415 on non-RAW). `rawpy` wheels bundle LibRaw, so no system lib on
  the Render image. TDD with a checked-in synthetic Bayer DNG fixture.
- **Frontend** (`dc30018`): `src/lib/raw-image.ts` (detect + develop);
  `open-file.ts` routes a RAW pick through the endpoint before
  `openImage`/`addImage`; picker `accept` widened to RAW extensions.
- **Full-resolution develop** (`1872156`): the empty-state uploader still used
  `accept="image/*"` (greys out RAW on macOS — RAW has no image MIME); routed
  through the shared picker with an explicit extension list. Also: prefer the
  embedded preview only when it's ≥80% of the sensor's long edge, else demosaic
  at full res (Sony embeds a ~1.7MP preview, so the old path silently opened a
  24MP RAW tiny). `max_dim` 2048 → 8192.
- **16-bit develop + OOM fix on Render** (`1872156`, `b7d1475`): full-res 16-bit
  develop peaks ~290MB+, which OOM-killed the 512MB starter worker mid-response
  (browser saw `ERR_HTTP2_PROTOCOL_ERROR` / "Failed to fetch"). Fixes:
  `render.yaml` **starter → standard (512MB → 2GB)**; rebind BGR onto `rgb` so
  the full-size source buffer frees before PNG encode; reject uploads >200MB with
  413 before decoding.
- **Spec / not-yet-done:** `docs/superpowers/specs/2026-06-26-raw-16bit-pipeline-plan.md`
  describes the full high-bit-depth pipeline (output_bps=16 + a higher-bit-depth
  editing pipeline). The current output is develop-to-8/16-bit-for-open — fine
  for "edit like a JPEG," **not** full RAW latitude end-to-end yet.

---

## 3 · Inline region chips in the command palette — `d942c32`

The palette prompt is now a **contenteditable segment document (`PromptDoc`)**
instead of a plain `<input>`. Region references become **atomic inline chips** at
the caret, Cursor-style.

**Spec:** `docs/superpowers/specs/2026-06-26-inline-region-chips-design.md`.

- As you type, words fuzzy-match region names; an **implicit caret-anchored
  picker** (portaled to `<body>`, anchored against the viewport) surfaces ranked
  matches. `Tab`/`Enter`/click converts the typed word into a chip; otherwise it
  stays prose. The **target chip moved onto the input row**.
- **Accepting a region always separates it** into its own image node
  (`extractObjectToImageNode`) — via inline picker, keyboard, or the Regions list.
- **Cascade mask cleanup:** deleting an image from the canvas now also drops its
  segments from the registry — `layer-lifecycle` cascades mask cleanup (local +
  backend) when a layer is removed.
- **Analysis-only prompts:** a prompt-driven analyze runs with `suggest:false`,
  so only the user's prompt drives proposals; a synthesized
  `markAnalyzeComplete()` gives the status card its end state when `widget_mint`
  never fires.
- **Bindings fix** (`432b6df`): a multi-op widget (e.g. from the agent) can
  expose two bindings with the same user `paramKey` (e.g. `amount`); the
  `BindingRow` list is now keyed by the binding's unique target
  (`nodeId:target.paramKey`), not `paramKey`, fixing React key collisions.

---

## 4 · Per-widget history + reset — `e16ddac`

Follow-up to the 2026-06-24 per-widget history stepper. A **per-widget action
strip** in `WidgetHistoryStepper` now hosts both the `‹ n/N ›` stepper **and** a
**reset-to-defaults** action. The reset button was **removed from
`WidgetShellHeader`** and consolidated into the widget body, with the reset
handler passed down from `WidgetShell`. Tests updated to match the header change.
(Also touches `workspace/drafting/` — `BottomMarginalia`, `ImageNodeDrafting`.)

---

## 5 · Admin cockpit token gate (working tree, uncommitted)

`backend/app/api/admin.py` — `_require_loopback` was loopback-only, which works
for local dev / SSH-or-Tailscale tunnels terminating on the host but **blocks the
cockpit on a hosted Render deploy** (no loopback path from a browser). Now gates
on **loopback OR a valid shared token**: a request is accepted when it carries
`BACKEND_AUTH_TOKEN` as `Authorization: Bearer <token>` *or* `?token=<token>`
(so the cockpit is openable as a plain URL). When no token is configured, only
loopback is allowed (unchanged). The embedded cockpit HTML carries `?token=` onto
every same-origin admin fetch + the CSV/JSON/image links via a `withTok()` helper.

> Pairs with the §1/study deployment work from the prior handover
> (`BACKEND_AUTH_TOKEN`, the `AI_access` admin toggle).

---

## 6 · AI "snake" border animation → arrival, not loading (working tree, uncommitted)

`src/index.css` — the AI proposal chip's animated border was an **infinite spin**
that read as a perpetual loading spinner. Reworked to read as **arrival**: two
finite sweeps (~0.9s each) on arrival, then the arc **fades out** and hands off
to a settled "arrived" state — a calm violet ring + bloom (`--color-ai`, same
accent as a placed AI widget) — so the proposal looks *finished*, not loading.
New keyframes `ai-snake-fade` / `ai-snake-settle`; `prefers-reduced-motion`
skips the sweep and shows only the settled glow.

---

## 7 · Drag-and-drop external images onto the canvas (IN PROGRESS — working tree)

> **This is the feature Anton is building in parallel.** It is **uncommitted**
> and untracked; it works and has green unit tests but has not been run through
> the full `npm run check` here.

Drag an image (or camera RAW) file from the OS straight onto the canvas to
open/add it — matching the picker's Open-vs-Add semantics.

**New / changed files:**

- **`src/lib/canvas-file-drop.ts`** (new) — the pure logic:
  - `isAcceptedImageFile(file)` — accepts web images by MIME *or* extension, and
    camera RAW by extension (RAW has no `image/*` MIME, so it's checked via
    `isRawFile`). Extension allow-list mirrors the picker's accept list.
  - `imageFilesFromList(files)` — filters a dropped `FileList`/array to openable
    files, preserving order.
  - `openDroppedFiles(files)` — the orchestrator. Filters; toasts on an
    all-non-image drop; the **first file replaces the document only when the
    canvas is empty**, otherwise every file is **added** alongside existing nodes
    (Open-vs-Add parity). RAW files are developed via `resolveImageFile` first.
    **Sequential by design** — opening the first creates the backend session that
    the rest attach to, avoiding the concurrent-upload session race noted in
    `document.ts`.
- **`src/lib/canvas-file-drop.test.ts`** (new) — 7 unit tests (accept by MIME /
  by extension / RAW / reject non-image / reject extensionless; list filtering).
  **Verified green:** `npx vitest run src/lib/canvas-file-drop.test.ts` → 7/7.
- **`src/components/workspace/CanvasDropZone.tsx`** (new) — the wrapper component.
  Highlights a dashed drop target while a **file** drag is over the canvas
  (`dataTransfer.types` includes `'Files'`), using a **dragenter/dragleave depth
  counter** so the highlight doesn't flicker as the cursor crosses child nodes.
  On drop, hands `dataTransfer.files` to `openDroppedFiles`. Styled with design
  tokens (`--color-accent`, `--radius-panel`), `ImagePlus` glyph, "Drop image to
  open" label.
- **`src/lib/open-file.ts`** (modified) — `resolveImageFile` is now **exported**
  (was module-private) so the drop path can reuse the RAW-develop step.
- **`src/App.tsx`** (modified) — the canvas column `<div>` is replaced by
  `<CanvasDropZone>`; the empty-state copy ("Drag a photo onto the canvas") is
  now backed by a real handler (the old "drag-drop affordance is in the copy; the
  actual handler is a follow-up" comment is removed).

**Open items for whoever finishes this:**

- Run the full `npm run check` (tsc + eslint + vitest) and commit — these files
  are untracked.
- `CanvasDropZone` lives in `workspace/` and styles via tokens, consistent with
  the 3-tier component rules; no new primitive was needed.
- No test yet for `openDroppedFiles`' Open-vs-Add branch or the RAW develop
  branch (those touch `editorDocument` / the backend) — only the pure filters are
  covered.

---

## Verification status at handover

- `origin/main` is at **`b7d1475`** (all §1–§4 work committed).
- **Uncommitted working tree:** the admin token gate (§5), the snake animation
  (§6), and the entire drag-and-drop feature (§7). The drag-drop **unit tests
  pass (7/7)**; the full `npm run check` / backend pytest suites were **not**
  re-run for this handover — run them before committing the working-tree changes.
- Prior-handover caveat still stands: `test_prune_disk_removes_old_records` is a
  pre-existing time/FS flake, unrelated to this batch.

---

## Commit index (chronological, 2026-06-26)

- `8672189` docs(spec): agentic client-tool loop design
- `cfa5ee5` docs(plan): client-tool round-trip transport (Plan 1 of 3)
- `dc30018` feat(raw): develop camera RAW to JPEG behind the open path
- `9a9d370` feat(transport): register client.tool_request event kind
- `d09545e` feat(transport): per-session pending client-tool-call registry + cancel drain
- `ea5ed18` feat(transport): request_client_tool emit-and-await bridge
- `ebd3e14` feat(transport): POST /state/{sid}/tool_result endpoint
- `e8d965d` feat(transport): frontend postToolResult helper
- `e75f8bf` feat(transport): client-tool approval slice
- `1872156` fix(raw): make RAW selectable in the picker + develop at full resolution
- `aff0a5b` docs(plan): RAW high-bit-depth editing pipeline (not yet implemented)
- `94a8a98` feat(transport): SSE handler runs query tools, queues mutate for approval
- `c44aeda` feat(transport): allow/deny approval chips for mutate tools
- `e16ddac` feat(widget): enhance per-widget history and reset functionality
- `1b87cd6` Merge branch 'worktree-feat+client-tool-transport'
- `6f09eeb` docs(plan): agent loop + manifest sharing (Plan 2 of 3)
- `5f1a954` feat(agent): filtered manifest serializer for the agent loop
- `80060b8` feat(agent): frontend agentTurn request + runAgentTurn
- `71f3f6a` feat(agent): propose_adjustment_widgets dispatch to propose_stack
- `1f0dfae` feat(agent): multi-turn run_agent_turn loop + agent_message
- `388f3da` feat(agent): POST /state/{sid}/agent_turn endpoint (non-locking)
- `aea25a0` feat(agent): palette agent-mode prompt runs the agent loop
- `dd8d87e` docs(plan): extract → new-node targeting (Plan 3 of 3)
- `9cfa836` feat(extract): extractObjectToImageNode returns {imageNodeId, layerId}
- `3762c0f` feat(extract): LLM tool returns new image_node_id + layer_ids
- `6e30401` feat(agent): thread extracted image nodes into node_layers
- `1656494` feat(agent): seed node_layers from the active node
- `93e7962` fix(agent): make the loop actually act, end to end
- `432b6df` fix(widget): key BindingRows by target, not paramKey
- `5b2cd21` docs(palette): spec for inline region chips
- `d942c32` feat(palette): inline region chips, always-separate, analysis-only
- `b7d1475` fix(raw): stop 16-bit develop OOM on Render
</content>
</invoke>
