# Fused Template Library Expansion — Design

**Date:** 2026-06-01
**Status:** Approved design, pre-implementation
**Author:** Anton + Claude

## 1. Problem & Context

The Cmd+K palette routes free-form prompts through `propose_widget` (`origin: 'mcp_user_prompt'`),
which asks Claude to pick a fused template from `all_fused_templates()` and then resolves
that template's numeric values. The current library has nine templates: `warm_grade`,
`cool_grade`, `exposure_balance`, `sky_recovery`, `portrait_glow`, `bw_cinematic`,
`cast_correct`, `teal_orange`, `subject_pop`.

The catalogue has two practical gaps:

1. **No HSL coverage.** A prompt like "green tones are not good" has no obvious match;
   `cast_correct` wins on the loose lexical hit "colour cast" and produces a kelvin +
   saturation widget rather than an HSL-band shift. The user wanted a per-colour tone tool.
2. **Sparse coverage of common photography intents.** Tonal moods (moody, dreamy, vintage),
   time-of-day atmospheres, per-channel light surgery, B&W variants, finishing moves, and
   colour-theory grades are all absent — so the picker either guesses with a poor fit or
   the user falls back to manual sliders.

The first issue is the immediate trigger. The second is the underlying shape: we need
roughly four times the catalogue, and we need a code organisation that does not force a
hand-written `resolve()` method per template.

## 2. Goals & Non-Goals

**Goals**
- Add **31 new fused templates** across eight families (see §3.3 for the full catalogue).
- Introduce a **default `resolve()`** on `FusedToolTemplate` so new templates can be pure
  data (skeleton + envelope + descriptions); subclasses override only for non-numeric
  schemas or special prompt shapes.
- Group related templates into one module per family, instead of one file per template.
- Keep existing templates (`warm_grade` … `subject_pop`) untouched — no migration churn.
- Zero frontend changes — `HslWidgetBody` already detects single-band widgets and renders
  the single-band view; multi-op widgets render through the existing `BindingRow` list.

**Non-Goals**
- A two-stage picker (family → template). Flat picker stays for now; revisit only if the
  picker starts misfiring on the expanded list.
- Templates that require engine ops we do not have: `film_grain` (no noise op),
  `gentle_glow` (no blur + screen-blend chain), `vignette` (no gradient mask plumbing).
- Stock-film emulations (`portra`, `velvia`, `ektachrome`). Those are essentially curated
  LUTs; the LUT path (`fused_tool_id: 'filter'`) already handles that and a "library of
  stocks" is a separate design.
- Picker prompt-engineering beyond per-template `description` / `typical_use` wording.

## 3. Design

### 3.1 Default resolver on `FusedToolTemplate`

Every existing `resolve()` follows the same shape: build a JSON schema with the tunable
keys + their `min/max` from `param_envelope`, build a prompt payload from the fields named
in `context_inputs`, call `anthropic.resolve_fused_tool(template_id=self.id, prompt_payload,
response_schema, …)`, return `ResolvedNumbers.model_validate(raw)`. Scaling that pattern
31 more times by hand is pure boilerplate.

Add a **default `async resolve(...)`** on `FusedToolTemplate` that:

1. Builds the response schema from `self.param_envelope`:
   ```python
   {
     "type": "object", "additionalProperties": False, "required": ["values"],
     "properties": {
       "values": {
         "type": "object", "additionalProperties": False,
         "required": list(self.param_envelope.keys()),
         "properties": {k: {"type": "number"} for k in self.param_envelope},
       },
       "reasoning": {"type": "string"},
     },
   }
   ```
2. Builds the prompt payload from `self.context_inputs`:
   ```python
   {
     "intent": intent,
     "scope": scope.model_dump(mode="json"),
     "context_summary": {k: getattr(ctx, k, None) for k in self.context_inputs},
     "prior_widget_values": (
       {b.param_key: b.value for b in prior_widget.bindings}
       if prior_widget is not None else None
     ),
     "instruction": instruction,
   }
   ```
   `getattr` with a default (`None`) so a stale `context_inputs` entry degrades rather than
   crashes; the picker prompt's context simply gets `None` for that key.
3. Calls `anthropic.resolve_fused_tool(template_id=self.id, prompt_payload=…,
   response_schema=…, session_id=…)` and returns `ResolvedNumbers.model_validate(raw)`,
   wrapping any exception in `ResolverError` exactly like `cast_correct` does today.

The existing nine templates keep their hand-written `resolve()`. The new 31 inherit the
default. A subclass overrides only when (a) the response schema is non-numeric (e.g. an
expression encoded as a string), or (b) the prompt payload needs unusual shaping.

**Pydantic note.** `FusedToolTemplate` is a `BaseModel` (see `fused_framework.py:62`). The
default `resolve()` is added as a regular `async def` on the class; pydantic doesn't
require any special handling for methods.

### 3.2 Module-per-family layout

Instead of one file per template, group related templates in one module each. The
`__init__.py` factory function yields instances in a stable order.

```
backend/app/tools/fused/
├── __init__.py               (yields all templates)
├── bw_cinematic.py           (existing)
├── cast_correct.py           (existing)
├── cool_grade.py             (existing)
├── exposure_balance.py       (existing)
├── portrait_glow.py          (existing)
├── sky_recovery.py           (existing)
├── subject_pop.py            (existing)
├── teal_orange.py            (existing)
├── warm_grade.py             (existing)
├── tone_band.py              (NEW: 8 ToneBandTemplate instances)
├── moods.py                  (NEW: 5)
├── atmospheres.py            (NEW: 4)
├── light_surgery.py          (NEW: 4)
├── contrast.py               (NEW: 3)
├── bw_variants.py            (NEW: 2)
├── finishing.py              (NEW: 2)
└── colour_theory.py          (NEW: 3)
```

Each new module exports its template classes (or, for `tone_band.py`, a single class
parametrised by band). `__init__.py` constructs and yields them.

### 3.3 Catalogue (31 templates)

Recipes below are normative: they pin which engine ops a template's nodes use and which
params the resolver chooses. Numeric envelopes are stated as `[min, max]`; `skin_safe_max`
is included only where the band can affect skin.

#### Tone bands (`tone_band.py`, 8 templates)

`ToneBandTemplate(band: str)` parametrised by `band ∈ {red, orange, yellow, green, aqua,
blue, purple, magenta}`.

- `id = f"tone_{band}"`, `label = f"Adjust {band} tones"`
- `description`: explicit colour name + 2–3 synonyms so the picker latches. Examples:
  - `tone_green`: "Shift the green colour family — greenish, lime, olive — in HSL space."
  - `tone_aqua`: "Shift the aqua / cyan / teal-leaning colour family in HSL space."
  - `tone_magenta`: "Shift the magenta / pink / fuchsia colour family in HSL space."
- `typical_use`: prompt-style examples — `"User says '{band} tones are off', 'too much
  {band}', 'desaturate the {band}s'"`.
- `node_skeleton`: one `hsl` node, tunable keys `[{band}_hue, {band}_sat, {band}_lum]`.
- `bindings_skeleton`: three sliders (Hue / Sat / Lum) targeting that node, each with
  `param_key = f"{band}_<channel>"` — required by `HslWidgetBody.tsx`'s band detection
  (`param_key.split('_')[0]`). Range `[-100, 100]`, `step=1`, `tunable_default=True`
  (Reset returns to AI's resolved values; × dismisses entirely).
- `param_envelope`: `ParamRange(min=-100, max=100, step=1)` for each of the three keys.
  For `tone_red` and `tone_orange`, add `skin_safe_max=30` on `*_hue` and `*_sat` so the
  envelope clamp protects skin when the scope is flagged skin-likely.
- `context_inputs = ["color_palette", "region_stats", "grade_character"]`.
- `preview = {"kind": "thumbnail", "auto_before_after": True}`.
- `requires_scope = "any"`.

#### Tonal mood grades (`moods.py`, 5 templates)

| Id | Recipe (ops) | Tunable keys | Notes |
|---|---|---|---|
| `moody` | `light` + `color` + `curves` | `exposure`, `contrast`, `saturation`, `curves` | drop exposure slightly, raise contrast, drop sat, shadow-dip RGB curve |
| `dreamy` | `light` + `color` + `clarity` | `exposure`, `shadows`, `highlights`, `saturation`, `amount` (clarity) | lift shadows, soften highlights, drop sat, clarity negative |
| `vintage` | `levels` + `color` + `hsl` | `inBlack`, `inWhite`, `saturation`, `red_hue`, `yellow_hue` | crushed-but-lifted blacks, slight desat, push red/yellow toward warm tints |
| `matte_film` | `levels` + `curves` | `inBlack`, `inWhite`, `curves` | lifted blacks + dropped whites (matte); subtle S-curve in mids |
| `gritty` | `light` + `color` + `sharpen` + `clarity` | `contrast`, `saturation`, `amount` (sharpen), `amount` (clarity) | high contrast, desat, sharpen+, clarity+ |

All five use the default resolver. `context_inputs = ["grade_character", "luma_histogram",
"contrast_p10_p90"]`. `tunable_default=True` for every binding.

#### Time-of-day atmospheres (`atmospheres.py`, 4 templates)

| Id | Recipe | Tunable keys |
|---|---|---|
| `golden_hour` | `kelvin` + `light` + `color` | `temperature`, `shadows`, `saturation` |
| `blue_hour` | `kelvin` + `light` + `color` | `temperature`, `shadows`, `saturation` |
| `overcast` | `color` + `light` | `saturation`, `contrast` |
| `foggy` | `levels` + `kelvin` | `inBlack`, `temperature` |

`context_inputs = ["estimated_white_point", "grade_character", "luma_histogram"]`.

#### Per-channel light surgery (`light_surgery.py`, 4 templates)

| Id | Recipe | Tunable keys | Picker hooks |
|---|---|---|---|
| `lift_shadows` | `light` | `shadows`, `blacks` | "open up the shadows", "shadows are blocked", "lift the dark areas" |
| `deepen_blacks` | `light` + `levels` | `blacks`, `inBlack` | "deepen blacks", "more punch in the blacks", "crush the shadows" |
| `recover_highlights` | `light` | `highlights`, `whites` | "recover highlights", "blown out", "too bright", "tone down the brights" |
| `contrast_punch` | `light` + `curves` | `contrast`, `curves` | "more contrast", "more punch", "flat — needs depth" |

`context_inputs = ["luma_histogram", "clipped_shadows_pct", "clipped_highlights_pct",
"contrast_p10_p90"]`.

#### Contrast (`contrast.py`, 3 templates)

| Id | Recipe | Tunable keys |
|---|---|---|
| `detail_pop` | `sharpen` + `clarity` + `light` | `amount` (sharpen), `amount` (clarity), `contrast` |
| `contrast_drop` | `light` + `levels` | `contrast`, `inBlack` |
| `s_curve_pop` | `curves` | `curves` |

`context_inputs = ["contrast_p10_p90", "luma_histogram"]`.

#### B&W variants (`bw_variants.py`, 2 templates)

Both pin `color.saturation = -100` via `fixed_params` on the `color` node, then tune
contrast/levels on top.

| Id | Recipe | Tunable keys |
|---|---|---|
| `bw_high_contrast` | `color` (sat=−100 fixed) + `light` + `curves` | `contrast`, `curves` |
| `bw_low_key` | `color` (sat=−100 fixed) + `light` + `levels` | `shadows`, `inWhite` |

`context_inputs = ["luma_histogram", "contrast_p10_p90", "grade_character"]`.

#### Finishing (`finishing.py`, 2 templates)

| Id | Recipe | Tunable keys | Notes |
|---|---|---|---|
| `split_toning` | `curves` | `curves` (red + blue channels) | shadow-side hue on one channel curve, highlight-side hue on the other |
| `micro_contrast` | `clarity` | `amount` | single-knob polish |

`context_inputs = ["grade_character", "contrast_p10_p90"]`.

#### Colour-theory grades (`colour_theory.py`, 3 templates)

| Id | Recipe | Tunable keys |
|---|---|---|
| `complementary_grade` | `curves` + `hsl` | `curves`, two band hue keys (one warm, one cool) |
| `analogous_grade` | `hsl` | three adjacent band `_hue` keys |
| `monochrome_tint` | `color` (sat=−100 fixed) + `kelvin` | `temperature`, `tint` |

`context_inputs = ["color_palette", "grade_character"]`.

### 3.4 Picker scale

Today `name_pick_fused_tool` sends the picker model a list with nine `{id, description,
typical_use}` candidates. After this change it sends 40. The picker prompt grows roughly
4× in token cost but stays well within the model's context.

The accuracy risk is that two similar templates (e.g. `golden_hour` vs `warm_grade`) split
the picker's choice. Per-template `description` wording is the lever: lead with the colour
words or photographic register the user is most likely to say. We will revisit if accuracy
is visibly poor — at which point a two-stage router (family pick, then template pick)
becomes a separate design. Not part of this spec.

### 3.5 What we are NOT doing

- **`film_grain`, `gentle_glow`, `vignette`** — need engine support we don't have (noise
  op, blur+screen blend chain, gradient mask). Defer.
- **Stock-film emulations** (`portra`, `velvia`, `ektachrome`) — these are essentially
  curated LUTs. The `fused_tool_id: 'filter'` path already covers LUT application; a
  "library of stocks" is a separate design.
- **Two-stage picker / router** — only if flat-picker accuracy proves bad.
- **Frontend changes** — `HslWidgetBody` already routes single-band widgets to
  `HslSingleBandView`; multi-op widgets render through the existing `BindingRow` list.
- **Touching existing templates** — they keep their hand-written `resolve()`. The default
  resolver is for new ones only, so no risk to current behaviour.

## 4. Testing Strategy

- **Default-resolver unit tests** in `backend/tests/tools/test_fused_default_resolver.py`:
  schema-from-envelope generation, context-inputs payload assembly (including missing
  `ctx` attributes degrading to `None`), and that the resolver wraps thrown exceptions in
  `ResolverError`.
- **Per-family smoke tests** in `backend/tests/tools/fused/`:
  one parametrised test per module that instantiates every template in the module,
  verifies `id`, `node_skeleton`, `bindings_skeleton`, `param_envelope`, and that the
  generated response schema validates a hand-crafted minimal payload.
- **Tone-band integration test**: hit
  `POST /api/tools/propose_widget` with `intent="green tones are not good"`, mock the
  picker to return `tone_green`, mock the resolver to return canned numbers, and assert
  the resulting widget's bindings carry `green_hue`, `green_sat`, `green_lum` — so the
  frontend's single-band detection triggers correctly.
- **Catalogue smoke test**: `all_fused_templates()` yields 40 templates, IDs are unique,
  and every template's `param_envelope` keys exactly match its `node_skeleton`'s
  `tunable_param_keys`.
- **No frontend test changes** — `HslWidgetBody.test.tsx` already covers the single-band
  rendering branch.

## 5. Risks

1. **Picker quality** — 40 templates is a lot for one prompt. If routing is poor, we add a
   two-stage router (a separate design). The fallback today (`fused_id = "warm_grade"`
   when picker returns nothing) still works.
2. **Skin-safe clamp on `tone_red` / `tone_orange`** — only relevant when scope is flagged
   skin-likely (`_scope_is_skin_likely` in `fused_framework.py`). For global scope these
   bands can push freely, which is the right behaviour for prompts like "shift the reds".
3. **Catalogue duplication with tool_invoked path** — `TOOL_DEFAULTS['hsl']` and the
   `tone_<band>` fused templates can both produce HSL widgets. That's intentional: the
   tool_invoked path is "open the all-bands panel as a widget", the fused path is "AI
   picks the right band for this prompt". Same engine, two entry points.

## 6. Future Work

- Two-stage picker (family → template) when 40 grows unwieldy.
- `vignette` / `gentle_glow` once gradient-mask and blend-chain plumbing exists.
- A stock-film LUT library spec (separate from this design).
