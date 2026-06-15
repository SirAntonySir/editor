# Fused-Tool `resolve()` Override Removal (H21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "17+ fused-tool files share the same skeleton" finding (H21) by extending the base `FusedToolTemplate.resolve()` to handle dotted-path `context_inputs`, then deleting the 9 redundant override implementations (plus their copy-pasted `_RESPONSE_SCHEMA` constants). Net: ~450 lines removed, one resolver implementation instead of 10.

**Architecture:** Research showed only 9 of 17 fused tools override `resolve()`. The other 8 (`contrast`, `atmospheres`, `moods`, `light_surgery`, `finishing`, `colour_theory`, `bw_variants`, `tone_band`) already use the base-class default `FusedToolTemplate.resolve()` — which auto-generates the same `_RESPONSE_SCHEMA` from `param_envelope.keys()` and serializes `context_inputs` via `getattr(ctx, k, None) + _serialize_for_payload`. Each of the 9 overrides falls into one of three categories: (a) scalar-only fields that match the base verbatim (`exposure_balance`, `cast_correct`, `teal_orange`); (b) dotted-path `context_inputs` like `"region_stats.contrast_p10_p90"` that the base can't handle today (`subject_pop`, `sky_recovery`, `portrait_glow`); (c) overrides that drop a field from `context_inputs` — likely accidental or stale (`warm_grade`, `cool_grade`, `bw_cinematic`). The plan: extend the base to support dotted paths (so category b can drop overrides); align `context_inputs` to match each "drop" override (so category c can also drop); then delete all 9 overrides + their `_RESPONSE_SCHEMA` constants.

**Tech Stack:** Python 3.12 + Pydantic v2 + pytest. Backend only.

---

## File Structure

**Modify:**
- `backend/app/tools/fused_framework.py` — extend `FusedToolTemplate.resolve()` to support dotted-path `context_inputs` (grouped by container).
- `backend/app/tools/fused/exposure_balance.py` — delete override + `_RESPONSE_SCHEMA`.
- `backend/app/tools/fused/cast_correct.py` — delete override + `_RESPONSE_SCHEMA`.
- `backend/app/tools/fused/teal_orange.py` — delete override + `_RESPONSE_SCHEMA`.
- `backend/app/tools/fused/subject_pop.py` — delete override + `_RESPONSE_SCHEMA`.
- `backend/app/tools/fused/sky_recovery.py` — delete override + `_RESPONSE_SCHEMA`.
- `backend/app/tools/fused/portrait_glow.py` — delete override + `_RESPONSE_SCHEMA`.
- `backend/app/tools/fused/warm_grade.py` — delete override + `_RESPONSE_SCHEMA` + align `context_inputs` (drop `"region_stats.mean_rgb"`).
- `backend/app/tools/fused/cool_grade.py` — same as warm_grade.
- `backend/app/tools/fused/bw_cinematic.py` — delete override + `_RESPONSE_SCHEMA` + align `context_inputs` (drop `"contrast_p10_p90"`).

**Create:**
- `backend/tests/tools/test_fused_framework_resolve.py` — unit tests for the enhanced base class (flat-only, dotted-only, mixed, missing-field cases).

**Not changed:**
- `fused_tool_framework.py`'s public surface (the `resolve()` signature is unchanged).
- The 8 fused tools that already use the base default.
- Call sites of `run_fused_tool` (the public entry point — no behavioural change visible to callers).
- The on-wire shape of `prompt_payload`'s `context_summary` is preserved on a per-tool basis: for files that the override matches the base verbatim, the payload is byte-identical; for the 3 "drop" files, the on-wire payload becomes what the override was already sending.

---

## Doctrine — anchor in the framework module

> `FusedToolTemplate.resolve()` is the single resolver implementation. Each subclass declares WHAT data it wants via `context_inputs` (flat field names or `container.field` dotted paths) and WHICH params it tunes via `param_envelope`. The base class derives the response schema from `param_envelope.keys()` and serializes `context_inputs` via `_serialize_for_payload`. Overriding `resolve()` is ONLY justified when (a) the response schema can't be number-only (e.g. curve points — see `colour_theory`-pattern templates that don't override today either, suggesting even this case is rare) or (b) the template needs to inject data that isn't a `ctx` attribute. New templates should not add a `_RESPONSE_SCHEMA` constant or override `resolve()` unless one of those two reasons applies.

---

### Task 1: Extend base `FusedToolTemplate.resolve()` with dotted-path support + unit tests

Today the base resolver does `summary[k] = _serialize_for_payload(getattr(ctx, k, None))`. For `context_inputs = ["region_stats.contrast_p10_p90", "region_stats.is_skin_likely"]`, `getattr(ctx, "region_stats.contrast_p10_p90", None)` returns `None` — the dotted form isn't honoured. The 3 region-stats-using tools work around this with their own `resolve()` override.

We extend the base to parse `context_inputs` into:
- Flat keys (no dot): existing behaviour.
- Dotted keys (one dot, `container.field`): group all dotted keys by container, look up `ctx.<container>` (expected to be a list), and emit `summary[container] = [{ "label": entry.label, **{field: getattr(entry, field, None) for field in fields_for(container)} }]`.

Mixed flat + dotted lists work naturally.

**Files:**
- Modify: `backend/app/tools/fused_framework.py`
- Test: `backend/tests/tools/test_fused_framework_resolve.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/tools/test_fused_framework_resolve.py` with EXACTLY this content:

```python
"""Unit tests for FusedToolTemplate.resolve()'s context-summary assembly.

The base resolver derives prompt_payload['context_summary'] from
context_inputs: flat keys come from `getattr(ctx, key, None)`; dotted
keys `container.field` get grouped under their container into a list
of {label, field1, field2, ...} dicts per entry."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from app.schemas.widget import Scope
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
    ResolvedNumbers,
)


class _StubCtx(BaseModel):
    """Minimal stand-in for EnrichedImageContext. Pydantic ensures
    attribute access works through model_dump."""
    cast_direction: list[float] = [0.1, 0.2]
    wb_neutral_confidence: float = 0.8
    model_version: str = "v"
    region_stats: list[Any] = []


class _RegionStat(BaseModel):
    label: str
    contrast_p10_p90: float
    is_skin_likely: bool
    mean_rgb: list[float]


class _SimpleTemplate(FusedToolTemplate):
    """Concrete template that exercises only param_envelope + context_inputs."""
    id = "_t"
    label = "Test"
    description = ""
    typical_use = ""
    node_skeleton = [NodeSkeleton(node_type="basic", fixed_params={}, tunable_param_keys=["a"])]
    bindings_skeleton: list[BindingSkeleton] = []
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {"a": ParamRange(min=0, max=10, step=1)}
    safety: dict[str, Any] = {}
    context_inputs: list[str] = []


def _capture_payload() -> dict:
    """Return a MagicMock whose `resolve_fused_tool` records its
    prompt_payload kwarg and returns a valid ResolvedNumbers."""
    captured: dict[str, Any] = {}

    def _capture(template_id: str, prompt_payload: dict, response_schema: dict, session_id: str | None):
        captured["payload"] = prompt_payload
        captured["schema"] = response_schema
        return {"values": {"a": 5.0}}

    client = MagicMock()
    client.resolve_fused_tool = MagicMock(side_effect=_capture)
    return client, captured


@pytest.mark.asyncio
async def test_flat_context_inputs_passes_through_via_getattr():
    class T(_SimpleTemplate):
        context_inputs = ["cast_direction", "wb_neutral_confidence"]

    ctx = _StubCtx()
    scope = Scope.model_validate({"root": {"kind": "global"}})
    client, captured = _capture_payload()
    result = await T().resolve("intent", scope, ctx, None, None, client)

    assert isinstance(result, ResolvedNumbers)
    assert captured["payload"]["context_summary"] == {
        "cast_direction": [0.1, 0.2],
        "wb_neutral_confidence": 0.8,
    }


@pytest.mark.asyncio
async def test_dotted_context_inputs_slice_container_entries():
    class T(_SimpleTemplate):
        context_inputs = ["region_stats.contrast_p10_p90", "region_stats.is_skin_likely"]

    ctx = _StubCtx(region_stats=[
        _RegionStat(label="sky", contrast_p10_p90=0.4, is_skin_likely=False, mean_rgb=[120, 130, 200]),
        _RegionStat(label="face", contrast_p10_p90=0.6, is_skin_likely=True, mean_rgb=[220, 180, 160]),
    ])
    scope = Scope.model_validate({"root": {"kind": "global"}})
    client, captured = _capture_payload()
    await T().resolve("intent", scope, ctx, None, None, client)

    assert captured["payload"]["context_summary"] == {
        "region_stats": [
            {"label": "sky", "contrast_p10_p90": 0.4, "is_skin_likely": False},
            {"label": "face", "contrast_p10_p90": 0.6, "is_skin_likely": True},
        ],
    }


@pytest.mark.asyncio
async def test_mixed_flat_and_dotted_context_inputs():
    class T(_SimpleTemplate):
        context_inputs = ["wb_neutral_confidence", "region_stats.contrast_p10_p90"]

    ctx = _StubCtx(
        wb_neutral_confidence=0.5,
        region_stats=[_RegionStat(label="sky", contrast_p10_p90=0.4, is_skin_likely=False, mean_rgb=[0, 0, 0])],
    )
    scope = Scope.model_validate({"root": {"kind": "global"}})
    client, captured = _capture_payload()
    await T().resolve("intent", scope, ctx, None, None, client)

    assert captured["payload"]["context_summary"] == {
        "wb_neutral_confidence": 0.5,
        "region_stats": [{"label": "sky", "contrast_p10_p90": 0.4}],
    }


@pytest.mark.asyncio
async def test_dotted_inputs_with_empty_container_yields_empty_list():
    class T(_SimpleTemplate):
        context_inputs = ["region_stats.contrast_p10_p90"]

    ctx = _StubCtx(region_stats=[])
    scope = Scope.model_validate({"root": {"kind": "global"}})
    client, captured = _capture_payload()
    await T().resolve("intent", scope, ctx, None, None, client)

    assert captured["payload"]["context_summary"] == {"region_stats": []}


@pytest.mark.asyncio
async def test_dotted_inputs_omit_label_when_entry_has_no_label_attr():
    """Defensive: not every container element is guaranteed to have a `label`.
    If absent, the per-entry dict only carries the requested fields."""
    class _NoLabel(BaseModel):
        contrast_p10_p90: float

    class T(_SimpleTemplate):
        context_inputs = ["region_stats.contrast_p10_p90"]

    ctx = _StubCtx(region_stats=[_NoLabel(contrast_p10_p90=0.3)])
    scope = Scope.model_validate({"root": {"kind": "global"}})
    client, captured = _capture_payload()
    await T().resolve("intent", scope, ctx, None, None, client)

    assert captured["payload"]["context_summary"] == {
        "region_stats": [{"contrast_p10_p90": 0.3}],
    }


@pytest.mark.asyncio
async def test_response_schema_derived_from_param_envelope_keys():
    class T(_SimpleTemplate):
        param_envelope = {
            "a": ParamRange(min=0, max=10, step=1),
            "b": ParamRange(min=-1, max=1, step=0.1),
        }

    ctx = _StubCtx()
    scope = Scope.model_validate({"root": {"kind": "global"}})
    client, captured = _capture_payload()
    # The MagicMock side_effect returns {"values": {"a": 5}}; the schema check
    # is what we care about. Validate the schema separately.
    client.resolve_fused_tool.side_effect = lambda **kw: {"values": {"a": 5.0, "b": 0.1}}
    await T().resolve("intent", scope, ctx, None, None, client)

    schema = captured["schema"]
    assert sorted(schema["properties"]["values"]["required"]) == ["a", "b"]
    assert set(schema["properties"]["values"]["properties"].keys()) == {"a", "b"}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && .venv/bin/pytest tests/tools/test_fused_framework_resolve.py -v
```

Expected: `test_dotted_context_inputs_slice_container_entries`, `test_mixed_flat_and_dotted_context_inputs`, `test_dotted_inputs_with_empty_container_yields_empty_list`, `test_dotted_inputs_omit_label_when_entry_has_no_label_attr` all FAIL (today's base treats dotted keys as opaque getattr lookups returning None). The flat-only and schema tests should pass.

- [ ] **Step 3: Implement the dotted-path support**

Edit `backend/app/tools/fused_framework.py`. Replace the entire `FusedToolTemplate.resolve()` method body (currently lines 80-132) with:

```python
    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        """Default resolver: numeric-values-only schema generated from
        `param_envelope`, prompt payload assembled from `context_inputs`.

        `context_inputs` entries take two shapes:
          - `"field"`  → flat attr on ctx; emitted as `summary[field] = ctx.field`.
          - `"container.field"`  → entries of `ctx.container` (a list) sliced to
            `{label, field, ...}` per entry. Multiple dotted keys sharing the
            same container are grouped, so the LLM sees one list per container
            with all the requested fields side-by-side.

        Subclasses override only when they need a non-numeric schema (e.g.
        curve points) or unusual prompt shaping that isn't expressible via
        `context_inputs`. Adding a `_RESPONSE_SCHEMA` constant + an override
        that just reformats `context_inputs` is a code smell — extend the
        base resolver instead."""
        required_keys = list(self.param_envelope.keys())
        response_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["values"],
            "properties": {
                "values": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": required_keys,
                    "properties": {k: {"type": "number"} for k in required_keys},
                },
                "reasoning": {"type": "string"},
            },
        }
        context_summary = self._build_context_summary(ctx)
        prompt_payload = {
            "intent": intent,
            "scope": scope.model_dump(mode="json", by_alias=True),
            "context_summary": context_summary,
            "prior_widget_values": (
                {b.param_key: b.value for b in prior_widget.bindings}
                if prior_widget is not None else None
            ),
            "instruction": instruction,
        }
        try:
            raw = anthropic.resolve_fused_tool(
                template_id=self.id,
                prompt_payload=prompt_payload,
                response_schema=response_schema,
                session_id=getattr(ctx, "model_version", None),
            )
        except Exception as exc:
            raise ResolverError(str(exc)) from exc
        return ResolvedNumbers.model_validate(raw)

    def _build_context_summary(self, ctx: EnrichedImageContext) -> dict[str, Any]:
        """Assemble the `context_summary` dict from `self.context_inputs`.

        Flat keys: `getattr(ctx, key, None)` → serialise.
        Dotted keys `container.field`: group by container, look up
        `ctx.<container>` as a list, emit one dict per entry containing
        `label` (if present) plus each requested field."""
        flat: list[str] = []
        dotted: dict[str, list[str]] = {}  # container → [field, ...]
        for entry in self.context_inputs:
            if "." in entry:
                container, _, field = entry.partition(".")
                dotted.setdefault(container, []).append(field)
            else:
                flat.append(entry)

        summary: dict[str, Any] = {}
        for k in flat:
            summary[k] = _serialize_for_payload(getattr(ctx, k, None))
        for container, fields in dotted.items():
            entries = getattr(ctx, container, None) or []
            sliced = []
            for entry in entries:
                row: dict[str, Any] = {}
                label = getattr(entry, "label", None)
                if label is not None:
                    row["label"] = label
                for f in fields:
                    row[f] = _serialize_for_payload(getattr(entry, f, None))
                sliced.append(row)
            summary[container] = sliced
        return summary
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
cd backend && .venv/bin/pytest tests/tools/test_fused_framework_resolve.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Run the full backend suite to confirm no regression**

```bash
cd backend && .venv/bin/pytest tests/ -q
```

Expected: all green (existing tests untouched; 631+ now that we added 6).

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/tools/fused_framework.py backend/tests/tools/test_fused_framework_resolve.py
git commit -m "feat(fused): base resolve() supports dotted-path context_inputs"
```

---

### Task 2: Delete the 6 "matches base verbatim (after Task 1)" overrides

After Task 1, six override files produce a `prompt_payload` byte-identical to what the enhanced base default would produce. Delete each override + its `_RESPONSE_SCHEMA` constant; verify the test suite stays green.

**Files:**
- Modify: `backend/app/tools/fused/exposure_balance.py`
- Modify: `backend/app/tools/fused/cast_correct.py`
- Modify: `backend/app/tools/fused/teal_orange.py`
- Modify: `backend/app/tools/fused/subject_pop.py`
- Modify: `backend/app/tools/fused/sky_recovery.py`
- Modify: `backend/app/tools/fused/portrait_glow.py`

For EACH file (do them in this order so the commit stays small per file):

- [ ] **Step 1: Delete the override + `_RESPONSE_SCHEMA` from the file**

In each file:
1. Delete the entire `_RESPONSE_SCHEMA = { ... }` constant at the top (typically lines 17-34).
2. Delete the entire `async def resolve(...)` method on the template class (typically the last ~30-40 lines of the class).
3. Clean up imports: drop `from app.schemas.enriched_context import EnrichedImageContext`, `from app.schemas.widget import ..., Scope, Widget` (where Scope and Widget were only used in `resolve`'s signature), `from app.tools.fused_framework import ResolverError, ResolvedNumbers` (only the override used these). Use ruff or eyeballed greps to confirm.
4. Drop `from typing import Any` if it was only used in the override signature.

The resulting file should still have: `ControlSchema`, `NodeParamTarget` (used by `BindingSkeleton`), `BindingSkeleton`, `FusedToolTemplate`, `NodeSkeleton`, `ParamRange` imports. Verify by reading the post-edit file.

- [ ] **Step 2: Run the targeted tests for that template (if any) + the broader suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/tools/ -q
```

Expected: all green. Particularly watch for tests in `tests/tools/test_fused_framework.py` and `tests/registry/test_propose_stack.py` which exercise the fused-template flow end-to-end.

- [ ] **Step 3: Commit (one per file, six commits in this task)**

For each file:
```bash
git add backend/app/tools/fused/<filename>.py
git commit -m "refactor(fused): drop redundant resolve override in <filename>"
```

Order: `exposure_balance.py`, `cast_correct.py`, `teal_orange.py`, `subject_pop.py`, `sky_recovery.py`, `portrait_glow.py`.

After all six commits, run `cd backend && .venv/bin/pytest tests/ -q` and confirm all-green.

---

### Task 3: Align `context_inputs` + delete overrides in the 3 "drop a field" files

Three files have an override that omits one or more entries declared in `context_inputs`. The discrepancy is most likely accidental copy-paste rot — `context_inputs` was extended but the override wasn't updated, or vice versa. Since the override is what actually flies on the wire to the LLM today, treat it as the source of truth and align `context_inputs` to match.

| File | `context_inputs` declares | override sends | drop |
|---|---|---|---|
| `warm_grade.py` | cast_direction, wb_neutral_confidence, region_stats.mean_rgb, grade_character | cast_direction, wb_neutral_confidence, grade_character | `region_stats.mean_rgb` |
| `cool_grade.py` | cast_direction, wb_neutral_confidence, region_stats.mean_rgb, grade_character | cast_direction, wb_neutral_confidence, grade_character | `region_stats.mean_rgb` |
| `bw_cinematic.py` | contrast_p10_p90, luma_histogram | luma_histogram | `contrast_p10_p90` |

**Files:**
- Modify: `backend/app/tools/fused/warm_grade.py`
- Modify: `backend/app/tools/fused/cool_grade.py`
- Modify: `backend/app/tools/fused/bw_cinematic.py`

For EACH file:

- [ ] **Step 1: Align `context_inputs` to the override**

In `warm_grade.py` and `cool_grade.py`, change:

```python
    context_inputs = ["cast_direction", "wb_neutral_confidence", "region_stats.mean_rgb", "grade_character"]
```

to:

```python
    context_inputs = ["cast_direction", "wb_neutral_confidence", "grade_character"]
```

In `bw_cinematic.py`, change:

```python
    context_inputs = ["contrast_p10_p90", "luma_histogram"]
```

to:

```python
    context_inputs = ["luma_histogram"]
```

- [ ] **Step 2: Delete the override + `_RESPONSE_SCHEMA` (same pattern as Task 2 Step 1)**

For each of the three files, delete `_RESPONSE_SCHEMA` and the entire `async def resolve(...)` method, plus the imports that were only used by the override.

- [ ] **Step 3: Run tests**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/ -q
```

Expected: all green.

- [ ] **Step 4: Commit (one per file)**

```bash
git add backend/app/tools/fused/warm_grade.py
git commit -m "refactor(fused): align warm_grade context_inputs + drop resolve override"
```

```bash
git add backend/app/tools/fused/cool_grade.py
git commit -m "refactor(fused): align cool_grade context_inputs + drop resolve override"
```

```bash
git add backend/app/tools/fused/bw_cinematic.py
git commit -m "refactor(fused): align bw_cinematic context_inputs + drop resolve override"
```

---

### Task 4: Update the audit doc

`docs/audit-2026-06-15.md` carries the H21 status. Flip it to resolved and link the commit range.

**Files:**
- Modify: `docs/audit-2026-06-15.md`

- [ ] **Step 1: Edit the H21 entry**

Find the line under "### Duplication / Architecture":

```markdown
- [ ] **H21** — **17+ fused-tool files share the same skeleton** in `backend/app/tools/fused/*.py` (`_RESPONSE_SCHEMA`, identical `resolve()` calling `anthropic.resolve_fused_tool`). A `SimpleFusedTemplate` base would delete ~1200 lines.
```

Replace with:

```markdown
- [x] **H21** — **17+ fused-tool files share the same skeleton** in `backend/app/tools/fused/*.py` (`_RESPONSE_SCHEMA`, identical `resolve()` calling `anthropic.resolve_fused_tool`). **Fix landed:** research showed only 9 of 17 files actually had the override; the base `FusedToolTemplate.resolve()` already auto-generated the same `_RESPONSE_SCHEMA` from `param_envelope.keys()`. Extended the base to also support dotted-path `context_inputs` (`region_stats.foo`); deleted the 9 overrides + their `_RESPONSE_SCHEMA` constants; aligned `context_inputs` in 3 files (`warm_grade`, `cool_grade`, `bw_cinematic`) to match what the override was actually sending. Net: one resolver implementation instead of ten.
```

- [ ] **Step 2: Update the progress snapshot near the top**

Find:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 9 resolved (17 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Replace with:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 10 resolved (16 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add docs/audit-2026-06-15.md
git commit -m "docs(audit): mark H21 (fused-tool resolve dedup) resolved"
```

---

## Self-Review

**Spec coverage:**

| Audit finding | Addressed in |
|---|---|
| H21 — 17+ fused tools share the same skeleton | Task 1 (base extension) + Task 2 (6 trivial deletions) + Task 3 (3 align + delete) + Task 4 (audit doc) |

H21 is the only finding this plan targets.

**Behavioural preservation matrix:**

| File | Pre-plan `prompt_payload.context_summary` | Post-plan `prompt_payload.context_summary` | Behavioural diff |
|---|---|---|---|
| `exposure_balance` | {luma_histogram, clipped_shadows_pct, clipped_highlights_pct, median_luma} | identical via base default | none |
| `cast_correct` | {estimated_white_point, cast_direction, wb_neutral_confidence} | identical via base default | none |
| `teal_orange` | {grade_character, color_palette: [s.model_dump()...]} | identical via base default + `_serialize_for_payload` | none |
| `subject_pop` | {region_stats: [{label, contrast_p10_p90, is_skin_likely}, ...]} | identical via Task 1 dotted-path | none |
| `sky_recovery` | {clipped_highlights_pct, region_stats: [{label, dominant_swatches, is_sky_likely}, ...]} | identical via Task 1 dotted-path | none |
| `portrait_glow` | {region_stats: [{label, is_skin_likely, mean_luma, dominant_swatches}, ...]} | identical via Task 1 dotted-path | none |
| `warm_grade` | {cast_direction, wb_neutral_confidence, grade_character} (override drops mean_rgb) | identical (context_inputs aligned to match) | none (the dropped field was never sent anyway) |
| `cool_grade` | same as warm_grade | identical | none |
| `bw_cinematic` | {luma_histogram} (override drops contrast_p10_p90) | identical | none |

Every file lands at byte-identical (modulo key order) on-wire payload. No LLM-facing behaviour change.

**Placeholder scan:** none. Every step has full code; tests are runnable as written.

**Type consistency:** `_build_context_summary` introduced in Task 1 is called from `resolve` in the same patch. Both `FusedToolTemplate` and the existing helpers are unchanged in signature.

**Risk analysis:**
- Tests for each migrated tool already exist in `tests/tools/` (per-tool tests live there). Each per-file deletion runs the full suite — a regression in any tool's behaviour surfaces immediately.
- The dotted-path enhancement is additive — files without dotted entries get the same flat behaviour as today.
- The `_serialize_for_payload` helper handles Pydantic models, lists, and scalars — covers all the field types `context_inputs` references.
- One subtle edge: `region_stats` is a list of `RegionStat` Pydantic models. The base resolver now does `getattr(entry, f, None)` and feeds the result through `_serialize_for_payload`. For scalar fields this is fine; for nested model fields (e.g. `dominant_swatches: list[Swatch]`), `_serialize_for_payload` correctly recurses. Verified mentally; tests in Task 1 cover the scalar and missing-attr cases.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-fused-tool-resolve-removal.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
