# Code Quality & Testing Handover

> **Purpose.** Fourth sibling to `implementation-architecture-handover.md`,
> `design-ux-handover.md`, `backend-and-anthropic-handover.md`, and
> `interaction-model-handover.md`. Those briefs explain what exists, how
> it looks, how the backend reasons, and how the interaction model
> evolved. This one explains *how the project enforces correctness, and
> what convention makes that enforcement cheap to live with*.
>
> Audience: a second agent picking up the code, or the thesis writer
> documenting the engineering practice that produced the artefact.
>
> Every load-bearing rule below is labelled **Entscheidung** with the
> argument that produced it — most are visible in code today
> (`tools/eslint-rules/`, `vitest.config.ts`, `.git-hooks/pre-commit`,
> the per-task TDD pattern in every plan under
> `docs/superpowers/plans/`).

---

## 0 · The bar in one paragraph

The project ships exactly one quality gate: **`npm run check`**. It
runs four steps in order — `gen-shared-types --check`, `tsc -b`,
`eslint .`, `vitest run --passWithNoTests` — and it must be green on
every commit (the pre-commit hook runs it). The cost of that
discipline is real, but every alternative is more expensive: a
type-only check skips behavioural regressions, a test-only check
skips contract drift, and a green CI without a local gate trades a
~12-second pre-commit for a 5-minute round-trip. **The gate is the
contract** between this session, the next session, and any subagent.
Everything else — the custom ESLint rule, the dual-environment vitest
projects, the shared-types regen, the coalesce of frontend + backend
tests under one command — exists to make that one gate honest.

---

## 1 · The four-step gate, explained

```bash
npm run check
# = npm run gen:types:check && tsc -b && eslint . && vitest run --passWithNoTests
```

### 1.1 · `gen:types:check`

The frontend's TypeScript types for everything that crosses the
backend wire (`Widget`, `Scope`, `OperationGraph`, `SessionStateSnapshot`,
`ImageContext`, etc.) are **generated from the backend's pydantic
models**, not hand-authored. The generator is
`scripts/gen-shared-types.py`; it writes:

- `shared/types/generated.ts` — TypeScript interface declarations.
- `shared/schemas/*.json` — JSON-Schema duals for every model.
- `shared/types/generated-config.ts` — runtime-config values
  (history depth, debounce windows, etc.) hoisted out of
  `backend/app/config/runtime.py`.

The `--check` variant runs the generator and diffs the result against
the committed file. **A drift between backend models and the
committed types fails the gate.** This is the load-bearing rule that
keeps the Engine-SSoT doctrine honest: there is no second source of
truth on the frontend, only a generated mirror.

**Entscheidung — generation, not hand-mirroring.** Mirroring the
backend types by hand on the frontend was the prior pattern;
drifted within a week. Generating-and-checking means a backend
schema change *must* land with a regen, and reviewers see both
sides in one diff. The generator is fast (~1 s) and idempotent;
generating is always cheaper than debugging a stale mirror.

### 1.2 · `tsc -b`

TypeScript project-references build. Strict mode. The build catches
generic correctness issues — unused imports (configured to error),
missing type narrowing on discriminated unions (the `Scope` and
`Widget` unions both benefit from this), illegal cross-package
imports. Combined with the generated wire types, every change to a
backend model that breaks a frontend consumer surfaces as a tsc
error inside the consumer file, with the exact line number.

### 1.3 · `eslint .`

The standard `@eslint/js` + `typescript-eslint` +
`eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` stack,
plus **one custom rule** that is load-bearing for the component
architecture: `editor-local/no-nested-component-definition`. See §4.

### 1.4 · `vitest run --passWithNoTests`

The frontend test runner. Two test projects under one config so a
single invocation covers both environments (§3).

### 1.5 · Where backend tests fit

Backend tests run under `pytest` with `asyncio_mode = "auto"`
(`backend/pyproject.toml`). `npm run check` does **not** run pytest
— the frontend-only gate keeps the local loop tight (~12 s) and
backend tests run alongside backend work (~6 s for 700 tests). The
pre-commit hook explicitly runs only `npm run check` because the
day-to-day editor of code in this project edits TypeScript an order
of magnitude more often than Python.

**Entscheidung — split the gate by language, run pytest separately.**
A single combined gate that runs both `npm run check` and `pytest`
would take ~20 s per commit. Most edits touch one side only.
Splitting respects edit locality; backend developers run
`pytest backend/` after their changes; frontend developers run
`npm run check` after theirs; a session that touches both runs
both. The pre-commit hook covers the side most likely to drift.

---

## 2 · The pre-commit hook

```bash
# .git-hooks/pre-commit
#!/usr/bin/env bash
set -e
npm run check
```

Three properties:

1. **`set -e`** — the moment any of the four check steps fails, the
   commit aborts. There is no path to a committed-but-failing tree.
2. **No `--no-verify` carve-out.** `superpowers` skills explicitly
   forbid passing `--no-verify` to skip hooks unless the user asks.
   Every commit produced in subagent sessions during this period
   went through the gate. The handful of failures that landed were
   pre-existing flakes (`test_state_event_kinds` in the schemas
   suite, called out in commit messages so they wouldn't be
   confused with new breakage).
3. **Installed via `package.json:prepare`** (`git config core.hooksPath
   .git-hooks`). New clones inherit the hook on first `npm install`
   without any per-developer setup step.

**Entscheidung — repo-managed hooks, not Husky.** Husky pulls a
~MB of node modules at install time and adds a level of indirection
over `git config`. A two-line shell script in `.git-hooks/` with a
one-line `prepare` script is auditable, transparent, and version-
controlled. The hook can be read in three seconds; Husky's hook
runner cannot.

---

## 3 · Vitest projects — two environments, one config

`vitest.config.ts` declares two **projects** that vitest runs in
parallel:

| Project | Environment | Includes |
|---|---|---|
| `node` | `node` | `src/**/*.test.ts`, `tests/**/*.test.ts`, `shared/**/*.test.ts` |
| `jsdom` | `jsdom` | `src/**/*.test.tsx`, `tests/**/*.test.tsx` |

The split is by **file extension**: `.test.ts` for pure-logic
modules (slices, helpers, parsers, schema utils), `.test.tsx` for
anything that renders React. The naming convention is the routing
rule; you never edit `vitest.config.ts` when adding a test, you just
pick the right extension.

**Entscheidung — environment by extension, not by directory.** The
alternative (a `node/` and `jsdom/` directory split) forces the test
to live far from the code under test. Co-location is more important:
the test sits next to the file it tests with the matching extension.
A reader who opens `LayerRow.tsx` finds `LayerRow.test.tsx` in the
same folder; a reader who opens `select-pipeline-nodes.ts` finds
`select-pipeline-nodes.test.ts`. The extension also serves as a
type-discriminator on first read.

### 3.1 · The jsdom setup file

`src/test/setup.ts` registers shims for browser APIs jsdom does not
implement:

- `HTMLElement.prototype.scrollIntoView` — used by CommandPalette
  keyboard nav, Radix scroll-into-view-on-focus behaviour.
- `Element.prototype.setPointerCapture` /
  `releasePointerCapture` — used by `CurveEditor` drag, Radix
  Slider thumb capture.
- `globalThis.ResizeObserver` — Radix uses it for measured
  positioning (Popover, Tooltip).

Each shim is a no-op stub; the goal is "don't throw during test
mount", not "implement the real semantic". Without these shims,
mounting a Radix Popover or a Slider component in jsdom throws
synchronously and the entire test file fails.

**Entscheidung — minimal stubs, not full jsdom polyfills.** A real
implementation of `ResizeObserver` in jsdom is non-trivial and
introduces its own correctness surface. Tests that need observed
size do so via store seeding (set the value, render, assert);
tests that *render* a component using `ResizeObserver` internally
just need the API to be non-throwing. The stubs honor that
contract without inviting an arms race with browser specs.

---

## 4 · The one custom ESLint rule that earns its keep

`tools/eslint-rules/no-nested-component-definition.js` — fires
`error` on any function (declaration or arrow) that is declared
**inside another function's body** AND **appears to return JSX**.

### Why this is load-bearing

React re-creates a component identity on every render of the
enclosing parent if the inner component is defined inside the
parent. The result: the inner component **never** memoises, its
state resets on every parent render, and its DOM remounts. Every
child element under it remounts too. The bug is invisible in
development and devastating in production — slider drags lose
their drag state, focus jumps around, transitions reset.

The CLAUDE.md states the rule as project policy:

> **No inline-defined components.** Never declare a functional
> component inside another component body. Hoist to module scope
> or a sibling file. Render callbacks that don't represent a
> reusable unit are fine.

The lint rule enforces this mechanically. The heuristic:

- An UpperCamelCase name → treated as a component.
- A return whose top expression is `JSXElement` or `JSXFragment`
  (or a conditional whose either branch is) → treated as
  returning JSX.

Render callbacks (lowercase names, passed inline to `.map` etc.) are
intentionally out of scope — those don't have the re-creation
problem because they aren't React components, just functions React
calls.

### Self-test for the lint rule itself

`tools/eslint-rules/no-nested-component-definition.test.js` is a
plain Node script that runs the rule against a fixture set with
labelled positives and negatives. It is invoked by
`npm run lint:rules` and is intentionally NOT part of the gate —
it tests the rule's own logic, which changes once per year. When
the rule changes, the developer runs `npm run lint:rules` by hand.

**Entscheidung — one project-specific rule, no second.** A larger
project might accumulate ten custom rules. This one rule has paid
for itself many times: every Layer-tab restyle, every history-
dropdown rewrite, every collapsed-pill change starts with a
"render the row separately" instinct that the rule reinforces.
A second rule would compete for the developer's attention; ESLint
is at its most useful when its messages are rare enough to read.

---

## 5 · TDD-per-task — the discipline that scales

Every plan under `docs/superpowers/plans/` follows the same
per-task shape:

```
- [ ] Step 1: Write the failing test
  <complete test code>
- [ ] Step 2: Run test to verify it fails
  Run: npm test -- --run path/to/test
  Expected: FAIL with <message>
- [ ] Step 3: Write minimal implementation
  <complete implementation code>
- [ ] Step 4: Run test to verify it passes
  Run: npm test -- --run path/to/test
  Expected: PASS
- [ ] Step 5: Commit
  git add … && git commit -m "…"
```

Three operational consequences:

1. **The implementer (often a fresh subagent) cannot ship code
   without a passing test.** The failing-first step is checkable;
   the implementer reports the test name and the expected failure
   message. A subagent that skips the failing step gets caught by
   the spec reviewer.
2. **Each commit is a green tree.** A subagent that breaks a test
   in step 3 must fix it in step 3 before step 4 succeeds. The
   pre-commit hook reinforces this — even if the subagent's
   implementation passes its own test, an unrelated test failure
   aborts the commit.
3. **Coverage grows naturally, not deliberately.** Over the two-
   spec sequence (image-layer-object rework + visibility-driven
   adjustments), the test count grew from 800 → 944 with no
   "let's add tests" task in any plan. Every task contributed at
   least one test.

The numbers as of this writing:

| Side | Test count | Approx duration |
|---|---|---|
| Frontend (vitest, 2 projects) | 932 | ~10 s |
| Backend (pytest, asyncio_mode=auto) | 700 | ~6 s |

**Entscheidung — TDD via the plan template, not via culture.** A
"TDD culture" relies on developers remembering. The template
makes the failing test a *checkbox*. Subagents follow the
template literally; humans follow it by habit. Either way the
test exists at commit time.

---

## 6 · Test patterns that recur

Six patterns appear in every test file the project produces. A new
test that uses them lands in the same shape as the existing tests
without needing review.

### 6.1 · Store seeding in `beforeEach`

```ts
beforeEach(() => {
  useEditorStore.setState({
    imageNodes: { 'in-1': { id: 'in-1', layerIds: ['L1'], … } },
    layers: [{ id: 'L1', type: 'image', name: 'photo.jpg', … }],
    activeImageNodeId: 'in-1',
    activeLayerId: 'L1',
  });
});
```

The store is a Zustand slice composed module; direct `setState`
seeds any combination of fields. No fixtures factory layer. The
test reads as a description of the editor state under test.

### 6.2 · `vi.mock` of backend modules

```ts
vi.mock('@/lib/backend-tools', () => ({
  backendTools: { proposeStack: vi.fn() },
}));
```

Mocks the wire surface, not the implementation. Asserts on the
`proposeStack` mock's calls (`expect(backendTools.proposeStack)
.toHaveBeenCalledWith('S1', expect.objectContaining({
layerId: 'L1', layerIds: ['L1', 'L2'] }))`). Three of the four
visibility-driven adjustments tasks added a test of this exact
shape. The pattern is so consistent that a reader who has seen one
recognises every subsequent occurrence.

### 6.3 · `vi.useFakeTimers()` for coalesced behaviour

The "Image added — click to edit" burst-coalesce test runs:

```ts
vi.useFakeTimers();
await editorDocument.addImage(await pixelFile('a.png'));
(toast as ReturnType<typeof vi.fn>).mockClear();
await Promise.all([
  editorDocument.addImage(await pixelFile('b.png')),
  editorDocument.addImage(await pixelFile('c.png')),
]);
vi.advanceTimersByTime(300);
expect(toast).toHaveBeenCalledTimes(1);
expect(toast).toHaveBeenCalledWith(expect.stringMatching(/2 images added/i));
```

The pattern is wherever a debounce or coalesce window matters
(history coalescing test, smart-match debounce test, toast burst).

### 6.4 · Window-event dispatch + listener tests

For inter-module communication via window events
(`spawn-palette:open`, `segment-hit:external-candidate`), tests
capture the dispatched detail:

```ts
let captured: CustomEvent<unknown> | null = null;
const handler = (e: Event) => { captured = e as CustomEvent<unknown>; };
window.addEventListener('segment-hit:external-candidate', handler);
selectInvertedObject(ref, 'in-1');
window.removeEventListener('segment-hit:external-candidate', handler);
expect(captured).not.toBeNull();
```

Avoids mocking globals, asserts behaviour at the wire boundary.

### 6.5 · Subscription guard tests

When a component is supposed to re-render on a store-field change,
the test asserts the subscription directly:

```ts
it('rerenders when activeImageNodeId changes (subscription guard)', () => {
  const { getByText } = render(<InfoTab />);
  act(() => { useEditorStore.setState({ activeImageNodeId: 'in-1' }); });
  act(() => { useEditorStore.setState({ activeImageNodeId: 'in-2' }); });
  // assertion that the rendered output reflects in-2
});
```

The pattern catches the *useImageNodeRender deps array* class of
bugs (one of which surfaced in the visibility-driven sequence —
toggling visibility didn't repaint live because no layer field was
in the deps). Adding a subscription-guard test next to a new
subscription costs ~10 lines and prevents the next regression.

### 6.6 · Brief manual flows in the plan

Every plan section ends with a `## Verification` block that names
the **manual flow** the implementer runs after the unit tests pass.
The flow is short (3-5 steps) and is the contract between the
unit-test layer and the user-observable behaviour. A subagent
reports this flow's outcome in their handoff report; the controller
treats it as the last gate.

---

## 7 · What's intentionally not tested

For the thesis writer: a fair accounting of the coverage **gaps**,
each with the reason it's not in scope.

- **WebGL-level rendering.** The renderer's filter and compositor
  paths are unit-tested at the *selection* boundary (`matchesLayer`,
  `layersSignature`) but not at the pixel-comparison level. WebGL
  pixel comparison in jsdom is impractical; an end-to-end visual
  regression suite would require headless browser infrastructure
  that doesn't currently exist. Manual verification covers the
  pipeline behaviour; the unit tests cover the selection of which
  ops apply to which layers.
- **End-to-end LLM flows.** The propose-stack handler is tested for
  argument-shaping; the agent loop end-to-end is not. The cockpit
  (`backend/app/api/admin.py`) and event journal stand in for
  end-to-end traces — see the backend-and-anthropic handover.
- **Backend-frontend round-trips against a real backend.** Each
  side mocks the other at the wire boundary
  (`backendTools.proposeStack` mocked on frontend; FastAPI test
  client used on backend). A small integration suite exists
  (`backend/tests/tools/test_propose_stack_integration.py`) and
  uses a real `httpx` client against the FastAPI app for the
  highest-value paths.
- **Multi-user / multi-session interleaving.** The session store
  serialises per-session via `asyncio.Lock` (see commit
  `40426c6` — the per-session `write_lock` was originally a
  thread-blocking `threading.Lock`, the fix replaced it). Tests
  cover the lock acquisition order but not chaos-style concurrent
  access; the editor is single-user by design.
- **Visual regressions beyond a snapshot here and there.** The
  drafting register is enforced through token discipline
  (CSS variables in `src/index.css`) and per-file conventions, not
  through pixel snapshots. A snapshot suite would catch font /
  spacing drift but the false-positive rate on a token-driven
  system is high.

Each gap is a deliberate trade. The current coverage protects the
behaviours that are easy to break and the contracts that cross
process boundaries; it does not promise pixel parity or chaos
resilience.

---

## 8 · The four-phase brainstorm → spec → plan → execution discipline

Code quality begins before code. Every non-trivial change in the
2026-06-16..06-20 sequence went through the `superpowers` flow:

1. **`brainstorming`** — exploratory dialogue, one question at a
   time, ends with a presented design and the user's approval.
   Output: a spec under `docs/superpowers/specs/YYYY-MM-DD-*.md`,
   committed before any code.
2. **`writing-plans`** — converts the spec into a per-task plan
   with full test/code/commit text per step. Output: a plan under
   `docs/superpowers/plans/YYYY-MM-DD-*.md`, committed.
3. **`subagent-driven-development`** — dispatches a fresh subagent
   per task, two-stage review (spec compliance, then code quality)
   after each. Each task lands as one commit (occasionally a
   small follow-up commit for review feedback).
4. **`finishing-a-development-branch`** — verifies tests, presents
   four options (merge / PR / keep / discard), executes the choice,
   cleans up the worktree.

The pre-commit hook reinforces this at every step. A subagent that
produces a broken commit fails the hook, the controller sees the
failure, dispatches a fix subagent. The user is never in the loop
for a debugging cycle the test suite can catch.

**Entscheidung — the spec is the contract.** Once a spec is
written and committed, a subagent who diverges from it is
detectable by the spec reviewer; a maintainer who reads the spec
six months later sees what was intended. The plan operationalises
the spec; the test for each task operationalises the plan. The
chain is auditable end-to-end from intent to commit.

### 8.1 · Worktree-per-spec

Every plan executes inside `.worktrees/<branch-name>` from HEAD;
work merges back via `git merge --no-ff` so the merge commit acts
as a receipts row in the log. The user's parallel work continues on
the source branch (e.g. `refactor/pipeline`) without conflict.

The two big specs in this period each ran in a worktree:

- `.worktrees/image-layer-rework` → branch
  `refactor/image-layer-object-rework` → merged at `68ca5f9`.
- `.worktrees/visibility-adjustments` → branch
  `refactor/visibility-driven-adjustments` → merged at `39fd8ec`.

The worktree is deleted after merge (`git worktree remove --force`
+ `git worktree prune`); the branch is deleted with `git branch
-d`. Net trace in the log: the two merge commits + the per-task
commits. The worktree pattern is `superpowers:using-git-worktrees`
verbatim.

---

## 9 · Telemetry — the runtime mirror of the test gate

The backend has a parallel telemetry pipeline that captures real
runtime data:

- **`backend/app/services/event_journal.py`** — append-only JSONL
  per session, every state event the SSE channel emitted. Replayable
  for post-mortem; the cockpit's evaluation views read from it.
- **`backend/app/services/process_stats.py`** — process-level stats
  (memory, CPU, GC). Surfaced in the cockpit at `/admin`.
- **`backend/app/api/telemetry.py`** — a tiny route the frontend
  posts custom counters to via `src/lib/telemetry.ts`.

This is **not** a test gate. It's the mirror image: tests catch what
is breakable before commit, telemetry catches what is observable
after deploy. The cockpit (`backend/app/api/admin.py`) is the
research artefact that turns the system into something the thesis
can evaluate — cost per analyse, acceptance rates, time-to-action,
context size growth. Detail in the backend-and-anthropic handover.

**Entscheidung — separate gates for separate failure modes.** A
test catches "the code does the wrong thing". Telemetry catches
"the user does an unexpected thing", "the model's cost shape
changed", "this widget never gets accepted". These are
non-overlapping; mixing them confuses both. The cockpit at
`/admin` is the user-facing read of the telemetry; the
`Makefile` target `make admin` boots the backend and opens it.

---

## 10 · Pointer index for the second agent

| If you want | Read |
|---|---|
| The single gate command | `package.json:scripts.check` |
| The pre-commit script | `.git-hooks/pre-commit` (installed by `package.json:scripts.prepare`) |
| The vitest project split | `vitest.config.ts` |
| jsdom shims for Radix / Slider / CurveEditor | `src/test/setup.ts` |
| The custom ESLint rule on inline components | `tools/eslint-rules/no-nested-component-definition.js` |
| Self-test for the rule | `npm run lint:rules` (`tools/eslint-rules/no-nested-component-definition.test.js`) |
| The generated wire types | `shared/types/generated.ts`, `shared/types/generated-config.ts`, `shared/schemas/*.json` |
| The generator | `scripts/gen-shared-types.py` |
| Backend test config | `backend/pyproject.toml:[tool.pytest.ini_options]` (`asyncio_mode = "auto"`) |
| Backend test count | `pytest backend/ --collect-only -q` (700 as of writing) |
| Frontend test count | `npm test -- --run` (932 as of writing) |
| Per-task TDD template | any plan under `docs/superpowers/plans/`, e.g. the 2026-06-17 visibility plan |
| Brainstorm → spec format | any spec under `docs/superpowers/specs/` |
| Subagent execution discipline | `docs/superpowers/plans/*` headers + the merge-commit pattern in `git log --merges --oneline` |
| Worktree pattern | `.worktrees/` (current empty; the pattern is `superpowers:using-git-worktrees`) |
| Cockpit / telemetry mirror | `backend/app/api/admin.py`, `backend/app/services/event_journal.py`, `backend/app/services/process_stats.py`, `src/lib/telemetry.ts`, `make admin` |

Every section's claims are verifiable: run `npm run check` from
the repo root; the gate is what the gate is. The discipline
described in §8 is documented in the `.claude/plugins/cache/.../skills/`
tree under `superpowers/` and applied verbatim by every subagent
the controller dispatches.
