# Phase 1 — Thin AI Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get a real Claude round-trip end-to-end — image upload → background context analysis → Cmd+K goal → Operation Graph → labelled control rendered as an `ai-panel` layer, revertable through existing undo. Component architecture enforcement (ESLint custom rule + `npm run check`) lands first so every subsequent commit is gated.

**Architecture:** A new FastAPI backend in `backend/` exposes three endpoints (`/api/session`, `/api/analyze`, `/api/panel`). Frontend mirrors the Operation Graph contract via Zod. Image is uploaded once per session and pre-analysed into a structured `ImageContext`; subsequent panel requests reuse both via Anthropic prompt caching. A new `ai-panel` layer type + processing definition renders model-emitted bindings as standard controls.

**Tech Stack:** Python 3.11+, FastAPI, Anthropic SDK (Opus 4.7), Pydantic v2, httpx, pytest. Frontend: existing React 19 + Vite + TypeScript + Zustand + Framer Motion stack. ESLint custom rule via `@typescript-eslint/utils` `RuleTester`.

**Spec reference:** [`docs/superpowers/specs/2026-05-11-thesis-prototype-implementation-design.md`](../specs/2026-05-11-thesis-prototype-implementation-design.md) §4 Phase 1.

---

## File Structure

### Created (backend)

| Path | Responsibility |
|---|---|
| `backend/pyproject.toml` | Project metadata + dependencies |
| `backend/requirements.txt` | Pinned dep list (CI / global CLAUDE.md compatibility) |
| `backend/.env.example` | `ANTHROPIC_API_KEY` placeholder |
| `backend/README.md` | Bootstrap + run instructions |
| `backend/app/__init__.py` | Package marker |
| `backend/app/main.py` | FastAPI app, route registration, CORS |
| `backend/app/config.py` | Settings via `pydantic-settings` |
| `backend/app/schemas/__init__.py` | Re-exports |
| `backend/app/schemas/operation_graph.py` | `OperationGraph`, `Node`, `PanelBinding`, `Scope` |
| `backend/app/schemas/image_context.py` | `ImageContext` |
| `backend/app/services/session_store.py` | In-memory session cache (image bytes, context, 30-min TTL) |
| `backend/app/services/anthropic_client.py` | SDK wrapper, structured tool use, cache-control markers |
| `backend/app/services/image_analyzer.py` | Calls Claude → `ImageContext` |
| `backend/app/services/panel_generator.py` | Calls Claude → `OperationGraph` |
| `backend/app/api/__init__.py` | Router aggregation |
| `backend/app/api/session.py` | `POST /api/session` |
| `backend/app/api/analyze.py` | `POST /api/analyze` |
| `backend/app/api/panel.py` | `POST /api/panel` |
| `backend/app/api/refine.py` | `POST /api/refine` (501 stub) |
| `backend/tests/__init__.py` | Test package marker |
| `backend/tests/conftest.py` | Pytest fixtures (client, fake Anthropic) |
| `backend/tests/test_schemas.py` | Pydantic round-trip |
| `backend/tests/test_session.py` | Session lifecycle, TTL |
| `backend/tests/test_analyze.py` | Analyze endpoint with mocked client |
| `backend/tests/test_panel.py` | Panel endpoint with mocked client |
| `backend/tests/fixtures/test_image.jpg` | Small test image (1024×683, ~80 KB) |

### Created (frontend)

| Path | Responsibility |
|---|---|
| `src/types/operation-graph.ts` | TS types mirroring Pydantic |
| `src/types/image-context.ts` | TS types for `ImageContext` |
| `src/lib/operation-graph-schema.ts` | Zod schema |
| `src/lib/image-context-schema.ts` | Zod schema |
| `src/lib/ai-client.ts` | `fetch`-based wrapper around backend endpoints |
| `src/hooks/useImageContext.ts` | Auto-uploads image, fires analyse pass |
| `src/components/ui/CommandPalette.tsx` | Generic Cmd+K palette primitive |
| `src/components/ui/AnalyseIndicator.tsx` | Status pill primitive |
| `src/components/inspector/AiPanelSection.tsx` | Renders `ai-panel` layer bindings |
| `src/processing/ai-panel.tsx` | `ai-panel` ProcessingDefinition |
| `tools/eslint-rules/no-nested-component-definition.js` | Custom rule |
| `tools/eslint-rules/index.js` | Rule plugin export |
| `tools/eslint-rules/no-nested-component-definition.test.js` | RuleTester suite |
| `.husky/pre-commit` | OR `.git-hooks/pre-commit` (no husky dep) |

### Modified (frontend)

| Path | Change |
|---|---|
| `package.json` | New scripts (`check`, `dev:backend`, `lint:rules`), dev deps |
| `eslint.config.js` | Load local rule plugin |
| `src/processing/index.ts` | Register `ai-panel` processing |
| `src/store/layer-slice.ts` | Allow `ai-panel` layer type; add `operationGraph` + `panelBindings` to layer for `ai-panel` |
| `src/types/processing.ts` | Optional `operationGraph` storage field on layer |
| `src/components/EditorProvider.tsx` | Register Cmd+K shortcut, wire palette |
| `src/components/inspector/InspectorPanel.tsx` | Add AI panel section below standard panel |
| `src/hooks/useFileIO.ts` | Fire `useImageContext.uploadAndAnalyse` on image load |
| `.gitignore` | `backend/.env`, `backend/.venv`, `__pycache__/`, `*.pyc` |
| `CLAUDE.md` | Already updated in brainstorming phase |

---

## Pre-flight

These prerequisites must be true before starting any task. **Do not skip these checks.**

- [ ] **P0a:** `ANTHROPIC_API_KEY` is set and has billing enabled. Run:
  ```bash
  curl -s https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d '{"model":"claude-opus-4-7","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' | head -c 200
  ```
  Expected: a JSON response with a `"content"` array (not an error). If `404` or `401`, fix before continuing.

- [ ] **P0b:** Python 3.11+ available: `python3 --version`

- [ ] **P0c:** Confirm current branch is `dev` (per CLAUDE.md branch strategy):
  ```bash
  git branch --show-current
  ```
  If not `dev`: `git switch dev` (create from main if missing).

---

## Task 1: Audit existing components for nested-component violations

The component-architecture rule is new; existing code may violate it. Fix violations before merging the rule, otherwise it lands with red squigglies everywhere.

**Files:**
- Audit: `src/**/*.tsx`
- Modify (if violations found): the offending file(s)

- [ ] **Step 1: Search for nested function-returning-JSX declarations**

Run:
```bash
grep -rEn 'function [A-Z][A-Za-z]*\s*\([^)]*\)\s*\{|const [A-Z][A-Za-z]*\s*=\s*\([^)]*\)\s*=>' src --include='*.tsx' | wc -l
```

Then for each `.tsx` file with multiple matches, manually inspect — most matches will be top-level (legal). Violations look like a `function Foo()` *inside* another function body that returns JSX.

- [ ] **Step 2: Hand-audit the top 5 largest components**

Run:
```bash
ls -lS src/components/**/*.tsx src/processing/*.tsx 2>/dev/null | head -5
```

Open each in your editor and look for nested `function ChildComponent() { return <…/> }` or `const ChildComponent = () => <…/>` inside another component's body.

- [ ] **Step 3: Hoist any violations to module scope**

For each violation found, extract the inner component to a sibling file (if reusable) or to module scope of the same file (if topic-local). Preserve behaviour exactly. If unsure whether something counts as a violation, flag it in a comment for review rather than refactoring blindly.

- [ ] **Step 4: Verify nothing broke**

```bash
npm run build
```

Expected: green. If TS errors appear, fix them before continuing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: hoist nested component declarations to module scope

Prepares the codebase for the no-nested-component-definition ESLint rule
landing in the next commit."
```

(If no violations were found, skip the commit and note this in the next task's commit message.)

---

## Task 2: Add ESLint custom rule scaffold

**Files:**
- Create: `tools/eslint-rules/index.js`
- Create: `tools/eslint-rules/no-nested-component-definition.js`
- Create: `tools/eslint-rules/no-nested-component-definition.test.js`

- [ ] **Step 1: Create the plugin entry**

Write `tools/eslint-rules/index.js`:

```js
import noNestedComponentDefinition from './no-nested-component-definition.js';

export default {
  meta: { name: 'editor-local', version: '0.1.0' },
  rules: {
    'no-nested-component-definition': noNestedComponentDefinition,
  },
};
```

- [ ] **Step 2: Write the failing rule test**

Write `tools/eslint-rules/no-nested-component-definition.test.js`:

```js
import { RuleTester } from 'eslint';
import rule from './no-nested-component-definition.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-nested-component-definition', rule, {
  valid: [
    {
      code: 'function Outer() { return <div/>; }',
    },
    {
      code: 'function Outer() { const handler = () => 1; return <div/>; }',
    },
    {
      code: 'function Outer({ render }) { return render(<span/>); }',
    },
  ],
  invalid: [
    {
      code: 'function Outer() { function Inner() { return <span/>; } return <Inner/>; }',
      errors: [{ messageId: 'nestedComponent' }],
    },
    {
      code: 'function Outer() { const Inner = () => <span/>; return <Inner/>; }',
      errors: [{ messageId: 'nestedComponent' }],
    },
  ],
});

console.log('no-nested-component-definition: all tests passed');
```

- [ ] **Step 3: Run the test (should fail — rule not implemented)**

```bash
node tools/eslint-rules/no-nested-component-definition.test.js
```

Expected: error about `rule` being undefined or no default export.

- [ ] **Step 4: Implement the rule**

Write `tools/eslint-rules/no-nested-component-definition.js`:

```js
/**
 * Flags function declarations / arrow-function expressions that:
 *   (a) are declared inside another function's body, and
 *   (b) appear to return JSX (i.e. are visually a React component).
 *
 * Render callbacks (e.g. passed inline to .map or as props) are intentionally
 * out of scope — they're flagged by their NAME convention only. A callback
 * starting with a lowercase letter and not directly assigned to an
 * UpperCamelCase identifier is treated as non-component.
 */

function isUpperCamelCase(name) {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function returnsJSX(node) {
  // Body may be a BlockStatement (contains ReturnStatement) or an Expression
  // (arrow function with implicit return).
  if (!node.body) return false;
  if (node.body.type === 'JSXElement' || node.body.type === 'JSXFragment') return true;
  if (node.body.type !== 'BlockStatement') return false;
  for (const stmt of node.body.body) {
    if (stmt.type !== 'ReturnStatement' || !stmt.argument) continue;
    const t = stmt.argument.type;
    if (t === 'JSXElement' || t === 'JSXFragment') return true;
    if (t === 'ConditionalExpression') {
      const c = stmt.argument.consequent.type;
      const a = stmt.argument.alternate.type;
      if (c === 'JSXElement' || c === 'JSXFragment' || a === 'JSXElement' || a === 'JSXFragment') return true;
    }
  }
  return false;
}

function getDeclaredName(node) {
  if (node.type === 'FunctionDeclaration' && node.id) return node.id.name;
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    if (node.parent && node.parent.type === 'VariableDeclarator' && node.parent.id.type === 'Identifier') {
      return node.parent.id.name;
    }
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow defining a React component inside another function body. Hoist to module scope or a sibling file.',
    },
    messages: {
      nestedComponent:
        'Component "{{name}}" is declared inside another function. Hoist it to module scope or a sibling file (see CLAUDE.md → Component Architecture).',
    },
    schema: [],
  },
  create(context) {
    const fnStack = [];

    function enter(node) {
      const name = getDeclaredName(node);
      if (fnStack.length > 0 && name && isUpperCamelCase(name) && returnsJSX(node)) {
        context.report({ node, messageId: 'nestedComponent', data: { name } });
      }
      fnStack.push(node);
    }

    function leave() {
      fnStack.pop();
    }

    return {
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': leave,
      FunctionExpression: enter,
      'FunctionExpression:exit': leave,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': leave,
    };
  },
};
```

- [ ] **Step 5: Run the test (should pass now)**

```bash
node tools/eslint-rules/no-nested-component-definition.test.js
```

Expected: `no-nested-component-definition: all tests passed`

- [ ] **Step 6: Commit**

```bash
git add tools/eslint-rules/
git commit -m "feat(lint): add no-nested-component-definition custom rule

Flags React components declared inside another function body.
Aligns with CLAUDE.md component-architecture contract."
```

---

## Task 3: Wire the custom rule into ESLint config

**Files:**
- Modify: `eslint.config.js`
- Modify: `package.json`

- [ ] **Step 1: Read current eslint config**

```bash
cat eslint.config.js
```

Note the current shape (flat config, exports an array).

- [ ] **Step 2: Add the local plugin**

In `eslint.config.js`, import the local plugin and wire it into a config block targeting `src/**/*.tsx`:

```js
// Add near other imports
import localPlugin from './tools/eslint-rules/index.js';

// In the exported array, add (or merge into the existing TSX block):
{
  files: ['src/**/*.tsx'],
  plugins: { 'editor-local': localPlugin },
  rules: {
    'editor-local/no-nested-component-definition': 'error',
  },
},
```

- [ ] **Step 3: Add `npm run check` script**

In `package.json`, under `"scripts"`:

```json
"check": "tsc -b && eslint .",
"lint:rules": "node tools/eslint-rules/no-nested-component-definition.test.js"
```

- [ ] **Step 4: Run check — should pass (Task 1 cleared violations)**

```bash
npm run check
```

Expected: tsc passes, eslint passes with no `no-nested-component-definition` errors.

- [ ] **Step 5: Verify the rule fires on a fixture**

Create a temporary file `src/_lint_fixture.tsx`:

```tsx
export function Outer() {
  function Inner() {
    return <span/>;
  }
  return <Inner/>;
}
```

Run:
```bash
npx eslint src/_lint_fixture.tsx
```

Expected: error citing `no-nested-component-definition`.

Delete the fixture:
```bash
rm src/_lint_fixture.tsx
```

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js package.json
git commit -m "build: wire no-nested-component-definition rule + add npm run check

Runs tsc -b followed by eslint over the repo. Use 'npm run lint:rules'
to test the custom rule itself."
```

---

## Task 4: Add a pre-commit hook

**Files:**
- Create: `.git-hooks/pre-commit`
- Modify: `package.json` (post-install script to symlink)

- [ ] **Step 1: Create the hook**

Write `.git-hooks/pre-commit`:

```bash
#!/usr/bin/env bash
set -e
npm run check
```

Make it executable:
```bash
chmod +x .git-hooks/pre-commit
```

- [ ] **Step 2: Add an install script**

Add to `package.json` `"scripts"`:

```json
"prepare": "git config core.hooksPath .git-hooks"
```

- [ ] **Step 3: Trigger the install**

```bash
npm run prepare
```

Verify:
```bash
git config --get core.hooksPath
```

Expected: `.git-hooks`

- [ ] **Step 4: Test the hook**

Make a trivial change and try a commit:
```bash
echo "// test" >> src/main.tsx
git add src/main.tsx
git commit -m "test: pre-commit hook"
```

Expected: hook runs `npm run check` before the commit completes. If `check` passes, commit succeeds.

Revert:
```bash
git reset HEAD~1
git checkout src/main.tsx
```

- [ ] **Step 5: Commit the hook itself**

```bash
git add .git-hooks/pre-commit package.json
git commit -m "build: pre-commit hook runs npm run check

Activated via 'npm run prepare' (sets core.hooksPath).
Zero deps; bare bash."
```

---

## Task 5: Backend project skeleton

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/README.md`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/config.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write `backend/pyproject.toml`**

```toml
[project]
name = "editor-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi==0.115.0",
  "uvicorn[standard]==0.31.0",
  "pydantic==2.9.2",
  "pydantic-settings==2.5.2",
  "anthropic==0.39.0",
  "python-multipart==0.0.12",
  "httpx==0.27.2",
]

[project.optional-dependencies]
dev = [
  "pytest==8.3.3",
  "pytest-asyncio==0.24.0",
  "respx==0.21.1",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Mirror to `requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.31.0
pydantic==2.9.2
pydantic-settings==2.5.2
anthropic==0.39.0
python-multipart==0.0.12
httpx==0.27.2
```

And `requirements-dev.txt`:

```
-r requirements.txt
pytest==8.3.3
pytest-asyncio==0.24.0
respx==0.21.1
```

- [ ] **Step 3: Write `.env.example`**

```
# Anthropic
ANTHROPIC_API_KEY=

# Server
HOST=127.0.0.1
PORT=8787
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Session
SESSION_TTL_SECONDS=1800
MAX_IMAGE_BYTES=2097152

# Model
ANTHROPIC_MODEL=claude-opus-4-7
```

- [ ] **Step 4: Write `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str
    anthropic_model: str = "claude-opus-4-7"
    host: str = "127.0.0.1"
    port: int = 8787
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    session_ttl_seconds: int = 1800
    max_image_bytes: int = 2 * 1024 * 1024

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
```

- [ ] **Step 5: Write `backend/app/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings


def create_app() -> FastAPI:
    app = FastAPI(title="editor-backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=False,
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 6: Create `backend/app/__init__.py`**

Empty file:
```bash
touch backend/app/__init__.py
```

- [ ] **Step 7: Write `backend/README.md`**

```markdown
# editor-backend

FastAPI backend for the photo editor's AI layer.

## Bootstrap

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY
```

## Run

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8787
```

Visit http://127.0.0.1:8787/health → `{"status":"ok"}`.

## Test

```bash
source .venv/bin/activate
pytest -v
```
```

- [ ] **Step 8: Update root `.gitignore`**

Append:
```
# Backend
backend/.env
backend/.venv/
backend/**/__pycache__/
backend/**/*.pyc
backend/.pytest_cache/
```

- [ ] **Step 9: Verify the skeleton runs**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" > .env
uvicorn app.main:app --port 8787 &
sleep 2
curl -s http://127.0.0.1:8787/health
kill %1
deactivate
cd ..
```

Expected: `{"status":"ok"}`

- [ ] **Step 10: Commit**

```bash
git add backend/ .gitignore
git commit -m "feat(backend): FastAPI skeleton with health endpoint, CORS, settings"
```

---

## Task 6: Pydantic schemas — Operation Graph + Image Context

**Files:**
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/operation_graph.py`
- Create: `backend/app/schemas/image_context.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_schemas.py`

- [ ] **Step 1: Write the failing schema tests**

Create `backend/tests/__init__.py` (empty) and `backend/tests/conftest.py`:

```python
import pytest


@pytest.fixture
def sample_operation_graph() -> dict:
    return {
        "id": "graph_01",
        "user_goal": "make it warmer",
        "reasoning": "Image is cool-toned, warming the white balance addresses this directly.",
        "nodes": [
            {
                "id": "n1",
                "type": "kelvin",
                "scope": {"kind": "global"},
                "params": {"temperature": 5800},
            }
        ],
        "panel_bindings": [
            {
                "node_id": "n1",
                "param_key": "temperature",
                "label": "warm cast",
                "control": "slider",
                "min": 3000,
                "max": 9000,
                "default": 5800,
                "step": 50,
            }
        ],
        "metadata": {"model_name": "claude-opus-4-7", "model_version": "2026-01"},
    }


@pytest.fixture
def sample_image_context() -> dict:
    return {
        "subjects": ["person", "snow"],
        "lighting": "backlit",
        "dominant_tones": ["shadows", "highlights"],
        "mood": "wintry, intimate",
        "candidate_regions": [
            {"label": "subject", "description": "person in centre frame"},
            {"label": "sky", "description": "upper third"},
        ],
        "model_name": "claude-opus-4-7",
        "model_version": "2026-01",
        "generated_at": "2026-05-11T10:00:00Z",
    }
```

Write `backend/tests/test_schemas.py`:

```python
from app.schemas.operation_graph import OperationGraph
from app.schemas.image_context import ImageContext


def test_operation_graph_roundtrip(sample_operation_graph: dict) -> None:
    parsed = OperationGraph.model_validate(sample_operation_graph)
    assert parsed.id == "graph_01"
    assert parsed.nodes[0].type == "kelvin"
    assert parsed.nodes[0].scope.kind == "global"
    assert parsed.panel_bindings[0].label == "warm cast"
    dumped = parsed.model_dump(mode="json")
    assert dumped["nodes"][0]["params"]["temperature"] == 5800


def test_operation_graph_rejects_unknown_scope_kind(sample_operation_graph: dict) -> None:
    bad = {**sample_operation_graph}
    bad["nodes"][0]["scope"] = {"kind": "telepathic"}
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        OperationGraph.model_validate(bad)


def test_image_context_roundtrip(sample_image_context: dict) -> None:
    parsed = ImageContext.model_validate(sample_image_context)
    assert parsed.lighting == "backlit"
    assert parsed.candidate_regions[0].label == "subject"
    dumped = parsed.model_dump(mode="json")
    assert dumped["lighting"] == "backlit"
```

- [ ] **Step 2: Run tests — should fail (schemas don't exist)**

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest tests/test_schemas.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.schemas.operation_graph'`.

- [ ] **Step 3: Write `backend/app/schemas/__init__.py`**

```python
from .operation_graph import OperationGraph, Node, PanelBinding, Scope, ScopeKind
from .image_context import ImageContext, CandidateRegion

__all__ = [
    "OperationGraph",
    "Node",
    "PanelBinding",
    "Scope",
    "ScopeKind",
    "ImageContext",
    "CandidateRegion",
]
```

- [ ] **Step 4: Write `backend/app/schemas/operation_graph.py`**

```python
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ScopeKind = Literal["global", "mask:click", "mask:proposed"]


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: ScopeKind
    # For mask:proposed — model-supplied label + representative point.
    label: str | None = None
    point: tuple[float, float] | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    type: str  # Resolved against ProcessingRegistry at runtime.
    scope: Scope = Field(default_factory=lambda: Scope(kind="global"))
    params: dict[str, float | int | str | bool] = Field(default_factory=dict)
    inputs: list[str] = Field(default_factory=list)  # node IDs


class PanelBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str
    param_key: str
    label: str
    control: Literal["slider", "toggle", "picker"] = "slider"
    min: float | None = None
    max: float | None = None
    default: float | str | bool | None = None
    step: float | None = None
    reasoning: str | None = None


class OperationGraph(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    user_goal: str
    reasoning: str | None = None
    nodes: list[Node]
    panel_bindings: list[PanelBinding]
    metadata: dict[str, str] = Field(default_factory=dict)
```

- [ ] **Step 5: Write `backend/app/schemas/image_context.py`**

```python
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Lighting = Literal["flat", "backlit", "side", "rim", "mixed"]
DominantTone = Literal["shadows", "midtones", "highlights"]


class CandidateRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    description: str


class ImageContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subjects: list[str] = Field(default_factory=list)
    lighting: Lighting
    dominant_tones: list[DominantTone] = Field(default_factory=list)
    mood: str
    candidate_regions: list[CandidateRegion] = Field(default_factory=list)
    model_name: str
    model_version: str
    generated_at: str  # ISO 8601 timestamp
```

- [ ] **Step 6: Run tests — should pass**

```bash
pytest tests/test_schemas.py -v
```

Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
cd ..
git add backend/app/schemas backend/tests/__init__.py backend/tests/conftest.py backend/tests/test_schemas.py
git commit -m "feat(backend): Pydantic schemas for OperationGraph + ImageContext"
```

---

## Task 7: Session store with TTL

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/session_store.py`
- Create: `backend/tests/test_session_store.py`

- [ ] **Step 1: Write the failing test**

Write `backend/tests/test_session_store.py`:

```python
import time
import pytest

from app.services.session_store import SessionStore, SessionNotFound


def test_create_and_get() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    record = store.get(sid)
    assert record.image_bytes == b"abc"
    assert record.mime_type == "image/jpeg"
    assert record.context is None


def test_set_context() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    store.set_context(sid, {"mood": "calm"})
    record = store.get(sid)
    assert record.context == {"mood": "calm"}


def test_expired_session_raises() -> None:
    store = SessionStore(ttl_seconds=0)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    time.sleep(0.01)
    with pytest.raises(SessionNotFound):
        store.get(sid)


def test_unknown_session_raises() -> None:
    store = SessionStore(ttl_seconds=60)
    with pytest.raises(SessionNotFound):
        store.get("nope")


def test_touch_refreshes_ttl() -> None:
    store = SessionStore(ttl_seconds=1)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    time.sleep(0.6)
    store.touch(sid)
    time.sleep(0.6)
    record = store.get(sid)  # would expire without touch
    assert record.image_bytes == b"abc"
```

- [ ] **Step 2: Run test — should fail**

```bash
cd backend
source .venv/bin/activate
pytest tests/test_session_store.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the store**

Write `backend/app/services/__init__.py` (empty).

Write `backend/app/services/session_store.py`:

```python
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any


class SessionNotFound(KeyError):
    pass


@dataclass
class SessionRecord:
    image_bytes: bytes
    mime_type: str
    created_at: float
    last_seen: float
    context: dict[str, Any] | None = None


class SessionStore:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._records: dict[str, SessionRecord] = {}
        self._lock = Lock()

    def _is_expired(self, record: SessionRecord) -> bool:
        return (time.monotonic() - record.last_seen) > self._ttl

    def create(self, image_bytes: bytes, mime_type: str) -> str:
        sid = uuid.uuid4().hex
        now = time.monotonic()
        with self._lock:
            self._records[sid] = SessionRecord(
                image_bytes=image_bytes,
                mime_type=mime_type,
                created_at=now,
                last_seen=now,
            )
        return sid

    def get(self, sid: str) -> SessionRecord:
        with self._lock:
            record = self._records.get(sid)
            if record is None:
                raise SessionNotFound(sid)
            if self._is_expired(record):
                self._records.pop(sid, None)
                raise SessionNotFound(sid)
            record.last_seen = time.monotonic()
            return record

    def touch(self, sid: str) -> None:
        self.get(sid)  # raises if missing/expired; side effect: updates last_seen

    def set_context(self, sid: str, context: dict[str, Any]) -> None:
        record = self.get(sid)
        record.context = context
```

- [ ] **Step 4: Run tests — should pass**

```bash
pytest tests/test_session_store.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/app/services/__init__.py backend/app/services/session_store.py backend/tests/test_session_store.py
git commit -m "feat(backend): in-memory session store with TTL"
```

---

## Task 8: Anthropic client wrapper

**Files:**
- Create: `backend/app/services/anthropic_client.py`
- Create: `backend/tests/test_anthropic_client.py`

- [ ] **Step 1: Write the failing test**

Write `backend/tests/test_anthropic_client.py`:

```python
from unittest.mock import MagicMock, patch

import pytest

from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph
from app.services.anthropic_client import AnthropicClient


@pytest.fixture
def fake_anthropic_response_image_context() -> MagicMock:
    response = MagicMock()
    response.content = [
        MagicMock(
            type="tool_use",
            name="emit_image_context",
            input={
                "subjects": ["person"],
                "lighting": "backlit",
                "dominant_tones": ["shadows"],
                "mood": "calm",
                "candidate_regions": [],
                "model_name": "claude-opus-4-7",
                "model_version": "2026-01",
                "generated_at": "2026-05-11T10:00:00Z",
            },
        )
    ]
    response.usage = MagicMock(cache_read_input_tokens=0, cache_creation_input_tokens=100)
    return response


def test_analyze_returns_context(fake_anthropic_response_image_context: MagicMock) -> None:
    with patch("app.services.anthropic_client.Anthropic") as MockAnthropic:
        instance = MockAnthropic.return_value
        instance.messages.create.return_value = fake_anthropic_response_image_context
        client = AnthropicClient(api_key="test", model="claude-opus-4-7")
        ctx = client.analyze_image(image_bytes=b"fake-jpeg", mime_type="image/jpeg")
        assert isinstance(ctx, ImageContext)
        assert ctx.lighting == "backlit"


def test_analyze_uses_cache_control() -> None:
    """Verify the image+system prompt is sent with cache_control markers."""
    with patch("app.services.anthropic_client.Anthropic") as MockAnthropic:
        instance = MockAnthropic.return_value
        instance.messages.create.return_value = MagicMock(
            content=[
                MagicMock(
                    type="tool_use",
                    name="emit_image_context",
                    input={
                        "subjects": [],
                        "lighting": "flat",
                        "dominant_tones": [],
                        "mood": "neutral",
                        "candidate_regions": [],
                        "model_name": "claude-opus-4-7",
                        "model_version": "2026-01",
                        "generated_at": "2026-05-11T10:00:00Z",
                    },
                )
            ],
            usage=MagicMock(),
        )
        client = AnthropicClient(api_key="test", model="claude-opus-4-7")
        client.analyze_image(image_bytes=b"fake-jpeg", mime_type="image/jpeg")
        call = instance.messages.create.call_args
        messages = call.kwargs["messages"]
        # First message is the user message with image + system text.
        user_blocks = messages[0]["content"]
        # At least one block must have cache_control.
        assert any("cache_control" in block for block in user_blocks), user_blocks
```

- [ ] **Step 2: Run test — should fail (module missing)**

```bash
cd backend
source .venv/bin/activate
pytest tests/test_anthropic_client.py -v
```

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement the client**

Write `backend/app/services/anthropic_client.py`:

```python
from __future__ import annotations

import base64
from typing import Any

from anthropic import Anthropic
from pydantic import ValidationError

from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph

ANALYZE_SYSTEM_PROMPT = """You are a photo-editing assistant. Given an image, \
produce a structured ImageContext capturing subjects, lighting, dominant \
tonal regions, mood, and candidate regions a user might want to edit. Call \
the `emit_image_context` tool exactly once. Do not return prose."""

PANEL_SYSTEM_PROMPT = """You are a photo-editing assistant. Given an image, \
its pre-computed context, and a user goal (e.g. "make it warmer"), produce \
an OperationGraph: a small set of editing operations bound to user-facing \
controls. Each control has a goal-relevant label ("warm cast" rather than \
"kelvin = 4200"). Call the `emit_operation_graph` tool exactly once. Do not \
return prose."""

IMAGE_CONTEXT_TOOL = {
    "name": "emit_image_context",
    "description": "Emit the structured ImageContext for the given image.",
    "input_schema": ImageContext.model_json_schema(),
}

OPERATION_GRAPH_TOOL = {
    "name": "emit_operation_graph",
    "description": "Emit the OperationGraph for the user's goal.",
    "input_schema": OperationGraph.model_json_schema(),
}


class AnthropicClient:
    """Wrapper around the Anthropic SDK with structured tool use + prompt caching."""

    def __init__(self, api_key: str, model: str) -> None:
        self._client = Anthropic(api_key=api_key)
        self._model = model

    def _image_block(self, image_bytes: bytes, mime_type: str) -> dict[str, Any]:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime_type,
                "data": base64.standard_b64encode(image_bytes).decode("ascii"),
            },
            "cache_control": {"type": "ephemeral"},
        }

    def analyze_image(self, image_bytes: bytes, mime_type: str) -> ImageContext:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=[{"type": "text", "text": ANALYZE_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[IMAGE_CONTEXT_TOOL],
            tool_choice={"type": "tool", "name": "emit_image_context"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        self._image_block(image_bytes, mime_type),
                        {"type": "text", "text": "Analyse this image."},
                    ],
                }
            ],
        )
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_image_context":
                return ImageContext.model_validate(block.input)
        raise RuntimeError("Anthropic did not emit emit_image_context tool call")

    def generate_panel(
        self,
        image_bytes: bytes,
        mime_type: str,
        context: ImageContext,
        user_goal: str,
    ) -> OperationGraph:
        last_error: ValidationError | None = None
        for _ in range(3):  # initial + 2 retries
            response = self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                system=[{"type": "text", "text": PANEL_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=[OPERATION_GRAPH_TOOL],
                tool_choice={"type": "tool", "name": "emit_operation_graph"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._image_block(image_bytes, mime_type),
                            {
                                "type": "text",
                                "text": f"Image context: {context.model_dump_json()}",
                                "cache_control": {"type": "ephemeral"},
                            },
                            {"type": "text", "text": f"User goal: {user_goal}"},
                        ],
                    }
                ],
            )
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_operation_graph":
                    try:
                        return OperationGraph.model_validate(block.input)
                    except ValidationError as e:
                        last_error = e
                        break
            else:
                raise RuntimeError("Anthropic did not emit emit_operation_graph tool call")
        raise RuntimeError(f"Panel generation failed validation after retries: {last_error}")
```

- [ ] **Step 4: Run tests — should pass**

```bash
pytest tests/test_anthropic_client.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/app/services/anthropic_client.py backend/tests/test_anthropic_client.py
git commit -m "feat(backend): Anthropic client with structured tool use + prompt caching"
```

---

## Task 9: `/api/session` endpoint

**Files:**
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/deps.py`
- Create: `backend/app/api/session.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_session_endpoint.py`
- Create: `backend/tests/fixtures/test_image.jpg`

- [ ] **Step 1: Create a small test image**

```bash
cd backend
mkdir -p tests/fixtures
python3 -c "
from PIL import Image
img = Image.new('RGB', (1024, 683), color=(80, 90, 110))
img.save('tests/fixtures/test_image.jpg', 'JPEG', quality=85)
" 2>/dev/null || python3 -c "
import struct, zlib, base64
# Minimal valid JPEG (1x1 grey pixel) — fallback if Pillow not installed.
jpeg = bytes.fromhex(
    'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707'
    '07090908'
    '0a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c'
    '30313434'
    '341f27393d38323c2e333432ffc0000b08000100010101110100ffc4001f00000105'
    '01010101'
    '0101010000000000000000010203040506070809000affc400b51000020103030204'
    '03050504'
    '040000017d010203000411051221314106135161072271143281914 1a1b14250d1f0'
    '243340827'
    '21a1817'
    '78231e1c1d1e1f25262728292a3435363738393a434445464748494a5354555657585'
    '95a6364656'
    '6'
)
# This synthetic JPEG is intentionally tiny; replace with a real fixture as soon as Pillow is available.
import pathlib
pathlib.Path('tests/fixtures/test_image.jpg').write_bytes(jpeg)
print('wrote tiny fallback fixture')
"
```

If neither succeeds, hand-place any JPEG you have at `backend/tests/fixtures/test_image.jpg` (must be ≤ `MAX_IMAGE_BYTES` = 2 MB).

Verify:
```bash
file tests/fixtures/test_image.jpg
```

Expected: `JPEG image data`.

- [ ] **Step 2: Write the failing endpoint test**

Write `backend/tests/test_session_endpoint.py`:

```python
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def test_session_create_returns_id() -> None:
    client = TestClient(app)
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        response = client.post(
            "/api/session",
            files={"image": ("test.jpg", fh, "image/jpeg")},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "session_id" in body
    assert len(body["session_id"]) == 32


def test_session_rejects_oversized_image(monkeypatch) -> None:
    # Force a tiny limit
    from app import config
    monkeypatch.setattr(config.settings, "max_image_bytes", 10)
    client = TestClient(app)
    response = client.post(
        "/api/session",
        files={"image": ("big.jpg", b"x" * 100, "image/jpeg")},
    )
    assert response.status_code == 413


def test_session_rejects_non_image_mime() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/session",
        files={"image": ("file.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 415
```

- [ ] **Step 3: Run test — should fail**

```bash
pytest tests/test_session_endpoint.py -v
```

Expected: 404 (endpoint missing).

- [ ] **Step 4: Implement the endpoint**

Write `backend/app/api/__init__.py`:

```python
from fastapi import APIRouter

from . import analyze, panel, refine, session

router = APIRouter(prefix="/api")
router.include_router(session.router)
router.include_router(analyze.router)
router.include_router(panel.router)
router.include_router(refine.router)
```

Write `backend/app/api/deps.py`:

```python
from app.config import settings
from app.services.anthropic_client import AnthropicClient
from app.services.session_store import SessionStore

_session_store = SessionStore(ttl_seconds=settings.session_ttl_seconds)
_anthropic_client = AnthropicClient(api_key=settings.anthropic_api_key, model=settings.anthropic_model)


def get_session_store() -> SessionStore:
    return _session_store


def get_anthropic_client() -> AnthropicClient:
    return _anthropic_client
```

Write `backend/app/api/session.py`:

```python
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import settings
from app.services.session_store import SessionStore

from .deps import get_session_store

router = APIRouter()


@router.post("/session")
async def create_session(
    image: UploadFile = File(...),
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="image/* MIME type required")
    data = await image.read()
    if len(data) > settings.max_image_bytes:
        raise HTTPException(status_code=413, detail="image too large")
    sid = store.create(image_bytes=data, mime_type=image.content_type)
    return {"session_id": sid}
```

Stub the other three (filled out in later tasks):

`backend/app/api/analyze.py`:
```python
from fastapi import APIRouter

router = APIRouter()


@router.post("/analyze")
async def analyze_stub() -> dict[str, str]:
    return {"status": "not_implemented"}
```

`backend/app/api/panel.py`:
```python
from fastapi import APIRouter

router = APIRouter()


@router.post("/panel")
async def panel_stub() -> dict[str, str]:
    return {"status": "not_implemented"}
```

`backend/app/api/refine.py`:
```python
from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/refine")
async def refine_stub() -> dict[str, str]:
    raise HTTPException(status_code=501, detail="refine endpoint lands in Phase 3")
```

Update `backend/app/main.py` to register the router:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router as api_router
from .config import settings


def create_app() -> FastAPI:
    app = FastAPI(title="editor-backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=False,
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["*"],
    )
    app.include_router(api_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 5: Run tests — should pass**

```bash
pytest tests/test_session_endpoint.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd ..
git add backend/app/api backend/app/main.py backend/tests/test_session_endpoint.py backend/tests/fixtures/
git commit -m "feat(backend): POST /api/session with TTL, size, MIME validation"
```

---

## Task 10: `/api/analyze` endpoint

**Files:**
- Modify: `backend/app/api/analyze.py`
- Create: `backend/tests/test_analyze_endpoint.py`

- [ ] **Step 1: Write the failing test**

Write `backend/tests/test_analyze_endpoint.py`:

```python
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.schemas.image_context import ImageContext


@pytest.fixture
def client_with_fake_anthropic(monkeypatch) -> TestClient:
    fake = MagicMock()
    fake.analyze_image.return_value = ImageContext.model_validate({
        "subjects": ["person"],
        "lighting": "backlit",
        "dominant_tones": ["shadows"],
        "mood": "calm",
        "candidate_regions": [],
        "model_name": "claude-opus-4-7",
        "model_version": "2026-01",
        "generated_at": "2026-05-11T10:00:00Z",
    })
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake)
    return TestClient(app)


def test_analyze_returns_context(client_with_fake_anthropic: TestClient) -> None:
    client = client_with_fake_anthropic
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        create = client.post("/api/session", files={"image": ("t.jpg", fh, "image/jpeg")})
    sid = create.json()["session_id"]
    response = client.post("/api/analyze", json={"session_id": sid})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["lighting"] == "backlit"


def test_analyze_unknown_session_404(client_with_fake_anthropic: TestClient) -> None:
    client = client_with_fake_anthropic
    response = client.post("/api/analyze", json={"session_id": "nope"})
    assert response.status_code == 404
```

- [ ] **Step 2: Run test — should fail**

```bash
cd backend
source .venv/bin/activate
pytest tests/test_analyze_endpoint.py -v
```

Expected: assertion on `body["lighting"]` fails (current stub returns `not_implemented`).

- [ ] **Step 3: Implement the endpoint**

Replace `backend/app/api/analyze.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.schemas.image_context import ImageContext
from app.services.anthropic_client import AnthropicClient
from app.services.session_store import SessionNotFound, SessionStore

from .deps import get_anthropic_client, get_session_store

router = APIRouter()


class AnalyzeRequest(BaseModel):
    session_id: str


@router.post("/analyze", response_model=ImageContext)
async def analyze(
    body: AnalyzeRequest,
    store: SessionStore = Depends(get_session_store),
    client: AnthropicClient = Depends(get_anthropic_client),
) -> ImageContext:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    if record.context is not None:
        return ImageContext.model_validate(record.context)
    context = client.analyze_image(image_bytes=record.image_bytes, mime_type=record.mime_type)
    store.set_context(body.session_id, context.model_dump(mode="json"))
    return context
```

- [ ] **Step 4: Run tests — should pass**

```bash
pytest tests/test_analyze_endpoint.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/app/api/analyze.py backend/tests/test_analyze_endpoint.py
git commit -m "feat(backend): POST /api/analyze caches ImageContext per session"
```

---

## Task 11: `/api/panel` endpoint

**Files:**
- Modify: `backend/app/api/panel.py`
- Create: `backend/tests/test_panel_endpoint.py`

- [ ] **Step 1: Write the failing test**

Write `backend/tests/test_panel_endpoint.py`:

```python
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph


@pytest.fixture
def fake_client() -> MagicMock:
    fake = MagicMock()
    fake.analyze_image.return_value = ImageContext.model_validate({
        "subjects": [],
        "lighting": "flat",
        "dominant_tones": [],
        "mood": "neutral",
        "candidate_regions": [],
        "model_name": "claude-opus-4-7",
        "model_version": "2026-01",
        "generated_at": "2026-05-11T10:00:00Z",
    })
    fake.generate_panel.return_value = OperationGraph.model_validate({
        "id": "g1",
        "user_goal": "warmer",
        "reasoning": "white balance",
        "nodes": [
            {"id": "n1", "type": "kelvin", "scope": {"kind": "global"}, "params": {"temperature": 5800}}
        ],
        "panel_bindings": [
            {
                "node_id": "n1",
                "param_key": "temperature",
                "label": "warm cast",
                "control": "slider",
                "min": 3000, "max": 9000, "default": 5800, "step": 50,
            }
        ],
        "metadata": {"model_name": "claude-opus-4-7"},
    })
    return fake


@pytest.fixture
def client(fake_client: MagicMock, monkeypatch) -> TestClient:
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake_client)
    return TestClient(app)


def test_panel_returns_operation_graph(client: TestClient, fake_client: MagicMock) -> None:
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        sid = client.post("/api/session", files={"image": ("t.jpg", fh, "image/jpeg")}).json()["session_id"]
    response = client.post("/api/panel", json={"session_id": sid, "user_goal": "make it warmer"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user_goal"] == "warmer"
    assert body["panel_bindings"][0]["label"] == "warm cast"
    # Verify analyze was called once (lazy, before panel)
    assert fake_client.analyze_image.call_count == 1


def test_panel_reuses_cached_context(client: TestClient, fake_client: MagicMock) -> None:
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        sid = client.post("/api/session", files={"image": ("t.jpg", fh, "image/jpeg")}).json()["session_id"]
    client.post("/api/analyze", json={"session_id": sid})
    fake_client.analyze_image.reset_mock()
    client.post("/api/panel", json={"session_id": sid, "user_goal": "x"})
    client.post("/api/panel", json={"session_id": sid, "user_goal": "y"})
    assert fake_client.analyze_image.call_count == 0


def test_panel_unknown_session_404(client: TestClient) -> None:
    response = client.post("/api/panel", json={"session_id": "nope", "user_goal": "x"})
    assert response.status_code == 404
```

- [ ] **Step 2: Run test — should fail (stub still in place)**

```bash
pytest tests/test_panel_endpoint.py -v
```

Expected: assertion failures.

- [ ] **Step 3: Implement the endpoint**

Replace `backend/app/api/panel.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph
from app.services.anthropic_client import AnthropicClient
from app.services.session_store import SessionNotFound, SessionStore

from .deps import get_anthropic_client, get_session_store

router = APIRouter()


class PanelRequest(BaseModel):
    session_id: str
    user_goal: str


@router.post("/panel", response_model=OperationGraph)
async def panel(
    body: PanelRequest,
    store: SessionStore = Depends(get_session_store),
    client: AnthropicClient = Depends(get_anthropic_client),
) -> OperationGraph:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    if record.context is None:
        context = client.analyze_image(image_bytes=record.image_bytes, mime_type=record.mime_type)
        store.set_context(body.session_id, context.model_dump(mode="json"))
    else:
        context = ImageContext.model_validate(record.context)
    return client.generate_panel(
        image_bytes=record.image_bytes,
        mime_type=record.mime_type,
        context=context,
        user_goal=body.user_goal,
    )
```

- [ ] **Step 4: Run tests — should pass**

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/app/api/panel.py backend/tests/test_panel_endpoint.py
git commit -m "feat(backend): POST /api/panel returns OperationGraph, lazy-analyses if needed"
```

---

## Task 12: Frontend types + Zod schemas

**Files:**
- Create: `src/types/operation-graph.ts`
- Create: `src/types/image-context.ts`
- Create: `src/lib/operation-graph-schema.ts`
- Create: `src/lib/image-context-schema.ts`
- Modify: `package.json` (add `zod`)

- [ ] **Step 1: Install Zod**

```bash
npm install zod@3.23.8
```

- [ ] **Step 2: Write TS types**

`src/types/operation-graph.ts`:

```typescript
export type ScopeKind = 'global' | 'mask:click' | 'mask:proposed';

export interface Scope {
  kind: ScopeKind;
  label?: string;
  point?: [number, number];
  confidence?: number;
}

export interface Node {
  id: string;
  type: string;
  scope: Scope;
  params: Record<string, number | string | boolean>;
  inputs: string[];
}

export interface PanelBinding {
  nodeId: string;
  paramKey: string;
  label: string;
  control: 'slider' | 'toggle' | 'picker';
  min?: number;
  max?: number;
  default?: number | string | boolean;
  step?: number;
  reasoning?: string;
}

export interface OperationGraph {
  id: string;
  userGoal: string;
  reasoning?: string;
  nodes: Node[];
  panelBindings: PanelBinding[];
  metadata: Record<string, string>;
}
```

`src/types/image-context.ts`:

```typescript
export type Lighting = 'flat' | 'backlit' | 'side' | 'rim' | 'mixed';
export type DominantTone = 'shadows' | 'midtones' | 'highlights';

export interface CandidateRegion {
  label: string;
  description: string;
}

export interface ImageContext {
  subjects: string[];
  lighting: Lighting;
  dominantTones: DominantTone[];
  mood: string;
  candidateRegions: CandidateRegion[];
  modelName: string;
  modelVersion: string;
  generatedAt: string;
}
```

- [ ] **Step 3: Write Zod schemas (snake_case → camelCase converter)**

`src/lib/operation-graph-schema.ts`:

```typescript
import { z } from 'zod';
import type { OperationGraph } from '@/types/operation-graph';

const ScopeSchema = z.object({
  kind: z.enum(['global', 'mask:click', 'mask:proposed']),
  label: z.string().optional(),
  point: z.tuple([z.number(), z.number()]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  scope: ScopeSchema,
  params: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
  inputs: z.array(z.string()).default([]),
});

const PanelBindingSchema = z
  .object({
    node_id: z.string(),
    param_key: z.string(),
    label: z.string(),
    control: z.enum(['slider', 'toggle', 'picker']).default('slider'),
    min: z.number().optional(),
    max: z.number().optional(),
    default: z.union([z.number(), z.string(), z.boolean()]).optional(),
    step: z.number().optional(),
    reasoning: z.string().optional(),
  })
  .transform((b) => ({
    nodeId: b.node_id,
    paramKey: b.param_key,
    label: b.label,
    control: b.control,
    min: b.min,
    max: b.max,
    default: b.default,
    step: b.step,
    reasoning: b.reasoning,
  }));

export const OperationGraphSchema = z
  .object({
    id: z.string(),
    user_goal: z.string(),
    reasoning: z.string().optional(),
    nodes: z.array(NodeSchema),
    panel_bindings: z.array(PanelBindingSchema),
    metadata: z.record(z.string()).default({}),
  })
  .transform<OperationGraph>((g) => ({
    id: g.id,
    userGoal: g.user_goal,
    reasoning: g.reasoning,
    nodes: g.nodes,
    panelBindings: g.panel_bindings,
    metadata: g.metadata,
  }));
```

`src/lib/image-context-schema.ts`:

```typescript
import { z } from 'zod';
import type { ImageContext } from '@/types/image-context';

const CandidateRegionSchema = z.object({
  label: z.string(),
  description: z.string(),
});

export const ImageContextSchema = z
  .object({
    subjects: z.array(z.string()).default([]),
    lighting: z.enum(['flat', 'backlit', 'side', 'rim', 'mixed']),
    dominant_tones: z.array(z.enum(['shadows', 'midtones', 'highlights'])).default([]),
    mood: z.string(),
    candidate_regions: z.array(CandidateRegionSchema).default([]),
    model_name: z.string(),
    model_version: z.string(),
    generated_at: z.string(),
  })
  .transform<ImageContext>((c) => ({
    subjects: c.subjects,
    lighting: c.lighting,
    dominantTones: c.dominant_tones,
    mood: c.mood,
    candidateRegions: c.candidate_regions,
    modelName: c.model_name,
    modelVersion: c.model_version,
    generatedAt: c.generated_at,
  }));
```

- [ ] **Step 4: Type-check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/types/operation-graph.ts src/types/image-context.ts src/lib/operation-graph-schema.ts src/lib/image-context-schema.ts package.json package-lock.json
git commit -m "feat: TS types and Zod schemas for OperationGraph + ImageContext"
```

---

## Task 13: AI client (frontend → backend wrapper)

**Files:**
- Create: `src/lib/ai-client.ts`

- [ ] **Step 1: Implement**

```typescript
import { OperationGraphSchema } from '@/lib/operation-graph-schema';
import { ImageContextSchema } from '@/lib/image-context-schema';
import type { OperationGraph } from '@/types/operation-graph';
import type { ImageContext } from '@/types/image-context';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function createSession(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('image', blob, 'image.jpg');
  const response = await fetch(`${BASE_URL}/api/session`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`/api/session → ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { session_id: string };
  return body.session_id;
}

export async function analyzeImage(sessionId: string): Promise<ImageContext> {
  const raw = await postJson<unknown>('/api/analyze', { session_id: sessionId });
  return ImageContextSchema.parse(raw);
}

export async function generatePanel(sessionId: string, userGoal: string): Promise<OperationGraph> {
  const raw = await postJson<unknown>('/api/panel', { session_id: sessionId, user_goal: userGoal });
  return OperationGraphSchema.parse(raw);
}
```

- [ ] **Step 2: Add backend URL to `.env.example`** (root)

Create or append to `/Users/anton/Dev/Projects/editor/.env.example`:

```
VITE_AI_BACKEND_URL=http://127.0.0.1:8787
```

- [ ] **Step 3: Type-check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai-client.ts .env.example
git commit -m "feat: ai-client wrapper for /api/session, /api/analyze, /api/panel"
```

---

## Task 14: Image-context downscale utility

**Files:**
- Create: `src/lib/downscale-for-upload.ts`

- [ ] **Step 1: Implement**

```typescript
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.85;

export async function downscaleForUpload(source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  const sourceWidth = 'width' in source ? source.width : 0;
  const sourceHeight = 'height' in source ? source.height : 0;
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);

  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/downscale-for-upload.ts
git commit -m "feat: downscale-for-upload utility (1024px max edge, JPEG q0.85)"
```

---

## Task 15: `useImageContext` hook

**Files:**
- Create: `src/hooks/useImageContext.ts`
- Modify: `src/hooks/useFileIO.ts` (fire on image load)

- [ ] **Step 1: Create a small store slice for the AI session**

Add this to `src/hooks/useImageContext.ts`:

```typescript
import { create } from 'zustand';
import { analyzeImage, createSession } from '@/lib/ai-client';
import { downscaleForUpload } from '@/lib/downscale-for-upload';
import type { ImageContext } from '@/types/image-context';

interface AiSessionState {
  sessionId: string | null;
  context: ImageContext | null;
  status: 'idle' | 'uploading' | 'analysing' | 'ready' | 'error';
  error: string | null;
  uploadAndAnalyse: (source: ImageBitmap) => Promise<void>;
  reset: () => void;
}

export const useAiSession = create<AiSessionState>((set, get) => ({
  sessionId: null,
  context: null,
  status: 'idle',
  error: null,
  async uploadAndAnalyse(source) {
    set({ status: 'uploading', error: null, context: null, sessionId: null });
    try {
      const blob = await downscaleForUpload(source);
      const sessionId = await createSession(blob);
      set({ sessionId, status: 'analysing' });
      const context = await analyzeImage(sessionId);
      // Guard against the user loading another image while this resolves.
      if (get().sessionId !== sessionId) return;
      set({ context, status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },
  reset() {
    set({ sessionId: null, context: null, status: 'idle', error: null });
  },
}));
```

- [ ] **Step 2: Wire into `useFileIO`**

Find where `useFileIO.ts` resolves a loaded `ImageBitmap`. Inject a call to `useAiSession.getState().uploadAndAnalyse(bitmap)` after the image is set on the layer model. Do not await it — fire and forget.

(If you can't immediately locate the right point, run:
```bash
grep -n 'createImageBitmap\|ImageBitmap' src/hooks/useFileIO.ts
```
and add the call directly after the bitmap becomes available for the source layer.)

- [ ] **Step 3: Type-check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useImageContext.ts src/hooks/useFileIO.ts
git commit -m "feat: useAiSession Zustand store; auto-upload + analyse on image load"
```

---

## Task 16: `AnalyseIndicator` primitive

**Files:**
- Create: `src/components/ui/AnalyseIndicator.tsx`
- Modify: `src/components/inspector/InspectorPanel.tsx` (place it)

- [ ] **Step 1: Implement the primitive**

```tsx
import { Sparkles, Loader2, CircleX } from 'lucide-react';
import { useAiSession } from '@/hooks/useImageContext';

export function AnalyseIndicator() {
  const status = useAiSession((s) => s.status);
  const error = useAiSession((s) => s.error);

  if (status === 'idle') return null;

  const icon = (() => {
    if (status === 'uploading' || status === 'analysing') return <Loader2 className="h-3 w-3 animate-spin" />;
    if (status === 'ready') return <Sparkles className="h-3 w-3" />;
    return <CircleX className="h-3 w-3" />;
  })();

  const label = (() => {
    if (status === 'uploading') return 'Uploading image…';
    if (status === 'analysing') return 'Analysing image…';
    if (status === 'ready') return 'Image context ready';
    return error ?? 'Analysis failed';
  })();

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 glass-panel px-2 py-1 flex items-center gap-1 text-[11px] text-text-secondary">
      {icon}
      <span>{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: Render in `EditorProvider` or top-level scaffold**

Find the editor root scaffold (`src/App.tsx` or `src/components/EditorProvider.tsx`) and add `<AnalyseIndicator />` inside the main editor surface. Do NOT inline-define it. Import the named export.

- [ ] **Step 3: Run check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/AnalyseIndicator.tsx src/App.tsx
git commit -m "feat(ui): AnalyseIndicator primitive surfaces upload/analyse status"
```

---

## Task 17: `ai-panel` layer + processing definition

**Files:**
- Modify: `src/store/layer-slice.ts`
- Modify: `src/types/processing.ts` (or wherever Layer is typed)
- Create: `src/processing/ai-panel.tsx`
- Modify: `src/processing/index.ts`

- [ ] **Step 1: Inspect the current Layer type**

```bash
grep -rn 'interface Layer\|type Layer' src/store src/types | head -20
```

Identify the Layer interface. Note its `type`, `adjustments`, `visible`, `opacity` fields.

- [ ] **Step 2: Extend Layer to carry an optional Operation Graph + panel bindings**

In the file that defines `Layer`, add to the interface:

```typescript
import type { OperationGraph, PanelBinding } from '@/types/operation-graph';

// inside the Layer interface (extend, don't replace):
//   operationGraph?: OperationGraph;
//   panelBindings?: PanelBinding[];
```

These are populated only on `ai-panel` layers.

- [ ] **Step 2b: Extend Adjustment with optional aiSource provenance**

Locate the `Adjustment` interface (likely in `src/types/processing.ts` or `src/store/layer-slice.ts`). Add the optional field:

```typescript
export interface AiSource {
  graphId: string;
  nodeId: string;
  label: string;
  reasoning?: string;
  modelName: string;
  modelVersion: string;
  generatedAt: string;
}

// inside Adjustment interface:
//   aiSource?: AiSource;
```

The field is optional in Phase 1 (only `ai-panel`-derived adjustments populate it). Phase 3 will wire it through history serialisation and the inspector reasoning badge.

- [ ] **Step 3: Add the `ai-panel` processing definition**

`src/processing/ai-panel.tsx`:

```tsx
import { useEditorStore } from '@/store';
import type { ProcessingDefinition } from '@/types/processing';
import { AiPanelSection } from '@/components/inspector/AiPanelSection';

export const aiPanelProcessing: ProcessingDefinition = {
  id: 'ai-panel',
  label: 'AI Suggestion',
  category: 'ai',
  // No params of its own — bindings come from the layer's operationGraph.
  paramKeys: [],
  Panel({ layerId }) {
    return <AiPanelSection layerId={layerId} />;
  },
};
```

(If `ProcessingDefinition`'s `category` doesn't already accept `'ai'`, leave it as `'basic'` or extend the union. Verify by grepping for the current `category` type.)

- [ ] **Step 4: Register in `src/processing/index.ts`**

Add to the existing registration call:

```typescript
import { aiPanelProcessing } from './ai-panel';
// inside registerAllProcessing():
ProcessingRegistry.register(aiPanelProcessing);
```

- [ ] **Step 5: Run check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/processing/ai-panel.tsx src/processing/index.ts src/store/layer-slice.ts src/types/processing.ts
git commit -m "feat: register ai-panel processing definition; extend Layer with operationGraph + bindings"
```

---

## Task 18: `AiPanelSection` level-2 component

**Files:**
- Create: `src/components/inspector/AiPanelSection.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEditorStore } from '@/store';
import { AdjustmentSlider } from './AdjustmentSlider';
import { ReasoningBadge } from '@/components/ui/ReasoningBadge';

interface AiPanelSectionProps {
  layerId: string;
}

export function AiPanelSection({ layerId }: AiPanelSectionProps) {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === layerId));
  if (!layer || layer.type !== 'ai-panel' || !layer.panelBindings) return null;

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-text-secondary">
        <span>AI suggestion:</span>
        <span className="text-text-primary">{layer.operationGraph?.userGoal ?? '—'}</span>
      </div>
      {layer.panelBindings.map((binding) => (
        <div key={`${binding.nodeId}-${binding.paramKey}`} className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-primary">{binding.label}</span>
            {binding.reasoning && <ReasoningBadge reasoning={binding.reasoning} />}
          </div>
          <AdjustmentSlider
            layerId={layerId}
            adjustmentType={layer.operationGraph?.nodes.find((n) => n.id === binding.nodeId)?.type ?? 'basic'}
            paramKey={binding.paramKey}
            min={binding.min ?? 0}
            max={binding.max ?? 100}
            step={binding.step ?? 1}
          />
        </div>
      ))}
    </div>
  );
}
```

(`AdjustmentSlider` already exists per `src/components/inspector/`. Its prop signature may differ — adjust the call to match. Run `head -40 src/components/inspector/AdjustmentSlider.tsx` to confirm.)

- [ ] **Step 2: Run check**

```bash
npm run check
```

Expected: passes (assuming `AdjustmentSlider` signature matches; if not, fix the call and re-run).

- [ ] **Step 3: Commit**

```bash
git add src/components/inspector/AiPanelSection.tsx
git commit -m "feat(inspector): AiPanelSection renders ai-panel layer bindings"
```

---

## Task 19: `ReasoningBadge` primitive

**Files:**
- Create: `src/components/ui/ReasoningBadge.tsx`
- Verify: Radix Tooltip is available (it's in package.json already).

- [ ] **Step 1: Implement**

```tsx
import { Sparkles } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';

interface ReasoningBadgeProps {
  reasoning: string;
  modelName?: string;
  timestamp?: string;
}

export function ReasoningBadge({ reasoning, modelName, timestamp }: ReasoningBadgeProps) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-[14px] items-center gap-px rounded-[6px] bg-surface-secondary/60 px-1 text-[10px] text-text-secondary"
          >
            <Sparkles className="h-2.5 w-2.5" />
            <span>AI</span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={4}
            className="glass-panel max-w-[240px] px-2 py-1 text-[11px] text-text-primary"
          >
            <p>{reasoning}</p>
            {(modelName || timestamp) && (
              <p className="mt-1 text-[10px] text-text-secondary">
                {modelName ?? ''}
                {modelName && timestamp ? ' · ' : ''}
                {timestamp ?? ''}
              </p>
            )}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
```

- [ ] **Step 2: Run check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/ReasoningBadge.tsx
git commit -m "feat(ui): ReasoningBadge primitive with Radix Tooltip"
```

---

## Task 20: `CommandPalette` primitive

**Files:**
- Create: `src/components/ui/CommandPalette.tsx`
- Modify: `src/components/EditorProvider.tsx` or `App.tsx` (mount + Cmd+K shortcut)

- [ ] **Step 1: Implement the palette**

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CommandPalette({ open, onClose, onSubmit, placeholder = 'Describe your edit…', disabled }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) {
      setValue('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-start justify-center pt-[20vh] bg-black/20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.form
            className="glass-panel w-[480px] px-3 py-2"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-secondary outline-none"
            />
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Mount + wire Cmd+K + submit handler**

In `src/components/EditorProvider.tsx` (or `App.tsx`), add:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { useAiSession } from '@/hooks/useImageContext';
import { generatePanel } from '@/lib/ai-client';
import { addAiPanelLayer } from '@/store/ai-panel-actions';

// inside the provider/component body:
const [paletteOpen, setPaletteOpen] = useState(false);
const sessionId = useAiSession((s) => s.sessionId);

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen(true);
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);

const handleSubmit = useCallback(async (text: string) => {
  if (!sessionId) return;
  try {
    const graph = await generatePanel(sessionId, text);
    addAiPanelLayer(graph);
  } catch (err) {
    console.error(err);
  }
}, [sessionId]);

// in the JSX:
<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSubmit={handleSubmit} disabled={!sessionId} />
```

- [ ] **Step 3: Implement `addAiPanelLayer`**

Create `src/store/ai-panel-actions.ts`:

```typescript
import { useEditorStore } from '@/store';
import type { OperationGraph } from '@/types/operation-graph';

let counter = 0;

export function addAiPanelLayer(graph: OperationGraph): void {
  const id = `ai-panel-${Date.now()}-${++counter}`;
  useEditorStore.getState().addLayer({
    id,
    type: 'ai-panel',
    name: graph.userGoal,
    visible: true,
    opacity: 1,
    adjustments: graph.nodes.map((n) => ({
      id: `${id}-${n.id}`,
      type: n.type,
      params: { ...n.params },
      aiSource: {
        graphId: graph.id,
        nodeId: n.id,
        label: graph.panelBindings.find((b) => b.nodeId === n.id)?.label ?? n.type,
        reasoning: graph.reasoning,
        modelName: graph.metadata.model_name ?? '',
        modelVersion: graph.metadata.model_version ?? '',
        generatedAt: new Date().toISOString(),
      },
    })),
    operationGraph: graph,
    panelBindings: graph.panelBindings,
  });
}
```

(`useEditorStore.getState().addLayer(...)` signature may differ; adapt to the existing API. Run `grep -n 'addLayer' src/store/*.ts` to confirm.)

- [ ] **Step 4: Run check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/CommandPalette.tsx src/components/EditorProvider.tsx src/store/ai-panel-actions.ts
git commit -m "feat: Cmd+K command palette; submits goal → /api/panel → new ai-panel layer"
```

---

## Task 21: Two-region InspectorPanel

**Files:**
- Modify: `src/components/inspector/InspectorPanel.tsx`

- [ ] **Step 1: Add AI panel section below the standard panel**

Read the current file; locate the rendered `processingDef.Panel` / `OptionsPanel`. After that JSX, add:

```tsx
// Render AI panel layers below the standard panel.
const aiPanelLayers = useEditorStore((s) => s.layers.filter((l) => l.type === 'ai-panel' && l.visible));

// In the JSX, after the standard panel block:
{aiPanelLayers.length > 0 && (
  <div className="border-t border-separator">
    {aiPanelLayers.map((layer) => (
      <div key={layer.id} className="border-b border-separator last:border-b-0">
        <AiPanelSection layerId={layer.id} />
      </div>
    ))}
  </div>
)}
```

Import `AiPanelSection` from `./AiPanelSection`.

- [ ] **Step 2: Run check**

```bash
npm run check
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/inspector/InspectorPanel.tsx
git commit -m "feat(inspector): two-region layout — standard panel above, AI panels below"
```

---

## Task 22: Bootstrap script + root README update

**Files:**
- Modify: `package.json` (add `dev:backend`)
- Modify (or create): root `README.md` section explaining the AI-layer dev loop

- [ ] **Step 1: Add convenience script**

In `package.json` `"scripts"`:

```json
"dev:backend": "cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --host 127.0.0.1 --port 8787"
```

(Note: shell-specific. Document in README; users on Windows will need a different invocation.)

- [ ] **Step 2: Add an "AI dev loop" section to root README**

If `README.md` doesn't exist or has no dev section, add at top:

```markdown
## AI dev loop (Phase 1)

Two processes:

```bash
# Terminal 1 — backend (Python)
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env  # fill in ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8787

# Terminal 2 — frontend (Vite)
npm install
cp .env.example .env  # only needed if backend URL changes
npm run dev
```

Open the editor, load an image — you should see an "Analysing image…" indicator
turn to "Image context ready" within ~3s. Press Cmd+K, type a goal, and an AI
panel should appear in the inspector.
```

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "docs: AI dev-loop instructions; npm run dev:backend"
```

---

## Task 23: Manual exit-criteria verification

This task has no code — it is the gate that signals Phase 1 is done.

- [ ] **Step 1: Start both processes**

Terminal 1: `npm run dev:backend`
Terminal 2: `npm run dev`

- [ ] **Step 2: Verify image upload + analyse**

- Load any JPEG into the editor.
- Indicator appears: "Uploading image…" → "Analysing image…" → "Image context ready" within ~5 s.
- If it errors, check backend terminal for stack trace.

- [ ] **Step 3: Verify Cmd+K → AI panel**

- Press Cmd+K. Palette appears centred at top.
- Type "make it warmer". Hit Enter.
- Within ~5 s, a new AI panel appears in the inspector below the standard tool panel.
- The panel has at least one labelled control (e.g. "warm cast").

- [ ] **Step 4: Verify the control affects the image and Cmd+Z reverts**

- Drag the control. The image updates.
- Press Cmd+Z. The AI panel disappears OR its effect reverts (depending on how the existing undo system serialises layer adds — currently flat stack, will be refined in Phase 2).

- [ ] **Step 5: Verify enforcement**

Run:
```bash
npm run check
```

Expected: green.

Run:
```bash
cd backend && source .venv/bin/activate && pytest -v && cd ..
```

Expected: all green.

- [ ] **Step 6: Tag the Phase 1 completion**

```bash
git tag phase-1-thin-slice
git log --oneline phase-1-thin-slice~25..phase-1-thin-slice
```

(Adjust the `~25` based on actual commit count; should be ~22 from this plan.)

---

## Self-Review (Spec Coverage Check)

Mapping each Phase 1 spec deliverable to plan tasks:

| Spec deliverable (§4 Phase 1) | Task(s) |
|---|---|
| Component-architecture enforcement (ESLint rule + `npm run check` + pre-commit) | T1, T2, T3, T4 |
| Operation Graph contract: TS types, Zod, Pydantic | T6 (backend), T12 (frontend) |
| Backend scaffold: FastAPI + three endpoints + refine stub | T5, T9, T10, T11 |
| Anthropic SDK integration with structured tool use | T8 |
| Prompt caching (image + system prompt cached at prefix) | T8 (`cache_control` markers) |
| Image context pre-computation: downscale, /api/session, /api/analyze, store in session | T7, T9, T10, T14, T15 |
| Frontend AI plumbing: CommandPalette primitive, AiPanelSection, useImageContext, ai-panel layer + processing def | T15, T16, T17, T18, T19, T20, T21 |
| One revertable adjustment through existing pipeline | T20 + T23 verification |
| Bootstrap: .env.example, README, dev:backend script | T5, T13, T22 |

All Phase 1 deliverables covered. The integration into existing `useFileIO` (T15 Step 2) and `addLayer` (T20 Step 3) are intentionally light-touch because the existing code shape is unknown without reading it; both steps include a `grep` instruction to confirm the right signature before editing.

**Gaps explicitly deferred (per spec):** SAM segmentation, reasoning badges actually populated end-to-end with model reasoning (`ReasoningBadge` primitive exists but the wiring to display per-control reasoning is in P3), provenance round-trip through history, multi-panel coexistence rules, `/api/refine` implementation, "reset to model suggestion", three revert granularities (only standard undo + slider override are wired in P1).
