# Design + UX Handover — Supplement

> **Purpose.** Companion to `design-ux-handover.md`. The first brief assumed
> the reader was already convinced the editor was an AI photo editor; this
> supplement does two jobs:
>
> 1. **Part A — Deeper arguments** for the AI-widget-generation decisions in
>    the original brief. Every entry below cites the parent Entscheidung
>    by section + number, names what the parent argument left implicit,
>    and supplies the thesis-grade rationale (with quotes from the MA
>    thesis `content.tex` and related-work citations where applicable).
> 2. **Part B — Decisions made after 2026-06-17.** The original brief was
>    committed on 2026-06-17 (`a7716a5`). Three specs and several substantive
>    commits have landed since; their decisions are documented below in the
>    same "Entscheidung" shape, continuing the numbering from the original
>    brief (the parent ends at Entscheidung 38; this supplement begins at 39).
>
> Cited sources:
> - **Thesis** (`Dynamic Interfaces for AI-Guided Image Editing`) at
>   `/Users/anton/Thesis/Latex/MA_thesis_Rockenstein/content.tex` — line refs
>   are inline.
> - **Related-work corpus** at `/Users/anton/Thesis/Research/`.
> - **Editor specs** at `docs/superpowers/specs/`.
> - **Original handover** at `docs/design-ux-handover.md`.

---

## 0 · How to read this brief

Same skeleton as the parent — *Entscheidung X*, then the argument that
produced it, with explicit ties to the thesis claim where relevant.

The thesis claim, in one line:

> AI composes *interface components* (sliders, curves, pickers, panels)
> adapted to the user's active goal and selected image region — not pixels
> directly — wired into the shader pipeline as inspectable, refinable
> widgets that coexist with the standard inspector.
> (`content.tex:8–28, 497`)

Every "deeper argument" below pivots on this. Decisions that look like UX
polish in isolation are evidence for the thesis claim when re-read in the
light of the four design themes the thesis commits to:

- **T1** — Intent-to-parameter translation as a first-class layer.
- **T2** — Adaptive widgets bounded by general-purpose access.
- **T3** — Inspectable autonomy.
- **T4** — Persistent alternatives on a spatial workspace.

(`content.tex:381–465`)

---

# Part A · Deeper arguments for the original handover

Each entry below references a section + Entscheidung from
`design-ux-handover.md`. The parent argument is summarised in *italics*;
the supplement begins under **Deeper argument**.

---

### A.1 · Attached-context chips on the Command Palette
*Parent: §3.6, Entscheidung 9 ("Two execution paths from one palette row")*

*Parent argument:* the palette has `↵` for tool rows and `⌘↵` for the AI
row; the modifier prevents conflating tool-selection with prompt-sending.

The parent brief mentions the **attached-context UI** ("drop chips … so
the prompt carries structured grounding") but treats it as convenience.
It is not.

#### Deeper argument

The thesis frames the editor as an **intent-to-parameter translation
layer** (T1) — the system's job is to take goal-language ("warmer", "more
focus on subject") and produce a *bounded, inspectable parameter panel*,
not to interpret pixels autonomously (`content.tex:381–401`). Context
chips are the user's contribution to that translation.

Without chips, the AI receives raw text and an image; it has to *guess*
which region, which colour, which problem the user is talking about.
That puts the editor in the same failure regime as instruction-following
systems (InstructPix2Pix, MagicQuill) where the model commits its
interpretation before the user can adjust (`content.tex:386, related-work
chapter`). The thesis explicitly positions against that:

> "the model commits interpretation before user can adjust; no
> intervention point at parameter level."
> (`content.tex` on MagicQuill, related-work)

A chip is *the user pointing*. When the user drops the "sky" region chip
onto Cmd+K, they have done the disambiguation. The LLM no longer chooses
*which* region; it only chooses *what to do* with the one the user named.
This narrows the translation layer's input domain and is what makes the
output (a parameter panel) inspectable: the user can verify that the
parameter targets the chip they dropped.

The chip is therefore the visible embodiment of **C4 (ambiguity
preservation vs. resolution)** from the thesis's open-challenges list —
the system *preserves* ambiguity for the user to resolve through chip
choice, instead of silently *resolving* it through LLM inference.

---

### A.2 · Three spawn paths → one `propose_widget`
*Parent: §3.6, Entscheidung 5 ("Why no permanent toolbar/toolrail?")*

*Parent argument:* a permanent toolrail would be a second surface for the
same actions; the palette is the only user-facing surface; in code,
both palette and toolrail call `propose_widget`.

The parent's argument is about attention-economy. The deeper argument is
schema-economy.

#### Deeper argument

The thesis claim requires that **an AI-composed widget is the same
artefact regardless of how it was conceived** — the same NodeSkeleton,
the same BindingSkeleton, the same operation graph contribution
(`content.tex:750–752, 940`). A widget summoned by Cmd+K, a widget minted
autonomously during analyze, and a widget invoked from a toolrail button
all share one schema, one persistence path, one undo entry.

If the three paths had different code branches, the user could spawn a
"warmer" widget from Cmd+K and a "warmer" widget from a button, and the
two could carry *different* binding shapes — the abstraction would leak.
The thesis's contribution claim is "shared canonical state in which
AI-proposed and user-edited adjustment values coexist" (`content.tex:497`).
That claim is only credible if the AI's proposals enter the canonical
state through *one* contract.

The `origin: 'tool_invoked' | 'mcp_user_prompt' | 'mcp_autonomous'` tag
on the widget envelope records *how* the widget was spawned for
provenance and labelling, but the widget structure is identical. The
unification is the architectural guarantee behind Entscheidung 19's
single-rule provenance colour: violet means "AI touched this" regardless
of which spawn path produced it, because the spawn path is the only
difference.

---

### A.3 · Provenance colour rule (violet / blue / grey)
*Parent: §8.4 Entscheidung 19, §10 Entscheidung 27*

*Parent argument:* one colour vocabulary; violet for AI, blue for hand,
grey for untouched; never overlay violet with selection blue.

The parent frames this as a graphic-design rule. The thesis frames it as
the load-bearing trust mechanism for inspectable autonomy (T3).

#### Deeper argument

The thesis quotes Zhang et al. 2026 on **point-of-decision provenance**
as the move that "visually distinguishes AI suggestions from user content
at the moment of accept or reject" (`content.tex:259`). The editor's
single-rule colour scheme operationalises that principle at *every*
control surface — slider fills, badges, selection glow — not just at the
accept/reject moment.

The argument the parent omits: in a system where AI and user both write
to the same canonical state (the thesis's central architectural claim,
`content.tex:497`), the user faces a **mental-model coherence problem**:
"is this slider where I put it, or where the AI set it?" Without an
at-a-glance answer, every slider becomes ambiguous, and the user pays a
cognitive cost on every glance.

Quote from the thesis:

> "Reserving violet for AI only, and never overlaying it with selection
> blue, is the rule that keeps the channel unambiguous: violet always
> means 'the AI touched this value'." (`content.tex:1037`)

The rule is enforced at the slider primitive (`Entscheidung 27`) so the
guarantee holds *uniformly* — the user never has to remember "violet
means AI here, but in this other panel it means something else." This is
what makes T3 (inspectable autonomy) survive in a busy interface: the
user can scan an inspector and immediately see what the AI proposed, what
they touched, and what's untouched, without reading labels.

Counterargument the parent doesn't address: "wouldn't a toggle (AI
overlay on/off) be simpler?" No — toggles add a modal state the user has
to track. The colour rule is *always on*, *always at zero cost*, and
folds into the visual hierarchy. It costs the user nothing to learn (it
is one rule) and nothing to read (it is a colour, not a label).

This connects to ProvenanceWidgets (cited in thesis related work) —
that system showed usage-frequency provenance overlays; the editor takes
that principle and sharpens it to one rule about *source* rather than
*frequency*.

---

### A.4 · "Live + Apply = bake" widget lifecycle
*Parent: §9.3, Entscheidung 21*

*Parent argument:* live preview shares the slider write path; Apply is
promotion; Dismiss undoes (otherwise users get confused).

The parent's "users get confused" hint is correct but skims the real
claim. The lifecycle is the thesis's answer to **C5 (reversibility)**.

#### Deeper argument

The thesis distinguishes two failure modes of AI-assisted edits
(`content.tex` related-work):

1. **Commit-first** systems (MagicQuill, InstructPix2Pix) — the model
   commits an interpretation; the user reacts to a fait accompli; reverting
   requires re-describing.
2. **Suggest-only** systems — the model shows a before/after; the user
   accepts or rejects; refinement requires a new round-trip.

The editor takes a third path: **the widget IS the pre-edit state**.
The moment a widget is proposed, its bindings are live-bound to the
canonical store (`content.tex:497`). The image already reflects the
edit; the widget chrome is the *handle* on it.

Apply doesn't change pixels — they were already changed. It promotes the
widget to a baked entry in the operation graph and removes the chrome.
Dismiss doesn't *undo a commit* — it withdraws a pre-commit. Refine
mutates *the same widget id* with a new resolution from the LLM, instead
of spawning a new widget the user would then have to compare against the
old one (`content.tex:300–313`).

This is the thesis's response to the "commit too early vs. nothing
committed" dilemma:

> "Widgets must be revertible without round-tripping through language
> layer, and refinable without forcing user to re-describe."
> (`content.tex:300–313, paraphrased from C5/T3`)

Apply-as-promotion is also load-bearing for the dual-view claim
(Entscheidung 15 / A.6 below): if Apply *committed* a separate
operation-graph entry, the inspector accordion would have two rows for
the same edit (one for the widget pre-Apply, one for the baked op
post-Apply). Promotion keeps the canonical state a single sequence the
user can scan top-to-bottom.

---

### A.5 · The widget shell as a unit of AI-composed editing
*Parent: §9.1–9.3, Entscheidung 21 (carries over)*

*Parent argument:* widget shells contain badge + intent + reasoning +
bindings + footer; live edit then Apply.

The parent describes the *anatomy*; this supplement defends *the
granularity*.

#### Deeper argument

The thesis says a widget is "the visible unit of AI-composed editing.
Three different user actions can spawn one, but all three converge on a
single backend tool" (`content.tex:940`). The shell is the
**vocabulary** of AI composition.

The granularity question — why widgets and not, e.g., "smart filters"
that are bigger, or "AI-set sliders" that are smaller — is answered by
the thesis's T2 bound: **adaptive widgets bounded by general-purpose
access**, 4–8 controls per widget, citing GANSlider (n=138) on cognitive
load (`content.tex:402–423`).

- **Bigger** ("grade this image" as a single mega-widget): the user
  cannot accept *part* of it. The reasoning that justifies the saturation
  bump may not justify the curves change. Combining them removes the
  user's ability to negotiate.
- **Smaller** (one slider per param, AI-set individually): the user
  loses the *joint* reasoning that justified them together. The Refine
  affordance (which mutates a coherent bloc) collapses.

The shell at 4–8 controls is the smallest unit that carries a coherent
intent ("warm up shadows", "split-tone cinematic") and the largest unit
the user can hold in working memory while comparing alternatives on the
canvas (T4 — persistent alternatives, `content.tex:443–465`).

The shell is also the **API contract** between the AI and the UI: the
NodeSkeleton + BindingSkeleton declared by a fused-tool template
(`content.tex:750`). The AI fills the tunable slots within declared
ranges; the UI guarantees to render those slots as the corresponding
controls. The shell is what makes that contract *visible* — the user
sees the slots the AI was allowed to fill.

This is the thesis's response to the "free-form generation" failure
mode: a fused tool is "a template, not a free-form generation surface"
(`content.tex:750`). The shell is the visible part of that template.

---

### A.6 · Two views of the same edit (Inspector accordion + canvas widget)
*Parent: §7.1, Entscheidung 15*

*Parent argument:* grinding vs. exploring postures; "no synchronisation
code because there is only one number to move".

The parent defends *that* dual views exist. The thesis claim is that the
duality is the *interface* through which T1 (intent-to-parameter
translation) is made inspectable.

#### Deeper argument

The thesis names the architectural claim explicitly:

> "the standard inspector and an AI-composed widget are two views of one
> dictionary keyed by (layer, op, param), written through one tool
> surface, projected to one operation graph." (`content.tex:497`)

This is the thesis's contribution. The parent brief defends it on
ergonomic grounds (one number to move, no sync code), which is true but
sells the claim short. The duality is the *evidence* for T1:

- The canvas widget shows the intent (badge, reasoning, bindings labelled
  by what the AI named them).
- The inspector accordion shows the parameters under the editor's own
  vocabulary (Light → Exposure / Contrast / Highlights / Shadows).

The user can read both. If the AI's intent ("warm shadows") makes sense
but the inspector shows it touched `basic.contrast` along the way, the
user has *just inspected the translation layer*. T1 in operation.

This also addresses the thesis's positioning against DynaVis and
Bespoke. From the agent-mined report:

> "DynaVis widgets are the *only* controls; no fallback inspector. This
> editor runs AI layer over a working photo editor with standard
> inspector." (paraphrasing `content.tex:1126`)

The dual view is what makes the editor *additive* rather than
*replacing*. The user keeps every standard control, gains AI widgets,
and the AI's edits read in *both* vocabularies. The standard inspector
becomes the *baseline* the AI is enhancing, not a competing surface.

---

### A.7 · Tethers as attribution only
*Parent: §8.2, Entscheidung 17*

*Parent argument:* "photographers do not think in DAGs"; tethers carry
visual attribution, not data-flow semantics.

The parent dismisses DAGs; the supplement defends the positive case for
attribution.

#### Deeper argument

The thesis frames the workspace as **T4 — persistent alternatives on a
spatial workspace** (`content.tex:443–465`). Tethers are how the spatial
layout stays *legible* when alternatives accumulate.

Without tethers, three AI-proposed widgets near three image nodes
produce a visual ambiguity: which widget edits which image? Labels would
solve it, but labels add chrome. Tethers solve it with a single curve
that the eye follows naturally — *the AI's attribution made visible*.

The thesis's evidence for this comes from F5 (the prestudy finding that
users improvise versioning via layers and save-as milestones,
`content.tex:443`). Photographers already think in *spatial
arrangement* of work-in-progress. Tethers are how the editor honours
that thinking without leaking a node-graph mental model the prestudy
explicitly rejected:

> "Previous iterations explored a real node graph (`graph-mode`). It
> failed the user-research test: photographers do not think in DAGs."
> (`design-ux-handover.md` §8.2, restated)

The arrow-less, dashed-vs-solid distinction (node-scope vs.
layer-scope) is the *only* DAG-like information tethers carry, and it is
read as *what the widget edits*, not *how it computes*. The user never
has to reason "what feeds into this widget"; the answer is always
"nothing, it's a leaf op on the named scope."

This connects to A.8 below: tethers + canvas-space widgets together
produce the "Figma model" where the workspace *is the composition*, not
a meta-view of it.

---

### A.8 · Compound dial topologies (linear vs. wheel)
*Parent: §9.5, Entscheidung 24*

*Parent argument:* Mood/Age/Weather are directional → linear; Time of
Day / Season are cyclic → wheel; one JSON flag picks.

The parent defends the topology choice; the supplement names its thesis
import.

#### Deeper argument

The thesis claim is that AI composes **perceptually meaningful** widgets
— not generic sliders. The compound dial framework is the evidence that
the widget schema can express *semantically shaped parameter spaces*,
not only 1-D continuous values.

A Mood dial that is linear ("cold → warm") encodes that mood has a
direction. A Time-of-Day dial that is a wheel encodes that time loops.
If the editor only had linear sliders, the AI would have to pick a seam
(midnight, perhaps) for a cyclic parameter — and the user would
encounter that seam every time they dragged across it.

The thesis's general principle here is that the AI's *output schema*
should match the user's *mental model* of the parameter space, not
default to whatever the engine's numeric range happens to be. The
topology flag (`linear` vs. `wheel`) is the smallest possible surface
for that claim: the AI picks the semantic shape; the UI renders it
faithfully.

This also shows the **block kit** in action. The thesis's USP is "AI
composes working widgets from a *block kit*" (memory:
`project_widget_compose_usp.md`). The compound dial framework adds a
new block (the wheel) without expanding the kit's surface — the AI's
compose vocabulary grows by one declarative flag.

---

### A.9 · Image context surfaced to the user (Info tab)
*Parent: §7.2, Entscheidung 16*

*Parent argument:* trust calibration; educational value; zero new
backend work (the data was already computed for the LLM).

The parent gives three reasons; the thesis frames it as the precondition
for trust in AI-set parameters.

#### Deeper argument

The thesis treats trust as **a per-session budget that inspectability
either replenishes or exhausts** (`content.tex:59`). The Info tab is one
of the largest replenishment sources.

Per the thesis's T3 (inspectable autonomy, `content.tex:424–442`),
"every AI decision (region detected, widget chosen, parameters set) is
labelled and revertible without re-describing the goal." The Info tab
covers the **region detected** half: the user sees what the AI thought
it was looking at *before* they accept any widget that depends on that
analysis.

If the AI says "sky overexposed" but the histogram shows no clipping,
the user has the evidence to disagree. This is the editor's response to
the "black-box analysis" failure mode that the prestudy F4 surfaced:

> "What inspectability and override affordances (visible region labels,
> parameter exposure, low-stakes preview, easy revert) are needed for
> users to extend incremental trust to AI-generated UI elements within a
> single editing session?" (`content.tex` RQ3)

The Info tab is the answer to "visible region labels" half of RQ3. The
widget shell (A.5) is the answer to "parameter exposure." The
Apply-as-promotion lifecycle (A.4) is the answer to "low-stakes preview
+ easy revert." Together they form the trust budget.

The parent's "educational value" framing is also load-bearing for the
thesis's contribution-to-the-field claim: the Info tab teaches the user
the vocabulary the LLM uses (subjects, dominant tones, grade character,
candidate regions). Over a session, the user internalises that
vocabulary and writes better prompts. The Info tab is therefore a
**vocabulary bridge**, not just a debug view.

---

### A.10 · Engine-SSoT as the precondition for safe AI composition
*Parent: §3.2 (mentioned in passing as a gate on the palette)*

*Parent argument:* "Engine-SSoT rule; nothing local to write to" when
SSE is disconnected.

The parent's only mention treats this as a backend implementation
detail. It is the architectural guarantee that makes AI composition
*safe*, and it deserves a first-class Entscheidung.

#### Deeper argument

The thesis's contribution sentence —

> "shared canonical state in which AI-proposed and user-edited
> adjustment values coexist in the same state dictionary."
> (`content.tex:497`)

— is only safely realisable if the dictionary has *one owner*. If the
frontend held a private copy of the operation graph and the AI wrote to
the backend, the two would drift; an AI proposal could land on stale
state; refinement would compose against the wrong baseline.

The Engine-SSoT doctrine (backend owns the snapshot; frontend reads SSE
deltas; tool calls are the only write path) is the architectural
expression of that single ownership. Specifically:

- Three spawn paths → one `propose_widget` (A.2) requires Engine-SSoT to
  guarantee the widget lands in the same canonical state regardless of
  origin.
- Live preview (A.4) requires Engine-SSoT to guarantee that "live" means
  *engine-live*, not "frontend has applied a tentative overlay."
- Provenance colour (A.3) requires Engine-SSoT to guarantee that the
  `source: 'ai' | 'hand' | 'default'` flag on a binding is consistent
  for every reader.

Disabling the palette when SSE is disconnected (parent §3.2) is the
visible enforcement: there is no local fallback, on purpose. A local
fallback would create a class of edits the engine never saw and could
not reconcile.

This is the architectural complement to A.3: provenance is meaningful
only if every binding the frontend reads has a single, authoritative
provenance flag. Engine-SSoT is what makes that single flag possible.

---

# Part B · Decisions made after 2026-06-17

The original brief was committed 2026-06-17. Since then, three specs and
five substantive commits have landed. Each load-bearing decision below
gets an Entscheidung continuing the parent numbering.

Sources:
- Spec `docs/superpowers/specs/2026-06-16-image-layer-object-rework-design.md`
- Spec `docs/superpowers/specs/2026-06-16-image-node-drafting.md`
- Spec `docs/superpowers/specs/2026-06-17-visibility-driven-adjustments-design.md`
- Commits: `9be79ae`, `4eb367d`, `3642a79`, `e36f64e`, `5162ff5`.

---

### Entscheidung 39 — Three orthogonal selection slots (Image node / Pixel layer / Object)

**Decision.** Replace the discriminated-union `activeScope` with three
independent slots:

- `activeImageNodeId` (workspace slice) — which photographic subject.
- `activeLayerId` (layer slice) — which pixel layer inside that subject.
- `activeObjectId` (selection slice) — which mask (= adjustment scope).

`activeObjectId === null` denotes the whole image; no special-casing.

**Why.** The discriminated union conflated three orthogonal concerns —
"select a mask," "select an image node," and "edit a layer" — into one
slot, forcing every selection-aware consumer to discriminate. The three
slots are independently meaningful: the user can be focused on Image #2,
editing its Layer 3, with no specific Object selected (whole-image scope).
The new model also fixes the `[Image #3]` auto-focus bug (Entscheidung
40) cleanly because the slots no longer compete.

The thesis ties in via T2 — "adaptive widgets bounded by general-purpose
access" (`content.tex:402–423`). Objects (mask + adjustments scoped to it)
are how AI widgets target *parts* of an image without making the standard
inspector go away. Separating Object selection from layer selection means
the AI can scope adjustments to a region without disturbing the user's
pixel-stack context.

Source: `2026-06-16-image-layer-object-rework-design.md` Phase 1.

---

### Entscheidung 40 — Hold selection when a new image is added

**Decision.** `document.addImage` calls `setActiveImageNode(newNodeId)`
only when `activeImageNodeId === null`. Otherwise the current selection
holds; the new image is added but does not steal focus.

**Why.** Users reported that the Info tab "always shows [Image #N]" —
the most recently imported one. The bug was a one-line
unconditional auto-activate. The fix is also one line, but the
*decision* is the principle: **selection is the user's, not the
import action's.** A workflow in which the user pastes a reference
image while editing should not yank them out of their current
context.

Source: `2026-06-16-image-layer-object-rework-design.md` Phase 2.

---

### Entscheidung 41 — Object as a vocabulary, not a new entity type

**Decision.** "Object" is not a new schema. It's the union of mask
sources surfaced by a hook: `{ source: 'sam' | 'ai-region' | 'brush' |
'whole-image', maskRef? }`. SAM segments, AI candidate regions, and
brush-drawn masks all surface as Objects in the UI.

**Why.** The backend already stores masks and their bindings; the
frontend only needed a consistent UI vocabulary. Inventing a new entity
type would have required a backend schema change, a migration, and a
parallel persistence path — all for no gain over the existing mask
store. The principle: **align UI vocabulary with existing data; avoid
schema churn for nomenclature.**

This also matters for the LLM. By exposing Objects as a unified
vocabulary, the LLM can reason about "the sky" without caring whether
that sky was SAM-segmented, AI-proposed, or brush-drawn. See Entscheidung
44.

Source: `2026-06-16-image-layer-object-rework-design.md`.

---

### Entscheidung 42 — Visibility, not "active layer," gates adjustment application

**Decision.** A widget anchors to an *image-node*, not a layer. At
composite time, the renderer applies the widget's params to *every layer
in that image-node whose `Layer.visible === true`*. Toggling a layer's
visibility live changes which layers the widget affects — no
operation-graph mutation needed.

`WidgetNode.layerId` remains as the stable anchor (used for undo and
back-compat); `WidgetNode.layerIds` is a *discovery hint* (the set the
node carried at spawn time, not the runtime target).

**Why.** The pre-change model required the user to *select* a layer
before spawning an adjustment, which conflated two intents — "I want to
edit this layer specifically" vs. "I want to edit what I currently see."
Most edits are the latter. With visibility-as-gate, the UI matches the
intent: **what you see is what your adjustments operate on.** Hiding a
layer is also a one-click way to scope an adjustment off, no extra mode.

The thesis link is to T3 (inspectable autonomy): when the AI proposes a
widget, the user can verify *what it affects* by toggling visibility and
watching the image change. The widget's effect is no longer a
mathematical abstraction; it is empirically observable.

Source: `2026-06-17-visibility-driven-adjustments-design.md`.

---

### Entscheidung 43 — LayerStrip click toggles visibility; activeLayerId no longer needed for adjustments

**Decision.** Click on a LayerStrip sheet toggles `Layer.visible`. Right-
click opens the existing context menu (Rename / Blend / Lock / Delete).
There is no "active layer" highlight on the strip; the user can have any
combination of visibilities.

**Why.** Once adjustments target visibility (Entscheidung 42), the strip
no longer needs to express "which layer is the target." Its job
collapses to **switchboard:** mute/unmute layers, drag to reorder, see
the stack. The thesis-relevant consequence: with no "active" state to
defend, the strip becomes an artefact of the image (which layers are
contributing right now), not a selector with hidden modal state.

Source: `2026-06-17-visibility-driven-adjustments-design.md` Phase 2.

---

### Entscheidung 44 — Objects + AI candidate regions unify under one "Regions" vocabulary

**Decision.** New MCP tool `list_named_regions` merges:

1. Committed Objects (origin: `'object'`, persistent, addressable by id)
2. AI candidate regions from `image_context` (origin: `'ai_region'`,
   ephemeral, addressable by label).

Objects win on duplicate label. Cmd+K palette renders both in one
"Regions" section; `select_named_region` branches internally on origin
(`setActiveObjectId` for Objects, `setActiveMask + commitMask` for
candidates).

**Why.** From the user's point of view "the sky" is one thing, whether
they already segmented it (Object) or the AI proposed it (candidate). A
unified vocabulary lets the user *and* the LLM refer to regions by name
without needing to know the underlying source.

Thesis link: this is a clean instance of T1 (intent-to-parameter
translation) at the *targeting* level. The user says "select the sky";
the system resolves the most specific match (committed Object first,
then AI candidate). The translation layer's job is to map natural names
to existing structures — exactly the editor's reason to exist.

Source: Commit `4eb367d`; tools registered in
`src/lib/tool-manifest/*-tools.ts`.

---

### Entscheidung 45 — Objects exposed to the LLM as first-class operands

**Decision.** Four new MCP tools surface Objects to the LLM:

- `list_objects` — query committed Objects by image-node.
- `select_object` — arm an Object as the active selection.
- `extract_object_to_image_node` — bake the masked region into a new
  ImageNode (paste-as-new-document).
- `convert_object_to_layer_mask` — duplicate the source layer and apply
  the mask as a layer mask.

**Why.** Before these tools, the LLM could *propose* masks but had no
way to *reason about* the user's committed work. The four tools let the
LLM see what the user has already segmented, choose between operating on
existing Objects or proposing new regions, and perform structural
transformations the user would otherwise do by hand (extract a region as
its own subject; convert a region into a non-destructive layer mask).

Thesis link: this is **T4 (persistent alternatives) extended to the LLM's
input domain.** The workspace is not just where the user composes —
it is where the LLM reads the user's prior decisions and composes
relative to them. The LLM becomes an agent that operates *over* the
user's accumulating workspace, not just *into* a blank one.

Implementation note: client-side `objectOwnership` map wins over
backend `mask.imageNodeId` when set — the client is the authoritative
owner mapping because SSE `mask.created` events arrive before the
backend has the node association resolved. Documented at the
`list_objects` call site.

Source: Commit `9be79ae`.

---

### Entscheidung 46 — History as a navigable list, not a linear stack

**Decision.** Backend gains `GET /state/{sid}/history` (lightweight
list: id, ts, label; no snapshot bytes) and `POST
/state/{sid}/jump/{cursor}` (seek to any entry, including -1 =
pre-history baseline). Frontend adds a `HistoryDropdown` in the toolbar
listing entries newest-first; click jumps the cursor.

**Why.** Undo/redo is the linear projection of history. Users actually
think *spatially*: "I want to go back to the state right after I added
the sky widget — not click Undo 12 times." Exposing the list as a
clickable surface removes the cost of counting backwards.

Thesis link: this connects to RQ4 — "How can a non-linear, branchable
workspace history support comparison across alternative interface
configurations and edit paths…" (`content.tex` RQ4). The dropdown is
the linear precursor to that vision; the REST endpoint shape (cursor
+ jump) is forward-compatible with a branching history without UI
changes today.

The list is lightweight (no snapshot bytes) so the fetch is cheap on
every dropdown open. Snapshots are only materialised when the user
actually jumps.

Source: Commits `3642a79`, `e36f64e`; future actions (cursor ahead of
current) are visually faded so the dropdown always reads as "what
already happened vs. what could be redone."

---

### Entscheidung 47 — Slider drags coalesce into one undo step

**Decision.** Tools whose mutations form a continuous drag (`SetParamTool`,
`SetWidgetParamTool`) return a `coalesce_key()` of
`f"{tool}:{scope}:{param}"`. The history engine collapses consecutive
entries with the same coalesce key arriving within
`history_coalesce_window_ms` (2000 ms — well above any drag cadence).

**Why.** Without coalescing, a single 1-second slider drag emits 10–20
incremental history entries. The undo stack becomes a sea of meaningless
intermediate frames, and Cmd+Z becomes useless for "go back one *action*."
Coalescing folds a drag into one user-meaningful entry; one Cmd+Z reverses
the drag.

Coalesce keys are scoped tightly (per-param) so distinct intents don't
collapse: dragging exposure then dragging contrast produces two entries.

Source: Commit `5162ff5`.

---

### Entscheidung 48 — Tool-generated history labels with per-tool formatting

**Decision.** `BackendTool` gains `history_label(input, output) -> str`,
called after the handler succeeds. Each user-action tool overrides with
context: `set_param` → "Setting saturation = +0.15", `propose_stack` →
"Proposed Curves", `set_image_node_transform` → "Crop & Rotate".

Values are formatted with sign prefix and 2-decimal rounding for floats;
booleans render as on/off; ints carry signs.

**Why.** The dropdown (Entscheidung 46) is only useful if rows are
scannable. "set_widget_param" tells the user nothing; "Setting exposure
= +0.50" tells them everything. Generating labels inside the tool means
they have access to the exact param values the user supplied — no
post-hoc inference required.

This is also a small step toward natural-language history summaries: each
label is a sentence fragment that could be aggregated by an LLM into "you
brightened the shadows, warmed the highlights, and proposed a curves
adjustment" without further plumbing.

Source: Commit `5162ff5`.

---

### Entscheidung 49 — Sidebar unmounts when no image is active

**Decision.** Change the sidebar mount gate from `layers.length > 0` to
`activeImageNodeId !== null`. With no image selected, the right sidebar
unmounts entirely and the canvas reclaims the space.

**Why.** A sidebar of empty/disabled tabs reads as a broken UI. After
Entscheidung 40 (hold selection on import) it became possible to have an
image present but no `activeImageNodeId` (e.g. immediately after a
multi-import where the user hasn't picked one yet). The new gate matches
the *intent* signal — "the user is engaged with an image" — instead of
the *state* signal ("layers exist somewhere").

This is consistent with §17 Entscheidung 36 (empty states never
apologise) from the parent brief.

Source: `2026-06-17-visibility-driven-adjustments-design.md` Phase 1.

---

### Entscheidung 50 — Architectural-drafting register: serif emphasis, marginalia metadata, leader-line object markers

**Decision.** A second visual register beyond the parent brief's
"drafting" sketch:

- **Fraunces (variable italic serif)** for image-node title, layer
  ordinals, object names. Geist remains for body UI.
- **Marginalia metadata** in left and right margins of an image node
  (LayerStrip on the left; numbered object markers on the right).
- **Object markers** are numbered circles in the right margin with
  *dashed ochre leader lines* into the image, terminating at the masked
  region's centroid.
- **Crop ticks** at the corners instead of a continuous frame.

**Why.** The previous image-node chrome (24 px header strip with seven
affordances; two-tab footer conflating Layers and Objects) was the
single noisiest UI surface in the app. The drafting register is a
deliberate retreat from that noise.

The three problems it solves:

1. **Object labels floated** as HTML pills on top of the image with no
   visual link to the masked region. Leader lines *make* the link.
2. **The mode toggle** (Layers vs. Objects) conflated orthogonal axes.
   They now occupy different margins.
3. **The footer ambiguity** ("Objects · 0" reads broken when nothing is
   segmented). Marginalia render only when there's content; "nothing
   segmented" reads as "no marginalia," not "broken counter."

The thesis link is to T4: the workspace is a spatial composition. The
drafting register honours that by making image-node chrome look like
*marginalia around a drawing*, not like *chrome on a panel*.

Source: `2026-06-16-image-node-drafting.md`.

---

### Entscheidung 51 — Delete the classic codepath outright (no toggle)

**Decision.** Remove `visualStyle: 'classic' | 'drafting'` from
preferences. Inline `ImageNodeDrafting` as the only image-node
implementation. Delete `ImageNodeClassic` and the branch wrapper.

**Why.** A toggle would have been the "safe" choice but at the cost of:
shipping two implementations of every image-node surface; maintaining
two test suites; running every regression in two modes. The drafting
register either *replaces* the classic register or it doesn't earn its
keep.

There is no backward-compat concern: `visualStyle` only affected
rendering; persisted state in the operation graph and workspace are
register-agnostic. The migration is a no-op (drop the preferences key).

The decision is also the operational expression of the parent brief's
Entscheidung 38 ("enforce structure with lint, not review"): keeping
both codepaths would let style-agnostic components silently regress.
Forcing one register is the forcing function.

Source: `2026-06-16-image-layer-object-rework-design.md` (Phase 3
"Classic deletion").

---

### Entscheidung 52 — Layer tab in the Inspector (not a standalone Layers panel)

**Decision.** The standalone `LayersPanel` is deleted. Its UI moves
into the Inspector as a **Layer tab**, alongside Adjustments / Info /
Crop. It consumes the same `layer-slice` state the old panel did.

**Why.** After Entscheidung 50 made the LayerStrip the primary visual
navigator for layers (in the image-node's left margin), the standalone
panel became a second answer to the same question. Folding it into the
Inspector as a tab keeps the *detailed* layer view (rename, blend mode
dropdown, opacity slider) accessible without occupying permanent space.

The Inspector now has four tabs (Adjustments / Info / Crop / Layer),
each a *view* on the active scope rather than a separate world. This
matches the parent's two-views-of-one-edit doctrine (Entscheidung 15 /
A.6): both the Layer tab and the LayerStrip are views on the same
`layer-slice`, never out of sync.

Source: `2026-06-16-image-layer-object-rework-design.md` (Phase 4
"Inspector Layer tab").

---

## Cross-cutting themes (post-handover)

1. **Objects become first-class for both user and LLM.** Entscheidungen
   39, 41, 44, 45 jointly establish "Object" as the primary
   adjustment-scoping vocabulary, surfaced identically to the user
   (Cmd+K Regions section, ObjectMarkers in margins) and to the LLM
   (`list_objects`, `select_object`, `extract_object_to_image_node`,
   `convert_object_to_layer_mask`). This is the editor's response to
   thesis RQ1 — selecting interface components for the user's active
   *region*, not just the user's active intent.

2. **Visibility becomes the universal scoping affordance.**
   Entscheidungen 42, 43, 49 collapse a tangle of "active layer" /
   "selected layer" / "sidebar mount" state into one signal:
   *visibility.* Adjustments apply to visible layers. The LayerStrip is
   a visibility switchboard. The Sidebar mounts when the user is
   engaged with a visible image. One signal, three consequences.

3. **History becomes spatial.** Entscheidungen 46, 47, 48 turn the
   linear undo stack into a navigable, semantically-labelled list with
   coalesced drags. This is forward-compatible with the RQ4 branching
   future without committing to a tree UI today.

4. **The drafting register replaces, not augments.** Entscheidungen 50,
   51, 52 commit to the drafting visual register as the only one.
   Marginalia, leader lines, and the Layer tab in the Inspector are the
   visible consequences; the deletion of the classic codepath is the
   architectural one.

---

## How to use this supplement when writing thesis chapters

- **Part A entries** are the "we already said this, but here's the
  *why* the thesis really cares about" layer. When writing about a
  parent-brief Entscheidung, read both the parent's argument and the
  Part A entry; lift the synthesis.
- **Part B entries** are decisions not in the parent brief. Use them
  freely; the numbering continues from 38.
- **Quote-targets.** `content.tex` line refs in Part A are the
  thesis's existing arguments — quote them directly rather than
  paraphrasing.
- **What is still missing.** Decisions about the multi-agent backend
  pipeline (analyze → context → propose → resolve), the
  fused-tool registration mechanism, and the cancel/cooldown semantics
  on autonomous suggestions are *backend doctrine* and live in
  `docs/implementation-architecture-handover.md`, not here. This
  supplement covers the user-facing decisions only.
