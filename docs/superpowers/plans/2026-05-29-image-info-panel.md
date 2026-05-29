# Image Info Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Info" tab to the Inspector that visualizes the full `EnrichedImageContext` (semantic, histograms, color, regions, problems).

**Architecture:** A 2-state tab switcher at the top of `InspectorPanel` toggles between today's adjustment stack and a new `InfoTab`. The Info tab reads `useBackendState.snapshot.image_context` via a new selector hook, narrows the `unknown` payload to a frontend-typed `EnrichedImageContext`, and renders four section components that compose three new visualization primitives (`Histogram`, `Swatch`, `PercentBar`).

**Tech Stack:** React 19, TypeScript strict, Tailwind tokens, Radix `ToggleGroup`, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-29-image-info-panel-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/types/enriched-context.ts` | Create | Frontend mirror of `EnrichedImageContext` |
| `src/hooks/useImageContextFull.ts` | Create | Selector hook returning `EnrichedImageContext \| null` |
| `src/components/ui/Histogram.tsx` | Create | SVG-path histogram primitive |
| `src/components/ui/Histogram.test.tsx` | Create | Unit tests |
| `src/components/ui/Swatch.tsx` | Create | Single color square |
| `src/components/ui/Swatch.test.tsx` | Create | Unit tests |
| `src/components/ui/PercentBar.tsx` | Create | Filled horizontal bar |
| `src/components/ui/PercentBar.test.tsx` | Create | Unit tests |
| `src/components/inspector/info/__fixtures__/enriched-context.ts` | Create | `makeFullContext` / `makePartialContext` factories |
| `src/components/inspector/info/SemanticSection.tsx` | Create | Subjects, mood, lighting, dominantTones, grade_character |
| `src/components/inspector/info/HistogramsSection.tsx` | Create | Luma + RGB histograms, clipping bars, median/contrast numbers |
| `src/components/inspector/info/ColorSection.tsx` | Create | Palette swatches, white point, cast a*/b* dot |
| `src/components/inspector/info/RegionsSection.tsx` | Create | Region rows + problems list |
| `src/components/inspector/info/InfoTab.tsx` | Create | Composes all four sections; reads `useImageContextFull` |
| `src/components/inspector/info/InfoTab.test.tsx` | Create | Empty state + complete + partial fixture tests |
| `src/components/inspector/InspectorPanel.tsx` | Modify | Add `tab` state + `ToggleGroup` switcher |

---

## Task 1: Type + selector hook for the full image context

Frontend mirror of the backend's `EnrichedImageContext`, plus the selector hook the new components will use.

**Files:**
- Create: `src/types/enriched-context.ts`
- Create: `src/hooks/useImageContextFull.ts`

### Steps

- [ ] **Step 1: Create the type file**

Create `src/types/enriched-context.ts`:

```ts
import type { ImageContext } from './image-context';

export interface ColorSwatchData {
  rgb: [number, number, number];
  weight: number;
}

export type ProblemKind =
  | 'clipped_highlights'
  | 'crushed_shadows'
  | 'low_contrast'
  | 'strong_color_cast'
  | 'noisy_shadows'
  | 'uneven_white_balance';

export interface Problem {
  kind: ProblemKind;
  severity: number;
  region_label?: string | null;
  bbox?: [number, number, number, number] | null;
  suggested_fused_tools: string[];
}

export interface RegionStats {
  label: string;
  pixel_count: number;
  mean_luma: number;
  luma_histogram: number[];
  mean_rgb: [number, number, number];
  dominant_swatches: ColorSwatchData[];
  is_skin_likely: boolean;
  is_sky_likely: boolean;
  saturation_mean: number;
  contrast_p10_p90: number;
}

export interface EnrichedImageContext extends ImageContext {
  // Cheap mechanical pass
  luma_histogram: number[];
  rgb_histograms: { r?: number[]; g?: number[]; b?: number[] };
  clipped_shadows_pct: number;
  clipped_highlights_pct: number;
  median_luma: number;
  contrast_p10_p90: number;
  color_palette: ColorSwatchData[];
  cast_strength: number;
  cast_direction: [number, number];
  region_stats: RegionStats[];

  // Claude-augmented pass
  estimated_white_point: [number, number, number];
  wb_neutral_confidence: number;
  grade_character: string;
  problems: Problem[];
}
```

- [ ] **Step 2: Create the selector hook**

Create `src/hooks/useImageContextFull.ts`:

```ts
import { useBackendState } from '@/store/backend-state-slice';
import type { EnrichedImageContext } from '@/types/enriched-context';

/**
 * Returns the backend's image_context narrowed to EnrichedImageContext, or
 * null when no snapshot has arrived yet. The narrowing is intentionally
 * trusting — the contract is owned by the backend; if its shape drifts,
 * sections render best-effort.
 */
export function useImageContextFull(): EnrichedImageContext | null {
  return useBackendState((s) => {
    const ctx = s.snapshot?.image_context;
    return ctx ? (ctx as EnrichedImageContext) : null;
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/enriched-context.ts src/hooks/useImageContextFull.ts
git commit -m "feat(types): EnrichedImageContext + useImageContextFull selector"
```

---

## Task 2: Histogram primitive

SVG-path histogram. Pure presentational. Decorative — `aria-hidden`.

**Files:**
- Create: `src/components/ui/Histogram.tsx`
- Test: `src/components/ui/Histogram.test.tsx`

### Steps

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Histogram.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { Histogram } from './Histogram';

describe('Histogram', () => {
  afterEach(cleanup);

  it('renders an aria-hidden svg', () => {
    const { container } = render(<Histogram bins={[1, 2, 3]} color="#fff" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders a path whose fill matches the color prop', () => {
    const { container } = render(<Histogram bins={[1, 2, 3]} color="#abcdef" />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('#abcdef');
  });

  it('uses the bins length to set the viewBox width', () => {
    const { container } = render(<Histogram bins={[0, 0, 0, 0]} color="#fff" width={200} height={40} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 40');
  });

  it('renders nothing visible when bins are all zero (no NaN in path)', () => {
    const { container } = render(<Histogram bins={[0, 0, 0]} color="#fff" />);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    expect(d).not.toContain('NaN');
  });

  it('renders an empty path when bins is empty', () => {
    const { container } = render(<Histogram bins={[]} color="#fff" />);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    expect(d).toBe('');
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

Run: `npx vitest run src/components/ui/Histogram.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/components/ui/Histogram.tsx`:

```tsx
interface Props {
  bins: number[];
  color: string;
  width?: number;
  height?: number;
}

export function Histogram({ bins, color, width = 120, height = 40 }: Props) {
  const d = buildPath(bins, width, height);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <path d={d} fill={color} />
    </svg>
  );
}

function buildPath(bins: number[], width: number, height: number): string {
  if (bins.length === 0) return '';
  const max = bins.reduce((m, v) => (v > m ? v : m), 0);
  if (max === 0) {
    // Flat baseline — no peaks but a valid closed path.
    return `M0,${height} L${width},${height} Z`;
  }
  const stepX = width / bins.length;
  const parts: string[] = [`M0,${height}`];
  bins.forEach((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    parts.push(`L${x},${y}`);
  });
  parts.push(`L${width},${height}`, 'Z');
  return parts.join(' ');
}
```

- [ ] **Step 4: Run the tests — confirm pass**

Run: `npx vitest run src/components/ui/Histogram.test.tsx`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Histogram.tsx src/components/ui/Histogram.test.tsx
git commit -m "feat(ui): Histogram primitive (SVG path)"
```

---

## Task 3: Swatch primitive

Single color square. One DOM node.

**Files:**
- Create: `src/components/ui/Swatch.tsx`
- Test: `src/components/ui/Swatch.test.tsx`

### Steps

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Swatch.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Swatch } from './Swatch';

describe('Swatch', () => {
  afterEach(cleanup);

  it('renders a div with the given rgb background', () => {
    const { container } = render(<Swatch rgb={[255, 0, 128]} />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.backgroundColor).toBe('rgb(255, 0, 128)');
  });

  it('uses the size prop for width and height', () => {
    const { container } = render(<Swatch rgb={[0, 0, 0]} size={24} />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.width).toBe('24px');
    expect(div.style.height).toBe('24px');
  });

  it('sets a hex title attribute', () => {
    const { container } = render(<Swatch rgb={[255, 0, 128]} />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.getAttribute('title')).toBe('#ff0080');
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

Run: `npx vitest run src/components/ui/Swatch.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/components/ui/Swatch.tsx`:

```tsx
interface Props {
  rgb: [number, number, number];
  size?: number;
}

export function Swatch({ rgb, size = 16 }: Props) {
  const [r, g, b] = rgb;
  return (
    <div
      title={toHex(r, g, b)}
      style={{
        width: size,
        height: size,
        backgroundColor: `rgb(${r}, ${g}, ${b})`,
        borderRadius: 2,
      }}
    />
  );
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
```

- [ ] **Step 4: Run the tests — confirm pass**

Run: `npx vitest run src/components/ui/Swatch.test.tsx`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Swatch.tsx src/components/ui/Swatch.test.tsx
git commit -m "feat(ui): Swatch primitive"
```

---

## Task 4: PercentBar primitive

A 2 px-tall track with a colored fill. Optional label and numeric.

**Files:**
- Create: `src/components/ui/PercentBar.tsx`
- Test: `src/components/ui/PercentBar.test.tsx`

### Steps

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/PercentBar.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PercentBar } from './PercentBar';

describe('PercentBar', () => {
  afterEach(cleanup);

  it('renders an inner fill with the given pct as width', () => {
    const { container } = render(<PercentBar pct={42} color="#0f0" />);
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('42%');
  });

  it('clamps negative pct to 0%', () => {
    const { container } = render(<PercentBar pct={-5} color="#0f0" />);
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('clamps pct over 100 to 100%', () => {
    const { container } = render(<PercentBar pct={150} color="#0f0" />);
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('renders the label and a 1-decimal numeric when label is supplied', () => {
    render(<PercentBar pct={42.34} color="#0f0" label="Clipped shadows" />);
    expect(screen.getByText('Clipped shadows')).not.toBeNull();
    expect(screen.getByText('42.3%')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

Run: `npx vitest run src/components/ui/PercentBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/components/ui/PercentBar.tsx`:

```tsx
interface Props {
  pct: number;
  color: string;
  label?: string;
}

export function PercentBar({ pct, color, label }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2 text-[10px] text-text-secondary">
      {label && <span className="flex-1 truncate">{label}</span>}
      <div className="flex-1 h-0.5 bg-surface-secondary rounded">
        <div
          data-fill
          style={{ width: `${clamped}%`, height: '100%', backgroundColor: color, borderRadius: 2 }}
        />
      </div>
      {label && <span className="w-10 text-right tabular-nums">{clamped.toFixed(1)}%</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests — confirm pass**

Run: `npx vitest run src/components/ui/PercentBar.test.tsx`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/PercentBar.tsx src/components/ui/PercentBar.test.tsx
git commit -m "feat(ui): PercentBar primitive"
```

---

## Task 5: Fixtures + SemanticSection

The fixtures are reused by `InfoTab.test.tsx` (Task 9). Build them with the first consumer.

**Files:**
- Create: `src/components/inspector/info/__fixtures__/enriched-context.ts`
- Create: `src/components/inspector/info/SemanticSection.tsx`

### Steps

- [ ] **Step 1: Write the fixtures**

Create `src/components/inspector/info/__fixtures__/enriched-context.ts`:

```ts
import type { EnrichedImageContext } from '@/types/enriched-context';

export function makeFullContext(): EnrichedImageContext {
  return {
    // v1 ImageContext
    subjects: ['train station platform at night', 'black locomotive'],
    lighting: 'mixed',
    dominantTones: ['shadows', 'midtones'],
    mood: 'quiet, moody, nocturnal',
    candidateRegions: [
      { label: 'sky', description: 'overcast night sky', bbox: [0, 0, 1, 0.3] },
      { label: 'locomotive', description: 'black engine, foreground', bbox: [0.2, 0.4, 0.5, 0.5] },
    ],
    modelName: 'claude',
    modelVersion: 'sonnet-4.5',
    generatedAt: '2026-05-29T00:00:00Z',
    // mechanical
    luma_histogram: Array.from({ length: 256 }, (_, i) => Math.round(Math.sin(i / 20) * 50 + 60)),
    rgb_histograms: {
      r: Array.from({ length: 256 }, (_, i) => 30 + (i % 17)),
      g: Array.from({ length: 256 }, (_, i) => 40 + (i % 13)),
      b: Array.from({ length: 256 }, (_, i) => 50 + (i % 11)),
    },
    clipped_shadows_pct: 2.5,
    clipped_highlights_pct: 0.7,
    median_luma: 0.42,
    contrast_p10_p90: 0.31,
    color_palette: [
      { rgb: [20, 22, 30], weight: 0.45 },
      { rgb: [120, 90, 60], weight: 0.25 },
      { rgb: [200, 60, 60], weight: 0.18 },
      { rgb: [220, 220, 230], weight: 0.12 },
    ],
    cast_strength: 0.35,
    cast_direction: [12, -8],
    region_stats: [],
    // Claude-augmented
    estimated_white_point: [248, 244, 240],
    wb_neutral_confidence: 0.78,
    grade_character: 'cool teal-orange',
    problems: [
      { kind: 'crushed_shadows', severity: 0.6, region_label: 'foreground', suggested_fused_tools: ['shadows_lift'] },
    ],
  };
}

export function makePartialContext(): EnrichedImageContext {
  // Mechanical pass done, Claude pass not yet.
  const full = makeFullContext();
  return {
    ...full,
    grade_character: 'neutral',
    problems: [],
  };
}
```

- [ ] **Step 2: Write the SemanticSection**

Create `src/components/inspector/info/SemanticSection.tsx`:

```tsx
import type { EnrichedImageContext } from '@/types/enriched-context';

interface Props {
  ctx: EnrichedImageContext;
}

export function SemanticSection({ ctx }: Props) {
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5">
        Semantic
      </div>
      <Chips items={ctx.subjects} />
      <Chips items={ctx.dominantTones} muted />
      <Row k="Lighting" v={ctx.lighting} />
      <Row k="Mood" v={ctx.mood} />
      {ctx.grade_character && ctx.grade_character !== 'neutral' && (
        <Row k="Grade" v={ctx.grade_character} />
      )}
    </section>
  );
}

function Chips({ items, muted }: { items: string[]; muted?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {items.map((s) => (
        <span
          key={s}
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            muted ? 'bg-surface-secondary text-text-secondary' : 'bg-accent/20 text-text-primary'
          }`}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-[10px] mb-0.5">
      <span className="text-text-secondary">{k}</span>
      <span className="text-text-primary">{v}</span>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/inspector/info/__fixtures__/enriched-context.ts src/components/inspector/info/SemanticSection.tsx
git commit -m "feat(inspector-info): fixtures + SemanticSection"
```

---

## Task 6: HistogramsSection

Stacked Histograms (luma + R/G/B), clipping bars, median/contrast rows.

**Files:**
- Create: `src/components/inspector/info/HistogramsSection.tsx`

### Steps

- [ ] **Step 1: Write the implementation**

Create `src/components/inspector/info/HistogramsSection.tsx`:

```tsx
import type { EnrichedImageContext } from '@/types/enriched-context';
import { Histogram } from '@/components/ui/Histogram';
import { PercentBar } from '@/components/ui/PercentBar';

interface Props {
  ctx: EnrichedImageContext;
}

export function HistogramsSection({ ctx }: Props) {
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5">
        Histograms
      </div>
      <div className="flex flex-col gap-1 mb-2">
        <Histogram bins={ctx.luma_histogram} color="rgba(255,255,255,0.7)" />
        {ctx.rgb_histograms.r && <Histogram bins={ctx.rgb_histograms.r} color="rgba(239,68,68,0.7)" />}
        {ctx.rgb_histograms.g && <Histogram bins={ctx.rgb_histograms.g} color="rgba(34,197,94,0.7)" />}
        {ctx.rgb_histograms.b && <Histogram bins={ctx.rgb_histograms.b} color="rgba(59,130,246,0.7)" />}
      </div>
      <div className="flex flex-col gap-1 mb-1.5">
        <PercentBar pct={ctx.clipped_shadows_pct} color="#3b82f6" label="Clipped shadows" />
        <PercentBar pct={ctx.clipped_highlights_pct} color="#f59e0b" label="Clipped highlights" />
      </div>
      <Row k="Median luma" v={ctx.median_luma.toFixed(2)} />
      <Row k="Contrast (p10–p90)" v={ctx.contrast_p10_p90.toFixed(2)} />
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-[10px] mb-0.5">
      <span className="text-text-secondary">{k}</span>
      <span className="text-text-primary tabular-nums">{v}</span>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inspector/info/HistogramsSection.tsx
git commit -m "feat(inspector-info): HistogramsSection"
```

---

## Task 7: ColorSection

Palette swatches, white point, cast a*/b* dot.

**Files:**
- Create: `src/components/inspector/info/ColorSection.tsx`

### Steps

- [ ] **Step 1: Write the implementation**

Create `src/components/inspector/info/ColorSection.tsx`:

```tsx
import type { EnrichedImageContext } from '@/types/enriched-context';
import { Swatch } from '@/components/ui/Swatch';

interface Props {
  ctx: EnrichedImageContext;
}

// Lab a*/b* are theoretically unbounded but typical natural images stay
// within ±50. Beyond that we clamp.
const AB_RANGE = 50;
const CAST_BOX_SIZE = 60;

export function ColorSection({ ctx }: Props) {
  const [r, g, b] = ctx.estimated_white_point;
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5">
        Color
      </div>
      {ctx.color_palette.length > 0 && (
        <div className="flex h-4 mb-2 rounded overflow-hidden">
          {ctx.color_palette.map((s, i) => (
            <div
              key={i}
              style={{
                flexGrow: Math.max(s.weight, 0.02),
                minWidth: 8,
                backgroundColor: `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`,
              }}
              title={`#${hex(s.rgb[0])}${hex(s.rgb[1])}${hex(s.rgb[2])} · ${(s.weight * 100).toFixed(0)}%`}
            />
          ))}
        </div>
      )}
      <Row k="White point">
        <span className="flex items-center gap-1 text-text-primary">
          <Swatch rgb={ctx.estimated_white_point} size={10} />
          <span className="tabular-nums">rgb({Math.round(r)}, {Math.round(g)}, {Math.round(b)})</span>
        </span>
      </Row>
      <Row k="WB confidence">
        <span className="text-text-primary tabular-nums">{(ctx.wb_neutral_confidence * 100).toFixed(0)}%</span>
      </Row>
      {ctx.cast_strength > 0 && <CastDot direction={ctx.cast_direction} strength={ctx.cast_strength} />}
    </section>
  );
}

function CastDot({ direction, strength }: { direction: [number, number]; strength: number }) {
  const ax = clamp(direction[0], -AB_RANGE, AB_RANGE);
  const ay = clamp(direction[1], -AB_RANGE, AB_RANGE);
  const x = ((ax + AB_RANGE) / (2 * AB_RANGE)) * CAST_BOX_SIZE;
  const y = ((ay + AB_RANGE) / (2 * AB_RANGE)) * CAST_BOX_SIZE;
  return (
    <div className="mt-2">
      <div className="text-[9px] text-text-secondary mb-1">Color cast (a*/b*)</div>
      <div
        className="relative bg-surface-secondary rounded"
        style={{ width: CAST_BOX_SIZE, height: CAST_BOX_SIZE }}
      >
        <div className="absolute top-1/2 left-0 right-0 h-px bg-separator" />
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-separator" />
        <div
          className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-accent"
          style={{ left: x, top: y, opacity: strength }}
        />
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-[10px] mb-0.5">
      <span className="text-text-secondary">{k}</span>
      {children}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inspector/info/ColorSection.tsx
git commit -m "feat(inspector-info): ColorSection"
```

---

## Task 8: RegionsSection

Region rows with mask thumbnails + problems list.

**Files:**
- Create: `src/components/inspector/info/RegionsSection.tsx`

### Steps

- [ ] **Step 1: Write the implementation**

Create `src/components/inspector/info/RegionsSection.tsx`:

```tsx
import type { EnrichedImageContext } from '@/types/enriched-context';
import type { CandidateRegion } from '@/types/image-context';
import type { Problem } from '@/types/enriched-context';
import { PercentBar } from '@/components/ui/PercentBar';

interface Props {
  ctx: EnrichedImageContext;
}

export function RegionsSection({ ctx }: Props) {
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1.5">
        Regions
        <span className="bg-surface-secondary px-1 rounded text-[8px]">{ctx.candidateRegions.length}</span>
      </div>
      {ctx.candidateRegions.map((r) => (
        <RegionRow key={`${r.label}-${r.description}`} region={r} />
      ))}
      {ctx.problems.length > 0 && (
        <>
          <div className="text-[9px] uppercase tracking-wide text-text-secondary mt-3 mb-1.5 flex items-center gap-1.5">
            Problems
            <span className="bg-surface-secondary px-1 rounded text-[8px]">{ctx.problems.length}</span>
          </div>
          {ctx.problems.map((p, i) => (
            <ProblemRow key={i} problem={p} />
          ))}
        </>
      )}
    </section>
  );
}

function RegionRow({ region }: { region: CandidateRegion }) {
  const src = region.maskPngBase64 ? `data:image/png;base64,${region.maskPngBase64}` : null;
  return (
    <div className="flex gap-2 items-start py-1">
      {src ? (
        <img src={src} alt="" className="w-8 h-8 rounded bg-surface-secondary object-cover" />
      ) : (
        <div className="w-8 h-8 rounded bg-surface-secondary" aria-hidden="true" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-text-primary truncate">{region.label}</div>
        <div className="text-[9px] text-text-secondary truncate">{region.description}</div>
      </div>
    </div>
  );
}

function ProblemRow({ problem }: { problem: Problem }) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[8px] uppercase tracking-wide px-1 py-0.5 bg-surface-secondary text-text-primary rounded">
          {problem.kind.replace(/_/g, ' ')}
        </span>
        {problem.region_label && (
          <span className="text-[9px] text-text-secondary">@ {problem.region_label}</span>
        )}
      </div>
      <PercentBar pct={problem.severity * 100} color="#f59e0b" label="Severity" />
      {problem.suggested_fused_tools.length > 0 && (
        <div className="text-[9px] text-text-secondary mt-0.5">
          Suggested: {problem.suggested_fused_tools.join(', ')}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/inspector/info/RegionsSection.tsx
git commit -m "feat(inspector-info): RegionsSection"
```

---

## Task 9: InfoTab + InspectorPanel tab switcher

Compose the four sections, add the tab switcher, write tests.

**Files:**
- Create: `src/components/inspector/info/InfoTab.tsx`
- Test: `src/components/inspector/info/InfoTab.test.tsx`
- Modify: `src/components/inspector/InspectorPanel.tsx`

### Steps

- [ ] **Step 1: Write the InfoTab implementation**

Create `src/components/inspector/info/InfoTab.tsx`:

```tsx
import { useImageContextFull } from '@/hooks/useImageContextFull';
import { SemanticSection } from './SemanticSection';
import { HistogramsSection } from './HistogramsSection';
import { ColorSection } from './ColorSection';
import { RegionsSection } from './RegionsSection';

export function InfoTab() {
  const ctx = useImageContextFull();
  if (!ctx) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-[10px] text-text-secondary">
        No image loaded.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <SemanticSection ctx={ctx} />
      <HistogramsSection ctx={ctx} />
      <ColorSection ctx={ctx} />
      <RegionsSection ctx={ctx} />
    </div>
  );
}
```

- [ ] **Step 2: Write the InfoTab test**

Create `src/components/inspector/info/InfoTab.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useBackendState } from '@/store/backend-state-slice';
import { InfoTab } from './InfoTab';
import { makeFullContext, makePartialContext } from './__fixtures__/enriched-context';
import type { SessionStateSnapshot } from '@/types/widget';

function setSnapshotWithContext(ctx: unknown) {
  const snap: SessionStateSnapshot = {
    session_id: 's1',
    image_context: ctx,
    widgets: [],
    masks_index: [],
    operation_graph: {
      id: 'g',
      userGoal: null,
      reasoning: null,
      nodes: [],
      panelBindings: [],
      metadata: {},
    },
    revision: 1,
  };
  useBackendState.setState({ snapshot: snap });
}

describe('InfoTab', () => {
  beforeEach(() => {
    useBackendState.setState({ snapshot: null });
  });
  afterEach(cleanup);

  it('renders an empty state when no snapshot is present', () => {
    render(<InfoTab />);
    expect(screen.getByText('No image loaded.')).not.toBeNull();
  });

  it('renders an empty state when snapshot has no image_context', () => {
    setSnapshotWithContext(null);
    render(<InfoTab />);
    expect(screen.getByText('No image loaded.')).not.toBeNull();
  });

  it('renders all four sections for a complete context', () => {
    setSnapshotWithContext(makeFullContext());
    render(<InfoTab />);
    expect(screen.getByText('Semantic')).not.toBeNull();
    expect(screen.getByText('Histograms')).not.toBeNull();
    expect(screen.getByText('Color')).not.toBeNull();
    expect(screen.getByText('Regions')).not.toBeNull();
    // Problems sub-list rendered when problems exist
    expect(screen.getByText('Problems')).not.toBeNull();
  });

  it('renders without crashing for a partial context (no problems, neutral grade)', () => {
    setSnapshotWithContext(makePartialContext());
    render(<InfoTab />);
    expect(screen.getByText('Semantic')).not.toBeNull();
    // Problems sub-list omitted when empty
    expect(screen.queryByText('Problems')).toBeNull();
    // Grade row omitted when neutral
    expect(screen.queryByText('Grade')).toBeNull();
  });
});
```

- [ ] **Step 3: Run InfoTab tests — confirm pass**

Run: `npx vitest run src/components/inspector/info/InfoTab.test.tsx`
Expected: 4/4 pass.

- [ ] **Step 4: Add the tab switcher to InspectorPanel**

Replace the entire contents of `src/components/inspector/InspectorPanel.tsx` with:

```tsx
import { useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { SuggestionsSection } from './SuggestionsSection';
import { ActiveSection } from './ActiveSection';
import { LayersSection } from './LayersSection';
import { InfoTab } from './info/InfoTab';

type Tab = 'adjustments' | 'info';

export function InspectorPanel() {
  const [tab, setTab] = useState<Tab>('adjustments');
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ToggleGroup.Root
        type="single"
        value={tab}
        onValueChange={(v) => v && setTab(v as Tab)}
        className="flex border-b border-separator"
      >
        <TabButton value="adjustments" label="Adjustments" active={tab === 'adjustments'} />
        <TabButton value="info" label="Info" active={tab === 'info'} />
      </ToggleGroup.Root>
      {tab === 'adjustments' ? (
        <>
          <SuggestionsSection />
          <ActiveSection />
          <LayersSection />
        </>
      ) : (
        <InfoTab />
      )}
    </div>
  );
}

function TabButton({ value, label, active }: { value: string; label: string; active: boolean }) {
  return (
    <ToggleGroup.Item
      value={value}
      className={`flex-1 text-[10px] py-1.5 transition-colors ${
        active ? 'text-text-primary bg-surface-secondary' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
    </ToggleGroup.Item>
  );
}

export const InspectorPanelBody = InspectorPanel;
```

- [ ] **Step 5: Extend `InspectorPanel.test.tsx` with the tab toggle**

Append the following `describe` block to the end of `src/components/inspector/InspectorPanel.test.tsx` (after the existing closing `});`):

```tsx
import userEvent from '@testing-library/user-event';

describe('InspectorPanel — tab switcher', () => {
  it('defaults to the Adjustments tab and shows Suggestions/Active/Layers', () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/suggestions/i)).toBeDefined();
    expect(screen.getByText(/^layers$/i)).toBeDefined();
  });

  it('clicking Info hides Suggestions and renders the Info empty state', async () => {
    const user = userEvent.setup();
    render(<InspectorPanel />);
    await user.click(screen.getByText('Info'));
    expect(screen.queryByText(/suggestions/i)).toBeNull();
    expect(screen.getByText('No image loaded.')).toBeDefined();
  });
});
```

If `userEvent` is already imported at the top of the file, just append the `describe` block without a second import statement.

- [ ] **Step 6: Run the full check**

Run: `npm run check`
Expected: tsc + eslint + all tests pass. Total test count rises by ~18 (5 Histogram + 3 Swatch + 4 PercentBar + 4 InfoTab + 2 tab switcher) over the prior baseline.

- [ ] **Step 7: Commit**

```bash
git add src/components/inspector/info/InfoTab.tsx src/components/inspector/info/InfoTab.test.tsx src/components/inspector/InspectorPanel.tsx src/components/inspector/InspectorPanel.test.tsx
git commit -m "feat(inspector): Info tab with image_context visualizations"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run the project check**

Run: `npm run check`
Expected: green; total test count ~134.

- [ ] **Step 2: Manual smoke test**

1. Start backend (`npm run dev:backend`) and frontend (`npm run dev`).
2. Open the editor, upload an image.
3. Wait for the analyze phases to complete (watch the status bar).
4. Open the Inspector. Click "Info" tab.
5. Expect: Semantic chips + key/value rows; luma + R/G/B histograms; clipping bars; palette swatch row; white point + WB confidence; cast a*/b* dot if cast is present; regions list with thumbnails; problems list (if Claude-augmented pass populated any).
6. Click "Adjustments" tab. Expect: original 3-section stack reappears unchanged.

- [ ] **Step 3: Manual partial-state check**

1. Reload the page mid-analyze (Cmd+R during phase progression).
2. Open the Info tab.
3. Expect: sections render whatever data has arrived; no crashes; problems sub-list only appears once present.

---

## Out of scope (do NOT do as part of this work)

- Region hover-to-highlight on canvas.
- Click-to-scope region selection.
- Problem-to-tool launch flow.
- Histogram tooltips / zoom / bin-count callouts.
- Persisting selected tab across sessions.
- Surfacing per-region `region_stats` deep-dive.
