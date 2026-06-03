# Widget Backlog — Not Yet Implemented

Tracking widget ideas that surfaced during brainstorming but have not been spec'd, designed, or implemented. Each entry needs both a `ProcessingDefinition` (shader + panel) and a `WidgetNode` body in `src/components/workspace/`. Do not implement these yet — they live here so we don't lose track.

## Conventional fused widgets (mainstream-editor parity)

These are well-understood, low-risk imports from established editors. Useful as table stakes, but not unique to this project.

| # | Widget | Composition | Source |
|---|---|---|---|
| 1 | Color Grading Wheels (3-way) | Shadows / Mids / Highs hue+sat pads + blend + balance | Lightroom Color Grading; DaVinci Resolve primaries |
| 2 | Tone EQ | 8-band luminance equalizer with zone preview | Darktable tone equalizer |
| 3 | Presence | Texture + Clarity + Dehaze fused | Lightroom Presence section |
| 4 | Effects | Post-crop vignette + film grain | Lightroom Effects panel |
| 5 | Detail | Sharpen + Luminance NR + Color NR fused | Lightroom Detail; Capture One NR |
| 6 | B&W Mix + Split Toning | Monochrome + per-hue luminance + shadow/highlight tint | Lightroom B&W; Nik Silver Efex |
| 7 | Range Mask (modifier widget) | Luma/color range thumbs + feather; constrains sibling widget | Lightroom Range Mask; Capture One Luma Range |
| 8 | Orton / Glow | Bloom amount + softness + highlight threshold | Michael Orton (1984); Nik Glamour Glow |

**Status:** all 8 are pending. Need ProcessingDefinition (`src/processing/*.tsx`), shader, panel, widget body, and registration. Defer until creative-direction shortlist is locked.
