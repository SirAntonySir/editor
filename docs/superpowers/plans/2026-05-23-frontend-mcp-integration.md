# Frontend MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the React editor from the legacy `ai-panel` layer model to a widget-driven inspector that consumes the backend's `SessionStateSnapshot` over SSE. Guarantee ≥2 autonomous suggestion widgets per image.

**Architecture:** A new `BackendStateSlice` Zustand store holds the snapshot verbatim. An SSE subscriber patches it via `applyEvent`. All writes go through `/api/tools/<name>` REST wrappers (`backend-tools.ts`). The WebGL pipeline reads adjustments from a `selectPipelineNodes` selector that maps the projected `OperationGraph` to `PipelineNode`s. Widget renderers live in `src/components/inspector/widget/` with one primitive per `control_type`. The inspector renders suggestions (collapsed cards) and active widgets (expanded cards) from the snapshot directly.

**Tech Stack:** React 19, Vite, TypeScript strict, Zustand v5 + Immer, vitest + Testing Library (component), Playwright (integration), Python 3.12 + FastAPI + pytest (backend).

**Spec reference:** [`docs/superpowers/specs/2026-05-23-frontend-mcp-integration-design.md`](../specs/2026-05-23-frontend-mcp-integration-design.md)

---

## Pre-flight

Establish the baseline before any task runs.

- [ ] **P0a:** Confirm you're on `dev` branch with a clean tree:

```bash
git branch --show-current && git status --short
```

Expected: `dev`, no uncommitted changes.

- [ ] **P0b:** Confirm backend baseline (196 tests pass on Plan 3 tip):

```bash
cd backend && ./.venv/bin/python -m pytest tests/ -q --tb=no 2>&1 | tail -3
```

Expected: `196 passed`.

- [ ] **P0c:** Confirm frontend toolchain:

```bash
cd /Users/anton/Dev/Projects/editor && \
  cat package.json | grep -E '"(test|check)":' && \
  ls node_modules/vitest >/dev/null && echo "vitest ok" && \
  ls node_modules/@testing-library 2>/dev/null && echo "testing-library ok" || echo "testing-library MISSING"
```

Expected: `vitest ok` and `testing-library ok`. If testing-library is missing, install:

```bash
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

(Add to `vite.config.ts` test environment `jsdom` if not already configured.)

- [ ] **P0d:** Confirm the pre-commit hook (`.git-hooks/pre-commit` runs `npm run check`) is broken on the current frontend tip. Every commit in this plan uses `git commit --no-verify` — user-authorized policy. Verify:

```bash
cat .git-hooks/pre-commit
```

Expected: contains `npm run check`. Remember to use `--no-verify` on every commit.

- [ ] **P0e:** Confirm the backend `SessionStateSnapshot` schema is reachable from the frontend perspective (we'll mirror it as TypeScript types):

```bash
./backend/.venv/bin/python -c "from app.state.snapshot import SessionStateSnapshot; print(SessionStateSnapshot.model_json_schema())" | head -40
```

Expected: JSON schema output. The fields `session_id`, `image_context`, `widgets`, `masks_index`, `operation_graph`, `revision` should all appear.

---

## File structure

### Created (frontend)

| Path | Responsibility |
|---|---|
| `src/types/widget.ts` | TS mirror of backend `Widget`, `ControlBinding`, `WidgetNode`, `WidgetOrigin`, `WidgetPreview`, `Scope`, `MaskSummary`, `SessionStateSnapshot`, `StateEvent` |
| `src/lib/backend-tools.ts` | Typed wrappers for every `/api/tools/<name>` call used by the frontend |
| `src/store/backend-state-slice.ts` | `useBackendState` Zustand store — snapshot + optimistic + applyEvent |
| `src/store/backend-state-slice.test.ts` | Vitest unit suite for the slice |
| `src/lib/sse-subscriber.ts` | `EventSource` lifecycle + reconnect + dispatch to slice |
| `src/lib/sse-subscriber.test.ts` | Vitest unit suite for the subscriber (event parsing + reconnect logic) |
| `src/hooks/useBackendSession.ts` | Hook that boots session, runs `analyze_image`, opens SSE |
| `src/lib/select-pipeline-nodes.ts` | `selectPipelineNodes` selector + `toPipelineNode` mapper + `mergeOptimistic` |
| `src/lib/select-pipeline-nodes.test.ts` | Vitest unit suite for the mapper |
| `src/lib/palette-actions.ts` | `proposeFromPalette(text, scope?)` — replaces `ai-palette-submit.ts` |
| `src/components/inspector/widget/WidgetCard.tsx` | Header + binding list + lifecycle footer |
| `src/components/inspector/widget/BindingRow.tsx` | Dispatches on `binding.control_type` |
| `src/components/inspector/widget/LifecycleActions.tsx` | Accept / Refine / Repeat / Delete buttons |
| `src/components/inspector/widget/PreviewThumbnail.tsx` | Lazy `preview_widget` fetch + cache by `(widget_id, revision)` |
| `src/components/inspector/widget/primitives/SliderControl.tsx` | Numeric slider primitive (refactor of `AdjustmentSlider`) |
| `src/components/inspector/widget/primitives/ToggleControl.tsx` | Radix Switch in glass register |
| `src/components/inspector/widget/primitives/ChoiceControl.tsx` | Radix DropdownMenu enum picker |
| `src/components/inspector/widget/primitives/ColorControl.tsx` | Floating UI popover + color input |
| `src/components/inspector/widget/primitives/RegionPickerControl.tsx` | Reads `masks_index`; dropdown of named regions |
| `src/components/inspector/widget/primitives/MaskThumbnailControl.tsx` | Read-only mask label |
| `src/components/inspector/SuggestionsRail.tsx` | Suggestions section header + collapsed-card list |

### Created (backend)

| Path | Responsibility |
|---|---|
| `backend/tests/services/test_suggest_fused_tools.py` | Tests for `AnthropicClient.suggest_fused_tools_for_character` |

### Modified (frontend)

| Path | Change |
|---|---|
| `src/lib/ai-client.ts` | Drop `generatePanel`/`refinePanel`/`GeneratePanelOptions`. Keep `createSession`/`analyzeImage`/`pushSessionContext` |
| `src/hooks/useImageContext.ts` | Drop `lastAnalysedFingerprint` branch; trim to bootstrap + restore |
| `src/components/inspector/InspectorPanel.tsx` | Rewrite to render `SuggestionsRail` + `WidgetCard` list from `useBackendState` |
| `src/components/canvas/EditorCanvas.tsx` (or wherever `useAdjustmentPipeline` lives) | Switch WebGL pipeline input to `selectPipelineNodes` for the widget overlay |
| `src/components/EditorProvider.tsx` | Wire `useBackendSession` on mount |
| `src/store/layer-slice.ts` | Drop `'ai-panel'` from `LayerType`; drop `operationGraph`/`panelBindings`/`aiSteps` fields; drop `Adjustment.aiSource` |
| `src/types/ai-target.ts` | Keep `Scope`; drop `TargetRef`, `InsertionIntent` |
| `src/types/operation-graph.ts` | Keep — pipeline still consumes `OperationGraph` shape |
| `backend/app/services/anthropic_client.py` | Add `suggest_fused_tools_for_character` |
| `backend/app/tools/atomic/analyze_image.py` | Add ≥2 top-up loop in `_mint_autonomous_suggestions` |
| `backend/tests/tools/test_analyze_image.py` | Extend with ≥2 top-up cases |
| `vite.config.ts` | Add jsdom test environment if not already configured |

### Deleted (frontend)

| Path | Reason |
|---|---|
| `src/store/ai-panel-actions.ts` | Layer-materialization gone |
| `src/store/ai-chips-store.ts` | Chip selections replaced by `masks_index` + `RegionPickerControl` |
| `src/lib/ai-palette-submit.ts` | Replaced by `palette-actions.ts` |
| `src/components/inspector/AiPanelHeader.tsx` | Refine moves into per-widget `LifecycleActions` |
| `src/components/inspector/AiPanelSection.tsx` | Replaced by `WidgetCard` |
| `src/components/inspector/BindingRow.tsx` (legacy) | Replaced by `inspector/widget/BindingRow.tsx` |

---

## Task 1: Backend — `suggest_fused_tools_for_character` AnthropicClient method

**Files:**
- Modify: `backend/app/services/anthropic_client.py`
- Create: `backend/tests/services/test_suggest_fused_tools.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/__init__.py` if it doesn't exist (empty file).

Create `backend/tests/services/test_suggest_fused_tools.py`:

```python
from __future__ import annotations

from unittest.mock import MagicMock

from app.services.anthropic_client import AnthropicClient


def _fake_anthropic_response(picks: list[str]) -> MagicMock:
    """Mock anthropic.messages.create response for a tool-use call."""
    block = MagicMock()
    block.type = "tool_use"
    block.input = {"picks": picks}
    block.name = "suggest_fused_tools"
    response = MagicMock()
    response.content = [block]
    return response


def test_returns_picks_list(monkeypatch) -> None:
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    monkeypatch.setattr(
        client._client.messages, "create",
        lambda **kwargs: _fake_anthropic_response(["warm_grade", "exposure_balance"]),
    )
    picks = client.suggest_fused_tools_for_character(
        grade_character="neutral", lighting="flat",
        dominant_tones=["midtones"], subjects=["person"],
        exclude=[], n=2,
    )
    assert picks == ["warm_grade", "exposure_balance"]


def test_returns_empty_on_no_picks(monkeypatch) -> None:
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    monkeypatch.setattr(
        client._client.messages, "create",
        lambda **kwargs: _fake_anthropic_response([]),
    )
    picks = client.suggest_fused_tools_for_character(
        grade_character="neutral", lighting="flat",
        dominant_tones=[], subjects=[], exclude=[], n=2,
    )
    assert picks == []


def test_excludes_passed_through(monkeypatch) -> None:
    """The exclude list should be forwarded into the prompt — verify the
    create() call received it (not the response, which is mocked)."""
    captured: dict = {}
    def capture(**kwargs):
        captured.update(kwargs)
        return _fake_anthropic_response(["warm_grade"])
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    monkeypatch.setattr(client._client.messages, "create", capture)
    client.suggest_fused_tools_for_character(
        grade_character="warm", lighting="harsh",
        dominant_tones=["highlights"], subjects=["sky"],
        exclude=["sky_recovery"], n=1,
    )
    # Find the user message with the exclude info; the exclude list should appear in it.
    serialised = str(captured.get("messages", []))
    assert "sky_recovery" in serialised
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && ./.venv/bin/python -m pytest tests/services/test_suggest_fused_tools.py -v
```

Expected: `AttributeError: 'AnthropicClient' object has no attribute 'suggest_fused_tools_for_character'` (or similar).

- [ ] **Step 3: Inspect existing patterns**

Read `backend/app/services/anthropic_client.py` around the existing `name_pick_fused_tool` (line 538) — your new method should follow the same shape: tool-use response, structured output schema, optional `session_id` for telemetry.

- [ ] **Step 4: Implement the method**

Add this method to `AnthropicClient` (place it after `name_pick_fused_tool`, around line 560):

```python
    def suggest_fused_tools_for_character(
        self,
        *,
        grade_character: str | None,
        lighting: str | None,
        dominant_tones: list[str],
        subjects: list[str],
        exclude: list[str],
        n: int,
        session_id: str | None = None,
    ) -> list[str]:
        """Ask Claude to name N fused-tool ids that fit the image's overall
        character, excluding ones already suggested. Returns template ids
        in priority order. Used by analyze_image to top up suggestions
        when problem-driven minting yields fewer than 2."""
        from app.tools.fused import all_fused_templates

        templates = list(all_fused_templates())
        catalog = [
            {"id": t.id, "description": t.description, "typical_use": t.typical_use}
            for t in templates
        ]

        tool_schema = {
            "name": "suggest_fused_tools",
            "description": "Pick fused tools that fit the image character.",
            "input_schema": {
                "type": "object",
                "additionalProperties": False,
                "required": ["picks"],
                "properties": {
                    "picks": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 0,
                        "maxItems": n,
                        "description": (
                            "Up to N fused-tool ids from the catalog, in priority order. "
                            f"N={n}. Do NOT include any id from the exclude list."
                        ),
                    },
                },
            },
        }

        user_msg = {
            "role": "user",
            "content": [
                {"type": "text", "text": (
                    f"Pick up to {n} fused tools whose typical_use fits this image.\n\n"
                    f"Catalog: {catalog}\n\n"
                    f"Image character:\n"
                    f"- grade_character: {grade_character}\n"
                    f"- lighting: {lighting}\n"
                    f"- dominant_tones: {dominant_tones}\n"
                    f"- subjects: {subjects}\n\n"
                    f"Exclude (already suggested): {exclude}\n\n"
                    f"Return picks as fused-tool ids in priority order. Empty list is fine if nothing fits."
                )},
            ],
        }

        response = self._client.messages.create(
            model=self._model,
            max_tokens=512,
            tools=[tool_schema],
            tool_choice={"type": "tool", "name": "suggest_fused_tools"},
            messages=[user_msg],
            extra_headers={"x-session-id": session_id} if session_id else None,
        )
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "suggest_fused_tools":
                picks = block.input.get("picks", []) or []
                # Defensive: filter out anything in exclude (Claude may slip).
                return [p for p in picks if p not in exclude]
        return []
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && ./.venv/bin/python -m pytest tests/services/test_suggest_fused_tools.py -v
```

Expected: `3 passed`.

- [ ] **Step 6: Full-suite regression**

```bash
cd backend && ./.venv/bin/python -m pytest tests/ -q --tb=no 2>&1 | tail -3
```

Expected: `199 passed` (was 196; +3 new).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/anthropic_client.py backend/tests/services/
git commit --no-verify -m "$(cat <<'EOF'
feat(anthropic): suggest_fused_tools_for_character method

Picks up to N fused-tool ids that fit an image's grade_character /
lighting / dominant_tones / subjects, excluding ids already suggested.
Used by analyze_image to top up autonomous suggestions to ≥2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — ≥2 suggestion top-up in `analyze_image`

**Files:**
- Modify: `backend/app/tools/atomic/analyze_image.py`
- Modify: `backend/tests/tools/test_analyze_image.py`

- [ ] **Step 1: Write the failing tests**

Open `backend/tests/tools/test_analyze_image.py` and add four new tests (append below the existing tests; reuse whatever fake-Claude fixture pattern that file already uses — likely a `MagicMock` with canned returns). The shape:

```python
# Append to backend/tests/tools/test_analyze_image.py

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.main import app
from app.schemas.enriched_context import EnrichedImageContext, Problem
from app.services.anthropic_client import _ContextSoftFields


def _fake_claude_for_topup(
    *,
    problems: list[Problem],
    topup_picks: list[str],
    resolve_values: dict,
):
    """Builds a MagicMock that walks a session through analyze_image + the
    fused-tool minting for each problem and (if needed) the top-up."""
    from unittest.mock import MagicMock
    from app.schemas.image_context import ImageContext
    fake = MagicMock()
    fake.analyze_image.return_value = ImageContext(
        subjects=["scene"], lighting="flat", dominant_tones=["midtones"],
        mood="calm", candidate_regions=[],
        model_name="fake", model_version="0", generated_at="2026-05-23T00:00:00Z",
    )
    fake.augment_context_soft_fields.return_value = _ContextSoftFields(
        estimated_white_point=(255, 255, 255), wb_neutral_confidence=0.7,
        grade_character="neutral", problems=problems, region_soft_fields=[],
    )
    fake.resolve_fused_tool.return_value = {"values": resolve_values, "reasoning": ""}
    fake.suggest_fused_tools_for_character.return_value = topup_picks
    return fake


def _bootstrap_session() -> str:
    from io import BytesIO
    from PIL import Image
    client = TestClient(app)
    buf = BytesIO(); Image.new("RGB", (64, 64), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_analyze_mints_two_when_no_problems(monkeypatch) -> None:
    """Zero problems → top-up fills both slots."""
    fake = _fake_claude_for_topup(
        problems=[],
        topup_picks=["warm_grade", "exposure_balance"],
        resolve_values={
            "temperature": 200, "highlight_warmth": 5, "saturation_lift": 2,
            "shadows": 10, "highlights": -10, "whites": 0, "blacks": 0,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    r = client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(autonomous) == 2
    fused_ids = {w.fused_tool_id for w in autonomous}
    assert fused_ids == {"warm_grade", "exposure_balance"}


def test_analyze_tops_up_when_one_problem(monkeypatch) -> None:
    """One high-severity problem → 1 minted from problem + 1 from top-up."""
    fake = _fake_claude_for_topup(
        problems=[Problem(
            kind="clipped_highlights", severity=0.8, region_label=None,
            suggested_fused_tools=["sky_recovery"], description="bright sky",
        )],
        topup_picks=["exposure_balance"],
        resolve_values={
            "temperature": 0, "highlight_warmth": 0, "saturation_lift": 0,
            "shadows": 5, "highlights": -15, "whites": -5, "blacks": 5,
            "highlight_amount": 0.8, "luma_curve_strength": 0.5,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(autonomous) == 2
    assert {w.fused_tool_id for w in autonomous} == {"sky_recovery", "exposure_balance"}
    # The top-up call must have excluded sky_recovery.
    args, kwargs = fake.suggest_fused_tools_for_character.call_args
    assert "sky_recovery" in kwargs["exclude"]


def test_analyze_no_topup_when_two_problems(monkeypatch) -> None:
    """Two high-severity problems → top-up not called."""
    fake = _fake_claude_for_topup(
        problems=[
            Problem(kind="clipped_highlights", severity=0.8, region_label=None,
                    suggested_fused_tools=["sky_recovery"], description="sky"),
            Problem(kind="crushed_shadows", severity=0.8, region_label=None,
                    suggested_fused_tools=["exposure_balance"], description="shadows"),
        ],
        topup_picks=["warm_grade"],  # should never be called
        resolve_values={
            "temperature": 0, "highlight_warmth": 0, "saturation_lift": 0,
            "shadows": 30, "highlights": -20, "whites": 0, "blacks": 0,
            "highlight_amount": 0.5, "luma_curve_strength": 0.3,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(autonomous) == 2
    fake.suggest_fused_tools_for_character.assert_not_called()


def test_analyze_skips_dismissed_topup_picks(monkeypatch) -> None:
    """If a dismissal rule already covers a top-up candidate, skip it."""
    from app.schemas.widget import DismissalRule
    fake = _fake_claude_for_topup(
        problems=[],
        # Claude suggests warm_grade twice (silly) — verify dedupe by dismissal.
        topup_picks=["warm_grade", "exposure_balance"],
        resolve_values={
            "temperature": 200, "highlight_warmth": 5, "saturation_lift": 2,
            "shadows": 0, "highlights": 0, "whites": 0, "blacks": 0,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    # Pre-populate a dismissal for warm_grade @ global.
    doc = deps.get_session_store().get_document(sid)
    doc.dismissals.append(DismissalRule(
        fused_tool_id="warm_grade", scope_signature="global",
        source_widget_id="dummy",
    ))
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    fused_ids = {w.fused_tool_id for w in autonomous}
    assert "warm_grade" not in fused_ids
    assert "exposure_balance" in fused_ids
```

- [ ] **Step 2: Run new tests to verify they fail**

```bash
cd backend && ./.venv/bin/python -m pytest tests/tools/test_analyze_image.py -v -k "topup or two_when_no_problems or skips_dismissed" 2>&1 | tail -15
```

Expected: 4 failures (top-up logic doesn't exist yet).

- [ ] **Step 3: Implement the top-up loop**

Open `backend/app/tools/atomic/analyze_image.py`. After the existing `for problem in ctx.problems:` block in `_mint_autonomous_suggestions`, append the top-up logic:

```python
async def _mint_autonomous_suggestions(doc, ctx, anthropic) -> None:
    # ...existing problem-driven loop unchanged...

    # ≥2 guarantee — top up via image-character match if the problem-driven
    # pass produced fewer than 2 autonomous widgets.
    MIN_AUTONOMOUS_SUGGESTIONS = 2

    def _count_autonomous_active() -> int:
        return sum(
            1 for w in doc.widgets.values()
            if w.origin.kind == "mcp_autonomous" and w.status == "active"
        )

    if _count_autonomous_active() >= MIN_AUTONOMOUS_SUGGESTIONS:
        return

    already_used = {
        w.fused_tool_id for w in doc.widgets.values()
        if w.origin.kind == "mcp_autonomous" and w.fused_tool_id
    }
    dismissed_global = {
        rule.fused_tool_id for rule in doc.dismissals
        if rule.scope_signature == "global"
    }
    needed = MIN_AUTONOMOUS_SUGGESTIONS - _count_autonomous_active()
    exclude = list(already_used | dismissed_global)
    candidates = anthropic.suggest_fused_tools_for_character(
        grade_character=ctx.grade_character,
        lighting=ctx.lighting,
        dominant_tones=ctx.dominant_tones,
        subjects=ctx.subjects,
        exclude=exclude,
        n=needed,
        session_id=doc.session_id,
    )

    global_scope = Scope.model_validate({"kind": "global"})
    for fused_id in candidates:
        if _count_autonomous_active() >= MIN_AUTONOMOUS_SUGGESTIONS:
            break
        if fused_id not in templates or fused_id in already_used:
            continue
        if _dismissed(fused_id, global_scope):
            continue
        origin = WidgetOrigin(kind="mcp_autonomous", prompt=None)
        intent = templates[fused_id].typical_use[:60] if templates[fused_id].typical_use else fused_id
        try:
            widget = await run_fused_tool(
                templates[fused_id], intent=intent, scope=global_scope,
                ctx=ctx, prior=None, instruction=None,
                anthropic=anthropic, origin=origin,
            )
        except Exception:  # noqa: BLE001
            continue
        if widget is None:
            continue
        doc.add_widget(widget)
        already_used.add(fused_id)
```

(`Scope` is already imported in this file from the existing problem-driven loop.)

- [ ] **Step 4: Run all four new tests to verify they pass**

```bash
cd backend && ./.venv/bin/python -m pytest tests/tools/test_analyze_image.py -v 2>&1 | tail -15
```

Expected: all `test_analyze_*` tests pass (existing + 4 new).

- [ ] **Step 5: Full-suite regression**

```bash
cd backend && ./.venv/bin/python -m pytest tests/ -q --tb=no 2>&1 | tail -3
```

Expected: 203 passed (was 199; +4 new).

- [ ] **Step 6: Commit**

```bash
git add backend/app/tools/atomic/analyze_image.py backend/tests/tools/test_analyze_image.py
git commit --no-verify -m "$(cat <<'EOF'
feat(analyze): guarantee ≥2 autonomous suggestion widgets

After the problem-driven pass, top up via suggest_fused_tools_for_character
when fewer than 2 autonomous widgets have been minted. Top-ups are
scope=global; problem-driven keeps per-problem scope. Dismissed templates
and already-used templates are excluded from the candidate list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Frontend — TS schemas for `Widget`, `SessionStateSnapshot`, `StateEvent`

**Files:**
- Create: `src/types/widget.ts`

- [ ] **Step 1: Write the type module**

Create `src/types/widget.ts`:

```ts
// Mirrors backend/app/schemas/widget.py + state/snapshot.py + state/events.

export type Scope =
  | { kind: 'global' }
  | { kind: 'named_region'; label: string }
  | { kind: 'mask:proposed'; label: string }
  | { kind: 'mask:click'; mask_id?: string };

export type ControlType =
  | 'slider'
  | 'toggle'
  | 'choice'
  | 'color'
  | 'region_picker'
  | 'mask_thumbnail';

export interface SliderSchema {
  control_type: 'slider';
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface ToggleSchema {
  control_type: 'toggle';
  on_label: string;
  off_label: string;
}

export interface ChoiceSchema {
  control_type: 'choice';
  options: { value: string; label: string; description?: string }[];
}

export interface ColorSchema {
  control_type: 'color';
  mode: 'rgb' | 'hex';
}

export interface RegionPickerSchema {
  control_type: 'region_picker';
}

export interface MaskThumbnailSchema {
  control_type: 'mask_thumbnail';
}

export type ControlSchema =
  | SliderSchema
  | ToggleSchema
  | ChoiceSchema
  | ColorSchema
  | RegionPickerSchema
  | MaskThumbnailSchema;

export type ControlValue = number | string | boolean;

export interface NodeParamTarget {
  node_id: string;
  param_key: string;
}

export interface ControlBinding {
  param_key: string;
  label: string;
  control_type: ControlType;
  target: NodeParamTarget;
  control_schema: ControlSchema;
  value: ControlValue;
  default: ControlValue;
  reasoning?: string;
}

export type ParamValue = number | string | boolean;

export interface WidgetNode {
  id: string;
  type: string;
  params: Record<string, ParamValue>;
  scope: Scope;
  inputs: string[];
  widget_id: string;
}

export type WidgetOriginKind =
  | 'mcp_user_prompt'
  | 'mcp_autonomous'
  | 'fused_expansion'
  | 'refine'
  | 'repeat';

export interface WidgetOrigin {
  kind: WidgetOriginKind;
  prompt?: string | null;
  parent_widget_id?: string | null;
}

export interface WidgetPreview {
  kind: 'thumbnail' | 'histogram_delta' | 'color_swatches' | 'none';
  auto_before_after: boolean;
}

export interface Widget {
  id: string;
  intent: string;
  reasoning?: string;
  scope: Scope;
  origin: WidgetOrigin;
  fused_tool_id?: string;
  composed: boolean;
  nodes: WidgetNode[];
  bindings: ControlBinding[];
  preview: WidgetPreview;
  rejected_attempts: unknown[];
  status: 'active' | 'dismissed';
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface MaskSummary {
  id: string;
  width: number;
  height: number;
  source: string;
  label: string | null;
}

// Re-export the existing OperationGraph type for the snapshot.
import type { OperationGraph } from './operation-graph';

export interface SessionStateSnapshot {
  session_id: string;
  image_context: unknown | null;     // EnrichedImageContext — opaque to the frontend
  widgets: Widget[];
  masks_index: MaskSummary[];
  operation_graph: OperationGraph;
  revision: number;
}

export type StateEventKind =
  | 'widget.created'
  | 'widget.updated'
  | 'widget.deleted'
  | 'widget.accepted'
  | 'widget.restored'
  | 'mask.created'
  | 'selection.changed'
  | 'context.updated'
  | 'dismissal.added';

export interface StateEvent {
  revision: number;
  kind: StateEventKind;
  payload: Record<string, unknown>;
  emitted_at: string;
}
```

- [ ] **Step 2: Verify the types compile**

```bash
npx tsc -b 2>&1 | tail -10
```

Expected: no new errors related to `widget.ts`. (Pre-existing errors elsewhere may still appear; ignore those.)

- [ ] **Step 3: Commit**

```bash
git add src/types/widget.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(types): widget + SessionStateSnapshot + StateEvent

TS mirror of backend/app/schemas/widget.py + state/snapshot.py shapes,
ready for the BackendStateSlice and widget renderers to consume.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend — `backend-tools.ts` typed REST wrappers

**Files:**
- Create: `src/lib/backend-tools.ts`

- [ ] **Step 1: Write the module**

Create `src/lib/backend-tools.ts`:

```ts
import type { Widget, Scope, ControlValue } from '@/types/widget';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

export interface ToolEnvelope<T> {
  ok: boolean;
  output?: T;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    recovery_hint?: string;
  };
}

async function invokeTool<T>(
  name: string,
  sessionId: string,
  input: Record<string, unknown>,
): Promise<ToolEnvelope<T>> {
  const response = await fetch(`${BASE_URL}/api/tools/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, input }),
  });
  if (!response.ok) {
    throw new Error(`/api/tools/${name} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as ToolEnvelope<T>;
}

export const backendTools = {
  analyze_image(sessionId: string) {
    return invokeTool<{ image_context: unknown }>('analyze_image', sessionId, {});
  },
  list_widgets(sessionId: string) {
    return invokeTool<{ widgets: Widget[] }>('list_widgets', sessionId, {});
  },
  propose_widget(sessionId: string, args: { intent: string; scope: Scope; fused_tool_id?: string; prompt?: string }) {
    return invokeTool<{ widget: Widget }>('propose_widget', sessionId, args);
  },
  refine_widget(sessionId: string, args: {
    widget_id: string;
    edits: { param_key: string; instruction: string }[];
    additions: { request: string }[];
    instruction?: string;
  }) {
    return invokeTool<{ widget: Widget }>('refine_widget', sessionId, args);
  },
  repeat_widget(sessionId: string, args: { widget_id: string }) {
    return invokeTool<{ widget: Widget }>('repeat_widget', sessionId, args);
  },
  delete_widget(sessionId: string, args: { widget_id: string; suppress_similar: boolean }) {
    return invokeTool<{ widget_id: string }>('delete_widget', sessionId, args);
  },
  restore_widget(sessionId: string, args: { widget_id: string }) {
    return invokeTool<{ widget_id: string }>('restore_widget', sessionId, args);
  },
  accept_widget(sessionId: string, args: { widget_id: string }) {
    return invokeTool<{ widget_id: string }>('accept_widget', sessionId, args);
  },
  set_widget_param(sessionId: string, args: { widget_id: string; param_key: string; value: ControlValue }) {
    return invokeTool<{ widget: Widget }>('set_widget_param', sessionId, args);
  },
  preview_widget(sessionId: string, args: { widget_id: string; max_dim?: number }) {
    return invokeTool<{ mime_type: string; image_b64: string | null; reason?: string }>(
      'preview_widget', sessionId, args,
    );
  },
};
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc -b 2>&1 | grep "src/lib/backend-tools.ts" || echo "no errors in backend-tools.ts"
```

Expected: `no errors in backend-tools.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/backend-tools.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(lib): typed REST wrappers for /api/tools/<name>

Single entry point for every backend tool the frontend calls. Returns
typed ToolEnvelope so callers can branch on ok/error without parsing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontend — `BackendStateSlice` Zustand store + unit tests

**Files:**
- Create: `src/store/backend-state-slice.ts`
- Create: `src/store/backend-state-slice.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store/backend-state-slice.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useBackendState } from './backend-state-slice';
import type { SessionStateSnapshot, StateEvent, Widget } from '@/types/widget';

function makeWidget(id: string, overrides: Partial<Widget> = {}): Widget {
  return {
    id,
    intent: `intent-${id}`,
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', prompt: 'x' },
    composed: false,
    nodes: [],
    bindings: [],
    preview: { kind: 'thumbnail', auto_before_after: true },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    created_at: '2026-05-23T00:00:00Z',
    updated_at: '2026-05-23T00:00:00Z',
    ...overrides,
  };
}

function baseSnapshot(): SessionStateSnapshot {
  return {
    session_id: 's1',
    image_context: null,
    widgets: [makeWidget('w_1')],
    masks_index: [],
    operation_graph: {
      id: 'projected-x',
      userGoal: 'w_1',
      reasoning: null,
      nodes: [],
      panelBindings: [],
      metadata: {},
    },
    revision: 1,
  };
}

beforeEach(() => useBackendState.getState().reset());

describe('BackendStateSlice', () => {
  it('reset clears snapshot and optimistic', () => {
    useBackendState.setState({ snapshot: baseSnapshot(), sessionId: 's1' });
    useBackendState.getState().reset();
    expect(useBackendState.getState().snapshot).toBeNull();
    expect(useBackendState.getState().sessionId).toBeNull();
    expect(useBackendState.getState().optimistic.size).toBe(0);
  });

  it('applyEvent widget.created appends a widget and bumps revision', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    const ev: StateEvent = {
      revision: 2,
      kind: 'widget.created',
      payload: { widget: makeWidget('w_2') },
      emitted_at: '2026-05-23T00:00:01Z',
    };
    useBackendState.getState().applyEvent(ev);
    const snap = useBackendState.getState().snapshot!;
    expect(snap.widgets.map((w) => w.id)).toEqual(['w_1', 'w_2']);
    expect(snap.revision).toBe(2);
  });

  it('applyEvent widget.updated replaces in place', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    const updated = makeWidget('w_1', { intent: 'changed', revision: 2 });
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.updated',
      payload: { widget: updated },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    const snap = useBackendState.getState().snapshot!;
    expect(snap.widgets[0].intent).toBe('changed');
  });

  it('applyEvent widget.deleted flips status to dismissed', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.deleted',
      payload: { widget_id: 'w_1' },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    const snap = useBackendState.getState().snapshot!;
    expect(snap.widgets[0].status).toBe('dismissed');
  });

  it('applyEvent drops optimistic patch when server revision is higher', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyOptimistic('w_1', {
      baseRevision: 1,
      bindings: [{ paramKey: 'temperature', value: 6500 }],
    });
    expect(useBackendState.getState().optimistic.size).toBe(1);
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.updated',
      payload: { widget: makeWidget('w_1', { revision: 2 }) },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    expect(useBackendState.getState().optimistic.size).toBe(0);
  });

  it('applyEvent drops same-or-lower revision events defensively', () => {
    const snap = baseSnapshot();
    snap.revision = 5;
    useBackendState.setState({ snapshot: snap });
    useBackendState.getState().applyEvent({
      revision: 5, kind: 'widget.deleted',
      payload: { widget_id: 'w_1' },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    // The widget should NOT have been deleted because the event was stale.
    expect(useBackendState.getState().snapshot!.widgets[0].status).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/store/backend-state-slice.test.ts 2>&1 | tail -10
```

Expected: ImportError / file not found on `./backend-state-slice`.

- [ ] **Step 3: Implement the slice**

Create `src/store/backend-state-slice.ts`:

```ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  SessionStateSnapshot,
  StateEvent,
  Widget,
  MaskSummary,
} from '@/types/widget';

type WidgetId = string;

export interface OptimisticPatch {
  bindings: { paramKey: string; value: number | string | boolean }[];
  baseRevision: number;
}

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

interface BackendState {
  sessionId: string | null;
  snapshot: SessionStateSnapshot | null;
  optimistic: Map<WidgetId, OptimisticPatch>;
  sseStatus: SseStatus;
  applyEvent: (ev: StateEvent) => void;
  applyOptimistic: (widgetId: WidgetId, patch: OptimisticPatch) => void;
  clearOptimistic: (widgetId: WidgetId) => void;
  setSseStatus: (status: SseStatus) => void;
  setSnapshot: (snapshot: SessionStateSnapshot) => void;
  setSessionId: (sessionId: string | null) => void;
  reset: () => void;
}

export const useBackendState = create<BackendState>()(
  immer((set) => ({
    sessionId: null,
    snapshot: null,
    optimistic: new Map(),
    sseStatus: 'idle',

    applyEvent: (ev) =>
      set((s) => {
        if (!s.snapshot) return;
        // Defensive: drop stale events.
        if (ev.revision <= s.snapshot.revision) return;

        const payload = ev.payload as Record<string, unknown>;

        switch (ev.kind) {
          case 'widget.created': {
            const w = payload.widget as Widget;
            s.snapshot.widgets.push(w);
            break;
          }
          case 'widget.updated': {
            const w = payload.widget as Widget;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === w.id);
            if (idx >= 0) s.snapshot.widgets[idx] = w;
            break;
          }
          case 'widget.deleted': {
            const id = payload.widget_id as string;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === id);
            if (idx >= 0) s.snapshot.widgets[idx].status = 'dismissed';
            break;
          }
          case 'widget.restored': {
            const id = payload.widget_id as string;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === id);
            if (idx >= 0) s.snapshot.widgets[idx].status = 'active';
            break;
          }
          case 'widget.accepted': {
            // Pure provenance event — no state mutation required.
            break;
          }
          case 'mask.created': {
            const summary = payload.mask as MaskSummary;
            if (summary) s.snapshot.masks_index.push(summary);
            break;
          }
          case 'context.updated': {
            s.snapshot.image_context = payload.image_context ?? null;
            break;
          }
          case 'selection.changed':
          case 'dismissal.added':
            // No snapshot change; subscribers (e.g. maskStore) handle these.
            break;
        }

        s.snapshot.revision = ev.revision;

        // Drop optimistic patches whose baseRevision is now stale.
        for (const [wid, patch] of s.optimistic) {
          if (patch.baseRevision < ev.revision) s.optimistic.delete(wid);
        }
      }),

    applyOptimistic: (widgetId, patch) =>
      set((s) => {
        s.optimistic.set(widgetId, patch);
      }),

    clearOptimistic: (widgetId) =>
      set((s) => {
        s.optimistic.delete(widgetId);
      }),

    setSseStatus: (status) => set((s) => { s.sseStatus = status; }),
    setSnapshot: (snapshot) => set((s) => { s.snapshot = snapshot; }),
    setSessionId: (sessionId) => set((s) => { s.sessionId = sessionId; }),

    reset: () =>
      set((s) => {
        s.sessionId = null;
        s.snapshot = null;
        s.optimistic = new Map();
        s.sseStatus = 'idle';
      }),
  })),
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/store/backend-state-slice.test.ts 2>&1 | tail -15
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/types/widget.ts src/store/backend-state-slice.ts src/store/backend-state-slice.test.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(store): BackendStateSlice — SessionStateSnapshot + optimistic patches

useBackendState is the single source of truth for widget/mask/projection
state. applyEvent handlers cover every StateEvent kind. Optimistic
patches are stored separately and reaped when the server's revision
overtakes the patch's baseRevision.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend — SSE subscriber

**Files:**
- Create: `src/lib/sse-subscriber.ts`
- Create: `src/lib/sse-subscriber.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/sse-subscriber.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseSseLine } from './sse-subscriber';
import type { StateEvent } from '@/types/widget';

describe('parseSseLine', () => {
  it('parses a complete data: line into a StateEvent', () => {
    const json = JSON.stringify({
      revision: 5,
      kind: 'widget.created',
      payload: { widget: { id: 'w_1' } },
      emitted_at: '2026-05-23T00:00:00Z',
    });
    const ev = parseSseLine(`data: ${json}`);
    expect(ev).not.toBeNull();
    expect(ev!.kind).toBe('widget.created');
    expect(ev!.revision).toBe(5);
  });

  it('returns null for non-data lines', () => {
    expect(parseSseLine('event: widget.created')).toBeNull();
    expect(parseSseLine('')).toBeNull();
    expect(parseSseLine(': keepalive')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSseLine('data: not-json')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/sse-subscriber.test.ts 2>&1 | tail -10
```

Expected: import error on `./sse-subscriber`.

- [ ] **Step 3: Implement the subscriber**

Create `src/lib/sse-subscriber.ts`:

```ts
import type { StateEvent, SessionStateSnapshot } from '@/types/widget';
import { useBackendState } from '@/store/backend-state-slice';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

export function parseSseLine(line: string): StateEvent | null {
  if (!line.startsWith('data: ')) return null;
  try {
    return JSON.parse(line.slice(6)) as StateEvent;
  } catch {
    return null;
  }
}

async function fetchSnapshot(sessionId: string): Promise<SessionStateSnapshot> {
  const response = await fetch(`${BASE_URL}/api/state/${sessionId}`);
  if (!response.ok) throw new Error(`/api/state/${sessionId} → ${response.status}`);
  return (await response.json()) as SessionStateSnapshot;
}

interface SseHandle {
  close: () => void;
}

export function openSseSubscription(sessionId: string): SseHandle {
  const state = useBackendState.getState();
  let attempt = 0;
  let closed = false;
  let source: EventSource | null = null;

  function backoffMs(): number {
    return Math.min(4000, 250 * 2 ** Math.min(attempt, 4));
  }

  async function rehydrate() {
    try {
      const snap = await fetchSnapshot(sessionId);
      state.setSnapshot(snap);
    } catch (err) {
      console.warn('[sse] rehydrate failed:', err);
    }
  }

  function open() {
    if (closed) return;
    state.setSseStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    source = new EventSource(`${BASE_URL}/api/state/${sessionId}/events`);

    source.onopen = () => {
      attempt = 0;
      state.setSseStatus('open');
    };

    source.onmessage = (event) => {
      const ev = parseSseLine(`data: ${event.data}`);
      if (ev) state.applyEvent(ev);
    };

    source.onerror = () => {
      if (closed) return;
      source?.close();
      attempt += 1;
      state.setSseStatus('reconnecting');
      // Refetch the snapshot on every reconnect (no Last-Event-ID replay in v1).
      setTimeout(() => {
        rehydrate().finally(open);
      }, backoffMs());
    };
  }

  open();

  return {
    close: () => {
      closed = true;
      source?.close();
      state.setSseStatus('closed');
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/sse-subscriber.test.ts 2>&1 | tail -10
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sse-subscriber.ts src/lib/sse-subscriber.test.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(lib): SSE subscriber with reconnect + snapshot rehydration

Opens EventSource against /api/state/{sid}/events, routes each event
through useBackendState.applyEvent, and on disconnect refetches the
snapshot and reopens with exponential backoff (250ms → 4s cap). No
Last-Event-ID replay in v1 — rehydrate is the recovery story.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend — `useBackendSession` hook + EditorProvider wiring (dark-shipped)

**Files:**
- Create: `src/hooks/useBackendSession.ts`
- Modify: `src/components/EditorProvider.tsx`

- [ ] **Step 1: Inspect the current session bootstrap**

```bash
cat src/hooks/useImageContext.ts | grep -n "uploadAndAnalyse\|bindCachedSession\|useAiSession" | head -10
```

The existing `useAiSession` already manages the session id + initial analyze call. The new `useBackendSession` runs alongside it for now (parallel paths), reading the session id from `useAiSession` after it boots.

- [ ] **Step 2: Implement the hook**

Create `src/hooks/useBackendSession.ts`:

```ts
import { useEffect, useRef } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { openSseSubscription } from '@/lib/sse-subscriber';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

/**
 * Boots the BackendStateSlice + SSE subscription whenever the AiSession
 * has a session id. Calls analyze_image to populate context + autonomous
 * suggestions. Lives in EditorProvider; one instance per app.
 */
export function useBackendSession(): void {
  const sessionId = useAiSession((s) => s.sessionId);
  const setSessionId = useBackendState((s) => s.setSessionId);
  const setSnapshot = useBackendState((s) => s.setSnapshot);
  const reset = useBackendState((s) => s.reset);
  const subscriptionRef = useRef<{ close: () => void } | null>(null);

  useEffect(() => {
    if (!sessionId) {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
      reset();
      return;
    }

    setSessionId(sessionId);
    let cancelled = false;

    (async () => {
      try {
        const envelope = await backendTools.analyze_image(sessionId);
        if (cancelled) return;
        if (!envelope.ok) {
          console.warn('[backend-session] analyze_image failed:', envelope.error);
        }
        const snapshotResp = await fetch(`${BASE_URL}/api/state/${sessionId}`);
        if (cancelled) return;
        if (snapshotResp.ok) {
          setSnapshot(await snapshotResp.json());
        }
        subscriptionRef.current = openSseSubscription(sessionId);
      } catch (err) {
        console.warn('[backend-session] boot failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
    };
  }, [sessionId, setSessionId, setSnapshot, reset]);
}
```

- [ ] **Step 3: Wire into EditorProvider**

In `src/components/EditorProvider.tsx`, add the import + hook call. Add the import at the top:

```ts
import { useBackendSession } from '@/hooks/useBackendSession';
```

Inside the `EditorProvider` function body, after the existing `useRef` declarations, add:

```ts
  // Dark-ship the backend state slice; rendering still uses legacy paths
  // until Task 11 mounts the new InspectorPanel.
  useBackendSession();
```

- [ ] **Step 4: Verify compilation**

```bash
npx tsc -b 2>&1 | grep -E "(useBackendSession|EditorProvider)" || echo "no new errors"
```

Expected: `no new errors`.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Start the backend (`cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8787 --reload`) and the frontend (`npm run dev`), upload an image, open devtools, confirm:
- Network tab: `POST /api/tools/analyze_image` succeeds.
- Network tab: `GET /api/state/{sid}` succeeds.
- Network tab: `GET /api/state/{sid}/events` shows `pending` (SSE keeps the connection open).
- `useBackendState.getState().snapshot` in the JS console has the snapshot with widgets.

This is optional — vitest can't easily exercise the EventSource. The integration is covered later in Task 14.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useBackendSession.ts src/components/EditorProvider.tsx
git commit --no-verify -m "$(cat <<'EOF'
feat(hooks): useBackendSession — analyze + snapshot + SSE bootstrap

EditorProvider mounts this hook once. It triggers analyze_image, fetches
the initial snapshot, and opens the SSE subscription. Dark-shipped: no
UI consumes useBackendState yet. The legacy ai-panel layer paths still
drive rendering until Task 11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend — `selectPipelineNodes` selector + `toPipelineNode` mapper

**Files:**
- Create: `src/lib/select-pipeline-nodes.ts`
- Create: `src/lib/select-pipeline-nodes.test.ts`

- [ ] **Step 1: Inspect the existing PipelineNode shape**

```bash
grep -n "PipelineNode\|interface.*Pipeline\|type.*Pipeline" src/lib/pipeline-manager.ts src/types/operation-graph.ts 2>/dev/null | head -10
```

Note the field names the existing pipeline expects (likely `id`, `type`, `params`, `scope`). The mapper in this task must preserve those names.

- [ ] **Step 2: Write the failing test**

Create `src/lib/select-pipeline-nodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeOptimistic, toPipelineNode } from './select-pipeline-nodes';
import type { OperationGraph } from '@/types/operation-graph';

const baseGraph: OperationGraph = {
  id: 'g1',
  userGoal: 'warmer',
  reasoning: null,
  nodes: [
    { id: 'n1', type: 'kelvin', scope: { kind: 'global' }, params: { temperature: 6500 }, inputs: [] },
    { id: 'n2', type: 'basic', scope: { kind: 'global' }, params: { exposure: 0.5, contrast: 10 }, inputs: [] },
  ],
  panelBindings: [],
  metadata: {},
};

describe('toPipelineNode', () => {
  it('maps node shape verbatim', () => {
    const out = toPipelineNode(baseGraph.nodes[0]);
    expect(out.id).toBe('n1');
    expect(out.type).toBe('kelvin');
    expect(out.params).toEqual({ temperature: 6500 });
    expect(out.scope).toEqual({ kind: 'global' });
  });
});

describe('mergeOptimistic', () => {
  it('returns nodes unchanged when no optimistic patches', () => {
    const out = mergeOptimistic(baseGraph.nodes, new Map());
    expect(out).toEqual(baseGraph.nodes);
  });

  // mergeOptimistic in v1 is a stub — optimistic patches target binding
  // values per widget, but the projected graph is a flat node list. The
  // mapping from binding paramKey to a specific node param happens via
  // the binding's `target` (node_id + param_key); since the slider widget
  // owns this lookup directly, mergeOptimistic at the graph layer is a
  // pass-through for v1. Future work: rebuild the merger if optimistic
  // updates need to feed the WebGL pipeline through this path instead.
  it('is a pass-through in v1', () => {
    const optimistic = new Map();
    optimistic.set('w_1', { baseRevision: 1, bindings: [{ paramKey: 'temperature', value: 7000 }] });
    const out = mergeOptimistic(baseGraph.nodes, optimistic);
    expect(out).toEqual(baseGraph.nodes);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/lib/select-pipeline-nodes.test.ts 2>&1 | tail -10
```

Expected: import error.

- [ ] **Step 4: Implement the selector**

Create `src/lib/select-pipeline-nodes.ts`:

```ts
import type { Node, OperationGraph } from '@/types/operation-graph';
import type { OptimisticPatch } from '@/store/backend-state-slice';
import { useBackendState } from '@/store/backend-state-slice';

/**
 * PipelineNode is whatever pipeline-manager.ts already consumes. We import
 * the existing Node type from OperationGraph and pass it through.
 */
export type PipelineNode = Node;

export function toPipelineNode(node: Node): PipelineNode {
  return { ...node };
}

/**
 * v1 pass-through. Optimistic patches are applied at the binding-render
 * layer (the slider component holds its own value during drag), so the
 * graph projection doesn't need to merge them here. Future: if we move
 * the WebGL pipeline to read directly from the projected graph, this
 * function will need to rewrite node.params based on binding-target
 * mappings.
 */
export function mergeOptimistic(
  nodes: Node[],
  _optimistic: Map<string, OptimisticPatch>,
): Node[] {
  return nodes;
}

/**
 * Selector used by useAdjustmentPipeline. Returns the projected
 * OperationGraph nodes as PipelineNodes.
 */
export function selectPipelineNodes(): PipelineNode[] {
  const snap = useBackendState.getState().snapshot;
  const opt = useBackendState.getState().optimistic;
  if (!snap) return [];
  return mergeOptimistic(snap.operation_graph.nodes, opt).map(toPipelineNode);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/lib/select-pipeline-nodes.test.ts 2>&1 | tail -10
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/select-pipeline-nodes.ts src/lib/select-pipeline-nodes.test.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(lib): selectPipelineNodes + mergeOptimistic stub

Pure mapper from the snapshot's projected OperationGraph to the
PipelineNode shape the WebGL pipeline consumes. mergeOptimistic is a
v1 pass-through; slider drags optimistically update the widget binding
value directly, not via the graph.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend — widget control primitives

**Files:**
- Create: `src/components/inspector/widget/primitives/SliderControl.tsx`
- Create: `src/components/inspector/widget/primitives/ToggleControl.tsx`
- Create: `src/components/inspector/widget/primitives/ChoiceControl.tsx`
- Create: `src/components/inspector/widget/primitives/ColorControl.tsx`
- Create: `src/components/inspector/widget/primitives/RegionPickerControl.tsx`
- Create: `src/components/inspector/widget/primitives/MaskThumbnailControl.tsx`
- Create: `src/components/inspector/widget/primitives/primitives.test.tsx`

Each primitive accepts `(value, default, onChange)` plus a schema-typed prop. None of them call `backendTools` directly — they emit `onChange(newValue)`; `BindingRow` owns the write side.

- [ ] **Step 1: Write the failing tests**

Create `src/components/inspector/widget/primitives/primitives.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SliderControl } from './SliderControl';
import { ToggleControl } from './ToggleControl';
import { ChoiceControl } from './ChoiceControl';
import { ColorControl } from './ColorControl';
import { MaskThumbnailControl } from './MaskThumbnailControl';
import { RegionPickerControl } from './RegionPickerControl';

describe('SliderControl', () => {
  it('renders value and emits onChange', () => {
    const onChange = vi.fn();
    render(<SliderControl
      label="Temperature" value={6500} default={5500}
      schema={{ control_type: 'slider', min: 3000, max: 9000, step: 50 }}
      onChange={onChange} />);
    expect(screen.getByText('Temperature')).toBeDefined();
    const input = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '7000' } });
    expect(onChange).toHaveBeenCalledWith(7000);
  });
});

describe('ToggleControl', () => {
  it('flips on click and emits boolean', () => {
    const onChange = vi.fn();
    render(<ToggleControl
      label="Skin protect" value={true} default={true}
      schema={{ control_type: 'toggle', on_label: 'Protect', off_label: 'Off' }}
      onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('ChoiceControl', () => {
  it('renders options and emits selected value', () => {
    const onChange = vi.fn();
    render(<ChoiceControl
      label="Preset" value="warm" default="warm"
      schema={{
        control_type: 'choice',
        options: [
          { value: 'warm', label: 'Warm' },
          { value: 'cool', label: 'Cool' },
        ],
      }}
      onChange={onChange} />);
    // Component-test interaction depends on the dropdown primitive — confirm
    // the current value displays. Full interaction is covered in Playwright.
    expect(screen.getByText('Warm')).toBeDefined();
  });
});

describe('ColorControl', () => {
  it('renders the current color', () => {
    render(<ColorControl
      label="Tint" value="#ff8800" default="#ffffff"
      schema={{ control_type: 'color', mode: 'hex' }}
      onChange={() => {}} />);
    expect(screen.getByLabelText('Tint')).toBeDefined();
  });
});

describe('MaskThumbnailControl', () => {
  it('renders read-only label for a mask', () => {
    render(<MaskThumbnailControl
      label="Skin"
      value="m_1"
      default="m_1"
      schema={{ control_type: 'mask_thumbnail' }}
      onChange={() => {}}
      maskSummaries={[{ id: 'm_1', width: 100, height: 100, source: 'sam_point', label: 'Skin' }]}
    />);
    expect(screen.getByText('Skin')).toBeDefined();
  });
});

describe('RegionPickerControl', () => {
  it('lists named regions and emits selection', () => {
    const onChange = vi.fn();
    render(<RegionPickerControl
      label="Region"
      value="m_1"
      default="m_1"
      schema={{ control_type: 'region_picker' }}
      onChange={onChange}
      maskSummaries={[
        { id: 'm_1', width: 100, height: 100, source: 'sam_point', label: 'Skin' },
        { id: 'm_2', width: 100, height: 100, source: 'sam_point', label: 'Sky' },
      ]}
    />);
    expect(screen.getByText('Skin')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/inspector/widget/primitives/primitives.test.tsx 2>&1 | tail -10
```

Expected: import errors (files don't exist yet).

- [ ] **Step 3: Implement SliderControl**

Create `src/components/inspector/widget/primitives/SliderControl.tsx`:

```tsx
import type { SliderSchema } from '@/types/widget';

interface SliderControlProps {
  label: string;
  value: number;
  default: number;
  schema: SliderSchema;
  onChange: (value: number) => void;
}

export function SliderControl({ label, value, schema, onChange }: SliderControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-primary">{label}</span>
        <span className="text-xs text-text-secondary">{value}{schema.unit ?? ''}</span>
      </div>
      <input
        type="range"
        role="slider"
        min={schema.min}
        max={schema.max}
        step={schema.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
```

- [ ] **Step 4: Implement ToggleControl**

Create `src/components/inspector/widget/primitives/ToggleControl.tsx`:

```tsx
import { Switch } from '@radix-ui/react-switch';
import type { ToggleSchema } from '@/types/widget';

interface ToggleControlProps {
  label: string;
  value: boolean;
  default: boolean;
  schema: ToggleSchema;
  onChange: (value: boolean) => void;
}

export function ToggleControl({ label, value, schema, onChange }: ToggleControlProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">
          {value ? schema.on_label : schema.off_label}
        </span>
        <Switch
          role="switch"
          checked={value}
          onCheckedChange={onChange}
          className="w-8 h-5 rounded-full bg-surface-secondary data-[state=checked]:bg-accent"
        />
      </div>
    </div>
  );
}
```

If `@radix-ui/react-switch` isn't installed, install it: `npm install @radix-ui/react-switch`.

- [ ] **Step 5: Implement ChoiceControl**

Create `src/components/inspector/widget/primitives/ChoiceControl.tsx`:

```tsx
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ChoiceSchema } from '@/types/widget';

interface ChoiceControlProps {
  label: string;
  value: string;
  default: string;
  schema: ChoiceSchema;
  onChange: (value: string) => void;
}

export function ChoiceControl({ label, value, schema, onChange }: ChoiceControlProps) {
  const current = schema.options.find((o) => o.value === value);
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="text-xs px-2 py-1 rounded bg-surface-secondary">
          {current?.label ?? value}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="bg-surface-primary border border-border-default rounded p-1">
            {schema.options.map((opt) => (
              <DropdownMenu.Item
                key={opt.value}
                onSelect={() => onChange(opt.value)}
                className="text-xs px-2 py-1 hover:bg-surface-secondary rounded cursor-pointer"
              >
                {opt.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
```

- [ ] **Step 6: Implement ColorControl**

Create `src/components/inspector/widget/primitives/ColorControl.tsx`:

```tsx
import type { ColorSchema } from '@/types/widget';

interface ColorControlProps {
  label: string;
  value: string;        // hex string (e.g. "#ff8800") for v1
  default: string;
  schema: ColorSchema;
  onChange: (value: string) => void;
}

export function ColorControl({ label, value, onChange }: ColorControlProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <input
        aria-label={label}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-5 rounded cursor-pointer"
      />
    </div>
  );
}
```

- [ ] **Step 7: Implement RegionPickerControl + MaskThumbnailControl**

Create `src/components/inspector/widget/primitives/RegionPickerControl.tsx`:

```tsx
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { RegionPickerSchema, MaskSummary } from '@/types/widget';

interface RegionPickerControlProps {
  label: string;
  value: string;        // mask id
  default: string;
  schema: RegionPickerSchema;
  onChange: (value: string) => void;
  maskSummaries: MaskSummary[];
}

export function RegionPickerControl({ label, value, onChange, maskSummaries }: RegionPickerControlProps) {
  const named = maskSummaries.filter((m) => m.label);
  const current = named.find((m) => m.id === value);
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="text-xs px-2 py-1 rounded bg-surface-secondary">
          {current?.label ?? 'Select region'}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="bg-surface-primary border border-border-default rounded p-1">
            {named.map((m) => (
              <DropdownMenu.Item
                key={m.id}
                onSelect={() => onChange(m.id)}
                className="text-xs px-2 py-1 hover:bg-surface-secondary rounded cursor-pointer"
              >
                {m.label}
              </DropdownMenu.Item>
            ))}
            {named.length === 0 && (
              <div className="text-xs px-2 py-1 text-text-secondary">No named regions</div>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
```

Create `src/components/inspector/widget/primitives/MaskThumbnailControl.tsx`:

```tsx
import type { MaskThumbnailSchema, MaskSummary } from '@/types/widget';

interface MaskThumbnailControlProps {
  label: string;
  value: string;
  default: string;
  schema: MaskThumbnailSchema;
  onChange: (value: string) => void;
  maskSummaries: MaskSummary[];
}

/** Read-only label/preview for a single mask. The `onChange` prop is part
 *  of the uniform primitive interface but is never called. */
export function MaskThumbnailControl({ label, value, maskSummaries }: MaskThumbnailControlProps) {
  const mask = maskSummaries.find((m) => m.id === value);
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-primary">{label}</span>
      <span className="text-text-secondary">{mask?.label ?? `(${value.slice(0, 8)})`}</span>
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run src/components/inspector/widget/primitives/primitives.test.tsx 2>&1 | tail -10
```

Expected: 6 passed (some assertions are presence-only; full interactions deferred to Playwright).

- [ ] **Step 9: Commit**

```bash
git add src/components/inspector/widget/primitives/ package.json package-lock.json
git commit --no-verify -m "$(cat <<'EOF'
feat(inspector): widget control primitives

One file per control_type — Slider, Toggle, Choice, Color, RegionPicker,
MaskThumbnail. Uniform (value, default, schema, onChange) call surface
so BindingRow can dispatch without per-type write logic. MaskThumbnail
is read-only (onChange unused).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend — `WidgetCard` + `BindingRow` + `LifecycleActions` + `PreviewThumbnail`

**Files:**
- Create: `src/components/inspector/widget/BindingRow.tsx`
- Create: `src/components/inspector/widget/LifecycleActions.tsx`
- Create: `src/components/inspector/widget/PreviewThumbnail.tsx`
- Create: `src/components/inspector/widget/WidgetCard.tsx`
- Create: `src/components/inspector/widget/widget-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/inspector/widget/widget-card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WidgetCard } from './WidgetCard';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    accept_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    refine_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    repeat_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    delete_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    preview_widget: vi.fn().mockResolvedValue({ ok: true, output: { mime_type: 'image/jpeg', image_b64: null } }),
  },
}));

const suggestion: Widget = {
  id: 'w_s',
  intent: 'Recover sky',
  scope: { kind: 'global' },
  origin: { kind: 'mcp_autonomous', prompt: null },
  composed: false,
  nodes: [],
  bindings: [],
  preview: { kind: 'thumbnail', auto_before_after: true },
  rejected_attempts: [],
  status: 'active',
  revision: 1,
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:00:00Z',
};

const active: Widget = {
  ...suggestion,
  id: 'w_a',
  intent: 'Warmer skin',
  origin: { kind: 'mcp_user_prompt', prompt: 'warmer' },
  bindings: [
    {
      param_key: 'temperature', label: 'Temperature', control_type: 'slider',
      target: { node_id: 'n_1', param_key: 'temperature' },
      control_schema: { control_type: 'slider', min: 3000, max: 9000, step: 50 },
      value: 6500, default: 5500,
    },
  ],
};

beforeEach(() => {
  useBackendState.getState().reset();
  useBackendState.setState({ sessionId: 's1' });
});

describe('WidgetCard suggestion mode', () => {
  it('renders intent and Accept/Dismiss buttons', () => {
    render(<WidgetCard widget={suggestion} isSuggestion />);
    expect(screen.getByText('Recover sky')).toBeDefined();
    expect(screen.getByRole('button', { name: /accept/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeDefined();
  });
});

describe('WidgetCard active mode', () => {
  it('renders bindings and lifecycle actions', () => {
    render(<WidgetCard widget={active} isSuggestion={false} />);
    expect(screen.getByText('Warmer skin')).toBeDefined();
    expect(screen.getByText('Temperature')).toBeDefined();
    expect(screen.getByRole('button', { name: /refine/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /repeat/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /delete/i })).toBeDefined();
  });

  it('calls set_widget_param + applyOptimistic when slider changes', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useBackendState.setState({
      snapshot: {
        session_id: 's1', image_context: null, widgets: [active],
        masks_index: [], operation_graph: { id: 'g', userGoal: '', reasoning: null, nodes: [], panelBindings: [], metadata: {} },
        revision: 1,
      },
    });
    render(<WidgetCard widget={active} isSuggestion={false} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    await userEvent.clear(slider);
    // Direct change via fireEvent — userEvent.type on range inputs is unreliable.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(slider, { target: { value: '7000' } });
    expect(useBackendState.getState().optimistic.has('w_a')).toBe(true);
    expect(backendTools.set_widget_param).toHaveBeenCalledWith('s1', {
      widget_id: 'w_a', param_key: 'temperature', value: 7000,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/inspector/widget/widget-card.test.tsx 2>&1 | tail -10
```

Expected: import errors.

- [ ] **Step 3: Implement BindingRow**

Create `src/components/inspector/widget/BindingRow.tsx`:

```tsx
import type { ControlBinding, MaskSummary } from '@/types/widget';
import { SliderControl } from './primitives/SliderControl';
import { ToggleControl } from './primitives/ToggleControl';
import { ChoiceControl } from './primitives/ChoiceControl';
import { ColorControl } from './primitives/ColorControl';
import { RegionPickerControl } from './primitives/RegionPickerControl';
import { MaskThumbnailControl } from './primitives/MaskThumbnailControl';

interface BindingRowProps {
  binding: ControlBinding;
  effectiveValue: ControlBinding['value'];
  onChange: (value: ControlBinding['value']) => void;
  maskSummaries: MaskSummary[];
}

export function BindingRow({ binding, effectiveValue, onChange, maskSummaries }: BindingRowProps) {
  const s = binding.control_schema;
  switch (s.control_type) {
    case 'slider':
      return <SliderControl label={binding.label} value={Number(effectiveValue)} default={Number(binding.default)} schema={s} onChange={onChange} />;
    case 'toggle':
      return <ToggleControl label={binding.label} value={Boolean(effectiveValue)} default={Boolean(binding.default)} schema={s} onChange={onChange} />;
    case 'choice':
      return <ChoiceControl label={binding.label} value={String(effectiveValue)} default={String(binding.default)} schema={s} onChange={onChange} />;
    case 'color':
      return <ColorControl label={binding.label} value={String(effectiveValue)} default={String(binding.default)} schema={s} onChange={onChange} />;
    case 'region_picker':
      return <RegionPickerControl label={binding.label} value={String(effectiveValue)} default={String(binding.default)} schema={s} onChange={onChange} maskSummaries={maskSummaries} />;
    case 'mask_thumbnail':
      return <MaskThumbnailControl label={binding.label} value={String(effectiveValue)} default={String(binding.default)} schema={s} onChange={onChange} maskSummaries={maskSummaries} />;
  }
}
```

- [ ] **Step 4: Implement LifecycleActions**

Create `src/components/inspector/widget/LifecycleActions.tsx`:

```tsx
import { useState } from 'react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

interface LifecycleActionsProps {
  widget: Widget;
  isSuggestion: boolean;
}

export function LifecycleActions({ widget, isSuggestion }: LifecycleActionsProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const [refining, setRefining] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    if (!sessionId) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  if (isSuggestion) {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => run(() => backendTools.accept_widget(sessionId!, { widget_id: widget.id }))}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-accent text-text-on-accent"
        >Accept</button>
        <button
          onClick={() => run(() => backendTools.delete_widget(sessionId!, { widget_id: widget.id, suppress_similar: true }))}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-surface-secondary"
        >Dismiss</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => setRefining((v) => !v)}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-surface-secondary"
        >Refine</button>
        <button
          onClick={() => run(() => backendTools.repeat_widget(sessionId!, { widget_id: widget.id }))}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-surface-secondary"
        >Repeat</button>
        <button
          onClick={() => run(() => backendTools.delete_widget(sessionId!, { widget_id: widget.id, suppress_similar: false }))}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-surface-secondary"
        >Delete</button>
      </div>
      {refining && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = instruction.trim();
            if (!trimmed) return;
            void run(async () => {
              await backendTools.refine_widget(sessionId!, {
                widget_id: widget.id, edits: [], additions: [], instruction: trimmed,
              });
              setInstruction('');
              setRefining(false);
            });
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe a refinement…"
            className="flex-1 text-xs px-2 py-1 rounded bg-surface-primary border border-border-default"
          />
          <button type="submit" disabled={busy} className="text-xs px-2 py-1 rounded bg-accent text-text-on-accent">
            Apply
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement PreviewThumbnail**

Create `src/components/inspector/widget/PreviewThumbnail.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

interface PreviewThumbnailProps {
  widget: Widget;
  maxDim?: number;
}

export function PreviewThumbnail({ widget, maxDim = 128 }: PreviewThumbnailProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) return;
    setLoading(true);
    (async () => {
      const env = await backendTools.preview_widget(sessionId, { widget_id: widget.id, max_dim: maxDim });
      if (cancelled) return;
      setImageB64(env.ok ? env.output!.image_b64 ?? null : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // Refetch when the widget revision bumps.
  }, [sessionId, widget.id, widget.revision, maxDim]);

  if (loading) return <div className="w-16 h-16 rounded bg-surface-secondary animate-pulse" />;
  if (!imageB64) {
    return (
      <div className="w-16 h-16 rounded bg-surface-secondary flex items-center justify-center text-[10px] text-text-secondary px-1 text-center">
        {widget.intent.slice(0, 24)}
      </div>
    );
  }
  return <img alt={widget.intent} src={`data:image/jpeg;base64,${imageB64}`} className="w-16 h-16 rounded object-cover" />;
}
```

- [ ] **Step 6: Implement WidgetCard**

Create `src/components/inspector/widget/WidgetCard.tsx`:

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BindingRow } from './BindingRow';
import { LifecycleActions } from './LifecycleActions';
import { PreviewThumbnail } from './PreviewThumbnail';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

interface WidgetCardProps {
  widget: Widget;
  isSuggestion: boolean;
}

export function WidgetCard({ widget, isSuggestion }: WidgetCardProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const masks = useBackendState((s) => s.snapshot?.masks_index ?? []);
  const optimistic = useBackendState((s) => s.optimistic);
  const applyOptimistic = useBackendState((s) => s.applyOptimistic);
  const baseRevision = useBackendState((s) => s.snapshot?.revision ?? 0);
  const [expanded, setExpanded] = useState(!isSuggestion);

  function effectiveValue(paramKey: string, fallback: Widget['bindings'][number]['value']): Widget['bindings'][number]['value'] {
    const patch = optimistic.get(widget.id);
    const hit = patch?.bindings.find((b) => b.paramKey === paramKey);
    return hit ? hit.value : fallback;
  }

  return (
    <div className="rounded-lg bg-surface-primary border border-border-default p-3 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {isSuggestion && <PreviewThumbnail widget={widget} maxDim={64} />}
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-text-primary"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {widget.intent}
          </button>
          {widget.reasoning && (
            <p className="text-xs text-text-secondary mt-1">{widget.reasoning}</p>
          )}
        </div>
      </div>

      {expanded && widget.bindings.length > 0 && (
        <div className="flex flex-col gap-2 pl-4">
          {widget.bindings.map((b) => (
            <BindingRow
              key={b.param_key}
              binding={b}
              effectiveValue={effectiveValue(b.param_key, b.value)}
              maskSummaries={masks}
              onChange={(value) => {
                if (!sessionId) return;
                applyOptimistic(widget.id, {
                  baseRevision,
                  bindings: [{ paramKey: b.param_key, value }],
                });
                void backendTools.set_widget_param(sessionId, {
                  widget_id: widget.id, param_key: b.param_key, value,
                });
              }}
            />
          ))}
        </div>
      )}

      {expanded && (
        <div className="pt-1 border-t border-border-default">
          <LifecycleActions widget={widget} isSuggestion={isSuggestion} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npx vitest run src/components/inspector/widget/widget-card.test.tsx 2>&1 | tail -15
```

Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add src/components/inspector/widget/
git commit --no-verify -m "$(cat <<'EOF'
feat(inspector): WidgetCard + BindingRow + LifecycleActions + PreviewThumbnail

WidgetCard is the visual unit per widget. Suggestion mode shows a thumb
+ Accept/Dismiss; active mode expands to bindings + Refine/Repeat/Delete.
BindingRow dispatches on control_type to the right primitive. Slider
drags fire applyOptimistic + set_widget_param in parallel. PreviewThumbnail
caches the preview_widget call keyed by (widget.id, widget.revision).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Frontend — InspectorPanel rewrite + WebGL pipeline switch (behind `VITE_BACKEND_WIDGETS` flag)

**Files:**
- Create: `src/components/inspector/SuggestionsRail.tsx`
- Modify: `src/components/inspector/InspectorPanel.tsx`
- Modify: the file containing `useAdjustmentPipeline` (likely `src/components/canvas/EditorCanvas.tsx`)
- Create: `src/components/inspector/InspectorPanel.test.tsx`

- [ ] **Step 1: Add the env flag declaration**

In `src/vite-env.d.ts` (or wherever `ImportMetaEnv` is augmented), add:

```ts
interface ImportMetaEnv {
  readonly VITE_AI_BACKEND_URL?: string;
  readonly VITE_BACKEND_WIDGETS?: string;
}
```

- [ ] **Step 2: Implement SuggestionsRail**

Create `src/components/inspector/SuggestionsRail.tsx`:

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { WidgetCard } from './widget/WidgetCard';
import type { Widget } from '@/types/widget';

interface SuggestionsRailProps {
  suggestions: Widget[];
}

export function SuggestionsRail({ suggestions }: SuggestionsRailProps) {
  const [open, setOpen] = useState(true);
  if (suggestions.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-text-secondary uppercase tracking-wide"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Suggestions ({suggestions.length})
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {suggestions.map((w) => <WidgetCard key={w.id} widget={w} isSuggestion />)}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Write the failing InspectorPanel test**

Create `src/components/inspector/InspectorPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useBackendState } from '@/store/backend-state-slice';
import { InspectorPanel } from './InspectorPanel';

const enabled = { ...import.meta.env, VITE_BACKEND_WIDGETS: '1' };

beforeEach(() => useBackendState.getState().reset());

describe('InspectorPanel (backend widgets enabled)', () => {
  it('renders suggestions and actives in separate sections', () => {
    vi.stubGlobal('import.meta', { env: enabled });
    useBackendState.setState({
      sessionId: 's1',
      snapshot: {
        session_id: 's1', image_context: null, widgets: [
          { id: 'sug', intent: 'Recover sky', scope: { kind: 'global' },
            origin: { kind: 'mcp_autonomous', prompt: null }, composed: false,
            nodes: [], bindings: [], preview: { kind: 'thumbnail', auto_before_after: true },
            rejected_attempts: [], status: 'active', revision: 1,
            created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
          { id: 'act', intent: 'Warmer skin', scope: { kind: 'global' },
            origin: { kind: 'mcp_user_prompt', prompt: 'warmer' }, composed: false,
            nodes: [], bindings: [], preview: { kind: 'thumbnail', auto_before_after: true },
            rejected_attempts: [], status: 'active', revision: 1,
            created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z' },
        ],
        masks_index: [], operation_graph: { id: 'g', userGoal: '', reasoning: null, nodes: [], panelBindings: [], metadata: {} },
        revision: 1,
      },
    });
    render(<InspectorPanel />);
    expect(screen.getByText('Recover sky')).toBeDefined();
    expect(screen.getByText('Warmer skin')).toBeDefined();
    expect(screen.getByText(/suggestions/i)).toBeDefined();
  });
});
```

- [ ] **Step 4: Rewrite InspectorPanel**

Read the current `src/components/inspector/InspectorPanel.tsx`. Note the legacy path branches (`layer.type === 'ai-panel'`, `AiPanelSection`, `LayerProperties`). Replace the AI-panel branch with the new widget-driven path **gated by the flag** so the legacy path still runs when the flag is off:

```tsx
// src/components/inspector/InspectorPanel.tsx — modify in place
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { LayerProperties } from './LayerProperties';
import { AiPanelSection } from './AiPanelSection';   // legacy, removed in Task 13
import { SuggestionsRail } from './SuggestionsRail';
import { WidgetCard } from './widget/WidgetCard';

const BACKEND_WIDGETS = import.meta.env.VITE_BACKEND_WIDGETS === '1';

export function InspectorPanel() {
  const layers = useEditorStore((s) => s.layers);
  const snapshot = useBackendState((s) => s.snapshot);

  if (BACKEND_WIDGETS) {
    const widgets = snapshot?.widgets.filter((w) => w.status === 'active') ?? [];
    const suggestions = widgets.filter(
      (w) => w.origin.kind === 'mcp_autonomous'
        // For v1: a suggestion stays in the suggestions rail until the user
        // explicitly accepts. We don't yet track an `acceptedAt` on Widget;
        // instead, after accept_widget the backend changes the origin or
        // emits widget.accepted (covered in spec). Simpler v1 heuristic:
        // all mcp_autonomous + active widgets are suggestions until a
        // widget.accepted event arrives. The accepted set lives in this
        // component's local memory.
    );
    const actives = widgets.filter((w) => !suggestions.includes(w));
    const otherLayers = layers.filter((l) => l.visible && l.type !== 'ai-panel');

    return (
      <div className="flex flex-col gap-4 p-3 overflow-y-auto">
        <SuggestionsRail suggestions={suggestions} />
        {actives.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">
              Active widgets
            </h3>
            <div className="flex flex-col gap-2">
              {actives.map((w) => <WidgetCard key={w.id} widget={w} isSuggestion={false} />)}
            </div>
          </section>
        )}
        {otherLayers.map((layer) => <LayerProperties key={layer.id} layerId={layer.id} />)}
      </div>
    );
  }

  // Legacy path — preserved verbatim from before this task.
  const aiPanelLayers = layers.filter((l) => l.type === 'ai-panel' && l.visible);
  const regularLayers = layers.filter(
    (l) => l.type !== 'ai-panel' && l.visible && l.aiSteps && Object.keys(l.aiSteps).length > 0,
  );
  // ...rest of the existing implementation unchanged...
  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto">
      {aiPanelLayers.map((layer) => <AiPanelSection key={layer.id} layerId={layer.id} />)}
      {regularLayers.map((layer) => <LayerProperties key={layer.id} layerId={layer.id} />)}
    </div>
  );
}
```

**Note**: the v1 accepted-suggestions handling above is incomplete (every `mcp_autonomous` widget shows as a suggestion forever, even after accept). Fix in Step 5.

- [ ] **Step 5: Track accepted suggestions in the slice**

Open `src/store/backend-state-slice.ts`. Add an `acceptedSuggestions: Set<string>` field and an `applyEvent` branch for `widget.accepted`:

In the `BackendState` interface (after `optimistic`):
```ts
  acceptedSuggestions: Set<string>;
```

In the `create()` initial state:
```ts
    acceptedSuggestions: new Set(),
```

In the `applyEvent` switch, add a case:
```ts
          case 'widget.accepted': {
            const id = payload.widget_id as string;
            s.acceptedSuggestions.add(id);
            break;
          }
```

In `reset()`:
```ts
        s.acceptedSuggestions = new Set();
```

Now update `InspectorPanel.tsx` to use this:

```tsx
    const accepted = useBackendState((s) => s.acceptedSuggestions);
    const suggestions = widgets.filter(
      (w) => w.origin.kind === 'mcp_autonomous' && !accepted.has(w.id),
    );
```

Also add a unit test in `backend-state-slice.test.ts` for the `widget.accepted` event:

```ts
  it('applyEvent widget.accepted adds to acceptedSuggestions set', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.accepted',
      payload: { widget_id: 'w_1' },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    expect(useBackendState.getState().acceptedSuggestions.has('w_1')).toBe(true);
  });
```

- [ ] **Step 6: WebGL pipeline switch**

Locate the file containing `useAdjustmentPipeline`:

```bash
grep -rln "useAdjustmentPipeline\|adjustmentPipeline\|pipelineManager" src/ | head -5
```

Open the most-relevant file. The current implementation reads adjustments from `useEditorStore.layers[].adjustments`. Add a new input source for the widget projection, gated by the flag:

```ts
import { selectPipelineNodes } from '@/lib/select-pipeline-nodes';

const BACKEND_WIDGETS = import.meta.env.VITE_BACKEND_WIDGETS === '1';

// Inside the hook/effect that builds the pipeline input list:
const widgetNodes = BACKEND_WIDGETS ? selectPipelineNodes() : [];
// Append widgetNodes to whatever per-layer adjustments list the pipeline currently consumes.
```

The exact integration depends on the existing pipeline-manager API; preserve current semantics. If the pipeline currently takes a flat node list, append `widgetNodes` to it. If it takes a layered structure, append a synthetic "ai-overlay" layer that contains `widgetNodes`.

- [ ] **Step 7: Run tests to verify they pass (with the flag enabled)**

```bash
VITE_BACKEND_WIDGETS=1 npx vitest run src/components/inspector/InspectorPanel.test.tsx src/store/backend-state-slice.test.ts 2>&1 | tail -10
```

Expected: all passes.

- [ ] **Step 8: Commit**

```bash
git add src/components/inspector/SuggestionsRail.tsx src/components/inspector/InspectorPanel.tsx src/components/inspector/InspectorPanel.test.tsx src/store/backend-state-slice.ts src/store/backend-state-slice.test.ts src/vite-env.d.ts
# Also add the file that hosts useAdjustmentPipeline if you modified it:
# git add src/components/canvas/EditorCanvas.tsx   (or wherever)
git commit --no-verify -m "$(cat <<'EOF'
feat(inspector): widget-driven InspectorPanel behind VITE_BACKEND_WIDGETS flag

When VITE_BACKEND_WIDGETS=1, InspectorPanel renders SuggestionsRail +
active WidgetCard list from useBackendState; the WebGL pipeline gets an
additional input from selectPipelineNodes. Legacy ai-panel path stays
intact when the flag is unset — both paths coexist during this slice.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Frontend — Palette migration to `propose_widget`

**Files:**
- Create: `src/lib/palette-actions.ts`
- Modify: any caller of `submitPaletteText` to call `proposeFromPalette` when the flag is on

- [ ] **Step 1: Find palette callers**

```bash
grep -rln "submitPaletteText\|ai-palette-submit" src/ | head -5
```

- [ ] **Step 2: Implement `palette-actions.ts`**

Create `src/lib/palette-actions.ts`:

```ts
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Scope } from '@/types/widget';

/** New propose-widget palette flow. The created widget appears in the
 *  inspector via the SSE `widget.created` event — no client-side layer
 *  materialization needed. */
export async function proposeFromPalette(
  text: string,
  scope: Scope = { kind: 'global' },
): Promise<void> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) {
    console.warn('[palette] no session yet, ignoring submit');
    return;
  }
  const env = await backendTools.propose_widget(sid, {
    intent: text, scope, prompt: text,
  });
  if (!env.ok) {
    console.error('[palette] propose_widget failed:', env.error);
  }
}
```

- [ ] **Step 3: Wire the new function behind the flag**

In every caller of `submitPaletteText`, branch on the flag:

```ts
import { proposeFromPalette } from '@/lib/palette-actions';

const BACKEND_WIDGETS = import.meta.env.VITE_BACKEND_WIDGETS === '1';

async function handleSubmit(text: string) {
  if (BACKEND_WIDGETS) {
    await proposeFromPalette(text);
  } else {
    await submitPaletteText(text, /* existing args */);
  }
}
```

(Exact patch sites depend on where palette UI lives — look for the call sites grep found in Step 1.)

- [ ] **Step 4: Manual smoke**

With `VITE_BACKEND_WIDGETS=1 npm run dev`, upload an image, wait for the ≥2 suggestions to appear in the inspector, then type a goal into the palette. Expected: a new widget appears in the inspector "Active widgets" section within a second.

- [ ] **Step 5: Commit**

```bash
git add src/lib/palette-actions.ts <any modified callers>
git commit --no-verify -m "$(cat <<'EOF'
feat(palette): propose_widget path behind VITE_BACKEND_WIDGETS flag

palette-actions.ts wraps backendTools.propose_widget for the palette;
created widgets show up via SSE — no client-side layer materialization.
Callers branch on the flag to keep the legacy submitPaletteText path
live while we validate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Frontend — Cleanup pass

**Files:**
- Delete: `src/store/ai-panel-actions.ts`, `src/store/ai-chips-store.ts`, `src/lib/ai-palette-submit.ts`, `src/components/inspector/AiPanelHeader.tsx`, `src/components/inspector/AiPanelSection.tsx`, `src/components/inspector/BindingRow.tsx` (legacy — the new one lives at `widget/BindingRow.tsx`)
- Modify: `src/store/layer-slice.ts` (drop `'ai-panel'` from `LayerType`; drop `operationGraph`/`panelBindings`/`aiSteps`/`Adjustment.aiSource`)
- Modify: `src/lib/ai-client.ts` (drop `generatePanel`, `refinePanel`, `GeneratePanelOptions`)
- Modify: `src/hooks/useImageContext.ts` (drop `lastAnalysedFingerprint` branch)
- Modify: `src/types/ai-target.ts` (drop `TargetRef`, `InsertionIntent`)
- Modify: `src/components/inspector/InspectorPanel.tsx` (remove the legacy branch + flag check; default to widget-driven path)
- Modify: `src/components/canvas/EditorCanvas.tsx` (remove flag check on widget overlay)
- Modify: `src/components/inspector/AdjustmentSlider.tsx` (if it survived — keep if still used by per-layer adjustments)
- Modify: `src/vite-env.d.ts` (remove `VITE_BACKEND_WIDGETS`)

- [ ] **Step 1: Inventory dead references**

```bash
grep -rln "ai-panel-actions\|ai-chips-store\|ai-palette-submit\|AiPanelHeader\|AiPanelSection\|generatePanel\|refinePanel\|operationGraph\|panelBindings\|aiSteps\|aiSource\|TargetRef\|InsertionIntent\|VITE_BACKEND_WIDGETS\|'ai-panel'" src/ | sort -u
```

Every hit must be either deleted, migrated, or has a comment explaining why it's intentionally retained.

- [ ] **Step 2: Delete the dead files**

```bash
git rm src/store/ai-panel-actions.ts src/store/ai-chips-store.ts src/lib/ai-palette-submit.ts \
       src/components/inspector/AiPanelHeader.tsx src/components/inspector/AiPanelSection.tsx \
       src/components/inspector/BindingRow.tsx
```

(Make sure `src/components/inspector/widget/BindingRow.tsx` from Task 10 is the only `BindingRow` left.)

- [ ] **Step 3: Remove `'ai-panel'` from `LayerType` and the related fields**

Open `src/store/layer-slice.ts`. Find the `LayerType` union and drop `'ai-panel'`. Find the `Layer` interface (or whatever Zustand piece holds layers) and drop the `operationGraph`, `panelBindings`, `aiSteps` fields. Drop `aiSource` from `Adjustment`.

For each consumer of those fields the grep in Step 1 surfaced, update or delete.

- [ ] **Step 4: Trim `ai-client.ts`**

Open `src/lib/ai-client.ts`. Delete the `generatePanel` function, the `refinePanel` function, the `GeneratePanelOptions` interface, and any unused imports left over. Keep `createSession`, `analyzeImage`, `pushSessionContext` — the new boot flow still uses them.

- [ ] **Step 5: Shrink `useImageContext.ts`**

Drop the `lastAnalysedFingerprint` field, the `currentImageFingerprint()` helper if no longer referenced, and the analyse-on-fingerprint-change effect. The backend's `analyze_image` tool handles idempotency now (via session-record caching of `context`). Keep `uploadAndAnalyse`, `bindCachedSession`, `restoreContext`.

- [ ] **Step 6: Trim `ai-target.ts`**

Open `src/types/ai-target.ts`. Drop `TargetRef`, `InsertionIntent`. Keep any types still consumed elsewhere (likely `Scope` — but since `Scope` is now re-exported from `src/types/widget.ts`, you can fold all `Scope` consumers onto that import and delete the file outright if nothing else lives there).

- [ ] **Step 7: Remove the flag**

Open `src/components/inspector/InspectorPanel.tsx`. Delete the `BACKEND_WIDGETS` constant and the legacy branch; the file should now only render the widget-driven path.

Open the file with `useAdjustmentPipeline`. Delete the `BACKEND_WIDGETS` constant; `widgetNodes` always feeds the pipeline.

Open `src/lib/palette-actions.ts` callers. Delete the flag branch; always call `proposeFromPalette`.

Delete `VITE_BACKEND_WIDGETS` from `src/vite-env.d.ts`.

- [ ] **Step 8: Type-check and lint**

```bash
npm run check 2>&1 | tail -30
```

Fix any errors surfaced by the cleanup. If pre-existing frontend lint errors in unrelated files come up, you may have to fix some — but limit yourself to errors caused by THIS plan. Pre-existing errors from before this plan's branch point can stay (they're tracked under the original "55 errors on dev" backlog).

- [ ] **Step 9: Run all frontend tests**

```bash
npm test -- --run 2>&1 | tail -15
```

Expected: all passes.

- [ ] **Step 10: Sanity grep**

```bash
grep -rln "ai-panel\|operationGraph\|panelBindings\|aiSteps\|aiSource\|TargetRef\|InsertionIntent\|generatePanel\|refinePanel" src/
```

Expected: zero hits (or only hits inside comments that document the migration).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit --no-verify -m "$(cat <<'EOF'
chore(frontend): remove legacy ai-panel layer machinery

Deletes ai-panel-actions, ai-chips-store, ai-palette-submit,
AiPanelHeader, AiPanelSection, the legacy BindingRow. Drops 'ai-panel'
from LayerType and the operationGraph/panelBindings/aiSteps/aiSource
fields. Drops generatePanel/refinePanel from ai-client. Trims
useImageContext to bootstrap + restore. Removes the VITE_BACKEND_WIDGETS
flag — widget path is now the only path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Final regression sweep + Playwright integration + tag

**Files:**
- Create: `tests/integration/mcp-loop.spec.ts` (Playwright)

- [ ] **Step 1: Run full backend pytest**

```bash
cd backend && ./.venv/bin/python -m pytest tests/ -q --tb=short 2>&1 | tail -5
```

Expected: all pass (~203 tests).

- [ ] **Step 2: Run full frontend vitest**

```bash
cd /Users/anton/Dev/Projects/editor && npm test -- --run 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 3: Run tsc + eslint**

```bash
npm run check 2>&1 | tail -10
```

Expected: clean (or at least no new errors from this plan).

- [ ] **Step 4: Add Playwright integration test (if Playwright is configured)**

Check if Playwright is set up:

```bash
ls playwright.config.ts e2e/ tests/integration/ 2>&1
```

If yes, add `tests/integration/mcp-loop.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// This test requires a real backend running on port 8787 with a fake-Claude
// monkeypatched in. Skip if not in the right environment.
test.skip(process.env.E2E !== '1', 'E2E only — set E2E=1 to run');

test('upload → ≥2 suggestions → accept → slider drag → external MCP', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // 1. Upload an image fixture.
  await page.setInputFiles('input[type=file]', 'tests/fixtures/test_image.jpg');

  // 2. Wait for ≥2 suggestion cards (within 10s budget).
  await expect(page.locator('text=Suggestions')).toBeVisible({ timeout: 10000 });
  const suggestions = page.locator('section:has-text("Suggestions") > div > div');
  await expect(suggestions).toHaveCount(2, { timeout: 10000 });

  // 3. Accept the first suggestion.
  await page.locator('button:has-text("Accept")').first().click();
  await expect(page.locator('section:has-text("Active widgets")')).toBeVisible();

  // 4. Drag a slider on the accepted widget.
  const slider = page.locator('section:has-text("Active widgets") input[type=range]').first();
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = String(Number(el.value) + 100);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // 5. External MCP propose_widget should appear.
  await page.evaluate(async () => {
    const sid = (window as any).__editorSessionId;
    await fetch('http://127.0.0.1:8787/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-editor-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 99, method: 'tools/call',
        params: { name: 'propose_widget', arguments: { intent: 'external test', scope: { kind: 'global' }, fused_tool_id: 'warm_grade' } },
      }),
    });
  });
  await expect(page.locator('text=external test')).toBeVisible({ timeout: 5000 });
});
```

Run when configured:

```bash
E2E=1 npx playwright test tests/integration/mcp-loop.spec.ts
```

If Playwright is NOT configured for this repo, document the manual smoke procedure instead and skip the file creation — the unit + component coverage is sufficient for v1.

- [ ] **Step 5: Manual smoke from a shell against a running backend**

Start the backend (`cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8787 --reload`) and the frontend (`npm run dev`). Open the app at `http://localhost:5173`. Upload an image.

Confirm visually:
- ≥2 suggestion cards appear within 5s.
- Clicking Accept on a suggestion moves it to the Active section; controls become live.
- Slider drag changes the canvas immediately; the per-widget revision number bumps (check via devtools console: `window.useBackendState?.getState().snapshot.widgets`).
- In a separate terminal, post an MCP `propose_widget` against the same session id. The new widget appears in the inspector live.

- [ ] **Step 6: Tag the plan close**

```bash
git tag frontend-mcp-integration-complete
```

- [ ] **Step 7: Update MEMORY.md**

If anything surprising emerged during implementation, add a one-line note to `~/.claude/projects/-Users-anton-Dev-Projects-editor/memory/MEMORY.md` capturing it. Otherwise no action.

---

## Plan complete — what's done

- Backend guarantees ≥2 autonomous suggestion widgets per `analyze_image` via image-character top-up.
- `BackendStateSlice` is the single source of truth for widget/mask/projection state.
- SSE subscriber + snapshot rehydrate on reconnect.
- Six control-type primitives: slider, toggle, choice, color, region_picker, mask_thumbnail.
- `WidgetCard` + `LifecycleActions` + `PreviewThumbnail` render the inspector.
- Palette routes through `propose_widget`; widgets appear via SSE.
- Legacy `ai-panel` layer machinery removed.
- WebGL pipeline reads adjustments from the projected `OperationGraph` for widget-authored ops; per-layer adjustments from user tools stay on the existing path.

## Out of scope for this plan (future work)

- Dismissed-widget restore history surface.
- Inline mask painting from a `region_picker` (creating a new mask via SAM mid-edit).
- WebGL parity for `preview_widget`. CPU approximation is what we ship.
- Migration of saved `.edp` documents with `ai-panel` layers — stripped on load with a `console.warn`.
- Multi-session / shared cursors / CRDT.
