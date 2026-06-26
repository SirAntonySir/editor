# Recent Changes — Handover (2026-06-21 → 2026-06-24)

> **Purpose.** Catch-up handover covering everything that landed on `main`
> *after* the 2026-06-20 handover series (architecture, design/UX,
> problems-and-solutions, backend/Anthropic, menu-keyboard-electron,
> code-quality-and-testing). 39 commits across four days. The previous
> handovers describe the *standing* architecture; this one is a **delta**:
> what changed, why, and where to look.
>
> Audience: the next agent picking up the editor, and the thesis chapters
> on deployment, study methodology, and the interaction surfaces.

The work clusters into seven themes. Reading order below is by importance,
not by date; a chronological commit index closes the document.

---

## 1 · Cloud deployment & remote access

The editor went from "localhost only" to **deployable and remotely
reachable**, which the study needs (participants hit a hosted instance, not
the dev's laptop).

- **Hosting scaffold** (`5c0d598`): `render.yaml` (Render, starter plan,
  Frankfurt region, `numInstances=1`, `/health` check) for the FastAPI
  backend; `vercel.json` (Vite build + SPA rewrite) for the frontend.
- **Shared-secret auth** (`5c0d598`): opt-in — enforced **only when
  `BACKEND_AUTH_TOKEN` is set**, so local dev stays frictionless. Backend
  gate in `backend/app/main.py` + `backend/app/config/env.py`; frontend
  carries the token via `src/lib/backend-auth.ts`, threaded through
  `src/lib/sse-subscriber.ts` and `src/main.tsx`. The token is entered in
  the Preferences dialog (§4) and persists to `localStorage`.
- **Runtime-configurable backend URL** (`b2e8e39`): `src/lib/backend-url.ts`
  resolves the backend origin at runtime (override in Preferences), so the
  same built frontend can point at localhost, a Cloudflare tunnel, or the
  Render host without a rebuild. Changing it requires a reload (re-establishes
  the session + SSE stream).
- **Tunnels** (`b2e8e39`, `36679f1`): Cloudflare tunnel for public exposure;
  a `make tunnel-tailscale` target for private (Tailscale) backend access.
- **Deploy hardening** (`0263789`, `254da75`, `db5ebea`): the first cloud
  builds surfaced three packaging gaps — `opencv-python-headless` had to be
  declared so the image boots without X11; `shared/registry` had to be copied
  into the backend image (the registry JSON is loaded at runtime); and the
  **MobileSAM ONNX assets must be vendored during the Vercel build** (they
  ship with the frontend for client-side segmentation).

**Why it matters for the thesis:** this is the infrastructure that makes a
controlled, multi-participant study possible. The auth + per-participant
condition (§2) together gate who sees what.

---

## 2 · Study infrastructure — the `AI_access` condition

`9d984bd` adds the **per-participant study condition** that the whole thesis
hinges on: a control group (no AI) vs. a treatment group (AI on).

- `AI_access` is a per-session/participant flag, surfaced on the
  `SessionStateSnapshot` (`backend/app/state/snapshot.py`,
  `backend/app/schemas/widget.py` → `aiAccess`).
- An **admin toggle** (`backend/app/api/admin.py`) flips it; the session API
  (`backend/app/api/session.py`) and state API (`backend/app/api/state.py`)
  read it.
- Frontend honours it defensively: autonomous AI suggestions are **never**
  surfaced as pending chips when `aiAccess` is false, even if some arrive via
  SSE replay on a session whose flag flipped mid-run (see the
  `widget.created` handler in `src/store/backend-state-slice.ts`).

This is the SSoT for "is this a control or treatment participant," and it is
deliberately backend-owned so a frontend can't opt itself into AI.

---

## 3 · Command palette (Cmd+K) — Ask mode + a UX overhaul

The palette got a substantial pass — a new *mode* plus a chrome redesign.
Roughly a third of the 39 commits are palette work.

### 3.1 Ask mode (`5b3ab9c`, `3b05dd1`)

A second palette mode alongside "spawn a widget": **Ask** — a Sonnet-tier
Q&A about the image that returns a **markdown** response rendered inline.
Backed by `backend/app/tools/atomic/ask_about_image.py`. Entry points:
the in-palette toggle, plus **right-click** and an **AI-menu** item
(`3b05dd1`). Region/Object rows can attach a **context chip** to the question
instead of running a selection (`9bf3b1c`).

### 3.2 Chrome + interaction polish

A run of focused fixes, worth knowing because they encode the palette's
current visual contract:

- **Two-row chrome** (`d15a799`, `7ba4926`, `b8cd7a3`): input row + results;
  the input icon **mirrors the active row** (Search when idle, MapPin for
  Region/Object); best-match preview; palette **state persists** across opens.
- **Active-row marking** (`9f8c486`): the left-border accent marks the *active*
  row only, not every AI row — previously ambiguous.
- **Scroll/geometry** (`742442d`, `b2fd3be`): wrap the results `ScrollArea` in
  a definite-height container (same trick as the History dropdown), and forward
  wheel events from the input row into the results viewport.
- **Glyphs/padding** (`36879e1`, `379c339`): MapPin for Region/Object, keep the
  Search icon when idle, tightened row padding.

If you touch the palette, read `src/components/CommandPalette.tsx` — these
commits left it in a deliberate two-row state with mode-dependent affordances.

---

## 4 · Preferences dialog

`4877f11` + `86aba28` replaced the old palette-embedded preferences with a
**dedicated Preferences dialog** (`src/components/PreferencesDialog.tsx`),
opened via the `prefs:open` event (`openPreferencesDialog()` helper). It hosts
theme, accent, radius, **and** the backend URL + auth token from §1.

- **Default accent → LMU Green `#00883a`** (`86aba28`) with a **v1 → v2
  preferences migration** so existing users get the new default cleanly
  (`src/store/preferences-store.ts`).
- **Follow-up fix (this session):** the **Edit ▸ Preferences…** menu item was
  still dispatching `spawn-palette:open` (it opened the command palette).
  Rewired to `openPreferencesDialog()` (`src/components/toolbar/MenuBar.tsx`).
  *(Committed as part of `fe63ee0`.)*

---

## 5 · Workspace interactions

- **Paste & duplicate** (`56a5ac4`): `Cmd+V` pastes an image as a new
  image-node; `Cmd+D` duplicates the selected image-node.
- **Post-reload fitView** (`30d3ad8`, `0e68cb1`): on reload the workspace now
  waits for `useNodesInitialized()` before fitting the view, so the fit math
  reads real (measured) node bboxes instead of zero-width placeholders — the
  old version landed the viewport off-screen. Fires exactly once per mount.
- **Crop overlay** (`fa30573`, this session-adjacent): removed the dim overlay
  outside the crop rect — purely visual.

---

## 6 · Segmentation / SAM

- **Auto-named objects** (`a35265b`): SAM-extracted objects inherit names from
  the AI's candidate-region labels instead of generic "Object N".
- **Alpha-channel mask fix** (`2353eb8`): shape-in-alpha mask PNGs now read the
  alpha channel correctly.

---

## 7 · Per-widget history (this session)

The largest single feature of this batch. Lets the user step a **single
adjustment widget** backward/forward through its own edit history, while
staying coherent with the global undo stack. Final shape: a **compact inline
stepper** inside the expanded widget body (it began as a tethered canvas node
— see the design note — and was deliberately collapsed into the widget).

**Spec:** `docs/superpowers/specs/2026-06-24-per-widget-history-design.md`.

### 7.1 Backend (single source of truth)

The global `HistoryEngine` already stored a before/after `Snapshot` per entry;
it just didn't expose *which* widget each entry touched. We added that.
(`backend/app/session/history.py`, `backend/app/tools/registry.py`,
`backend/app/api/state.py`.)

- **Entry tagging:** each `HistoryEntry` now carries `affected_widget_ids`,
  `widget_params_before/after`, and an `is_restore` flag. Affected ids are
  computed at push time in the tool registry (`_compute_affected_widget_ids`)
  — from the tool's `widget_id` input, falling back to a before/after param
  diff.
- **Two endpoints:**
  - `GET /state/{sid}/widget-history/{widget_id}` — the widget's slice of the
    timeline, **excluding `is_restore` entries**, with that widget's param
    snapshots inlined. `current_entry_id` is computed by **matching the
    widget's live params** to an entry's `params_after` (not by cursor).
  - `POST /state/{sid}/restore-widget/{widget_id}/{entry_id}` — re-applies a
    past param set as a **new forward mutation** (a normal `set_param` /
    `update_widget`), so it lands in the global history *and* is itself
    undoable, rather than rewinding the whole session.

### 7.2 Why "restore as a forward op" + the two guards

Restoring forward (not a cursor rewind) keeps the per-widget timeline synced
with global undo without a divergent stack. But a naive stepper would then
(a) inflate the `n/N` count on every press and (b) oscillate, because the
appended restore entry becomes the new cursor tip. The two backend guards fix
this: **excluding `is_restore` entries** keeps `N` stable, and **params-matched
`current`** makes ‹/› behave like a true per-widget undo/redo (after stepping
back, the pointer sits on the older entry, not the restore).

### 7.3 Frontend

A single self-contained row, rendered between the widget header and its
controls when expanded:

- `src/components/widget/WidgetHistoryStepper.tsx` — `‹ n/N ›`; renders nothing
  until the widget has history; arrows disable at the ends, offline, or mid-
  restore.
- `src/hooks/useWidgetHistory.ts` — fetches the widget-scoped endpoint, refetches
  on `snapshot.revision` (same trigger as `useHistoryLog`).
- Helpers: `src/lib/widget-history-step.ts` (`resolveStep`),
  `src/lib/widget-history-deltas.ts`, `src/lib/relative-time.ts` (extracted from
  `HistoryDropdown`).

**Note on the history:** an earlier iteration shipped this as a tethered
**canvas node** (`HistoryNode` + `HistoryWidgetShell` + a `historyNodes` store
slice + auto-tether). That was fully removed when it collapsed to the inline
stepper — if you find references to those names in old notes, they're gone.
The commit message (`fe63ee0` "per-widget history timeline **node**") predates
the collapse; the committed tree is the **stepper**.

---

## 8 · White Balance bug fixes (this session) — `69b88a5`

Two bugs in the kelvin (White Balance) tool, both worth understanding because
the second is a subtle schema trap.

1. **Tint slider was inverted.** `src/shaders/kelvin.glsl.ts` did
   `color.g += u_tint * 0.1`, so positive tint *added* green (right → teal),
   opposite the slider's gradient (right = magenta). Flipped to
   `color.g -= u_tint * 0.1`. The visual gradient was left untouched —
   the *mapping* was the bug.
2. **The widget never reached the canvas.** The `tint` binding's
   `control_type: "tint_strip"` was **missing from the `ControlType` literal**
   in `backend/app/schemas/widget.py`, even though `TintStripSchema` was
   already in the discriminated union. So building the kelvin widget threw a
   Pydantic validation error and *no widget was created*. Added `"tint_strip"`
   to the literal and regenerated the shared types
   (`shared/types/generated.ts` et al.).
   - **Trap for the future:** the drift-guard test
     `tests/schemas/test_widget.py::test_control_type_matches_union_members`
     *should* have caught this, but its own hardcoded schema list **also**
     omitted `TintStripSchema`, so it was locking in the bug. Both that test
     and `test_control_type_set` were corrected. There was a prior partial fix
     (`a853c4b`, "include tint_strip in slider-shaped schema branch") that
     patched `propose_stack` but not the schema vocab — the root cause survived
     until `69b88a5`.

**If you add a control type:** update (1) `registry/schema.py CONTROL_TYPE`,
(2) `app/schemas/widget.py ControlType` literal **and** add a `*Schema` to the
union, (3) the two schema tests, (4) regenerate shared types, (5) the frontend
`BindingRow` switch + registry-controls `CONTROL_MAP`. Missing any one of these
silently breaks widget creation for that op.

---

## 9 · Pipeline, curves, session-store & smaller fixes

- **Pipeline refactor merge** (`e4e5360`): `refactor/pipeline → main`. Worth a
  diff-read if you work in `src/shaders/pipeline.ts` / `lib/pipeline-manager.ts`.
- **Curves live preview + pin** (`aefd40a`, `8ba1b6b`): curves show a live
  preview *before* the first canonical write, and pin-to-canvas preserves
  in-progress edits instead of resetting to identity.
- **`refine_widget` layer anchoring** (`d265ec6`): refining a widget preserves
  its `layer_id` so it stays tethered to its image instead of detaching.
- **Session store durability** (`45b296e`, `200f9a8`, `5f5708f`):
  `prune_disk` keys off *last activity* (TTL bumped to 24h); `SESSIONS_DIR` is
  anchored absolutely with a legacy-path migration; and the frontend keeps a
  persisted session when the backend is briefly unreachable (no spurious reset).
  *(`200f9a8`'s `prune_disk` timestamp logic is the same area as the lone
  pre-existing test failure `test_prune_disk_removes_old_records`, which is a
  time/filesystem flake — see code-quality handover.)*
- **File ▸ Close** (`947a376`): now actually clears the canvas.
- **Titlebar** (`0d1f40f`): top-bar height matches the macOS traffic lights.
- **Docs** (`e5d4883`): hand-curated architecture Mermaid under `docs/figures`.

---

## Verification status at handover

- **Frontend** `npm run check` (gen-types + tsc + eslint + vitest): **958
  tests pass, 0 errors** as of `69b88a5`.
- **Backend** pytest: **740 pass**, 1 pre-existing failure
  (`test_prune_disk_removes_old_records`, a time/FS flake unrelated to these
  changes — confirmed by stashing).
- `origin/main` is at `69b88a5`. Working tree clean.

---

## Commit index (chronological)

- `e4e5360` merge: refactor/pipeline → main
- `e5d4883` docs(figures): add hand-curated architecture Mermaid
- `45b296e` fix(session-store): key prune_disk off last activity + bump TTL to 24h
- `200f9a8` fix(session-store): anchor SESSIONS_DIR absolutely + migrate legacy paths
- `8ba1b6b` fix: pin-to-canvas + curves writes + palette polish
- `aefd40a` fix(curves): live preview before first canonical write + pin preserves edits
- `379c339` style(palette): tighten padding across all rows
- `b2fd3be` fix(palette): forward wheel events on the input row to the results viewport
- `742442d` fix(palette): wrap ScrollArea in definite-height container
- `9bf3b1c` fix(palette): Region clicks attach a context chip, don't run a selection
- `5b3ab9c` feat(palette): Ask mode — Sonnet-tier Q&A with markdown response
- `d15a799` style(palette): two-row chrome + input layout; slim chips, target, toggle
- `0e68cb1` feat(workspace): fitView once after the post-reload nodes arrive
- `7ba4926` feat(palette): search icon in input row · best-match preview · persist state
- `30d3ad8` fix(workspace): wait for useNodesInitialized before post-reload fitView
- `9f8c486` fix(palette): left-border marks the ACTIVE row, not every AI row
- `b8cd7a3` feat(palette): input icon mirrors active row · chip preview on Region rows
- `36879e1` style(palette): Region/Object MapPin glyph · keep Search icon when idle
- `d265ec6` fix(refine_widget): preserve layer anchoring
- `3b05dd1` feat(palette): right-click and AI-menu entry points for Ask mode
- `a853c4b` fix(propose_stack): include tint_strip in slider-shaped schema branch
- `a35265b` feat(segment): auto-name SAM objects from AI candidate regions
- `947a376` fix(close): File → Close now actually clears the canvas
- `2353eb8` fix(sam): pick alpha channel for shape-in-alpha mask PNGs
- `4877f11` feat(prefs): dedicated Preferences dialog + palette flips both ways
- `86aba28` feat(prefs): default accent → LMU Green (#00883a) + v1 → v2 migration
- `56a5ac4` feat(workspace): Cmd+V paste image, Cmd+D duplicate image-node
- `b2e8e39` feat(backend-url): runtime-configurable backend + Cloudflare tunnel
- `0d1f40f` fix(titlebar): match top-bar height to macOS traffic lights
- `9d984bd` feat(study): AI_access per-participant condition + admin toggle
- `5f5708f` fix(session): keep persisted session when backend is unreachable
- `5c0d598` feat(deploy): cloud scaffold (Render + Vercel) + shared-secret auth
- `36679f1` feat(makefile): add tunnel-tailscale target for private backend access
- `0263789` fix(deploy): declare opencv-python-headless so the Render image boots
- `254da75` fix(deploy): include shared/registry in the backend image
- `db5ebea` fix(vercel): vendor MobileSAM ONNX assets during the build
- `fe63ee0` feat(history): per-widget history (+ Preferences menu fix)
- `fa30573` style(crop): remove dim overlay outside the crop rect
- `69b88a5` fix(white-balance): flip tint mapping + tint_strip ControlType
