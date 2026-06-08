# Creative Compound Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four new compound 1D dial ops (weather, mood, season, age) as JSON-only data, plus a `mood` category for grouping all five compound dials, validating that the compound framework actually delivers "add a new creative widget by authoring one JSON file."

**Architecture:** Five commits, each independently revertable: (1) introduce `mood` category + flip TOD to it + planner-prompt update; (2-5) one widget JSON per commit. No code changes beyond the planner prompt — the framework handles everything else.

**Tech Stack:** JSON files validated by the Compound Widget Framework's existing Pydantic + Zod schemas. Backend test extensions in pytest.

**Reference:** `docs/superpowers/specs/2026-06-09-creative-compound-widgets-design.md`

**Pytest env quirk:** tests need ANTHROPIC_API_KEY loaded. Use `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest <args>`.

**Convention reminder:** values for `kelvin.kelvin` are in the SHADER convention (`2 * 6500 - physical_kelvin`). Higher stored value = warmer apparent image. The existing TOD anchors are the reference (`shared/registry/ops/time-of-day.json`).

---

## File Structure

### Modified
- `shared/registry/ops/time-of-day.json` — single-line category change
- `backend/app/services/anthropic_client.py` — `_PLANNER_SYSTEM_PROMPT` adds `mood` to category list + one sentence on multi-dial stacking
- `backend/tests/registry/test_loader.py` — 4 new per-widget loader assertion functions
- `backend/tests/services/test_anthropic_planner.py` — extend `test_plan_widget_stack_catalog_surfaces_compound_dial` to assert all 5 dials' anchor names visible

### Created
- `shared/registry/ops/weather.json`
- `shared/registry/ops/mood.json`
- `shared/registry/ops/season.json`
- `shared/registry/ops/age.json`

### No deletions
The framework is reused as-is. No file deletions in this plan.

---

## Task 1: Add `mood` category — flip TOD + update planner prompt

**Visible effect:** Time-of-Day's category becomes `mood`. The planner prompt lists `mood` as a valid category and instructs the LLM that compound dials may stack when intents span multiple axes.

**Files:**
- Modify: `shared/registry/ops/time-of-day.json`
- Modify: `backend/app/services/anthropic_client.py`
- Test: `backend/tests/services/test_anthropic_planner.py` (extend)

- [ ] **Step 1: Flip TOD's category**

In `shared/registry/ops/time-of-day.json`, change one line:

```diff
-  "category": "tone",
+  "category": "mood",
```

- [ ] **Step 2: Write failing planner-prompt test**

Add to `backend/tests/services/test_anthropic_planner.py`:

```python
def test_planner_prompt_lists_mood_category(monkeypatch):
    """The planner system prompt must include `mood` as a valid category."""
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")

    captured: dict = {}
    def fake_create(**kwargs):
        captured["system"] = kwargs.get("system")
        resp = MagicMock()
        resp.content = [MagicMock(text='{"plan": []}')]
        return resp
    monkeypatch.setattr(client._client.messages, "create", fake_create)

    reg = reload_registry()
    client.plan_widget_stack(
        intent="any", scope={"kind": "global"}, image_context={},
        existing_widgets=[], registry=reg, session_id="s1",
    )
    system_blob = str(captured["system"])
    assert "mood" in system_blob
    # Multi-dial stacking sentence
    assert "Multiple compound dials may stack" in system_blob
```

- [ ] **Step 3: Run test to confirm failure**

Run: `cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/services/test_anthropic_planner.py::test_planner_prompt_lists_mood_category -v`
Expected: FAIL — `Multiple compound dials may stack` not in system prompt.

- [ ] **Step 4: Update the planner system prompt**

In `backend/app/services/anthropic_client.py`, locate `_PLANNER_SYSTEM_PROMPT`. Find the existing COMPOUND DIAL OPS rule block. Append one sentence to it:

```python
- COMPOUND DIAL OPS: ops with a `compound_dial` field in the catalog ARE
  the right answer for intents that describe a point on that dial. Set
  `starting_params` to {driver: target_value} and return a SINGLE-OP widget.
  Example: "make it night" → time-of-day with position=1.0. Do NOT manually
  compose individual tone+color+vignette ops when a compound dial op covers
  the intent — the dial does that math from its anchor table automatically.
  Multiple compound dials may stack when the intent spans more than one
  dial axis (e.g., "winter sunset" = season + time-of-day, "vintage stormy"
  = age + weather). Prefer ONE dial when the intent fits a single axis.
```

(The first paragraph is the existing rule from commit `0eea773`; only the trailing sentence is new.)

- [ ] **Step 5: Run test to confirm pass**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/services/test_anthropic_planner.py -v`
Expected: PASS (existing + new).

- [ ] **Step 6: Run loader tests to confirm TOD still loads with new category**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/ -v 2>&1 | tail -10`
Expected: PASS (the existing `test_all_ops_have_category` accepts any category string since the validator is not a closed enum).

- [ ] **Step 7: Run full backend suite**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -5`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/ops/time-of-day.json backend/app/services/anthropic_client.py backend/tests/services/test_anthropic_planner.py
git commit -m "feat(registry): add mood category; planner allows multi-dial stacking"
```

---

## Task 2: Weather (5 anchors)

**Visible effect:** A new `weather` op exists. Cmd+K "make it stormy" should now spawn a Weather widget at position ~1.0.

**Files:**
- Create: `shared/registry/ops/weather.json`
- Test: `backend/tests/registry/test_loader.py` (extend)

- [ ] **Step 1: Author `weather.json`**

Create `shared/registry/ops/weather.json` with this exact content:

```json
{
  "id": "weather",
  "display_name": "Weather",
  "category": "mood",
  "llm": {
    "description": "1-D dial that re-lights the image across weather conditions — sunny, partly cloudy, overcast, fog, rain. Compiles to coordinated kelvin, exposure, contrast, haze (negative clarity), and grain (for rain texture).",
    "typical_use": "User says 'make it sunny', 'overcast day', 'foggy morning', 'rainy', 'stormy', 'cloudy'.",
    "semantic_tags": ["mood", "atmosphere", "weather", "lighting"]
  },
  "params": {
    "weather.position":          { "type": "scalar", "range": [0, 1],         "default": 0.25, "step": 0.001 },
    "kelvin.kelvin":             { "type": "scalar", "range": [2000, 12000],  "default": 6500, "step": 50, "unit": "K" },
    "light.exposure":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.contrast":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.highlights":          { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.shadows":             { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "color.vibrance":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "clarity.amount":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "grain.amount":              { "type": "scalar", "range": [0, 100],      "default": 0,    "step": 1 },
    "filters.vignette_amount":   { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 }
  },
  "bindings": [
    { "param_key": "weather.position",         "control_type": "slider", "label": "Conditions" },
    { "param_key": "kelvin.kelvin",            "control_type": "slider", "label": "WB" },
    { "param_key": "light.exposure",           "control_type": "slider", "label": "Exposure" },
    { "param_key": "light.contrast",           "control_type": "slider", "label": "Contrast" },
    { "param_key": "light.highlights",         "control_type": "slider", "label": "Highlights" },
    { "param_key": "light.shadows",            "control_type": "slider", "label": "Shadows" },
    { "param_key": "color.vibrance",           "control_type": "slider", "label": "Vibrance" },
    { "param_key": "clarity.amount",           "control_type": "slider", "label": "Clarity" },
    { "param_key": "grain.amount",             "control_type": "slider", "label": "Grain" },
    { "param_key": "filters.vignette_amount",  "control_type": "slider", "label": "Vignette" }
  ],
  "engine": { "shader": "compound", "render_order": 5, "node_type": "compound" },
  "compound": {
    "driver": "weather.position",
    "interpolation": "catmull_rom_1d",
    "anchors": [
      { "position": 0.00, "name": "sunny",          "values": { "kelvin.kelvin": 8000, "light.exposure":  10, "light.contrast":  15, "light.highlights": -10, "light.shadows":   0, "color.vibrance":  15, "clarity.amount":   5, "grain.amount":  0, "filters.vignette_amount":   0 } },
      { "position": 0.25, "name": "partly_cloudy",  "values": { "kelvin.kelvin": 7500, "light.exposure":   0, "light.contrast":   5, "light.highlights":  -5, "light.shadows":   5, "color.vibrance":   5, "clarity.amount":   0, "grain.amount":  0, "filters.vignette_amount":   0 } },
      { "position": 0.50, "name": "overcast",       "values": { "kelvin.kelvin": 6500, "light.exposure": -10, "light.contrast": -10, "light.highlights":   0, "light.shadows":  10, "color.vibrance": -15, "clarity.amount": -10, "grain.amount":  0, "filters.vignette_amount":  -5 } },
      { "position": 0.75, "name": "fog",            "values": { "kelvin.kelvin": 6500, "light.exposure":  -5, "light.contrast": -25, "light.highlights":   0, "light.shadows":  15, "color.vibrance": -30, "clarity.amount": -40, "grain.amount":  0, "filters.vignette_amount": -10 } },
      { "position": 1.00, "name": "rain",           "values": { "kelvin.kelvin": 5500, "light.exposure": -15, "light.contrast":   5, "light.highlights":  -5, "light.shadows":   5, "color.vibrance": -15, "clarity.amount":  10, "grain.amount": 20, "filters.vignette_amount": -15 } }
    ]
  }
}
```

- [ ] **Step 2: Add loader assertion test**

Add to `backend/tests/registry/test_loader.py`:

```python
def test_weather_op_loads_with_compound():
    reg = reload_registry()
    op = reg.ops.get("weather")
    assert op is not None
    assert op.category == "mood"
    assert op.compound is not None
    assert op.compound.driver == "weather.position"
    assert len(op.compound.anchors) == 5
    names = [a.name for a in op.compound.anchors]
    assert names == ["sunny", "partly_cloudy", "overcast", "fog", "rain"]
```

- [ ] **Step 3: Run loader tests + Vite glob smoke**

```bash
cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/ -v 2>&1 | tail -15
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/op-jsons.smoke.test.ts
```
Expected: all PASS. Loader test count goes up by 1; Vite glob op count goes up by 1.

If validation fails, the schema rejected something — read the error and fix the JSON. Common issues: missing key from a `values` dict (must be identical across all anchors), position out of [0, 1], driver not in `params`.

- [ ] **Step 4: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/ops/weather.json backend/tests/registry/test_loader.py
git commit -m "feat(registry): weather compound dial (sunny → rain, 5 anchors)"
```

---

## Task 3: Mood (4 anchors)

**Visible effect:** A new `mood` op exists (id `mood`, category `mood` — distinct concepts: op_id is the dial, category is the grouping). Cmd+K "make it dramatic" should spawn a Mood widget at position ~0.66.

**Files:**
- Create: `shared/registry/ops/mood.json`
- Test: `backend/tests/registry/test_loader.py` (extend)

- [ ] **Step 1: Author `mood.json`**

Create `shared/registry/ops/mood.json` with this exact content:

```json
{
  "id": "mood",
  "display_name": "Mood",
  "category": "mood",
  "llm": {
    "description": "1-D dial that ramps emotional tension from serene to aggressive. Coordinates contrast, clarity, shadow crush, vignette closure, and split-tone hue shift. Independent of color temperature.",
    "typical_use": "User says 'make it dramatic', 'serene', 'aggressive', 'calm', 'cinematic', 'intense', 'soft mood'.",
    "semantic_tags": ["mood", "tension", "atmosphere", "cinematic"]
  },
  "params": {
    "mood.position":             { "type": "scalar", "range": [0, 1],         "default": 0.33, "step": 0.001 },
    "light.contrast":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.shadows":             { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.highlights":          { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "color.vibrance":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "color.saturation":          { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "clarity.amount":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "splitTone.shadow_hue":      { "type": "scalar", "range": [0, 360],       "default": 200,  "step": 1, "unit": "deg" },
    "splitTone.highlight_hue":   { "type": "scalar", "range": [0, 360],       "default": 30,   "step": 1, "unit": "deg" },
    "filters.vignette_amount":   { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 }
  },
  "bindings": [
    { "param_key": "mood.position",            "control_type": "slider", "label": "Intensity" },
    { "param_key": "light.contrast",           "control_type": "slider", "label": "Contrast" },
    { "param_key": "light.shadows",            "control_type": "slider", "label": "Shadows" },
    { "param_key": "light.highlights",         "control_type": "slider", "label": "Highlights" },
    { "param_key": "color.vibrance",           "control_type": "slider", "label": "Vibrance" },
    { "param_key": "color.saturation",         "control_type": "slider", "label": "Saturation" },
    { "param_key": "clarity.amount",           "control_type": "slider", "label": "Clarity" },
    { "param_key": "splitTone.shadow_hue",     "control_type": "hue_wheel", "label": "Shadow Hue" },
    { "param_key": "splitTone.highlight_hue",  "control_type": "hue_wheel", "label": "Highlight Hue" },
    { "param_key": "filters.vignette_amount",  "control_type": "slider", "label": "Vignette" }
  ],
  "engine": { "shader": "compound", "render_order": 5, "node_type": "compound" },
  "compound": {
    "driver": "mood.position",
    "interpolation": "catmull_rom_1d",
    "anchors": [
      { "position": 0.00, "name": "serene",     "values": { "light.contrast": -15, "light.shadows":  10, "light.highlights":  -5, "color.vibrance": -10, "color.saturation": -10, "clarity.amount": -20, "splitTone.shadow_hue": 200, "splitTone.highlight_hue": 200, "filters.vignette_amount":   0 } },
      { "position": 0.33, "name": "calm",       "values": { "light.contrast":  -5, "light.shadows":   5, "light.highlights":   0, "color.vibrance":  -5, "color.saturation":  -5, "clarity.amount":  -5, "splitTone.shadow_hue": 200, "splitTone.highlight_hue": 180, "filters.vignette_amount":  -5 } },
      { "position": 0.66, "name": "dramatic",   "values": { "light.contrast":  30, "light.shadows": -15, "light.highlights": -15, "color.vibrance":  10, "color.saturation":   5, "clarity.amount":  15, "splitTone.shadow_hue": 220, "splitTone.highlight_hue":  30, "filters.vignette_amount": -15 } },
      { "position": 1.00, "name": "aggressive", "values": { "light.contrast":  50, "light.shadows": -25, "light.highlights": -30, "color.vibrance":  20, "color.saturation":  15, "clarity.amount":  30, "splitTone.shadow_hue":  15, "splitTone.highlight_hue":  30, "filters.vignette_amount": -25 } }
    ]
  }
}
```

- [ ] **Step 2: Add loader assertion test**

Add to `backend/tests/registry/test_loader.py`:

```python
def test_mood_op_loads_with_compound():
    reg = reload_registry()
    op = reg.ops.get("mood")
    assert op is not None
    assert op.category == "mood"
    assert op.compound is not None
    assert op.compound.driver == "mood.position"
    assert len(op.compound.anchors) == 4
    names = [a.name for a in op.compound.anchors]
    assert names == ["serene", "calm", "dramatic", "aggressive"]
```

- [ ] **Step 3: Run loader tests + Vite glob smoke**

```bash
cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/ -v 2>&1 | tail -15
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/op-jsons.smoke.test.ts
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/ops/mood.json backend/tests/registry/test_loader.py
git commit -m "feat(registry): mood compound dial (serene → aggressive, 4 anchors)"
```

---

## Task 4: Season (4 anchors)

**Visible effect:** A new `season` op exists. Cmd+K "make it wintery" should spawn a Season widget at position ~1.0.

**Files:**
- Create: `shared/registry/ops/season.json`
- Test: `backend/tests/registry/test_loader.py` (extend)

- [ ] **Step 1: Author `season.json`**

Create `shared/registry/ops/season.json` with this exact content:

```json
{
  "id": "season",
  "display_name": "Season",
  "category": "mood",
  "llm": {
    "description": "1-D dial that shifts an image across the four seasons via kelvin, vibrance/saturation, per-band HSL (green/orange/blue), and split-tone. Spring/summer push greens and freshness; autumn pushes orange foliage; winter cools and desaturates.",
    "typical_use": "User says 'make it summer', 'autumn vibes', 'wintery', 'spring fresh', 'fall colors', 'seasonal shift'.",
    "semantic_tags": ["mood", "season", "atmosphere", "color"]
  },
  "params": {
    "season.position":           { "type": "scalar", "range": [0, 1],         "default": 0.33, "step": 0.001 },
    "kelvin.kelvin":             { "type": "scalar", "range": [2000, 12000],  "default": 6500, "step": 50, "unit": "K" },
    "color.vibrance":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "color.saturation":          { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "hsl.green_sat":             { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "hsl.orange_sat":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "hsl.blue_sat":              { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "light.exposure":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "splitTone.highlight_hue":   { "type": "scalar", "range": [0, 360],       "default": 30,   "step": 1, "unit": "deg" },
    "splitTone.shadow_hue":      { "type": "scalar", "range": [0, 360],       "default": 200,  "step": 1, "unit": "deg" }
  },
  "bindings": [
    { "param_key": "season.position",          "control_type": "slider", "label": "Season" },
    { "param_key": "kelvin.kelvin",            "control_type": "slider", "label": "WB" },
    { "param_key": "color.vibrance",           "control_type": "slider", "label": "Vibrance" },
    { "param_key": "color.saturation",         "control_type": "slider", "label": "Saturation" },
    { "param_key": "hsl.green_sat",            "control_type": "slider", "label": "Green Sat" },
    { "param_key": "hsl.orange_sat",           "control_type": "slider", "label": "Orange Sat" },
    { "param_key": "hsl.blue_sat",             "control_type": "slider", "label": "Blue Sat" },
    { "param_key": "light.exposure",           "control_type": "slider", "label": "Exposure" },
    { "param_key": "splitTone.highlight_hue",  "control_type": "hue_wheel", "label": "Highlight Hue" },
    { "param_key": "splitTone.shadow_hue",     "control_type": "hue_wheel", "label": "Shadow Hue" }
  ],
  "engine": { "shader": "compound", "render_order": 5, "node_type": "compound" },
  "compound": {
    "driver": "season.position",
    "interpolation": "catmull_rom_1d",
    "anchors": [
      { "position": 0.00, "name": "spring", "values": { "kelvin.kelvin": 7000, "color.vibrance":  10, "color.saturation":  5,  "hsl.green_sat":  15, "hsl.orange_sat":   0, "hsl.blue_sat":   5, "light.exposure":  0, "splitTone.highlight_hue":  90, "splitTone.shadow_hue": 200 } },
      { "position": 0.33, "name": "summer", "values": { "kelvin.kelvin": 7500, "color.vibrance":  15, "color.saturation": 10,  "hsl.green_sat":  10, "hsl.orange_sat":  10, "hsl.blue_sat":  10, "light.exposure":  0, "splitTone.highlight_hue":  60, "splitTone.shadow_hue": 200 } },
      { "position": 0.66, "name": "autumn", "values": { "kelvin.kelvin": 8500, "color.vibrance":   5, "color.saturation": -5,  "hsl.green_sat": -30, "hsl.orange_sat":  30, "hsl.blue_sat": -10, "light.exposure":  0, "splitTone.highlight_hue":  35, "splitTone.shadow_hue":  20 } },
      { "position": 1.00, "name": "winter", "values": { "kelvin.kelvin": 5500, "color.vibrance": -15, "color.saturation": -10, "hsl.green_sat": -25, "hsl.orange_sat": -10, "hsl.blue_sat":  15, "light.exposure": -5, "splitTone.highlight_hue": 210, "splitTone.shadow_hue": 220 } }
    ]
  }
}
```

- [ ] **Step 2: Add loader assertion test**

Add to `backend/tests/registry/test_loader.py`:

```python
def test_season_op_loads_with_compound():
    reg = reload_registry()
    op = reg.ops.get("season")
    assert op is not None
    assert op.category == "mood"
    assert op.compound is not None
    assert op.compound.driver == "season.position"
    assert len(op.compound.anchors) == 4
    names = [a.name for a in op.compound.anchors]
    assert names == ["spring", "summer", "autumn", "winter"]
```

- [ ] **Step 3: Run loader tests + Vite glob smoke**

```bash
cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/ -v 2>&1 | tail -15
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/op-jsons.smoke.test.ts
```
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/ops/season.json backend/tests/registry/test_loader.py
git commit -m "feat(registry): season compound dial (spring → winter, 4 anchors)"
```

---

## Task 5: Age (4 anchors)

**Visible effect:** A new `age` op exists. Cmd+K "make it vintage" should spawn an Age widget at position ~0.66. Cmd+K "antique photo" → position ~1.0.

**Files:**
- Create: `shared/registry/ops/age.json`
- Test: `backend/tests/registry/test_loader.py` (extend)

- [ ] **Step 1: Author `age.json`**

Create `shared/registry/ops/age.json` with this exact content:

```json
{
  "id": "age",
  "display_name": "Age",
  "category": "mood",
  "llm": {
    "description": "1-D dial that ages an image from fresh to antique. Defining mechanic is lifted blacks + crushed whites (levels), monotonic grain ramp, and warm hue shifts on orange/yellow. Vignettes heavy at the antique end.",
    "typical_use": "User says 'vintage', 'antique', 'retro', 'aged photo', 'old film look', 'faded print'.",
    "semantic_tags": ["mood", "age", "vintage", "film", "nostalgia"]
  },
  "params": {
    "age.position":              { "type": "scalar", "range": [0, 1],         "default": 0.33, "step": 0.001 },
    "levels.inBlack":            { "type": "scalar", "range": [0, 255],       "default": 0,    "step": 1 },
    "levels.inWhite":            { "type": "scalar", "range": [0, 255],       "default": 255,  "step": 1 },
    "light.contrast":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "color.saturation":          { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "color.vibrance":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "hsl.orange_hue":            { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 },
    "grain.amount":              { "type": "scalar", "range": [0, 100],      "default": 0,    "step": 1 },
    "splitTone.highlight_hue":   { "type": "scalar", "range": [0, 360],       "default": 30,   "step": 1, "unit": "deg" },
    "filters.vignette_amount":   { "type": "scalar", "range": [-100, 100],    "default": 0,    "step": 1 }
  },
  "bindings": [
    { "param_key": "age.position",             "control_type": "slider", "label": "Age" },
    { "param_key": "levels.inBlack",           "control_type": "slider", "label": "Black Point" },
    { "param_key": "levels.inWhite",           "control_type": "slider", "label": "White Point" },
    { "param_key": "light.contrast",           "control_type": "slider", "label": "Contrast" },
    { "param_key": "color.saturation",         "control_type": "slider", "label": "Saturation" },
    { "param_key": "color.vibrance",           "control_type": "slider", "label": "Vibrance" },
    { "param_key": "hsl.orange_hue",           "control_type": "slider", "label": "Orange Hue" },
    { "param_key": "grain.amount",             "control_type": "slider", "label": "Grain" },
    { "param_key": "splitTone.highlight_hue",  "control_type": "hue_wheel", "label": "Highlight Hue" },
    { "param_key": "filters.vignette_amount",  "control_type": "slider", "label": "Vignette" }
  ],
  "engine": { "shader": "compound", "render_order": 5, "node_type": "compound" },
  "compound": {
    "driver": "age.position",
    "interpolation": "catmull_rom_1d",
    "anchors": [
      { "position": 0.00, "name": "fresh",   "values": { "levels.inBlack":   0, "levels.inWhite": 255, "light.contrast":   0, "color.saturation":   0, "color.vibrance":   0, "hsl.orange_hue":   0, "grain.amount":  0, "splitTone.highlight_hue":  30, "filters.vignette_amount":   0 } },
      { "position": 0.33, "name": "retro",   "values": { "levels.inBlack":   6, "levels.inWhite": 248, "light.contrast":  -8, "color.saturation": -10, "color.vibrance":  -5, "hsl.orange_hue":  10, "grain.amount":  8, "splitTone.highlight_hue":  35, "filters.vignette_amount":  -5 } },
      { "position": 0.66, "name": "vintage", "values": { "levels.inBlack":  12, "levels.inWhite": 240, "light.contrast": -15, "color.saturation": -25, "color.vibrance": -15, "hsl.orange_hue":  20, "grain.amount": 15, "splitTone.highlight_hue":  40, "filters.vignette_amount": -12 } },
      { "position": 1.00, "name": "antique", "values": { "levels.inBlack":  20, "levels.inWhite": 230, "light.contrast": -25, "color.saturation": -40, "color.vibrance": -30, "hsl.orange_hue":  30, "grain.amount": 30, "splitTone.highlight_hue":  45, "filters.vignette_amount": -20 } }
    ]
  }
}
```

- [ ] **Step 2: Add loader assertion test**

Add to `backend/tests/registry/test_loader.py`:

```python
def test_age_op_loads_with_compound():
    reg = reload_registry()
    op = reg.ops.get("age")
    assert op is not None
    assert op.category == "mood"
    assert op.compound is not None
    assert op.compound.driver == "age.position"
    assert len(op.compound.anchors) == 4
    names = [a.name for a in op.compound.anchors]
    assert names == ["fresh", "retro", "vintage", "antique"]
```

- [ ] **Step 3: Run loader tests + Vite glob smoke**

```bash
cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/ -v 2>&1 | tail -15
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/op-jsons.smoke.test.ts
```
Expected: all PASS.

- [ ] **Step 4: Extend the catalog test to assert all 5 dials are visible**

Extend the existing `test_plan_widget_stack_catalog_surfaces_compound_dial` in `backend/tests/services/test_anthropic_planner.py` to assert all 5 dials' anchor names show up in the catalog blob:

Find the existing assertion block:
```python
    # Anchor names should be surfaced so the model picks the right position.
    for name in ("dawn", "noon", "golden", "blue", "night"):
        assert name in catalog_blob
```

Replace with:

```python
    # All 5 compound dials' anchor names should appear in the catalog.
    expected_anchor_names = (
        # time-of-day
        "dawn", "noon", "golden", "blue", "night",
        # weather
        "sunny", "partly_cloudy", "overcast", "fog", "rain",
        # mood
        "serene", "calm", "dramatic", "aggressive",
        # season
        "spring", "summer", "autumn", "winter",
        # age
        "fresh", "retro", "vintage", "antique",
    )
    for name in expected_anchor_names:
        assert name in catalog_blob, f"missing anchor name in catalog: {name}"
    # All 5 compound op ids should appear too.
    for op_id in ("time-of-day", "weather", "mood", "season", "age"):
        assert op_id in catalog_blob, f"missing compound op_id in catalog: {op_id}"
```

- [ ] **Step 5: Run the extended catalog test**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/services/test_anthropic_planner.py -v`
Expected: PASS (3 tests: returns_op_plan, nested_shape, catalog_surfaces_compound_dial).

- [ ] **Step 6: Run full backend sweep**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -5`
Expected: all green.

- [ ] **Step 7: Run frontend tsc + targeted vitest**

```bash
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/ src/components/widget/ src/components/workspace/ shared/registry/ 2>&1 | tail -10
```
Expected: tsc clean; vitest green.

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add shared/registry/ops/age.json backend/tests/registry/test_loader.py backend/tests/services/test_anthropic_planner.py
git commit -m "feat(registry): age compound dial (fresh → antique, 4 anchors); catalog test covers all 5 dials"
```

---

## Tuning pass (manual, after commit 5)

After commit 5, spin up the dev server and exercise each new dial. The anchor values shipped in this plan are informed estimates, NOT final. Visual iteration is expected.

For each dial:
1. Spawn it via Cmd+K (use the typical_use phrases as inputs — e.g. "make it stormy" → weather).
2. Drag the position slider slowly through all anchors.
3. For each anchor, verify the look is reasonable against a representative test image.
4. If a value is clearly wrong (e.g. "winter" looks summery, "antique" doesn't look aged), edit the JSON and reload.

Common tuning levers:
- **Kelvin too neutral/extreme:** values can range 2000-12000 in shader convention. Reference TOD's range (4500-9800).
- **Contrast/vibrance overdriven:** the planner may compose other widgets on top; conservative compound values stack better.
- **HSL band shifts insufficient:** -30/+30 is common; -50/+50 starts to feel artificial.
- **Grain too gritty at antique:** 30 is a lot. Try 20 if the texture overwhelms.

The framework's lock-on-edit feature helps: drag a dial, edit a single value manually, lock it, snapshot the final dial state, then transfer those numbers into the JSON.

**No git commit for tuning until the values feel right.** Then commit the JSON edits with a `tune:` prefix:

```bash
git commit -m "tune(registry): tighten anchor values for <widget> after smoke test"
```

---

## Definition of Done

After commit 5:

- Five compound dial ops in `shared/registry/ops/`: `time-of-day`, `weather`, `mood`, `season`, `age`.
- All five have `category: "mood"`.
- Cmd+K examples produce single widgets:
  - "make it stormy" → ONE weather widget
  - "make it dramatic" → ONE mood widget
  - "make it wintery" → ONE season widget
  - "make it vintage" → ONE age widget
  - "make it night" → ONE time-of-day widget (still works post-category-shift)
- Multi-dial intents produce stacks:
  - "winter sunset" → season + time-of-day
  - "vintage stormy" → age + weather
- Each widget renders via `CompoundWidgetBody` with its anchor cards and lock-on-edit.
- Backend tests: ≥471 passing (467 existing + 4 new loader tests; planner tests 3/3).
- Frontend tests: targeted subset green (no new tests; framework unchanged).
- `npx tsc --noEmit` clean.
- Tuning pass complete: each dial dragged through its anchors in dev server against at least one test image; egregious values flagged and adjusted.
