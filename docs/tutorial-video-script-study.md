# Editor — Onboarding Tutorial Video Script

**Audience:** Study participants (pre-session onboarding)
**Target length:** ~5 minutes (~750 words of narration @ ~150 wpm)
**Format:** Two-column A/V (Visual · Narration)

---

## Production notes

- **Tone is deliberately neutral.** Narration presents every surface — manual and
  AI-assisted — as *ways to make an edit*. Avoid "powerful", "smart", "magic",
  "AI-powered". The study measures how people treat these affordances; the video
  must not tell them what to feel about them.
- **Condition split.** Scenes 1–4, 7, 8 are **shared** (shown to every participant).
  **Scene 5 (assistant-composed controls) and Scene 6 (region-scoped assist) are
  EXPERIMENTAL-ONLY** — cut them for the baseline onboarding cut, in which the
  same edits are reached through the inspector (Scene 3). Both cuts should feel
  complete on their own.
- **No pointing-out of provenance color, autonomy, or "trust".** If participants
  notice the violet marker, that's an observation, not something the tutorial names.
- Record voiceover flat and even. Screen capture at the study machine's resolution.
- Bracketed `[cues]` are on-screen actions, not spoken.

---

## Scene 1 — Welcome & orientation (0:00–0:35)

| Visual | Narration |
|---|---|
| App launches to the empty editor. A single **Open Image** control sits centered. Slow push-in. | This is the photo editor you'll be using today. Let's take a quick tour so you know where things are before you start. |
| Cursor circles the three permanent regions: thin menu bar (top), the large canvas (center), status bar (bottom). | The window keeps only three things on screen at all times: the menu bar up top, the canvas in the middle where your photo lives, and a status bar along the bottom. Everything else appears when you need it and steps out of the way when you don't. |

## Scene 2 — Opening a photo (0:35–1:05)

| Visual | Narration |
|---|---|
| Click **Open Image**; file picker; a landscape photo loads onto the canvas. A panel slides in on the right. | You can open a photo two ways — click Open Image and pick a file… |
| Undo it; drag an image file directly onto the canvas; it loads. | …or just drag a file straight onto the canvas. As soon as a photo is open, a panel appears on the right. That's the inspector, where your adjustment controls live. |

## Scene 3 — The inspector: making an adjustment (1:05–2:00)

| Visual | Narration |
|---|---|
| Inspector's **Adjustments** tab in view. Expand the **Light** section. | The inspector groups the controls by category — Light, Color, White Balance, Tone, and so on. Open a section to see its sliders. |
| Drag **Exposure**; the image brightens live. Drag **Contrast**. | Drag a slider and the image updates as you move. Here we lift the exposure a little… and add some contrast. |
| Collapse Light, open **Color**, nudge **Saturation**. | Each section works the same way. Open it, adjust, move on. |
| Menu bar: toggle the **before/after compare** view; wipe between the two. | At any point you can compare against the original — this before-and-after view shows where you started next to where you are now. |
| `Cmd+Z` once to undo. | And every change is reversible. Undo steps back one edit at a time. |

## Scene 4 — The command palette (2:00–2:45)

| Visual | Narration |
|---|---|
| Press **Cmd+K**. A search field opens over the canvas, listing operations, presets, and menu actions. | There's also a faster way to reach anything in the editor. Press Command-K to open the command palette. |
| Type "cur"; **Curves** filters to the top; select it — the inspector scrolls to and opens the Curves section. | Start typing what you want — a control, a preset, a setting — and it filters as you go. Pick one, and the editor takes you straight to it. |
| Reopen palette; type a plain-language phrase like "make the sky a bit warmer"; hover the confirm affordance without committing yet. | The same field also lets you describe an edit in your own words, rather than hunting for the exact slider. |

## Scene 5 — Assistant-composed controls  ·  **[EXPERIMENTAL-ONLY]** (2:45–3:45)

> **Cut this scene for the baseline onboarding video.**

| Visual | Narration |
|---|---|
| Confirm the typed request from Scene 4. The prompt collapses to a small pill; after a moment a compact panel appears **next to the image** on the canvas. | When you describe an edit this way, a small set of controls appears next to your photo, already set up for what you asked. |
| Expand the panel: it shows a short note, a preview, and one or more labeled sliders. | Open it and you'll see what it's doing and the controls behind it. |
| Drag one of its sliders; the image and the inspector value both move. | These are ordinary controls — drag them to tune the result, exactly like the sliders in the inspector. Nothing is locked in yet. |
| Point to the footer's two buttons: **Apply** and **Dismiss**. Click Dismiss; the effect reverts and the panel disappears. | Two buttons finish the interaction. Dismiss removes the panel and undoes its effect completely — the photo goes back to how it was. |
| Redo the request; this time click **Apply**; the panel closes, the edit stays. | Apply keeps the edit and tidies the panel away. You're always free to try one on and then keep it or drop it. |

## Scene 6 — Editing part of a photo  ·  **[EXPERIMENTAL-ONLY for @-mention; click-select is shared]** (3:45–4:20)

| Visual | Narration |
|---|---|
| With a tool active, **click** on the sky; a selection mask snaps to it. A small label names it as an object. | You don't have to edit the whole image. Click on a region — here, the sky — and the editor selects just that area for you. |
| Refine the edge briefly with a brush stroke. | If the selection needs cleaning up, brush over it to add or remove from the edge. |
| Open the palette, type "@", pick the sky from the list, then finish a short request scoped to it. | Once a region is named, you can refer to it directly — mention it in the palette and your next edit applies only there. |

## Scene 7 — Filling in an area (4:20–4:50)

| Visual | Narration |
|---|---|
| Mark a small unwanted object in the frame. Choose the fill option; type a short description of what should replace it. | If you want to remove or replace something, mark the area and describe what should go there instead. |
| A brief background indicator; the result appears composited into the scene. Accept it. | This one takes a few seconds to prepare. When it's ready, you can keep the result or discard it and try again. |

## Scene 8 — Saving your work & wrap-up (4:50–5:05)

| Visual | Narration |
|---|---|
| Menu bar → export; the file saves. | When you're happy, export saves your edited photo. |
| Pull back to show the full editor with the finished image. Soft fade toward end card. | That's everything you need to get started. Take a moment to open a photo and try the controls yourself — and if anything's unclear during the session, just ask. |
| End card: neutral title only (no logo hype). Hold 2s. | *(no narration)* |

---

### Narration-only reference (for the recording booth)

1. This is the photo editor you'll be using today. Let's take a quick tour so you know where things are before you start.
2. The window keeps only three things on screen at all times: the menu bar up top, the canvas in the middle where your photo lives, and a status bar along the bottom. Everything else appears when you need it and steps out of the way when you don't.
3. You can open a photo two ways — click Open Image and pick a file…
4. …or just drag a file straight onto the canvas. As soon as a photo is open, a panel appears on the right. That's the inspector, where your adjustment controls live.
5. The inspector groups the controls by category — Light, Color, White Balance, Tone, and so on. Open a section to see its sliders.
6. Drag a slider and the image updates as you move. Here we lift the exposure a little… and add some contrast.
7. Each section works the same way. Open it, adjust, move on.
8. At any point you can compare against the original — this before-and-after view shows where you started next to where you are now.
9. And every change is reversible. Undo steps back one edit at a time.
10. There's also a faster way to reach anything in the editor. Press Command-K to open the command palette.
11. Start typing what you want — a control, a preset, a setting — and it filters as you go. Pick one, and the editor takes you straight to it.
12. The same field also lets you describe an edit in your own words, rather than hunting for the exact slider.
13. *(experimental)* When you describe an edit this way, a small set of controls appears next to your photo, already set up for what you asked.
14. *(experimental)* Open it and you'll see what it's doing and the controls behind it.
15. *(experimental)* These are ordinary controls — drag them to tune the result, exactly like the sliders in the inspector. Nothing is locked in yet.
16. *(experimental)* Two buttons finish the interaction. Dismiss removes the panel and undoes its effect completely — the photo goes back to how it was.
17. *(experimental)* Apply keeps the edit and tidies the panel away. You're always free to try one on and then keep it or drop it.
18. You don't have to edit the whole image. Click on a region — here, the sky — and the editor selects just that area for you.
19. If the selection needs cleaning up, brush over it to add or remove from the edge.
20. *(experimental)* Once a region is named, you can refer to it directly — mention it in the palette and your next edit applies only there.
21. If you want to remove or replace something, mark the area and describe what should go there instead.
22. This one takes a few seconds to prepare. When it's ready, you can keep the result or discard it and try again.
23. When you're happy, export saves your edited photo.
24. That's everything you need to get started. Take a moment to open a photo and try the controls yourself — and if anything's unclear during the session, just ask.
