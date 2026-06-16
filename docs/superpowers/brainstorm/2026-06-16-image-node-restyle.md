# Image Node / Footer / Layers — Restyle Brainstorm

**Date:** 2026-06-16
**Status:** Direction-only. No spec, no plan. Pick one (or remix), then we
build a static mockup before touching components.

---

## Pain points in the current system

1. **Footer is busy and ambiguous.** Dimensions, "Layers · 1", "Objects · 0"
   sit as tabs at the bottom. "Objects · 0" is meaningless until the user
   has segmented something — it reads as broken UI.
2. **Header strip is over-iconified.** Image · name · 👁 · ⬜︎ Compare ·
   ✂ Split · ⤓ Merge · ⋯ Menu. Seven affordances on the same 24px strip;
   nobody remembers what each does. Cognitive cost on every glance.
3. **"Layers" vs "Objects" is a forced binary.** They're orthogonal
   concepts — Photoshop-style stack vs SAM segments — pretending to be a
   toggle. The toggle hides whichever isn't active even though both are
   relevant to almost every action.
4. **Object labels float as detached HTML bubbles.** No visual connection
   from the bubble to the masked region. The user has to mentally trace.
5. **LayersPanel duplicates work.** It lives in the sidebar AND there's a
   layer strip in the image node footer. Two surfaces, two states.

---

## Direction A — Architectural Drafting

> *Like a draftsman's table. Crop marks, leader-line callouts, marginalia.*

### Aesthetic

- **Typography:** Fraunces (variable serif) for headings and the
  image-node title; Geist (current) for body UI; **Geist Mono** with
  letter-spacing `+0.06em` and uppercase for every chrome label
  ("DIMENSIONS", "LAYERS", "OBJECTS"). Tabular figures everywhere
  numbers appear.
- **Colour:** Cream paper (`oklch(0.97 0.012 90)`) replaces the current
  cool gray dotted bg. Ink for text. **One** accent: warm vermilion
  ochre `oklch(0.55 0.20 30)` — the colour of marginalia ink. Used only
  for active states, leader lines, and object outlines.
- **Surface:** No solid borders anywhere. The image node is identified
  by **four corner ticks** (5px L-shapes, hairline weight). On select,
  the ticks slide into a full hairline frame.

### Image node layout

```
   ┌                                            ┐
                                              
       ┌────────────────────────────┐             
       │                            │  ← raw image,
       │   (image canvas)           │     no frame
       │                            │     around it
       │                            │
       └────────────────────────────┘             
                                              
   └  IMAGE 01    1013 × 1350 px  · jpeg  · 4.2MB ┘
        ↑                ↑
        title in       monospace caps, tracked
        Fraunces       out, sits inside the
        italic         margin under the image
```

- **No header chrome.** The title becomes typographic marginalia in the
  top-left margin: an italic display serif "Image 01". A small
  monospace overline above it reads "ACTIVE LAYER · SOURCE".
- **No footer tabs.** Everything that was in the footer — dims, file
  meta, layer count, object count — flows in the bottom margin as a
  single typographic line in Geist Mono caps, separated by · markers.
- **Buttons disappear.** Eye / Compare / Split / Merge / Menu collapse
  into a single `⋯` that lives in the right margin and only appears on
  hover. The full context menu opens from there.

### Layers

- Vertical **strip of tracing-paper rectangles** outside the LEFT
  margin of the node. Each layer is a 24×16 outlined rectangle stacked
  top-to-bottom. The active layer is filled with the ochre accent.
- A small Fraunces italic numeral labels each: "01", "02", "03".
- Layer name + opacity + blend mode appear on hover as a popover.
- Drag-to-reorder along that strip. The LayersPanel in the sidebar
  becomes a secondary view (or goes away entirely — strip + popover
  is enough for most workflows).

### Objects

- Outlines render in the **ochre accent** (no more white + black halo).
- Each object gets a **leader line** from its centroid to a label
  OUTSIDE the image (left or right margin, whichever side has more
  space). The label is a numbered marker: small circle with a numeral,
  then the name in Fraunces. Like a museum object label.
- Right-click on the marker opens the menu. Hovering the marker
  highlights the corresponding mask.
- The "Objects · N" footer count is gone — the numbered markers ARE
  the count.

### One memorable touch

- On select, the corner crop ticks animate in a 200ms ease toward each
  other to form the hairline frame. A single ochre baseline appears
  underneath the title.

### Trade-offs

- ✓ Annotations naturally fit object labels (this is literally what
  architectural drawings do).
- ✓ Marginalia is a generous home for metadata without chrome clutter.
- ✓ The tracing-paper layer strip is intuitive AND saves sidebar space.
- ✗ Leader lines need spatial awareness — what if objects are at the
  edge of the canvas, or there's no room in the margin? Fall-back is
  inline labels at the centroid (current behaviour).
- ✗ Fraunces + Geist + Geist Mono is three font families. Possible bundle
  hit. (Mitigation: subset Fraunces to the display weights we use.)

---

## Direction B — Editorial / Magazine Spread

> *Pure typography. The image is the photograph; everything else is caption.*

### Aesthetic

- **Typography:** Bodoni Moda (high-contrast didone) for the display
  caption underneath the image. Geist for UI. Geist Mono for numbers.
  Italic Bodoni for active states.
- **Colour:** Off-white "paper" background. Sharp ink. **One** accent:
  hot pink `oklch(0.68 0.24 0)` for selection and active. Because
  magazines love hot pink and we shouldn't be afraid.
- **Surface:** No frames, no borders. The image floats. Selection is
  a thin pink underline beneath the caption — never around the image.

### Image node layout

```
       ┌────────────────────────────┐
       │                            │
       │   (image canvas)           │
       │                            │
       │                            │
       └────────────────────────────┘

       Image 01 — Untitled photo
       1013 × 1350 px  ·  4 LAYERS  ·  2 OBJECTS
       ─────────                       ← pink when selected
```

- The caption block below the image carries everything. It reads top to
  bottom: big display title, then a meta line in Geist Mono caps.
- A subtle overline above the image holds the layer state: a Mono caps
  line like "ACTIVE · L01 SOURCE".
- Header chrome is gone. The `⋯` menu lives at the end of the meta line.

### Layers

- A vertical "table of contents" to the **right** of the image:
  ```
  L01  Source                 ↪
  L02  Adjustments
  L03  Mask · Bottle
  ```
- Active layer is set in **Bodoni italic**, others in Geist Mono. That
  hierarchy alone is enough to read which is active.
- Eye (visibility) toggles by clicking the row's left edge. Opacity is
  a small numeric input on hover.

### Objects

- Outlines render in hairline **pink**.
- Numbered annotations appear in a numbered list **left** of the image,
  editorial-style:
  ```
  1.  Bottle
  2.  Hand
  3.  Background
  ```
- Each list item highlights its mask on hover. Right-click opens the
  menu.

### One memorable touch

- Selecting an image node draws a single pink **paragraph rule**
  beneath the caption block — like a magazine pull-quote.

### Trade-offs

- ✓ Strikingly distinctive. Nobody else does this in image editors.
- ✓ Treats the image with respect — no chrome competing for attention.
- ✗ Reads as "art project" rather than "daily tool" if the user works
  fast and wants persistent affordances.
- ✗ Two columns of marginalia (objects left, layers right) needs the
  canvas to be wide enough. On a small workspace it gets cramped.

---

## Direction C — Modular Patch Bay

> *Eurorack synth modules. Chrome on the side, patch points everywhere.*

### Aesthetic

- **Typography:** A condensed sans (Fira Sans Compressed or Roboto
  Condensed) for labels. Geist Mono for numerics. Tight uppercase
  tracking.
- **Colour:** Industrial graphite. Sharp white screen-print labels.
  **One** accent: chartreuse `oklch(0.85 0.18 130)` — a single
  saturated LED green that lights up on active states.
- **Surface:** Hairline edges with subtle 1px bevels at the corners.

### Image node layout

```
   ┌─────────────────────────────────┬──────┐
   │ IMAGE 01                        │  ●  │ ← layer 1 (active)
   │                                 │  ○  │ ← layer 2
   │   (image canvas)                │  ○  │ ← layer 3
   │                                 │  ──  │
   │                                 │  ●  │ ← object 1
   │                                 │  ●  │ ← object 2
   │                                 │  ──  │
   │                                 │ DIMS │
   │ 1013 × 1350                     │ 4.2M │
   └─────────────────────────────────┴──────┘
```

- **Right edge becomes the patch bay.** A narrow vertical strip with
  dots for each layer and each object. Click a dot to make it active
  (the LED lights chartreuse).
- Title in the top-left. Dims in the bottom-left. The right strip
  carries everything else.
- No traditional footer; metadata flows into the right strip.

### Layers

- Each layer is a labeled dot in the right strip. Drag to reorder along
  the column.
- A click on the dot activates the layer; a long-press opens layer
  metadata (opacity, blend mode, eye).
- LayersPanel in the sidebar becomes optional / collapsible — the strip
  is enough.

### Objects

- Object dots in the right strip, BELOW the layer dots, in a different
  color (cool blue vs the layer chartreuse).
- Hover over a dot draws a leader-line into the image from the strip to
  the object's centroid — short, declarative.
- Click on a dot selects the object (highlights mask in chartreuse).

### One memorable touch

- The patch-bay LEDs subtly pulse with a 4Hz breathing animation when
  the layer is being edited (drag, slider change). A live readout.

### Trade-offs

- ✓ Distinct, technical, immediately legible — affordances are obvious
  from the dot+label pattern.
- ✓ Compresses chrome into a single edge so the image owns the centre.
- ✗ Heavy / industrial aesthetic might fight the photo content — a
  warm portrait next to a graphite synth-module frame can clash.
- ✗ Dots need labels to be useful; small labels are hard to read.

---

## My pick

**Direction A (Architectural Drafting).** Reasons:

1. The leader-line + marginalia pattern is a *direct visual answer* to
   the current pain point of "labels float disconnected from the
   image". The whole metaphor solves a real problem, not just decorates.
2. Marginalia is naturally extensible — when a new piece of metadata
   shows up (file size, EXIF date, layer count), there's already a
   place for it. No fight for footer real-estate.
3. The tracing-paper layer strip dissolves the LayersPanel /
   ObjectModeFooter duplication into a single surface that lives where
   the user looks (on the image node), without taking sidebar space.
4. Typography opportunity is generous — Fraunces + Geist Mono is a
   pairing the editor doesn't currently use anywhere, so this carves a
   genuine identity instead of more Geist-on-Geist.
5. The footer tabs go away entirely. The "Objects · 0" empty-state
   ambiguity dissolves because the count *is* the absence-of-markers.

Direction B is the boldest but is closer to "art project" than tool.
Direction C is closest to a future-proof technical chassis but the
aesthetic fights the photo content.

---

## Next step (your call)

1. **Build a static HTML mockup** of Direction A in `docs/mockups/`.
   Real fonts, real proportions, no React. Fastest way to evaluate
   visually. ~1 turn.
2. **Build a working React prototype** of the image node + margin
   strip + leader-line annotations behind a feature flag. Slower but
   you can interact with it. ~2-3 turns.
3. **Remix.** Pick parts of A / B / C and I redraft the brainstorm.

If you don't pick, I default to (1) — visual eval first, then decide
whether to commit to a full implementation spec.
