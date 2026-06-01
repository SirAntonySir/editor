# Architecture — Detailed

Detailed companion to [`architecture-overview.md`](architecture-overview.md). Diagrams use
real module names. **One rule underpins all of it (Engine-SSoT):** the backend owns every
pixel-affecting value (`canonical`); the frontend mirrors that state and mutates it only
through tools.

> View rendered: GitLab renders Mermaid inline; in VS Code use the "Markdown Preview Mermaid
> Support" extension.

---

## 1 · Component & data-flow map

```mermaid
flowchart LR
  subgraph FE["FRONTEND — React + Vite + Zustand"]
    direction TB
    subgraph UI["UI surfaces"]
      CW["CanvasWorkspace: ImageNode, WidgetNode, TetherEdge"]
      INS["InspectorPanel -> AdjustmentsAccordion: ToolSection, AiSection, ColourBandToolRow"]
      WS["WidgetShell -> HslWidgetBody / BindingRow"]
      CMD["CommandPalette (Cmd+K)"]
    end
    subgraph HK["Hooks"]
      UCP["useCanonicalParam"]
      UPP["useProcessingParam, useParamProvenance"]
      UBS["useBackendSession"]
    end
    subgraph ST["Stores (Zustand)"]
      ES["EditorStore: layer, tool, viewport, selection, workspace, document, segmentation"]
      BSS["BackendState: snapshot, optimistic, sseStatus, sessionId"]
    end
    subgraph RND["Render"]
      PM["pipeline-manager"]
      INR["image-node-renderer"]
      LC["layer-compositor"]
      OVR["overlay-painters"]
      SH["shaders GLSL: basic, hsl, curves, levels, lut, blur"]
      PX["pixelStore: OffscreenCanvas per layer"]
    end
    subgraph REGF["Registries"]
      PROC["ProcessingRegistry"]
      CTR["CanvasToolRegistry"]
      LLMR["LlmToolRegistry"]
    end
    BT["backendTools REST client"]
    SUB["sse-subscriber"]
  end

  subgraph BE["BACKEND — FastAPI"]
    direction TB
    subgraph APIL["API"]
      ASESS["POST /session"]
      ATOOL["POST /tools/{name}"]
      ASTATE["GET /state/{sid}/events SSE"]
      AANA["POST /analyze, /panel, /refine, /segment"]
    end
    REG["ToolRegistry — permission gate: requires_image / requires_context"]
    subgraph TOOLS["Tools"]
      AT["atomic: analyze_image, select_by_point, get_image_context, combine_masks"]
      WT2["widgets: propose_widget, set_param, set_widget_param, accept/delete/refine"]
    end
    subgraph FUSED["Fused tools (LLM)"]
      FF["fused_framework"]
      TPL["templates: warm_grade, sky_recovery, teal_orange, portrait_glow"]
      ANTH["Anthropic client"]
    end
    subgraph STATE["State"]
      DOC["SessionDocument"]
      CAN["canonical = SSoT"]
      OPS["operations -> operation_graph"]
      SNAP["snapshot"]
      EVT["EventBus SSE"]
    end
    TD["TOOL_DEFAULTS"]
  end

  ENG["shared/engine-registry.json — ENGINE_OPS"]
  SCREEN["composited canvas"]

  UI --> HK
  HK --> BT
  CMD --> BT
  INS --> PROC
  CW --> CTR
  SUB --> BSS
  BSS --> PM
  PX --> PM
  SH --> PM
  OVR --> LC
  PM --> INR
  INR --> LC
  LC --> SCREEN

  BT ==>|mutate: HTTP tool call| ATOOL
  ASTATE ==>|observe: SSE events| SUB

  ASESS --> DOC
  ATOOL --> REG
  REG --> TOOLS
  WT2 --> DOC
  AT --> DOC
  WT2 -.->|tool_invoked| TD
  WT2 -.->|prompt or autonomous| FUSED
  FUSED --> ANTH
  DOC --> CAN
  CAN --> OPS
  OPS --> SNAP
  DOC --> EVT
  EVT --> ASTATE

  ENG --> PROC
  ENG --> TD
  ENG --> OPS
  ENG --> SH
```

---

## 2 · The engine registry is shared truth

```mermaid
flowchart LR
  J["shared/engine-registry.json"] --> FER["FE engine/registry.ts: uniform values, param-ranges"]
  J --> BER["BE engine/registry.py: ENGINE_OPS"]
  BER --> TD["tool_defaults.py: TOOL_DEFAULTS (light, color, kelvin, levels, hsl, hsl_band)"]
  FER --> SH["shaders bind uniforms"]
  BER --> OPV["operation_graph param validation"]
```

One JSON defines each op's params/ranges/scale/shaderBinding; both runtimes import it, so the
slider, the shader uniform, and the backend default never drift.

---

## 3 · Sequence — a manual adjustment (slider)

```mermaid
sequenceDiagram
  actor U as User
  participant SL as AdjustmentSlider
  participant H as useCanonicalParam
  participant BS as BackendState
  participant GL as WebGL pipeline
  participant API as POST /tools/set_param
  participant REG as ToolRegistry
  participant DOC as SessionDocument
  participant SSE as EventBus

  U->>SL: drag
  SL->>H: onChange(v)
  H->>BS: applyOptimistic canon node, param = v
  BS-->>GL: snapshot changed, re-render instantly
  Note over H,API: debounced 300ms
  H->>API: set_param layer, op, param, v
  API->>REG: invoke
  REG->>DOC: handler writes canonical
  DOC->>DOC: project operation_graph, revision++
  DOC->>SSE: emit state event
  SSE-->>BS: reconcile snapshot, drop optimistic
  BS-->>GL: render from authoritative snapshot
```

---

## 4 · Sequence — spawning a widget ("Open on canvas")

```mermaid
sequenceDiagram
  actor U as User
  participant TS as ToolSection / ColourBandToolRow
  participant PR as promote / colour-band-spawn
  participant API as POST /tools/propose_widget
  participant REG as ToolRegistry
  participant PW as ProposeWidgetTool
  participant DOC as SessionDocument
  participant SSE as EventBus
  participant BS as BackendState
  participant WT as workspace-tether
  participant CW as CanvasWorkspace

  U->>TS: click Open on canvas
  TS->>PR: promote sid, hsl or hsl_blue, layer
  PR->>API: propose_widget origin tool_invoked
  API->>REG: invoke
  Note over REG: permission gate. requires_image yes. context NOT required for tool_invoked
  REG->>PW: handler
  alt origin is tool_invoked
    PW->>PW: build nodes and bindings from TOOL_DEFAULTS
  else prompt or autonomous
    PW->>PW: LLM fused tool, needs image_context
  end
  PW->>DOC: add_widget, seed canonical, operation_graph
  DOC->>SSE: widget.created
  SSE-->>BS: push to snapshot.widgets
  BS->>WT: tetherWorkspaceWidget
  WT->>CW: setWidgetPosition and setEdge, WidgetNode plus tether
  Note over CW: WidgetShell -> HslWidgetBody renders the colour panel. edits go via set_widget_param
```

---

## 5 · Sequence — open image, analyze, autonomous suggestions

```mermaid
sequenceDiagram
  actor U as User
  participant FIO as useFileIO / editorDocument
  participant PX as pixelStore
  participant SESS as POST /session
  participant SUB as useBackendSession + sse-subscriber
  participant AZ as analyze_image LLM
  participant DOC as SessionDocument
  participant SSE as EventBus
  participant BS as BackendState
  participant ACC as AdjustmentsAccordion

  U->>FIO: open image
  FIO->>PX: register source and working OffscreenCanvas
  FIO->>SESS: upload image
  SESS-->>SUB: session_id and SSE stream opens
  SUB->>AZ: analyze_image
  AZ->>DOC: image_context plus autonomous suggestion widgets
  DOC->>SSE: context.updated and widget.created mcp_autonomous
  SSE-->>BS: snapshot updated
  BS->>ACC: auto-tether each suggestion onto the canvas
```

---

## 6 · Snapshot data model

```mermaid
classDiagram
  class SessionStateSnapshot {
    session_id
    image_context
    revision
  }
  class OperationGraph {
    nodes
    panelBindings
  }
  class OpNode {
    id
    type
    params
    layer_id
    scope
  }
  class Widget {
    id
    intent
    origin
    fused_tool_id
    status
  }
  class WidgetNode {
    id
    type
    params
    layer_id
  }
  class ControlBinding {
    param_key
    control_type
    control_schema
    value
    default
    target
  }
  SessionStateSnapshot --> OperationGraph : operation_graph
  OperationGraph --> OpNode : nodes
  SessionStateSnapshot --> Widget : widgets
  Widget --> WidgetNode : nodes
  Widget --> ControlBinding : bindings
  ControlBinding ..> OpNode : target.node_id
```

Notes: `OpNode.id` = `canon:<layer>:<op>`. `Widget.origin` is one of `tool_invoked`,
`mcp_user_prompt`, `mcp_autonomous`. `Widget.status` is one of `active`, `dismissed`,
`accepted`. A binding's `target.node_id` points at the WidgetNode it drives; on
`add_widget` those params are seeded into `canonical`, which then projects the matching
`OpNode`.

---

## 7 · Module reference

### Frontend
| Area | Modules |
|---|---|
| Stores | `store/{layer,tool,viewport,selection,workspace,document,segmentation}-slice.ts`, `backend-state-slice.ts` |
| Param I/O | `hooks/useCanonicalParam.ts`, `lib/use-processing-param.ts`, `hooks/useParamProvenance.ts` |
| Session / SSE | `hooks/useBackendSession.ts`, `lib/sse-subscriber.ts`, `lib/backend-tools.ts` |
| Render | `lib/pipeline-manager.ts`, `image-node-renderer.ts`, `layer-compositor.ts`, `overlay-painters.ts`, `shaders/*`, `core/pixel-store.ts` |
| Canvas | `components/workspace/CanvasWorkspace.tsx`, `lib/workspace-tether.ts` |
| Registries | `lib/processing-registry.ts`, `canvas-tool-registry.ts`, `tool-manifest/llm-tool-registry.ts` |
| Spawn | `inspector/adjustments/promote.ts`, `lib/colour-band-spawn.ts`, `lib/toolrail-spawn.ts`, `lib/palette-actions.ts` |

### Backend
| Area | Modules |
|---|---|
| API | `api/{session,tools_rest,state,analyze,panel,refine,segment}.py` |
| Registry | `tools/registry.py`, `tools/base.py` (`ToolPermissions`) |
| Widget tools | `tools/widgets/{propose_widget,set_param,set_widget_param,accept,delete,refine,repeat,restore}.py` |
| Atomic tools | `tools/atomic/{analyze_image,select_by_point,select_by_box,get_image_context,combine_masks}.py` |
| Fused (LLM) | `tools/fused/*` (templates), `tools/fused_framework.py`, `tools/tool_defaults.py` |
| State | `state/{document,canonical,operations,snapshot,events,preview_renderer,context_stats}.py` |
| Shared | `shared/engine-registry.json`, `engine/registry.{ts,py}` |
```
