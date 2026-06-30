# Frontend & Backend Specs, Software Usage & Packages — Handover

> **Purpose.** A reference handover for the editor's *technical surface*: the
> frontend stack, the backend stack, every third-party package and why it's
> there, how the software is run/built/deployed, and the project tree.
>
> Intended to back a thesis **Appendix** (system specification, dependency
> manifest, reproducibility). Pair it with the architecture handovers
> (`architecture-overview.md`, `architecture-detailed.md`,
> `implementation-architecture-handover.md`) for *how it works*; this document is
> *what it's built from*.
>
> Snapshot date: 2026-06-26. Versions are pinned from `package.json`,
> `backend/pyproject.toml`, and `backend/requirements.txt` as of this date.

---

## 1 · Frontend specification

### 1.1 Runtime & language

| Concern | Choice | Version | Notes |
|---|---|---|---|
| Language | TypeScript (strict) | `~5.9.3` | `tsc -b` project references; strict mode |
| UI runtime | React | `^19.2.0` | React 19 (`react-dom` `^19.2.0`) |
| Build / dev server | Vite | `^7.3.1` | `@vitejs/plugin-react` `^5.1.1` |
| Node (dev) | Node.js | v22 (`v22.22.3` local) | dev tooling only; app ships as static assets |
| Styling | Tailwind CSS v4 | `^4.2.1` | via `@tailwindcss/vite` plugin (no `tailwind.config.*` — v4 is CSS-config-first; tokens live in `src/index.css`) |
| Desktop shell | Electron | `^42.2.0` | optional packaging (`electron/main.cjs` + `preload.cjs`); `electron-builder` `^26.8.1` |

The app is a **single-page React app**. It can run three ways: in a browser
(Vite/Vercel static build), in an Electron desktop shell, or against a remote
backend. No SSR.

### 1.2 Frontend dependency map (runtime)

Grouped by role, with the *why*:

**Canvas & graph**
- `@xyflow/react` `^12.10.2` — React Flow infinite workspace (ImageNodes +
  WidgetNodes + tether edges). The core canvas surface.

**State**
- `zustand` `^5.0.11` + `immer` `^11.1.4` — single `EditorStore` (slice pattern)
  + a separate `BackendState` store; Immer for ergonomic immutable updates.

**UI primitives (Radix, headless)**
- `@radix-ui/react-*` — `dialog`, `dropdown-menu`, `menubar`, `popover`,
  `context-menu`, `scroll-area`, `separator`, `slider`, `switch`,
  `toggle-group`, `tooltip`. Accessible primitives wrapped by `src/components/ui`.
- `@floating-ui/react` `^0.27.19` — popover/caret-anchored positioning (palette
  region-chip picker, floating panels).

**Motion & type**
- `framer-motion` `^12.35.0` — restrained enter/exit + layout motion.
- `@fontsource-variable/geist` + `geist-mono` — Geist variable font stack
  (self-hosted, matching the Vercel/Radix register).
- `lucide-react` `^0.577.0` — icons (tree-shaken **named imports only**).

**Image / pixel / AI-on-device**
- `onnxruntime-web` `^1.26.0` — runs **MobileSAM ONNX** in-browser for
  client-side segmentation (the deployed segmentation path; see §2.5).
- `fast-png` `^8.0.0` — PNG encode/decode for mask transport.
- `exifr` `^7.1.3` — EXIF/metadata extraction on open.
- `comlink` `^4.4.2` — ergonomic Web Worker RPC (heavy processing off the main
  thread, worker pool in `src/workers`).

**Markdown & misc**
- `react-markdown` `^10.1.0` + `remark-gfm` `^4.0.1` — render the palette
  **Ask mode** markdown answers.
- `leaflet` `^1.9.4` (+ `@types/leaflet`) — map rendering (geo-tagged image
  context / location features).
- `zod` `^3.23.8` — runtime schema validation at boundaries.

### 1.3 Frontend dev / tooling dependencies

- **Test:** `vitest` `^3.2.4`, `@testing-library/react` `^16.3.2`,
  `@testing-library/jest-dom`, `@testing-library/user-event`,
  `fake-indexeddb` `^6.2.5` (jsdom IndexedDB for the pixel/registry tests).
- **Lint:** `eslint` `^9.39.1` (flat config `eslint.config.js`),
  `typescript-eslint` `^8.48.0`, `eslint-plugin-react-hooks`,
  `eslint-plugin-react-refresh`, `globals`. Plus a **custom rule**
  `tools/eslint-rules/no-nested-component-definition.js` enforcing the
  "no inline-defined components" architecture rule.
- **Types codegen:** `json-schema-to-typescript` `^15.0.4` — generates
  `shared/types/generated.ts` from the backend Pydantic schemas (see §3.3).
- **Diagrams:** `arkit` `^1.6.4` (+ a vendored PlantUML jar) — architecture
  figures under `docs/figures`.
- **Desktop & orchestration:** `electron`, `electron-builder`, `concurrently`,
  `wait-on` (used by `electron:dev`).
- **Types:** `@types/node`, `@types/react`, `@types/react-dom`.

### 1.4 Frontend architecture (one-paragraph spec)

Strict 3-tier components (`ui/` primitives → topic folders → page scaffolds; see
`CLAUDE.md` and `design.md`). Pixel data lives **outside** Zustand in a
`CanvasRegistry` (Map of layer IDs → OffscreenCanvas pairs). Adjustments are
**non-destructive** and **backend-owned** — the frontend reads the backend
`SessionStateSnapshot` and renders it through a WebGL ping-pong pipeline
(`src/shaders`, `src/lib/pipeline-manager.ts`, `layer-compositor.ts`). The
"Triple Registry" (CanvasTool / Llm / Processing) keeps tools, LLM manifests, and
processing features extensible by registration. See `src/` tree in Appendix A.

---

## 2 · Backend specification

### 2.1 Runtime & framework

| Concern | Choice | Version | Notes |
|---|---|---|---|
| Language | Python | `>=3.11` (`requires-python`) | type-hinted |
| Web framework | FastAPI | `0.115.0` | REST + SSE routers under `app/api` |
| ASGI server | Uvicorn (`[standard]`) | `0.31.0` | `uvicorn app.main:app` |
| Validation / schemas | Pydantic | `2.9.2` + `pydantic-settings` `2.5.2` | SSoT for the snapshot + generated TS types |
| LLM SDK | `anthropic` | `0.39.0` | model `claude-opus-4-7` (deploy default); Sonnet-tier for Ask |
| Streaming | `sse-starlette` | `>=2.1.0` | the one-way SSE event bus to the frontend |
| Tool protocol | `mcp` | `>=1.0.0` | MCP server surface for LLM-facing tools |
| Multipart | `python-multipart` | `0.0.12` | image upload |
| HTTP client | `httpx` | `0.27.2` | outbound calls |
| Process stats | `psutil` | `>=5.9.0` | admin cockpit telemetry |

### 2.2 Image / RAW / CV dependencies

- `Pillow` `>=10.0.0`, `numpy` `>=1.26.0` — image decode + array math (analyze
  stats, mask ops).
- `rawpy` `>=0.22.0` — **camera RAW develop** (`app/services/raw_decode.py`).
  Wheels bundle LibRaw, so **no system library** is needed on the server image.
- `opencv-python-headless` `4.11.0.86` — headless OpenCV (no libGL/X11) for
  analyze-time region/context stats (`app/state/*_stats.py`). **Headless build is
  mandatory on the slim/server image.**

### 2.3 Two dependency sets — slim deploy vs. full local (IMPORTANT)

There are **two backend manifests and they differ on purpose**:

| | `backend/pyproject.toml` (slim) | `backend/requirements.txt` (full) |
|---|---|---|
| Role | What the **deployed Docker image** installs | Full **local** dev set |
| Includes | fastapi, uvicorn, pydantic, anthropic, rawpy, opencv-headless, mcp, sse-starlette, psutil | everything in slim **plus** `torch>=2.1.0`, `torchvision>=0.16.0`, `SAM-2 @ git+…facebookresearch/sam2`, `huggingface-hub>=0.20.0` |
| Segmentation | **client-side** MobileSAM via `onnxruntime-web` | optional **server-side** SAM-2 (`ANALYZE_SAM=1`) |

**Why it matters:** torch + SAM-2 are heavyweight and are **not** shipped to
Render. On the hosted deploy, segmentation runs **in the browser** (MobileSAM
ONNX, vendored at Vercel build time via `scripts/download_mobile_sam.sh`).
Server-side SAM-2 is a **local-only / opt-in** analyze path (`dev:backend` sets
`ANALYZE_SAM=1`). If you reproduce the deploy, install from **pyproject**, not
`requirements.txt`.

### 2.4 Dev / test dependencies

`pytest` `8.3.3`, `pytest-asyncio` `0.24.0` (`asyncio_mode = "auto"`),
`respx` `0.21.1` (mock httpx/Anthropic in tests). Tests under `backend/tests`.

### 2.5 Backend architecture (one-paragraph spec)

FastAPI app (`app/main.py`) with routers in `app/api` (`session`, `state`,
`analyze`, `segment`, `refine`, `panel`, `raw`, `tools_rest`, `telemetry`,
`admin`). The **`SessionStateSnapshot`** (`app/state`, `app/schemas`) is the
single source of truth for everything that affects pixels (widgets,
operation_graph, masks_index, image_context, per-layer adjustment data). State is
**in-process** (`app/api/deps.py` singletons) — sessions and the SSE bus live in
memory, which is why the deploy is **single-instance, always-on, never
autoscaled** (`render.yaml`). LLM/agent tooling lives in `app/tools`
(`atomic/`, `fused/`, `widgets/`) + `app/mcp`; the agentic client-tool loop adds
a backend↔client round-trip (per-session `pending_tool_calls` futures). Services
in `app/services` (anthropic client, SAM client, RAW decode, session store +
disk IO, event journal, cohort store, telemetry).

---

## 3 · Software usage — run, build, test, deploy

### 3.1 Scripts (`package.json`)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (frontend only) |
| `npm run dev:backend` | venv + `ANALYZE_SAM=1 uvicorn app.main:app --reload` on `127.0.0.1:8787` |
| `npm run electron:dev` | Vite + Electron together (`concurrently` + `wait-on`) |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run electron:build` | build + `electron-builder` (dmg/nsis/AppImage) |
| `npm test` / `test:watch` | Vitest |
| `npm run check` | **gate:** `gen:types:check` + `tsc -b` + `eslint .` + `vitest` |
| `npm run gen:types` | regenerate `shared/types` from backend Pydantic schemas |
| `npm run diagram` | regenerate architecture PlantUML/SVG figures |
| `npm run lint:rules` | run the custom `no-nested-component` rule's own tests |
| `prepare` | points git hooks at `.git-hooks` (pre-commit runs `check`) |

### 3.2 Backend run / test

```bash
cd backend && python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .            # slim (deploy parity) — OR: pip install -r requirements.txt (full, w/ SAM-2)
uvicorn app.main:app --reload --host 127.0.0.1 --port 8787
pytest                      # tests/ ; asyncio_mode=auto
```

### 3.3 Shared-types contract

The backend Pydantic schemas are the SSoT. `scripts/gen-shared-types.py`
generates `shared/types/generated.ts`; `npm run gen:types:check` fails CI if the
committed TS has drifted from the schemas. **Any schema change must regenerate
shared types** (see the 2026-06-24 handover §8 control-type trap).

### 3.4 Deployment

- **Frontend → Vercel** (`vercel.json`): build = `download_mobile_sam.sh && npm
  run build`; SPA rewrite of all routes to `/index.html`. Vendors MobileSAM ONNX
  at build time.
- **Backend → Render** (`render.yaml`): Docker (`backend/Dockerfile`,
  context = repo root so the image gets `backend/` **and** `shared/`), **`standard`
  plan (2GB)** — 16-bit RAW develop peaks ~300MB+ and OOM'd the 512MB `starter`
  tier — Frankfurt region, **`numInstances: 1`**, `/health` check, `autoDeploy:
  false`.
- **Env vars:** `ANTHROPIC_API_KEY` (secret), `ANTHROPIC_MODEL`
  (`claude-opus-4-7`), `BACKEND_AUTH_TOKEN` (frontend shared secret, Render
  mints it), `ADMIN_TOKEN` (**separate** secret for `/admin` participant data),
  `ALLOWED_ORIGINS` (CORS allow-list).
- **Statefulness caveat:** sessions + SSE bus are in-process. Never enable
  autoscaling; never use Free (spins down on idle → wipes active sessions).

---

## Appendix A · Project tree (top two levels)

```
editor/
├── src/                         # React frontend (499 .ts/.tsx files)
│   ├── components/
│   │   ├── ui/                  #   primitives (Radix wrappers, tokens)
│   │   ├── workspace/          #   CanvasWorkspace + ImageNode/WidgetNode/TetherEdge + CanvasDropZone
│   │   ├── inspector/          #   InspectorPanel (per-widget ProcessingDefinition.Panel)
│   │   ├── panels/             #   Layers panel
│   │   ├── toolbar/            #   6-button toolrail + MenuBar
│   │   ├── widget/             #   WidgetShell + parts (history stepper, refine, why)
│   │   ├── registry-controls/  #   control_type → control component map
│   │   └── canvas/             #   CanvasContextMenu
│   ├── processing/             # ProcessingDefinition registrations (light, color, kelvin, curves, levels, filters)
│   ├── tools/                  # toolrail entries → propose_widget
│   ├── store/                  # Zustand slices (layer/tool/viewport/selection/workspace + backend-state)
│   ├── core/                   # document facade, layer lifecycle
│   ├── engine/                 # engine glue
│   ├── shaders/                # GLSL sources (TS template literals)
│   ├── hooks/                  # extracted React hooks
│   ├── lib/                    # registries, pipeline, compositor, SAM/segmentation, tool-manifest, raw-image, canvas-file-drop
│   ├── workers/                # Comlink worker pool
│   ├── types/                  # shared TS interfaces
│   └── config/ · test/
├── backend/
│   ├── app/                    # FastAPI app (128 .py files)
│   │   ├── api/                #   routers: session, state, analyze, segment, refine, panel, raw, tools_rest, telemetry, admin, deps
│   │   ├── schemas/            #   Pydantic (SSoT for snapshot + generated TS)
│   │   ├── state/             #   SessionStateSnapshot + *_stats analyze
│   │   ├── session/           #   session record, history, migrations
│   │   ├── services/          #   anthropic, sam_client, raw_decode, session_store, disk IO, event_journal, cohort_store
│   │   ├── tools/             #   atomic/ · fused/ · widgets/ (LLM + agent loop)
│   │   ├── mcp/ · registry/ · config/
│   │   ├── main.py
│   │   └── Dockerfile
│   ├── tests/                  # pytest (asyncio auto)
│   ├── pyproject.toml          # SLIM deploy deps
│   └── requirements.txt        # FULL local deps (+ torch, SAM-2)
├── shared/                     # cross-cutting, backend+frontend
│   ├── registry/               #   ops/ · presets/ · schema.ts · lib/
│   ├── schemas/                #   JSON schemas
│   └── types/                  #   generated.ts (from Pydantic)
├── electron/                   # main.cjs + preload.cjs
├── scripts/                    # gen-shared-types.py, download_mobile_sam.sh
├── tools/                      # eslint-rules/ (no-nested-component), plantuml/
├── docs/                       # handovers, specs, figures, mockups
├── public/ · dist/ · release/
├── package.json · vite.config.ts · tsconfig*.json · eslint.config.js
├── render.yaml · vercel.json · Makefile
└── CLAUDE.md · design.md
```

---

## Appendix B · Version manifest (verbatim pins)

- **Frontend:** see `package.json` (`dependencies` + `devDependencies`) —
  reproduced by role in §1.2–§1.3.
- **Backend (slim/deploy):** see `backend/pyproject.toml` — §2.1–§2.2.
- **Backend (full/local):** see `backend/requirements.txt` — adds
  `torch>=2.1.0`, `torchvision>=0.16.0`,
  `SAM-2 @ git+https://github.com/facebookresearch/sam2.git`,
  `huggingface-hub>=0.20.0` (§2.3).
- **Toolchain observed locally:** Node `v22.22.3`, Python `3.11+` target.

> For a thesis appendix, freeze exact transitive versions with
> `npm ls --all` (or commit `package-lock.json`, already present) and
> `pip freeze > requirements.lock.txt` inside the backend venv. The manifests
> above pin **direct** deps; the lockfiles pin the full transitive closure.

---

## Appendix C · Environment-variable reference

Read by `backend/app/config/env.py` (`EnvSettings`, Pydantic `BaseSettings`,
loaded from `.env` / process env). `*` = required (no default).

| Variable | Default | Secret | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` * | — | ✅ | Anthropic auth. App won't start without it. |
| `ANTHROPIC_MODEL` | `claude-opus-4-7` | | Primary planning/agent model. |
| `ANTHROPIC_FAST_MODEL` | `claude-haiku-4-5-20251001` | | Latency-tier — palette smart-match (`AnthropicClient.smart_match`), ~10× faster. |
| `ANTHROPIC_SONNET_MODEL` | `claude-sonnet-4-6` | | Mid-tier — palette **Ask mode** (`ask_about_image`). |
| `HOST` | `127.0.0.1` | | Bind host. |
| `PORT` | `8787` | | Bind port. |
| `ALLOWED_ORIGINS` | `""` (empty) | | CORS allow-list, comma-separated. Empty = reject cross-origin (a fresh prod install won't accept a co-located dev server by accident). |
| `BACKEND_AUTH_TOKEN` | `""` (disabled) | ✅ | Shared-secret gate. Empty = auth off (local/Tailscale). Set on public deploys; every request except `/health` + CORS preflight must carry it via `Authorization: Bearer` or `?token=`. **Shipped to the browser** (`VITE_BACKEND_TOKEN`). |
| `ADMIN_TOKEN` | `""` (loopback-only) | ✅✅ | **Separate** server-only secret for `/admin` (participant data). Empty = admin stays loopback-only. Never shipped to the browser. |
| `SESSION_TTL_SECONDS` | `1800` | | Session prune TTL (keyed off last activity; runtime bumps to 24h per the session-store work). |
| `MAX_IMAGE_BYTES` | `2 MiB` | | Upload size cap. |
| `SAM_CHECKPOINT_PATH` | `None` | | Optional local SAM-2 checkpoint (server-side analyze). |
| `SAM_MODEL_NAME` | `facebook/sam2.1-hiera-base-plus` | | HF model id for server-side SAM-2. |
| `USE_REGISTRY_PLANNER` | `False` | | Feature flag — registry-driven planner path. |
| `ANALYZE_SAM` | unset | | (read at run, not in `EnvSettings`) — `dev:backend` sets `=1` to enable the server-side SAM analyze path locally. |

> **Two-token model (study-critical):** `BACKEND_AUTH_TOKEN` is the app gate and
> *is* exposed to the client; `ADMIN_TOKEN` guards participant data and is *not*.
> They must be different secrets. See `render.yaml` and the 2026-06-26 admin
> cockpit token-gate change.

---

## Appendix D · REST + SSE endpoint catalogue

All app routes are under the **`/api`** prefix (`app/api/__init__.py`), except
`/admin` (`/admin` prefix, mounted separately), the MCP router, and `/health`.

### D.1 Session lifecycle (`session.py`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/session` | Create a session (uploads first image, returns `sid`). |
| POST | `/api/session/{sid}/images` | Add another image to the session. |
| POST | `/api/session/{sid}/cancel` | Cancel in-flight work; rejects pending client-tool futures. |
| POST | `/api/session/{sid}/context` | Set/refresh image context. |

### D.2 State, history & the agent loop (`state.py`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state/{sid}` | Full `SessionStateSnapshot` (App. E). |
| GET | `/api/state/{sid}/events` | **SSE stream** (`EventSourceResponse`) — the event bus (App. D.6). |
| POST | `/api/state/{sid}/agent_turn` | Run one agentic client-tool turn (non-locking). |
| POST | `/api/state/{sid}/tool_result` | Client → backend result for a `client.tool_request`. |
| POST | `/api/state/{sid}/undo` · `/redo` · `/revert` | Linear history navigation. |
| POST | `/api/state/{sid}/jump/{target_cursor}` | Jump to a history cursor. |
| GET | `/api/state/{sid}/history` | Global history log. |
| GET | `/api/state/{sid}/widget-history/{widget_id}` | Per-widget timeline slice. |
| POST | `/api/state/{sid}/restore-widget/{widget_id}/{entry_id}` | Restore a past widget param set as a forward op. |
| GET | `/api/state/{sid}/masks/{mask_id}` | Fetch a mask PNG. |

### D.3 AI / processing (`analyze.py`, `panel.py`, `refine.py`, `tools_rest.py`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/analyze` | Run image analysis (problems, regions, suggestions). |
| POST | `/api/name-region` | LLM-name a region. |
| POST | `/api/panel` | Build/resolve an inspector panel for a widget. |
| POST | `/api/refine` | Refine an existing widget. |
| POST | `/api/tools/{name}` | Invoke a named server tool (REST tool surface). |

### D.4 Segmentation & RAW (`segment.py`, `raw.py`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/segment/embed` | Compute the SAM image embedding. |
| POST | `/api/segment/decode` | Decode a mask from click prompts. |
| POST | `/api/raw/develop` | Develop camera RAW → image (sessionless; 415 non-RAW, 413 >200MB). |

### D.5 Telemetry & admin (`telemetry.py`, `admin.py`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/telemetry/{sid}/event` | Record a study telemetry event. |
| GET | `/admin/` · `/admin` | Cockpit HTML. |
| GET | `/admin/sessions` · `/sessions/{sid}` | Session list / detail. |
| POST | `/admin/sessions/{sid}/ai-access` | Flip the `AI_access` study condition. |
| GET | `/admin/sessions/{sid}/image` · `/export.json` | Session image / JSON export. |
| GET | `/admin/aggregate` · `/process_stats` · `/export.csv` | Aggregates, process stats, CSV export. |

*(plus `/health` for the Render health check, and the MCP router for the
LLM-facing MCP tool surface.)*

### D.6 SSE event kinds (`StateEventKind`, `schemas/widget.py`)

The down-channel event bus. Each `StateEvent` carries `{revision, kind, …}`.
Most kinds are appended to `doc.history` and replayable by `Last-Event-ID`;
two are **transient control events** (published only, never logged).

| Kind | Meaning |
|---|---|
| `widget.created` / `.updated` / `.deleted` / `.accepted` / `.restored` | Widget lifecycle. |
| `mask.created` / `.deleted` / `.renamed` | Mask lifecycle. |
| `selection.changed` | Active/hovered object changed. |
| `context.updated` · `dismissal.added` · `note.created` | Image-context, dismissals, notes. |
| `phase.started` / `.progress` / `.completed` / `.cancelled` | Long-op progress (analyze, etc.). |
| `canonical.updated` | Canonical engine node changed. |
| `image_node_transform.updated` | Crop/rotate/flip on an image node. |
| `mcp.usage` | Token/usage accounting. |
| `history.applied` | Undo/redo/revert — carries the full restored snapshot summary. |
| `session.ai_access` | Study `AI_access` flip (payload `{ai_access: bool}`); live, no reload. |
| `state.gap` *(transient)* | Replay impossible (log pruned past client cursor); client refetches the snapshot. |
| `client.tool_request` *(transient)* | Backend asks the client to run an `LlmToolRegistry` tool. Payload `{request_id, name, input, kind}`. **Never** appended to history. |

---

## Appendix E · Data model — `SessionStateSnapshot`

The single source of truth for everything that affects pixels
(`app/state/snapshot.py`, serialised camelCase; mirrored to
`shared/types/generated.ts`). Top-level shape:

```python
SessionStateSnapshot:
  session_id: str
  image_context: EnrichedImageContext | None   # analyze output (App. E.3)
  widgets: list[Widget]                          # UI-facing adjustment widgets
  masks_index: list[{ id, width, height, source, label, imageNodeId }]
  operation_graph: OperationGraph                # the pixel program (App. E.1)
  revision: int                                  # monotonic; drives SSE/refetch
  ai_access: bool = True                         # study condition (→ `aiAccess`)
```

### E.1 `OperationGraph` (`schemas/operation_graph.py`)

```python
OperationGraph:
  id: str
  user_goal: str
  reasoning: str | None
  nodes: list[Node]
  panel_bindings: list[PanelBinding]
  metadata: dict[str, str]

Node:
  id: str
  type: str                  # resolved against ProcessingRegistry at runtime
  scope: Scope               # global | named_region | mask | image_node
  params: dict[str, float|int|str|bool|list|dict]
  inputs: list[str]          # upstream node IDs
  layer_id: str              # which frontend layer this renders into
  layer_ids: list[str] | None   # set for image_node-scope nodes
  widget_id: str | None      # originating Widget (None for canonical nodes)

PanelBinding:
  node_id: str; param_key: str; label: str
  control: "slider" | "toggle" | "picker"
  min / max / default / step / reasoning
```

### E.2 `Scope` (discriminated union, `schemas/widget.py`)

`kind ∈ { global, named_region, mask, image_node }`, with optional
`label`, `point`, `confidence`. Mirrors the frontend `src/types/scope.ts`.

### E.3 `EnrichedImageContext` (analyze output, `schemas/enriched_context.py`)

Pre-computed on load, reused via prompt cache. Notable fields:
`luma_histogram[256]`, `rgb_histograms`, `clipped_shadows_pct` /
`clipped_highlights_pct`, `median_luma`, `color_palette` (`ColorSwatch[]`),
`cast_strength` / `cast_direction`, `estimated_white_point`,
`wb_neutral_confidence`, `grade_character`, `problems` (`Problem[]` with
`kind`, `severity`, `bbox`, `suggested_fused_tools`), and per-region
`region_stats` (`RegionStats[]`: `mean_luma`, `mean_rgb`, `luma_histogram[32]`,
`dominant_swatches`, `is_skin_likely` / `is_sky_likely`, `saturation_mean`).

> The **Widget** model (UI-facing, with typed `control_type` bindings —
> `slider`, `numeric_pair`, `toggle`, `choice`, `color`, `curve`, `curve_point`,
> `mask_thumbnail`, `region_picker`, `before_after_toggle`, `tint_strip`) is the
> other half of the snapshot; see `schemas/widget.py` and the control-type
> contract in the 2026-06-24 handover §8.

---

## Appendix F · Build provenance & runtime support

### F.1 Provenance (this snapshot)

| Field | Value |
|---|---|
| Commit | `bd7d645e0e0955b605a14e8d45032543db9edbb4` |
| Branch | `main` |
| Date | 2026-06-26 |
| Deploy model | `claude-opus-4-7` (`ANTHROPIC_MODEL`) |
| Frontend host | Vercel (static SPA) |
| Backend host | Render (Docker, `standard`/2GB, Frankfurt, single instance) |

> Capture this per deployed artifact. A `git rev-parse HEAD` + build timestamp
> baked into the build (e.g. a Vite `define` and a backend `/health` field) makes
> every screenshot in the thesis traceable to an exact commit.

### F.2 Runtime support requirements (test-matrix template)

The editor depends on browser features that aren't universal — fill the
right-hand column with what the **study actually ran on**:

| Requirement | Why | Study config |
|---|---|---|
| WebGL2 | Filter/adjustment pipeline (`src/shaders`) | _fill in_ |
| OffscreenCanvas + Web Workers | Pixel data + Comlink worker pool | _fill in_ |
| WASM (`onnxruntime-web`) | Client-side MobileSAM segmentation | _fill in_ |
| `createImageBitmap` / `canvas.toBlob` | Image open / export | _fill in_ |
| Modern evergreen browser | React 19 + ES2022 build target | _e.g. Chrome 1xx_ |
| OS / hardware | GPU-backed WebGL for acceptable latency | _e.g. macOS, M-series_ |

> Recommended: state the **one** browser/OS the participants used (controlled
> study) rather than a broad compatibility matrix — it's a cleaner reproducibility
> claim. Chromium-family is the safe target (best OffscreenCanvas + WASM support).
</content>
