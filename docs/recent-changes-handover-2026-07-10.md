# Recent Changes — Handover (2026-07-10)

> **Purpose.** Delta handover for everything that landed *after* the
> 2026-07-08 handover (`docs/recent-changes-handover-2026-07-08.md`, tip
> `b1e3c7e`). Covers the range `b1e3c7e..HEAD` — **22 commits**.
>
> Same convention as the other dated handovers: this is the **delta** — what
> changed, why, and where to look. Ordered by importance; a chronological
> commit index closes the document.
>
> **Repository state (important, read first).** `main` tip is `ca609a9`
> (the 07-08 handover doc + tutorial script). Everything from §1, §3, §4, §6–§9
> below lives on the **unmerged feature branch `feat/grounded-verified-suggestions`**,
> not on `main`. The committed `main` history up to `ca609a9` carries §2, §5,
> and most of §10. Backend suite: **907 passing**. Frontend `npm run check`
> (tsc + eslint + 1343 vitest): green.
>
> **Commit-hygiene caveat.** The four grounded-suggestions commits used
> `git add -A` and therefore **absorbed a batch of unrelated, uncommitted
> work-in-progress** that was sitting in the tree (the §6–§8 clusters). Those
> changes were not authored in the session that produced §1; they were
> pre-existing WIP. They are functionally sound (all tests pass) but their
> commit messages do not describe them. See the hygiene note near the end
> before rewriting history.
>
> Big picture: this batch is dominated by a **grounded + self-verifying AI
> suggestion pipeline** (fixing the "Problems say cast, Suggest offers a teal
> grade" disconnect), **TIFF support + physically-correct white balance**, a
> **per-problem Correct button**, **auto-analyze on load**, and three clusters
> of correctness/robustness hardening (SSE/multi-layer, backend security,
> workspace perf).

---

## 1 · Grounded, verified AI suggestions (branch only)

Spec: `docs/superpowers/specs/2026-07-10-grounded-verified-suggestions-design.md`.
Four phases (`4823097`, `4e83670`, `6fdf4f1`, `4a83de8`).

**The problem it fixes.** A deliberately degraded stimulus produced correct
*diagnoses* in the Info tab (strong color cast, crushed shadows) but "Suggest
something" returned *aesthetic grades* (Complementary, Teal & orange). Root
cause, confirmed from session journals: the augment LLM scores severity
conservatively (0.35 for an objectively heavy 0.46 cast), the suggestion gate
dropped anything < 0.5, and a fallback "image-character" pass then filled the
card quota with grades matched to `grade_character`.

**Phase A — severity grounding** (`4823097`).
- New `backend/app/services/severity_grounding.py`: `ground_problem_severities`
  raises an *already-detected* problem's severity to a floor derived from the
  mechanical cheap-pass (`cast_strength`, `clipped_*_pct`, `median_luma`,
  region `mean_luma`, `contrast_p10_p90`). One-directional (`max(llm, floor)`),
  never invents a problem, leaves judgement-only kinds untouched.
- Applied in `build_enriched` (`backend/app/tools/atomic/_analyze_phases.py`)
  so the Info tab badge, the suggestion gate, the journal, and any prompt that
  echoes context all read the **same** grounded number.
- Gate lowered `0.5 → 0.4` (`SEVERITY_GATE`, now module-scope in
  `autonomous_suggestions.py`). The floor, not the gate, is what stops a
  conservative LLM score from hiding a real defect.
- `_AUGMENT_PROMPT` rewritten: for measurable kinds it delegates magnitude to
  the mechanical anchors and asks the model to score by *importance* (subject
  vs corner), with worked examples.

**Phase B — suggestion behavior** (`4e83670`).
- **Top-up guard:** while any corrective problem (`_CORRECTIVE_KINDS`) at
  severity ≥ 0.35 is unresolved, the aesthetic image-character top-up is
  suppressed (journal `topup_skipped / open_corrective_problems`). A damaged
  image gets corrections or fewer cards, never decoration.
- **Measurement-aimed params:** the fused-resolve prompt now tells the model to
  *derive* corrective params from the measured `context_summary`
  (`cast_direction`, `estimated_white_point`, luma gap) instead of
  re-estimating the defect from the thumbnail.

**Phase C — self-verification** (`6fdf4f1`).
- New `backend/app/services/suggestion_verification.py`. After a corrective
  suggestion resolves, its params are applied through the CPU preview on a
  downscale, the cheap pass is recomputed, and the problem's own metric must
  have moved the right way (cast_strength drop ≥ 20 %, median toward mid,
  clip % shrink ≥ 25 %, contrast widen). On failure it re-resolves **once** with
  concrete feedback and keeps the retry only if it verifies; unsupported /
  unverifiable widgets skip. Every outcome journaled
  (`verify_ok|failed|retry_ok|retry_failed|skipped|error`).
- **Latent bug fixed here:** the CPU preview (`preview_renderer.py`) read empty
  `node.params` for fused widgets and so was a silent no-op for *all* of them —
  the existing `preview_widget` tool included. `render_widget_*` now project
  binding values onto their target node params (`_effective_params`).

**Phase D — eval harness** (`4a83de8`).
- `backend/app/services/analysis_eval.py` (`evaluate_rgb`, `floors_from_cheap`)
  reports cheap-pass signals + the mechanical floor each measurable kind would
  receive. `SEVERITY_GATE` hoisted to module scope as the single source.
- CI tier `backend/tests/eval/test_analysis_eval.py`: synthesized planted
  defects clear the gate, a clean frame stays quiet.
- Manual tool `scripts/eval-analysis.py`: runs `(original, degraded)` pairs
  through the real develop path; free mechanical tier + env-gated (`--llm`) LLM
  tier. Detectability counts *newly-tripped or intensified* floors.
- **Verified on the real 2026-07-10 stimuli:** a0197 newly trips
  crushed_shadows + underexposure; a0151 (naturally dark/blue) intensifies its
  existing cast floor 0.46 → 0.64 — quantifying that naturally-defective scenes
  signal via intensification, not a fresh threshold.

## 2 · Per-problem Correct button + auto-analyze on load (on main)

- **Auto-analyze on load + bulb-first image-node header** (`e020e07`, spec
  `d114c37`): opening an image kicks off analysis automatically; the image-node
  header leads with the analysis bulb.
- **Per-problem Correct button, masked element thumbnails, icon cleanup**
  (`4d8d328`): each problem in the Info tab's Problems section gets its own
  "Correct" action (`ProblemsSection.tsx`), region thumbnails show the masked
  element, and an icon pass. This is the surface §1 feeds — Correct now mints a
  grounded, verified corrective suggestion.

## 3 · TIFF support + physically-correct white balance (branch only)

**TIFF open path** (in `4823097`'s raw-decode changes + `open-file`/`raw-image`):
- Chromium can't decode TIFF at all (`createImageBitmap` throws
  `InvalidStateError`), so `.tif/.tiff` now ride the RAW develop transport.
  `needsBackendDevelop()` (RAW ∪ TIFF) replaces `isRawFile` at the open/drop
  call sites (`src/lib/open-file.ts`, `raw-image.ts` + `raw-image.test.ts`).
- Backend `develop_raw_to_png16` / `develop_raw_to_jpeg` fall back to a direct
  TIFF decode **after** LibRaw declines *and* the bytes carry TIFF magic
  (RAW files are TIFF containers, so ordering matters). Handles 8/16-bit and
  float/HDR TIFFs (clip to [0,1]), grayscale/alpha normalized. Tests in
  `test_raw_decode.py` / `test_raw_develop.py`.

**Linear-space white balance** (`src/shaders/color-space.glsl.ts`,
`kelvin.glsl.ts`): the WB multiply now happens in linear light —
`srgbTransferSnippet` (piecewise IEC sRGB↔linear) is applied around the
multiply, and the Kelvin multiplier is itself linearized. Corrects the
gamma-domain hue-twist on strong corrections; midtones unchanged so existing
edits don't jump. Shader verified with `glslangValidator`.

## 4 · As-shot white balance for RAW — design only (branch only)

Spec `docs/superpowers/specs/2026-07-10-as-shot-white-balance-design.md`
(`0409f59`). Backend-owned plan: extract camera WB → Kelvin/tint at develop
time, flow it into the session, spawn the WB widget at the as-shot position
(neutral = as-shot) on all three spawn paths. **Not implemented** — spec
awaiting review. Once landed, develop metadata becomes extra grounding
evidence for §1.

## 5 · Objects / copy / clone + suggestion correctness (on main)

- **Object-scoped suggest on cutouts; manual copies keep pending clones**
  (`87462a3`), and the fix that pending suggestions no longer materialize as
  widgets on cutouts (`08a943f`).
- **Re-scope region/mask widgets to global when copying layer edits**
  (`ab7893e`).
- **Back-to-back accepts extract from the suggestion's source node**
  (`f75707f`).
- **Single-flight chip accept; disambiguate colliding binding labels**
  (`5df8fd2`).
- **Extracted image nodes adopt the mask's label as their name** (`635026c`).

## 6 · SSE / multi-layer / optimistic-preview correctness (branch, bundled)

*Pre-existing WIP absorbed into `4823097`/`6fdf4f1` — not authored with §1.*
- `WidgetShell.tsx`: optimistic overrides now fan out to **every** target layer
  in a widget's replicate set (`canonIdsFor`, mirroring `widgetTargetLayerIds`),
  not just the frozen singular `layerId`; a multi-layer widget previews live on
  all layers it edits. Row rendering extracted to `renderBindingRow`, and
  curves widgets now render their non-curve "extras" (e.g. teal_orange's
  saturation slider) instead of dropping them (`CurvesWidgetBody.isCurveBinding`).
- `backend-state-slice.ts`: snapshot-refetch guard keyed by session id (not a
  bare boolean) so a fast image-swap isn't suppressed; provisional snapshot
  stubs stay at revision 0 so the authoritative REST fetch isn't rejected by
  the floor guard; `applyOptimistic` merges + rebases instead of replacing
  (no partial-reset flash mid-drag); undo/redo reconciles tether mirror via
  `syncWidgetTethers`; module sync guards cleared on close; `runClientTool`
  splits invoke from result-post.
- `useBackendSession.ts`: guard the SSE open against a cleaned-up effect after
  the async session probe (no orphaned handle).
- `GenfillWidgetBody.tsx`: `mountedRef` guard on trailing `setState` (genfill
  widgets are torn down by an SSE echo right after accept/regenerate).

## 7 · Backend robustness & security hardening (branch, bundled)

*Pre-existing WIP absorbed into `4823097` — not authored with §1.*
- `disk_session_io.py`: **path-traversal guard** on session ids (`_SAFE_SID_RE`)
  and **atomic writes** (`_atomic_write_text` via temp + `os.replace`) for
  meta/context so a crash can't leave corrupt JSON.
- `image_validation.py` + `session.py`: `reject_oversize_content_length` —
  cheap pre-read `Content-Length` OOM backstop (413) before buffering the body.
- `segment.py`: SAM embed/decode + JPEG encode moved off the event loop
  (`asyncio.to_thread`) so one embed can't freeze other requests / SSE.
- `tools/registry.py`: **query tools now take the document lock** — a read that
  projects the graph or iterates widgets/canonical could otherwise tear against
  a concurrent mutate ("dict changed size during iteration").
- `session_store.py`: prefer `get_running_loop`, fall back for sync unit tests.

## 8 · Workspace geometry / drafting perf + cleanup (branch, bundled)

*Pre-existing WIP absorbed into `4823097` — not authored with §1.*
- `image-node-geometry.ts`: **identity-geometry fast path** — an untransformed
  image (no rotate/flip/crop) skips the full-size working-canvas allocation +
  rotate pass that otherwise ran and was GC'd on every composite (every slider
  tick / zoom frame).
- `ImageNodeDrafting.tsx`, `CanvasWorkspace.tsx` simplified; dead
  `SegmentHitLayer.tsx` / `workspace-drag.ts` paths removed; `CropTab.tsx`
  tightened; small `index.css` + `document.ts` touch-ups.

## 9 · Render/perf + misc fixes (on main)

- **Coalesce composites to frame rate; memoize curve LUTs** (`7b4be8a`).
- **Keep big-image first paint off the plumbing's critical path** (`1892a62`).
- **Apply widgets before merging visible layers** — no more zombie widgets on
  merge (`b7e49b2`).
- **AI single-luma curve editor no longer snaps to stale backend values**
  (`db7e979`).
- **Palette prompt input wraps instead of scrolling horizontally** (`c627bfd`).
- **Reset segmentation client caches on document close/open** — stale SAM masks
  (`59ea3dd`).

## 10 · Tooling & docs

- `scripts/degrade-dng.py` (branch): generate corrective-task study stimuli by
  editing DNG develop metadata (`AsShotNeutral`, `LinearizationTable`,
  `BlackLevel`) + `--patch-thumbnail` so Finder/Quick Look icons show the
  degraded look. Calibrated recipes + correction-ceiling warning in the
  docstring. Needs `exiftool`.
- `scripts/eval-analysis.py` (branch): see §1 Phase D.
- Docs: the 07-08 handover + onboarding tutorial-video script (`ca609a9`, on
  main); two new specs (§1, §4).

---

## Commit-hygiene note (action suggested)

The four branch commits `4823097 4e83670 6fdf4f1 4a83de8` were meant to be
§1 only, but `4823097` (Phase A) was staged with `git add -A` and swept in the
§6–§8 WIP that happened to be uncommitted in the tree. Consequences:
- Those clusters have no descriptive commit message of their own.
- `4823097`'s diff is a grab-bag (grounding + TIFF + WB + SSE + security +
  workspace perf).

If a clean history matters before merging, the branch should be rebased to
split `4823097` into: (a) severity grounding + gate + prompt, (b) TIFF + linear
WB, (c) the SSE/multi-layer cluster, (d) the backend-hardening cluster, (e) the
workspace-perf cluster. Nothing is lost — the working tree is clean and all
907 backend + 1343 frontend tests pass; this is purely narrative hygiene.

## Chronological commit index (`b1e3c7e..HEAD`, oldest first)

```
d114c37 docs(spec): auto-analyze on load + bulb-first image node header
e020e07 feat(ai): auto-analyze on image load; bulb-first image node header
635026c feat(objects): extracted image nodes adopt the mask's label as their name
c627bfd fix(palette): prompt input wraps instead of scrolling horizontally
59ea3dd fix(segmentation): reset client caches on document close/open — stale SAM masks
5df8fd2 fix(suggestions): single-flight chip accept; disambiguate colliding binding labels
1892a62 perf(open): keep big-image first paint off the plumbing's critical path
ab7893e fix(clone): re-scope region/mask widgets to global when copying layer edits
08a943f fix(clone): pending suggestions no longer materialize as widgets on cutouts
87462a3 feat(objects): manual copies keep pending clones; object-scoped suggest on cutouts
7b4be8a perf(render): coalesce composites to frame rate; memoize curve LUTs
db7e979 fix(curves): AI single-luma curve editor no longer snaps to stale backend values
f75707f fix(suggestions): back-to-back accepts extract from the suggestion's source node
b7e49b2 fix(merge): apply widgets before merging visible layers — no more zombie widgets
4d8d328 feat(info): per-problem Correct button; masked element thumbnails; icon cleanup
ca609a9 feat(docs): add recent changes handover and onboarding tutorial video script   [main tip]
--- feat/grounded-verified-suggestions branch below ---
0409f59 docs(spec): as-shot white balance for RAW — backend-owned design
b8dd352 docs(spec): grounded, verified AI suggestions
4823097 feat(analyze): ground problem severities  [+ bundled TIFF/WB/§6–§8 WIP]
4e83670 feat(suggestions): guard aesthetic top-up + measurement-derived params
6fdf4f1 feat(suggestions): self-verify corrective suggestions via CPU preview
4a83de8 feat(eval): ground-truth analysis eval harness (CI tier + manual script)
```
