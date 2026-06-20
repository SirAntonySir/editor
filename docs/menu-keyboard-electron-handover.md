# Menu, Keyboard, Electron — Handover

> **Purpose.** Fifth handover in the series. The previous four cover
> architecture, design/UX, problems-and-solutions, and the
> backend/Anthropic strategy. This one fills in three pieces of the
> client surface that are easy to under-document precisely because they
> *don't ship features* — they ship **reach**: where the features can
> be *found*, *invoked*, and *delivered* outside a browser.
>
> Audience: the thesis chapter on the editor's interaction surfaces,
> and any future agent picking the menu / shortcut / desktop work back
> up.

---

## 1 · The three surfaces in one paragraph

The editor exposes **one set of capabilities** via **three input
surfaces**: the **MenuBar** (mouse + discovery), the **keyboard
shortcut layer** (kinetic muscle memory), and **Cmd+K** (search +
arbitrary intent — covered in the design/UX handover). They are not
alternative UIs. They are **redundant entry points into the same
underlying actions**, and the redundancy is deliberate: each surface
optimises for a different stage of the learning curve and a different
working posture. The fourth surface, **Electron**, is not an input
modality at all — it's a *delivery wrapper* that lets the same React
code run as a native desktop app without a server hop.

---

## 2 · The MenuBar

`src/components/toolbar/MenuBar.tsx` (~728 lines). Built on
**Radix Menubar** primitives.

### 2.1 What it is — "the place where you can find it all"

The MenuBar is the editor's **discovery surface**. It is the answer to
the question a first-time user, a returning user after a long break, or
a thesis evaluator asks first: *"what can this thing actually do?"*

The Cmd+K palette assumes you already know what you're looking for —
it's a search index. The toolrail (removed in the canvas-centric
restyle) assumed the same six abstract icon-buttons would be enough.
Neither is true for a discoverable surface. The MenuBar is the
*labelled, hierarchical, mouse-navigable inventory* of every
non-destructive action the editor can perform. If a capability isn't in
the menu, a new user has no path to it.

This frames a load-bearing project commitment: **the menu has to
contain everything**. The current MenuBar is incomplete — Adjustments
are partially there via `Image → Adjustments`, but several registered
ops, every fused-tool template, and the LLM-only actions don't yet
appear. Closing that gap is real work. Until it closes, the editor
fails its own discoverability claim.

The top-level groups today:

| Menu | Today's contents (representative) |
|---|---|
| **File** | Open · Add image · Export As (PNG/JPEG/WebP) · Close |
| **Edit** | Undo · Redo · Revert to Original · Cut/Copy/Paste/Select All (disabled stubs reserving the slot) · Preferences (opens palette) |
| **Image** | Auto (Light / Color / Tone / Contrast) · Adjustments → registry ops by category · Rotate CW/CCW · Flip H/V |
| **Layer** | Layer-panel-equivalent actions for keyboard-only use |
| **View** | Zoom In/Out · Fit on Screen · 100% · 200% · 50% |
| **AI** | Analyze image · Re-analyze · Analyze image… (per image-node) · Suggestion history |
| **Help** | Build info, version, links |

### 2.2 Why we have it — the four arguments

1. **Discoverability before efficiency.** Radix Menubar conveys a
   classic mental model — File / Edit / View / Help — that newcomers
   recognise from every desktop app they've used. The cost is a row
   of low-contrast triggers at the top of the window; the payoff is
   that a user can find Undo, Export, and Zoom in under a second,
   first attempt, every time.

2. **Hierarchical organisation.** Cmd+K is a flat search. The menu is
   the *taxonomy* — Image lives near Layer, View groups all zoom
   actions, AI clusters every Claude-touching action so users learn
   "these are the things that take time and money."

3. **Shortcut teaching surface.** Every menu item that has a keyboard
   shortcut renders its `Kbd` chip on the right of the row. A user
   who clicks Open three times notices the `⌘O` chip the third time
   and internalises it. The menu and the keyboard layer are coupled
   by design: the menu is how shortcuts are *taught*; the keyboard
   layer is how they are *used*.

4. **Visible state.** Every menu item declares `disabled={…}` against
   live state — "Undo" greys out when there's nothing to undo, "Add
   image…" greys out when there's no document or SSE is closed, "Auto
   Light" greys out when the mechanical context hasn't been computed.
   The menu doubles as a *system-state probe*. A user who opens File
   and sees "Add image…" greyed knows the session isn't healthy
   without reading the status bar.

### 2.3 How it works

**Composition.** `MenuBar.tsx` is a flat composition of one
`FileMenu`, `EditMenu`, `ImageMenu`, `LayerMenu`, `ViewMenu`, `AiMenu`,
`HelpMenu`. Each is a function-component declared at module scope
(per the no-inline-component rule from `CLAUDE.md`). They all read the
hooks they need directly (`useEditorStore`, `useBackendState`,
`useFileIO`, `useImageTransform`, `useCanvasZoom`,
`useLiveMechanicalContext`). The menu is *not* prop-drilled — each
menu owns its own reads.

**Primitives.**

- `Item` — wraps `Menubar.Item`, adds the trailing `Kbd` chip when
  `keys` is supplied, accepts `disabled` and `onSelect`.
- `Sub` — wraps `Menubar.Sub` + `SubTrigger` + `SubContent` with the
  project's overlay styling.
- `Sep` — 1 px `--color-separator` divider.
- `TriggerButton` — the top-row button. Hairline, no background
  until `data-state=open`.

The styling lives in three local class strings: `menuContentClass`
(the overlay surface), `menuItemClass` (the row), `subTriggerClass`
(the right-chevron sub-row). All design tokens — never hardcoded
values. Highlights use `data-[highlighted]:bg-accent
data-[highlighted]:text-white` (Radix's keyboard / hover signal).

**Right edge.** After all the top-level menus, the same row hosts:
- `BackendStatusBadge` — the SSE connection pill.
- `UndoRedoButtons` — quick-access redundancy for Edit → Undo / Redo.

### 2.4 The duplication problem (and why it's tolerated for now)

The MenuBar declares its `Item` closures **inline** — `onSelect={() =>
window.dispatchEvent(new CustomEvent('spawn-palette:open'))}` and
similar. The same actions are *also* declared in `src/lib/menu-actions.ts`
which is the source consumed by Cmd+K's "Commands" sections. These two
declarations have drifted from each other in the past.

The intended endgame: **MenuBar adopts `useMenuActions()` too**, so
the menu and the palette share one declaration. Until that lands, every
new menu item has to be added in *both* places. The keyboard-shortcut
layer (`src/lib/keyboard-shortcuts.ts`) is a *third* declaration of
the same actions — see §3.3. Three-way duplication of File/Edit/View
intent is an unfinished consolidation.

### 2.5 What still needs to land for the "find it all" promise

- Every registered op in `Image → Adjustments`. Today the menu lists
  them by category from `shared/registry/ops/*.json`; new ops appear
  for free but the rendering polish (icons, separators between
  categories) is rough.
- Every fused template surfaced as a *named look* under a new menu.
  Today only the planner uses them; a user can't open the menu and
  click "Sky recovery" or "Teal & orange."
- The LLM-only entry points: Cmd+K, refine, repeat, autonomous
  suggestion replay. Some have palette rows; none have menu rows.
- Layers panel parity. The `Layer` menu is sparse; it should mirror
  every right-click action on a layer row.

When all four are in, the discoverability claim holds without
caveats. That work is bounded — finite, listable — and it is the cost
of taking the "where you can find it all" framing seriously.

---

## 3 · The keyboard shortcut layer

`src/lib/keyboard-shortcuts.ts` (~190 lines). Installed once at app
boot by `<KeyboardShortcuts/>` (`src/components/KeyboardShortcuts.tsx`)
in `App.tsx`.

### 3.1 What it is

A single global `keydown` listener at `document` level. It looks up
the key combination in a flat array of `ShortcutEntry` records and
fires the matching `action()`. Inputs / textareas / contenteditable
elements early-out so typing in a field never triggers a shortcut.
Platform-aware: on macOS `mod = Cmd`; everywhere else `mod = Ctrl`.

### 3.2 Why we have it

**Three distinct user benefits, in increasing order of subtlety:**

1. **Conventional bindings have to work.** `Cmd+O` opens, `Cmd+S`
   saves, `Cmd+Z` undoes, `Cmd+Shift+Z` redoes, `Cmd+0` fits on
   screen, `Cmd+W` closes. Photographers expect these; not providing
   them is a usability failure. The shortcut layer is the
   non-negotiable baseline.

2. **Tool registry shortcuts compose automatically.** Every
   `ToolDefinition` registered with `CanvasToolRegistry` can declare a
   `shortcut`. `buildShortcuts()` reads the registry at install time
   and registers each one with the correct mode-gating logic — a tool
   only fires when its declared `modes` includes the current editor
   mode, and tools that require an AI session don't fire before
   analyze completes. Adding a tool gets a shortcut for free without
   touching this file.

3. **Reach into Cmd+K and the menu.** `Cmd+,` opens the palette
   (Preferences live there now), `Cmd+]` toggles the right sidebar,
   `Cmd+Alt+A` triggers analyze, `Cmd+Alt+R` reverts. The shortcut
   layer is the keyboard-only path to every surface the mouse user
   reaches via the menu, including back into the palette itself.

### 3.3 How it works

```
                  installKeyboardShortcuts() (App.tsx mount)
                                │
                                ▼
            buildShortcuts() — flat list of ShortcutEntry
                                │
        ┌───────────────────────┼─────────────────────────────┐
        ▼                       ▼                             ▼
  CanvasToolRegistry        Hard-coded globals          Mode toggle
  walk: every tool with    Cmd+O, Cmd+Shift+O,         Tab cycles
  `shortcut` is bound,     Cmd+Z, Cmd+Shift+Z,         develop ↔ compose
  mode + AI-gate logic     Cmd+Alt+R, Cmd+,
  wrapped in the action    Cmd+], Cmd+Alt+A
                                │
                                ▼
        document.addEventListener('keydown', handler)
                                │
                                ▼
        handler:
          - early-out if input/textarea/contenteditable focused
          - normalise Mac Cmd ↔ PC Ctrl
          - linear scan, first match wins, preventDefault
                                │
                                ▼
                       teardown: unsubscribe on unmount
```

**Browser-imposed avoidance.** Two shortcuts moved off their natural
chord because the browser eats them:
- `Cmd+Shift+R` is the browser's hard-reload (not preventable). Revert
  uses `Cmd+Alt+R` instead.
- `Cmd+Shift+A` is Chrome's tab-search (not preventable). Analyze
  uses `Cmd+Alt+A` instead.

In Electron these conflicts vanish — Electron owns the keyboard. But
the editor runs as a browser app in dev and in the web build, so the
binding choice has to survive both. We picked the chord that works
*everywhere* rather than maintaining two tables.

**Display.** `getShortcutEntries()` exposes a `{label, display}`
array. The Help dialog and any future cheatsheet read from it. The
`Kbd` primitive (covered in design/UX handover §5) renders the chord
in platform-correct glyphs.

### 3.4 The advantages it brings

- **Muscle memory survives onboarding.** A photographer's existing
  Lightroom / Photoshop reflexes (`Cmd+Z`, `Cmd+0`, `Cmd+W`,
  `Cmd+Shift+E`) land on the right actions without reading a manual.
- **The thesis evaluation produces less noise.** A user who reaches for
  `Cmd+Z` and gets undo doesn't break stride; the telemetry captures
  the intent rather than a mistrigger.
- **Mode-gating built in.** Tool shortcuts respect the editor mode and
  the AI-session state without per-shortcut duplication. The same
  `B` press activates the brush only when brush mode allows it.

### 3.5 The same duplication problem

Every shortcut is declared *three times*:
- Once in `MenuBar.tsx` as `keys={[…]}` on the menu Item (display only).
- Once in `keyboard-shortcuts.ts` as the registered chord that
  actually fires.
- Once in `menu-actions.ts` for the palette's "Commands" section.

The displayed `Kbd` chip can drift from the registered chord; the
palette can declare a chord the listener doesn't fire. Closing this is
the same consolidation work the MenuBar duplication needs (§2.4).

---

## 4 · Electron

`electron/main.cjs` (45 lines), `electron/preload.cjs` (10 lines).
electron-builder config in `package.json` `"build"` block.

### 4.1 What it is

A tiny Electron shell that loads the same Vite build (`dist/`) the
browser uses. The main process boots a single 1440 × 900 window,
loads either `http://localhost:5173` in dev or `dist/index.html` in
prod, and exits when the last window closes (except on macOS where
the dock survives). The renderer (the React app) is *unchanged* — it
doesn't know it's in Electron. The preload script exposes a tiny
`window.electron` bridge with platform + version info, and that's it.

### 4.2 Why we have it

**Three concrete reasons:**

1. **The thesis claim is desktop-first.** "A high-fidelity photo
   editor" suggests an application a photographer launches from their
   dock alongside Lightroom and Photoshop, not a tab they keep in a
   browser. The Electron build is the artefact that makes the claim
   tangible — there is a `.dmg` (macOS), `.exe` installer (Windows),
   and `.AppImage` (Linux) produced by `npm run electron:build`. The
   evaluation can hand a participant a real installer rather than a
   URL.

2. **The keyboard belongs to the app.** A browser tab competes with
   Cmd+Shift+R, Cmd+Shift+A, Cmd+T, Cmd+W, Cmd+L, Cmd+R — every one
   of those is a chord a photographer might want. Electron owns the
   window-level keyboard. The shortcut table can pick the *natural*
   chord rather than the browser-survivor (see §3.3).

3. **The frame matters for image work.** Browser chrome — tabs, URL
   bar, bookmarks — eats vertical pixels and visual attention. The
   Electron window uses `titleBarStyle: 'hiddenInset'` so the macOS
   traffic lights blend into the title strip and the canvas gets the
   full window height. The backdrop is `#0a0a0a` (the dark surface
   token) so launch-time flash is the editor's own colour, not a
   white blank.

### 4.3 How it works

**Architecture.**

```
electron/main.cjs (main process)
    │
    ├─ BrowserWindow({ 1440×900, hiddenInset, dark bg })
    │     ├─ webPreferences: contextIsolation + sandbox + nodeIntegration=false
    │     └─ preload: electron/preload.cjs
    │
    ├─ loadURL(VITE_DEV_SERVER_URL) | loadFile(dist/index.html)
    │     │
    │     └─→ React app renders the same code as the browser build
    │
    └─ setWindowOpenHandler(({url}) => shell.openExternal(url))
              ↑ external links never open a second Electron window;
                they hand off to the OS browser
```

**Security posture.** Three Electron flags pinned to safe defaults:

- `contextIsolation: true` — the preload runs in an isolated context;
  the renderer cannot reach into Node.
- `sandbox: true` — the renderer runs in Chromium's sandbox.
- `nodeIntegration: false` — `require()` is not available in the
  renderer.

This means the React code in `src/` can be audited as a pure browser
app. The only Node-reachable code is the 10-line preload, which only
exposes the `process.platform` string and version numbers.

**Two scripts.**

- `npm run electron:dev` — runs Vite + Electron concurrently. Waits
  for Vite to come up (`wait-on tcp:5173`) before opening Electron;
  the renderer points at the dev server so HMR works inside the
  Electron window. DevTools open in detached mode.
- `npm run electron:build` — `tsc -b && vite build && electron-builder`.
  Produces a `release/` directory with platform installers.

**Packaging targets** (from `package.json` `build` block):
- macOS: `.dmg`, `category: public.app-category.photography`
- Windows: NSIS installer
- Linux: AppImage

`appId: com.cloudhaus.photo-editor`, `productName: Photo Editor`.

### 4.4 The advantages it brings

- **Keyboard sovereignty.** Every browser-collision shortcut becomes
  pickable. The Help/Cheatsheet can offer the *natural* binding
  (Cmd+Shift+R for revert, Cmd+Shift+A for analyze, …) once the
  build target is Electron-only — for now the shortcut layer has to
  pick a chord that works in both.
- **Single-process security.** The contextIsolation + sandbox +
  no-nodeIntegration triad means a compromised React render cannot
  reach the user's filesystem.
- **One renderer codebase.** The React app doesn't fork by target.
  `window.electron` exists in Electron and is `undefined` in the
  browser; code paths that want it can branch, but no UI is gated on
  the host so the browser build is fully functional.
- **External links open externally.** `setWindowOpenHandler` hands
  every outbound URL to `shell.openExternal`, so a user clicking a
  documentation link gets their actual browser instead of an
  in-window pop-up.

### 4.5 What we deliberately don't do (yet)

- **No native menu.** Electron's `Menu.setApplicationMenu` would
  surface the in-app MenuBar at the OS level (system-wide Cmd+Q,
  About dialog, the macOS apple-menu integration). We haven't wired
  it; the in-app MenuBar carries the work for now. Adding the native
  menu is one of the low-cost "things still on the list" items —
  it'd cost about a screen of code in `main.cjs` plus a duplicate
  table of items, or a JSON contract the preload reads.
- **No auto-update.** electron-builder supports it; we don't ship
  signed binaries yet so there's no update channel to publish to.
- **No IPC.** The preload exposes read-only constants. There is no
  invoke / handle pattern, no file-system access, no native dialog
  triggers. Open / Save use the *browser* `<input type="file">` and
  `canvas.toBlob()` — same code path as the web build. When a native
  file dialog becomes warranted (drag-and-drop folders, recents
  list), it'll go through a new `ipcMain.handle` channel and a
  `window.electron.openFile()` bridge in the preload.

---

## 5 · How the three surfaces compose

The same Open action has **four** entry points:

1. **`File → Open…`** in the MenuBar — discovery.
2. **`Cmd+O`** via `keyboard-shortcuts.ts` — keyboard-only flow.
3. **"Open"** row in Cmd+K via `menu-actions.ts` — search.
4. **OS-level dock click → app launch** opens the Electron window;
   the empty-state UI shows an "Open Image" button that calls the
   same handler.

All four resolve to `useFileIO().handleOpen` — a single function in
one module. The four surfaces are *teaching aids* and *delivery
vectors* for one underlying capability. **No surface owns logic.** A
new capability is added by writing its action once, then wiring it
into each of the four surfaces it's relevant to.

This is the load-bearing design choice: the editor's *actions* are a
single registry-shaped catalog; the *surfaces* are pluggable indexes
over it. The current state of three-way duplication
(MenuBar inline / `keyboard-shortcuts.ts` / `menu-actions.ts`) is a
*deviation* from this principle, not the principle itself. The fix —
adopting `useMenuActions()` as the single source — is on the list.

---

## 6 · Suggested thesis text outline

For lifting into the chapter:

1. **§X.1 — Three input surfaces, one delivery wrapper.** §1 of this
   document collapses into the framing sentence: redundancy is
   intentional, each surface serves a posture.

2. **§X.2 — MenuBar as discoverability.** §2.1 + §2.2. Make the "find
   it all" claim explicit, including the honest admission that it's
   incomplete and what closing the gap means (§2.5).

3. **§X.3 — The keyboard layer.** §3.1 + §3.2 + §3.4. Mention the
   browser-collision workaround as one paragraph; it's a small but
   real design constraint worth naming.

4. **§X.4 — Electron as desktop reach.** §4.1 + §4.2 + §4.4. The
   three reasons are the chapter; the security posture (§4.3) is a
   one-paragraph aside.

5. **§X.5 — Composition.** §5. The "one Open, four entry points"
   walkthrough is the cleanest way to make the design choice
   concrete.

6. **§X.6 — Honest limitations.** §2.5 + §3.5 + §4.5. The three
   "what we don't do yet" sections, collapsed, frame the future work
   without hand-waving.

---

## 7 · Citable artefacts

- `src/components/toolbar/MenuBar.tsx` — the menu surface.
- `src/lib/menu-actions.ts` — the action catalog the palette
  consumes; the intended single source for menu actions long-term.
- `src/lib/keyboard-shortcuts.ts` — the global keydown layer.
- `src/components/KeyboardShortcuts.tsx` — the React mount point.
- `src/components/ui/kbd.tsx` — the chord-rendering primitive (also
  in design/UX handover).
- `electron/main.cjs` + `electron/preload.cjs` — the desktop shell.
- `package.json` `build` block — electron-builder targets.
- Sibling handover docs:
  - `design-ux-handover.md` §4 covers Cmd+K, §5 covers Kbd.
  - `implementation-architecture-handover.md` §5.10 documents the
    three-tier component rule the MenuBar primitives obey.

---

## 8 · Decision register

Consolidates the design choices made for these three surfaces into the
numbered Entscheidung shape used by the other handovers, for direct
lifting into the thesis chapter.

**Entscheidung 1 — Three surfaces, not one.**
Ship MenuBar, keyboard layer, and Cmd+K simultaneously rather than
picking the "best" of them.
*Argument.* The three surfaces optimise for different stages of the
learning curve — discovery, search, muscle memory — and a single
surface forces a tradeoff users feel as friction. Redundancy is the
feature, not waste.

**Entscheidung 2 — MenuBar carries the discoverability claim.**
The MenuBar — not Cmd+K, not the toolrail — is the inventory of every
action the editor can perform.
*Argument.* Search assumes the searcher already knows the noun. A
labelled hierarchical taxonomy is the only surface that answers "what
can this do?" for someone who can't name what they want. The cost is
an honest list of what's still missing (§2.5); the alternative is a
discoverability claim the product can't back.

**Entscheidung 3 — Radix Menubar over a hand-rolled menu.**
Inherit Radix's keyboard navigation, focus management, and ARIA roles
instead of reimplementing them.
*Argument.* Menu interactions are a solved problem with deep edge
cases (Type-ahead, arrow-key traversal across sub-menus, focus
return on close). Reimplementing them is a way to ship subtly broken
keyboard accessibility. The styling is ours; the behaviour is Radix's.

**Entscheidung 4 — Each menu reads its own state.**
`FileMenu`, `EditMenu`, etc. each call the hooks they need; the
MenuBar does not prop-drill state down.
*Argument.* The menus are siblings — coupling them through a parent
that aggregates state inverts the dependency. Each menu's `disabled`
logic stays local to the menu it gates, which is where future
maintenance will happen.

**Entscheidung 5 — Trailing `Kbd` chips on every shortcuted item.**
Render the chord next to the label inside the menu row.
*Argument.* The menu is where shortcuts are *taught*. A user who
opens File → Open three times before noticing `⌘O` would never have
noticed it from a separate cheatsheet. Coupling display to the
discovery surface is the lowest-friction teaching mechanism.

**Entscheidung 6 — `disabled` reflects live system state.**
Menu items grey out against `useBackendState`, `useEditorStore`, and
mechanical-context readiness, not against a static permission table.
*Argument.* The menu doubles as a system-state probe. "Add image…"
greying out tells the user the SSE is down without making them read
the status bar. The cost is a hook call per render; the payoff is a
self-documenting surface.

**Entscheidung 7 — Single global keydown listener.**
Install one `document`-level handler at boot, not per-component.
*Argument.* Per-component listeners race on focus and accumulate when
components mount/unmount. One listener with an early-out on focused
inputs handles every case without the lifecycle bookkeeping.

**Entscheidung 8 — Browser-survivor chords over native chords.**
Pick `Cmd+Alt+R` for Revert and `Cmd+Alt+A` for Analyze instead of
the natural `Cmd+Shift+R` / `Cmd+Shift+A` chords.
*Argument.* The editor runs in browser and Electron. Maintaining two
shortcut tables doubles the failure surface; picking a chord that
works in both means the documentation, the menu chip, and the
listener never disagree.

**Entscheidung 9 — Tool shortcuts auto-bind from the registry.**
`buildShortcuts()` walks `CanvasToolRegistry`; each tool's `shortcut`
field becomes a binding, mode-gated automatically.
*Argument.* The cost of registering a tool drops to one declaration.
The shortcut layer scales without manual edits and stays consistent
with the tool's own mode requirements.

**Entscheidung 10 — Electron without a native menu (today).**
Ship the Electron build with the in-app MenuBar only; don't wire
`Menu.setApplicationMenu`.
*Argument.* The in-app MenuBar covers the find-it-all promise, and
the native menu would duplicate it. Adding the native menu is bounded
work (~one screen of code) but isn't load-bearing for the thesis
claim. The decision is "later," not "no."

**Entscheidung 11 — Electron security: triad pinned, no IPC.**
`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
preload exposes only platform strings.
*Argument.* The React renderer is auditable as a pure browser app.
The instant a feature needs Node — native file dialogs, drag-folder
support — the IPC contract becomes the place where the security
posture has to be re-justified. Until then, no surface area to
defend.

**Entscheidung 12 — External links escape Electron.**
`setWindowOpenHandler` hands every outbound URL to
`shell.openExternal`.
*Argument.* A documentation link opening in a second Electron window
strands the user in an in-app browser without history, bookmarks, or
extensions. Shipping to the OS browser is the behaviour users expect
from a desktop app.

**Entscheidung 13 — Three-way duplication tolerated, not endorsed.**
MenuBar inline / `keyboard-shortcuts.ts` / `menu-actions.ts` declare
the same actions three times. Consolidation to a single
`useMenuActions()` consumer is on the list.
*Argument.* The principle is one catalog and pluggable indexes (§5).
The current state deviates from the principle for one reason: the
consolidation work hasn't shipped. Documenting it as a deviation
(not a design) preserves the principle for the next agent picking it
up.

---

## 9 · The complete shortcut table

Lifted from `getShortcutEntries()` and the MenuBar's `Kbd` chips,
for the thesis appendix and the in-app cheatsheet alike. Display
strings shown for macOS; on Windows/Linux substitute `Ctrl` for
`Cmd` and `Alt` for `Option`.

| Chord | Action | Source | Surfaces present |
|---|---|---|---|
| `⌘O` | Open… | global | Menu (`File`), palette |
| `⌘⇧O` | Add image… | global (gated: doc + SSE) | Menu (`File`), palette |
| `⌘Z` | Undo | global | Menu (`Edit`), palette, UndoRedoButtons |
| `⌘⇧Z` | Redo | global | Menu (`Edit`), palette, UndoRedoButtons |
| `⌘⌥R` | Revert to Original | global (browser-survivor) | Menu (`Edit`), palette |
| `⌘,` | Preferences (opens palette) | global | Menu (`Edit`) |
| `⌘]` | Toggle right sidebar | global | Menu (`View`) |
| `⌘⌥A` | Analyze image | global (browser-survivor; gated) | Menu (`AI`), palette |
| `Tab` | Toggle mode (develop ↔ compose) | global | — |
| *(per-tool)* | Activate registered tool | `CanvasToolRegistry.shortcut` (mode-gated) | Tool button, palette |
| `⌘K` | Open command palette | the palette itself | Always available when SSE open |

Items the menu surfaces but the keyboard layer does **not** bind
(menu-only today):

- File → Export As → PNG / JPEG / WebP
- File → Close
- Image → Auto Light / Auto Color / Auto Tone / Auto Contrast
- Image → Adjustments → *(every registry op by category)*
- Image → Rotate / Flip
- View → Zoom In / Out / Fit / 100% / 200% / 50%
- AI → Re-analyze · Analyze image… per node · Suggestion history
- Help → Build info, links

These are the candidates for the next round of binding promotion —
each is currently a mouse-only path, and each has a defensible
"natural" chord. The binding budget is small (every new chord
fights for screen space on the cheatsheet); the promotion decision
should be driven by telemetry of which menu items get clicked most,
not by speculation.

The palette covers all of them by name today. That's the safety net
the binding budget gets to lean on: nothing is reach-blocked just
because it lacks a chord, because Cmd+K finds it in three
keystrokes.
