import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MarkerDot } from './MarkerDot';
import type { Widget } from '@/types/widget';

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w', intent: 'test',
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', prompt: 't', parent_widget_id: null },
    op_id: 'grain',
    composed: false,
    nodes: [], bindings: [],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [], status: 'active', revision: 1,
    locked_params: [],
    display_name: null, category: 'texture',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('MarkerDot', () => {
  it('renders a 16x16 SVG circle', () => {
    const { container } = render(<MarkerDot widget={makeWidget()} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
  });

  it('uses category color for texture (yellow)', () => {
    const { container } = render(<MarkerDot widget={makeWidget({ category: 'texture' })} />);
    const fill = container.querySelector('circle')?.getAttribute('fill');
    expect(fill).toBe('#eab308');
  });

  it('uses category color for mood (purple)', () => {
    const { container } = render(<MarkerDot widget={makeWidget({ category: 'mood' })} />);
    const fill = container.querySelector('circle')?.getAttribute('fill');
    expect(fill).toBe('#6d5cff');
  });

  it('falls back to mood color when category is null', () => {
    const { container } = render(<MarkerDot widget={makeWidget({ category: null })} />);
    const fill = container.querySelector('circle')?.getAttribute('fill');
    expect(fill).toBe('#6d5cff');
  });

  it('falls back to mood color when category is unknown', () => {
    const { container } = render(<MarkerDot widget={makeWidget({ category: 'made_up_category' })} />);
    const fill = container.querySelector('circle')?.getAttribute('fill');
    expect(fill).toBe('#6d5cff');
  });
});
