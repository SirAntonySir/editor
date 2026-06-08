# Creative Compound Widgets — Design

**Status:** Draft
**Date:** 2026-06-09
**Author:** Anton (with Claude)
**Branch:** to be created off `feat/compound-widget-framework` (or `main` post-merge)

---

## 1. Problem

The Compound Widget Framework (spec `2026-06-08-compound-widget-framework-design.md`, landed) ships exactly one compound 1D dial: **time-of-day**. The framework is generic — adding a new compound op is supposed to be one JSON file with a `compound` block, no code.

This spec proves that out by adding **four creative compound widgets** that cover semantically-distinct intent axes:

- **Weather** — sunny → stormy
- **Mood** — serene → aggressive
- **Season** — spring → winter
- **Age** — fresh → antique

Together with time-of-day, these give the planner five orthogonal mood/atmosphere axes. Users typing "make it night" / "make it stormy" / "make it dramatic" / "winter scene" / "vintage feel" should each land on the right single-dial widget.

## 2. Goals

1. **One JSON file per widget.** No new code. No new components. No new shaders. The framework already handles compound ops generically.
2. **Plausible anchor values** out of the box — informed by cinematic-color-grading conventions and the existing TOD anchor table. Final tuning happens during implementation in the dev server.
3. **Categorize coherently.** Add a `mood` category and move all five compound dials into it.
4. **Planner picks the right dial for typical intents.** "Stormy" → weather=1.0. "Dramatic" → mood=0.66. "Winter sunset" → season + time-of-day (two widgets stacked).

## 3. Non-goals

- 2D compound widgets (e.g. weather × time on one dial).
- Per-anchor LLM planner hooks (`{op_id, anchor_name: "golden"}` instead of `{position: 0.55}`) — deferred.
- Anchor tuning UI (drag-to-edit anchor positions on the dial) — authoring-only feature.
- Cross-dial conflict resolution — accept stacking per the framework design.
- Auto-fitting more compound widgets (palette, texture, depth) — defer until these four prove themselves.
- Linear interpolation as an alternative to Catmull-Rom — framework limitation, separate spec.

## 4. Architecture

Five new files + two single-line edits:

```
shared/registry/ops/
  weather.json           NEW — 5 anchors (sunny → rain)
  mood.json              NEW — 4 anchors (serene → aggressive)
  season.json            NEW — 4 anchors (spring → winter)
  age.json               NEW — 4 anchors (fresh → antique)
  time-of-day.json       EDIT — category "tone" → "mood"

backend/app/services/anthropic_client.py
  _PLANNER_SYSTEM_PROMPT  EDIT — add "mood" to category list; one sentence on
                                  multi-dial stacking for composite intents

backend/tests/registry/test_loader.py
  + 4 new test functions   NEW — per-widget loader assertions

backend/tests/services/test_anthropic_planner.py
  test_plan_widget_stack_catalog_surfaces_compound_dial  EDIT — assert all 5
                                                                dials in catalog
```

Nothing else. The shared interpolation library, `resolve_compound`, `CompoundWidgetBody`, and `ToolSection.tsx` dispatch all already handle any compound op.

## 5. Widget designs

Each widget's `compound.driver` is `<op_id>.position` (e.g. `weather.position`). The label override in bindings provides the semantic UI label ("Conditions", "Intensity", "Season", "Age"). All four declare `category: "mood"`.

### 5.1 Weather

**File:** `shared/registry/ops/weather.json`
**Anchors (5):** Sunny (0.0) · Partly Cloudy (0.25) · Overcast (0.5) · Fog (0.75) · Rain (1.0)
**Param vocab (9):**
| Param | Why |
|---|---|
| `kelvin.kelvin` | Warm-golden (sunny) → neutral (overcast) → cool blue (rain) |
| `light.exposure` | Sunny brightens; overcast/rain darkens |
| `light.contrast` | Sunny crisp; fog tanks contrast; rain mild |
| `light.highlights` | Sunny recovers (-) bright skies; rain neutral |
| `light.shadows` | Fog lifts (+); rain mild lift |
| `color.vibrance` | Sunny boosts; overcast/fog/rain crushes |
| `clarity.amount` | Fog uses negative clarity for haze; rain slightly positive |
| `grain.amount` | Rain adds organic texture (+20) |
| `filters.vignette_amount` | Subtle on overcast/rain for closed-in feel |

Reasoning: weather is the only widget combining `clarity` (haze) and `grain` (rain texture), which together produce the atmospheric "feel" beyond pure color shift.

### 5.2 Mood

**File:** `shared/registry/ops/mood.json`
**Anchors (4):** Serene (0.0) · Calm (0.33) · Dramatic (0.66) · Aggressive (1.0)
**Param vocab (9):**
| Param | Why |
|---|---|
| `light.contrast` | -15 (serene) → +50 (aggressive) — defining axis |
| `light.shadows` | Open at low end, crushed at high end |
| `light.highlights` | Aggressive crushes highlights too |
| `color.vibrance` | Negative (serene) → positive (aggressive) |
| `color.saturation` | Tracks vibrance |
| `clarity.amount` | -20 soft (serene) → +30 punchy (aggressive) |
| `splitTone.shadow_hue` | Cool/neutral → warm-amber as intensity rises |
| `splitTone.highlight_hue` | Mirrors |
| `filters.vignette_amount` | 0 → -25 (closes in at aggressive) |

Reasoning: mood is about TENSION, not color temperature. No kelvin (mood is independent of the image's white balance). The `splitTone` dual-hue axis is the secondary mood-shaping tool after contrast/clarity.

### 5.3 Season

**File:** `shared/registry/ops/season.json`
**Anchors (4):** Spring (0.0) · Summer (0.33) · Autumn (0.66) · Winter (1.0)
**Param vocab (9):**
| Param | Why |
|---|---|
| `kelvin.kelvin` | Warm-fresh (spring) → very warm/amber (autumn) → cool blue (winter) |
| `color.vibrance` | Fresh & saturated for spring/summer; muted for autumn/winter |
| `color.saturation` | Tracks vibrance |
| `hsl.green_sat` | Spring/summer +15/+10; autumn -30 (leaves brown); winter -25 |
| `hsl.orange_sat` | Autumn +30 (foliage); winter -10 |
| `hsl.blue_sat` | Winter +15 (cold light); others 0 |
| `light.exposure` | Winter -5 (subtle dimming); others 0 |
| `splitTone.highlight_hue` | Autumn amber; winter cool blue |
| `splitTone.shadow_hue` | Autumn warm; winter cool |

Reasoning: per-band HSL is what makes season recognizable. Generic kelvin alone wouldn't capture autumn foliage. The `hsl.{color}_sat` shifts are the season-defining mechanic.

### 5.4 Age

**File:** `shared/registry/ops/age.json`
**Anchors (4):** Fresh (0.0) · Retro (0.33) · Vintage (0.66) · Antique (1.0)
**Param vocab (9):**
| Param | Why |
|---|---|
| `levels.inBlack` | 0 → +20 (lifted blacks — the defining "aged" mechanic) |
| `levels.inWhite` | 255 → 240 (crushed whites for low contrast) |
| `light.contrast` | -25 at antique (faded film) |
| `color.saturation` | -40 at antique (faded dyes) |
| `color.vibrance` | -30 at antique |
| `hsl.orange_hue` | Warm shift at antique/vintage (yellowed paper) |
| `grain.amount` | Monotonic ramp 0 → +30 (silver halide texture) |
| `splitTone.highlight_hue` | Warm cream at antique |
| `filters.vignette_amount` | Heavy negative (-20) at antique (lens vignetting on old optics) |

Reasoning: levels (lifted blacks, crushed whites) is the unique mechanic. Grain ramping monotonically is what makes the dial feel right — every step toward antique increases the visible texture.

### 5.5 Updated time-of-day.json

One-line change:
```diff
-  "category": "tone",
+  "category": "mood",
```

No other change. Anchors and params unchanged.

## 6. Anchor value tuning

Each widget JSON ships with the ballpark values listed in §5. They are informed by:
- The existing TOD anchor table (proven values for atmospheric shifts)
- Cinematic-color-grading conventions (S-curve contrast for drama, lifted blacks for age, etc.)
- The per-band HSL behavior described in `shared/registry/ops/hsl.json`

**Expect a tuning pass after implementation.** Designing photo looks numerically requires visual iteration. The implementation plan reserves a final task for "dev server smoke + tune" where each widget is dragged through its anchors against test images and values adjusted.

## 7. Planner integration

The `compound_dial` info is already surfaced to the LLM (commit `0eea773`). For each new widget, the planner sees:

```python
{
  "id": "weather",
  "category": "mood",
  "description": "...",
  "typical_use": "User says 'sunny', 'overcast', 'stormy', 'foggy', 'rain'.",
  "semantic_tags": ["mood", "atmosphere", "weather"],
  "params": [...10 keys],
  "compound_dial": {
    "driver": "weather.position",
    "anchor_names": ["sunny", "partly_cloudy", "overcast", "fog", "rain"],
    "hint": "This is a 1-D dial preset. Set `weather.position` to one value..."
  }
}
```

The planner system prompt gains one sentence after the COMPOUND DIAL OPS rule:

> Multiple compound dials may stack when the intent spans more than one dial axis (e.g., "winter sunset" = season + time-of-day, "vintage stormy" = age + weather). Prefer ONE dial when the intent fits a single axis.

And the category list gains `mood`:
> Use the `category` field as a strong default... Common categories: tone, color, detail, texture, effect, **mood**.

## 8. Failure handling

Inherited from the framework — nothing new:

| Failure | Behavior |
|---|---|
| Anchor JSON malformed (positions unsorted, missing keys, etc.) | Schema validator rejects at load time. Loader throws. |
| Driver param key not in `op.params` | Schema validator rejects. |
| Anchor value key not in `op.params` | Schema validator rejects. |
| Position outside [0, 1] when interpolating | Clamp to endpoint (existing). |
| User stacks two compound widgets that both write to `kelvin.kelvin` | Pipeline composes (sums) the adjustments — existing widget-stacking behavior. Per Q4, accept this. |
| LLM picks an anchor name that doesn't exist | Doesn't happen — planner sets `position` (numeric), not `anchor_name`. |

## 9. Testing

| Tier | What | Where |
|---|---|---|
| Schema | Each new op JSON validates | covered by existing `test_loader_finds_all_ops` |
| Schema | Every op has a category | covered by existing `test_all_ops_have_category` (the `mood` value is accepted because category is `Optional[str]`, no closed enum) |
| Loader | Each new op shows up with correct anchor count + driver | NEW per-widget assertions in `test_loader.py` (4 small functions like `test_weather_op_loads_with_compound`) |
| Planner catalog | All 5 compound dials' `compound_dial` info reaches the LLM | EXTEND `test_plan_widget_stack_catalog_surfaces_compound_dial` to assert weather/mood/season/age anchor names visible in the catalog blob |
| Manual smoke | Dev server: each dial spawns, drags smoothly through anchors, looks reasonable | NOT automated — part of the tuning pass |

No integration tests needed. The framework already proved end-to-end for time-of-day. Adding data files exercises no new code paths.

## 10. Migration

No data migration. Five commits, each independently revertable, each ships a discrete visible improvement:

1. **`mood` category** — update planner prompt + flip `time-of-day.json` to `category: "mood"`. No behavior change beyond planner routing.
2. **Author `weather.json`** + loader test.
3. **Author `mood.json`** + loader test. (Note: op `id: "mood"`, distinct from the category named "mood" — the op is a specific dial, the category is a grouping.)
4. **Author `season.json`** + loader test.
5. **Author `age.json`** + loader test.

After commit 5: tuning pass — manual smoke in dev server, iterate on anchor values.

## 11. Definition of done

After commit 5:

- Five compound dial ops exist in `shared/registry/ops/`: `time-of-day`, `weather`, `mood`, `season`, `age`.
- All five have `category: "mood"`.
- Cmd+K "make it stormy" → ONE weather widget at position ~1.0.
- Cmd+K "make it dramatic" → ONE mood widget at position ~0.66.
- Cmd+K "make it wintery" → ONE season widget at position ~1.0.
- Cmd+K "make it vintage" → ONE age widget at position ~0.66.
- Cmd+K "winter sunset" → TWO widgets (season + time-of-day), each refineable.
- Each widget renders via `CompoundWidgetBody` with its anchor cards and lock-on-edit.
- Backend tests: ≥467 + 4 new loader tests passing.
- Frontend tests: targeted subset green (no new tests needed; no new code paths).
- `npx tsc --noEmit` clean.
- Tuning pass complete — each dial dragged through its anchors in dev server against at least one test image; egregious values flagged and adjusted.

## 12. Why these choices

**Why `mood` category for all 5 instead of per-widget categories?**
Five categories proliferating to ten (one per dial) would balkanize the planner's category-grouping logic. Smart Widget Composition's `category` field is for "how should we group widgets in a multi-op spawn?" — all five compound dials are conceptually about overall mood, so they belong in the same category. The `compound_dial` hint disambiguates between specific dials.

**Why per-widget custom param sets instead of shared 9?**
Each widget's defining mechanic uses different params. Weather needs `clarity` (haze) and `grain` (rain) which Mood doesn't. Season needs `hsl.green_sat` (foliage) which Age doesn't. Forcing a shared vocab would mean zeros in unused slots — visually fine but conceptually noisy when authoring. Each widget is now self-documenting about which params it controls.

**Why accept stacking (per Q4) instead of enforcing single-dial-only?**
The pipeline already stacks widgets. Adding single-dial enforcement adds frontend state (track active compound widget per session), planner constraints, and surprises ("why can't I have winter sunset?"). Stacking lets the user compose; if results are ugly, they refine each dial. Worst case: the planner's hint says "prefer ONE dial" so accidental composition is rare.

**Why ballpark values + a tuning pass instead of fully-designed anchor tables?**
Designing photo looks numerically without seeing the result is guesswork. Ship plausible values, render against test images, iterate. The framework's lock-on-edit feature means tuning pass can be partially user-driven — drag a slider, lock the value, snapshot it as the new anchor.

**Why deferring 2D compound and per-anchor LLM hooks?**
YAGNI. Five 1D dials cover most creative-intent axes. 2D would add framework complexity (bilinear interpolation, 2D anchor placement) for unclear UX payoff. Per-anchor LLM hooks are nicer ergonomics but the current `position` numeric approach works fine — the LLM has the anchor positions in the hint.
