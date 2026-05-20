# AI Editor Roadmap

The four plans below structure the work toward an LLM-orchestrated editor where
Claude decides editing steps, calls tools (segmentation, adjustments), and
emits structured panels the user can curate. The plans must be executed in
order — each one is a prerequisite for the next.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Plan 1 — Transform-locked overlay substrate  `[x]`

Every overlay (mask wash, region outline, prompt dots, AI annotations) must
follow the image's full transform — translate, scale, rotate, flip, viewport
zoom/pan — without overlay code touching transform math.

**Build:**

- `OverlayLayer` type: one typed object per overlay item, anchored to a layer
  ID. Examples: `{ kind: 'mask', maskRef, anchorTo, style }`,
  `{ kind: 'outline', maskRef, anchorTo, style }`,
  `{ kind: 'dots', points, anchorTo, style }`.
- Materialize each `OverlayLayer` as a Fabric object on the same Fabric canvas
  as the image. Anchor by either (a) mirroring the parent's transform matrix
  on every render or (b) using Fabric grouping. Fabric then handles all the
  transform math automatically.
- Overlay store: small Zustand slice listing live overlays. Replaces the
  `activeMaskRef`/`committedMaskRef` pair (or sits beneath it).
- One renderer: a React effect that diffs the overlay list against existing
  Fabric children and add/remove/updates as needed. Replaces the bespoke
  `MaskOverlay` DOM canvas.
- Marching-ants outline as the proof: animated `strokeDashOffset` Path. If
  this rotates correctly with the image, the substrate is right.

**Verification gate:** rotate the image 30°, zoom to 200%, pan — mask,
outline, and prompt dots stay glued to the image.

**Scope:** ~2 days. Deletes more code than it adds once `MaskOverlay` is
migrated.

---

## Plan 2 — MCP-shaped tool surface  `[x]`

**Implemented as 10 tools** (SAM exposure hidden per inventory review):

- Query: `get_image_context`, `list_named_regions`, `get_active_selection`, `list_layers`
- Selection: `select_named_region`, `clear_selection`
- Action: `apply_adjustment` (confident/mechanical), `propose_panel` (subjective/curated)
- Annotation: `highlight_region`, `add_note`

Lives at `src/lib/tool-manifest/` with one file per tool, a `ToolManifest`
type backed by zod schemas, a registry, and a minimal `zodToJsonSchema`
converter producing Anthropic-shaped tool blocks via
`serializeAllManifests()`. Wiring the backend Claude call to consume these
manifests is a follow-up (the existing hardcoded tool block on the backend
stays in place until that swap is made).


Every editor capability the LLM can invoke is described by a uniform schema.
Plays the role of MCP whether or not an MCP server is actually exposed today.

**Build:**

- `ToolManifest` type: `{ name, description, inputSchema, outputSchema, handler }`.
  One file per capability.
- Initial tool inventory (~12 tools): `select_named_region(label)`,
  `select_object_at_point(x, y)`, `select_object_by_text(prompt)`,
  `apply_adjustment(scope, kind, params)`, `get_image_context()`,
  `propose_panel(bindings)`, etc.
- Manifest-to-system-prompt generator: serialize manifests into the tool
  descriptions Claude sees. Replaces hand-written tool blocks.
- Optional MCP server: thin FastAPI route at `/mcp` exposing the same
  manifests via the MCP wire format. Future-proofs Claude Desktop / agent
  integration but is not required for the agent loop.

**Why second:** forces explicit decisions about what the LLM can do. Most of
the value comes from the inventory discussion, not the code.

**Scope:** ~1 day for the schema and prompt generator; the harder part is
deciding the right ~12 tools.

---

## Plan 3 — Intent vocabulary + decomposition  `[ ]`

The LLM speaks in human-meaningful intents. The editor internally decomposes
intents into atomic operations (SAM clicks, parameter sets, mask
combinations).

**Build:**

- Intent → operation router: maps `select_named_region`,
  `select_object_by_text`, `select_object_at_point` to underlying
  mask-producing code paths. Decides which of (Claude regions, SAM, future
  grounding model) to use based on intent shape.
- Region-aware fusion: when a SAM mask significantly overlaps a Claude
  region, label the mask with the region's name. Both LLM and user see the
  label.
- Demote atomic tools (Select Point, Select Box, Multi-Point): keep visible
  to the user, hide from the LLM's tool manifest. The LLM only sees
  high-level intents.

**Why third:** depends on the manifest existing (Plan 2) and the overlay
substrate being able to display labeled selections (Plan 1).

**Scope:** ~2 days, mostly tuning the fusion heuristic against real images.

---

## Plan 4 — Dynamic panel schema growth  `[ ]`

The LLM's output is *always* a structured panel the user can edit, never an
opaque "I changed things."

**Build:**

- Catalog of control types in the panel schema: `slider`, `color_picker`,
  `region_picker`, `mask_thumbnail`, `before_after_toggle`, `choice_set`,
  `text_input`. Today only `slider` and a few others exist.
- Validation: every LLM panel response is validated against the schema.
  Malformed responses get rejected and re-asked, never rendered.
- Bidirectional binding: user adjustments propagate back to the node graph
  *and* into the next LLM context so Claude knows what was changed.
- Reusable rendering: one renderer takes `panelBindings` → React tree. New
  control types are added by registering a renderer + a schema entry. Same
  pattern as the existing ProcessingDefinition registry.

**Why fourth:** only valuable once the previous three are in place — the LLM
needs to *have* something meaningful to put in a panel, which requires intent
vocabulary (3), which requires a tool manifest (2), which produces overlays
needing the substrate (1).

**Scope:** ongoing. Initial pass to formalize the existing schema: ~1 day.

---

## Execution notes

- Plans are prerequisites in order. Don't pull work from later plans
  forward — the foundations matter.
- The most important parts of Plan 2 and Plan 3 are *design* (tool
  inventory, intent vocabulary), not code. Spend the thinking time.
- Direct-click SAM and browser-side ONNX are deferred. They're escape
  hatches, not the primary product surface.
