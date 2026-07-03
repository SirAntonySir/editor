import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenfillWidgetBody } from './GenfillWidgetBody';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget, GenfillState, SessionStateSnapshot } from '@/types/widget';

vi.mock('@/store/genfill-actions', () => ({
  acceptGenfill: vi.fn(),
  discardGenfill: vi.fn(),
}));
vi.mock('@/lib/backend-tools', () => ({
  backendTools: { genfill_regenerate: vi.fn(async () => ({ ok: true })) },
}));
vi.mock('@/lib/genfill-asset', () => ({
  genfillAssetUrl: () => 'http://x/asset.png',
}));

function widgetWith(genfill: Partial<GenfillState>): Widget {
  return {
    id: 'w_gf_1', intent: 'Generative fill', scope: { kind: 'mask', mask_id: 'm1' },
    origin: { kind: 'tool_invoked' }, composed: false, nodes: [], bindings: [],
    preview: { kind: 'none', autoBeforeAfter: false }, rejectedAttempts: [],
    status: 'active', revision: 1, lockedParams: [],
    createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
    genfill: {
      status: 'compose', prompt: '', seed: 7, maskId: 'm1',
      imageNodeId: 'in-default', ...genfill,
    },
  } as Widget;
}

beforeEach(() => {
  useBackendState.getState().reset();
  useBackendState.setState({
    snapshot: { sessionId: 's1', widgets: [], masksIndex: [] } as unknown as SessionStateSnapshot,
  });
});

describe('GenfillWidgetBody', () => {
  it('compose state renders prompt input and Generate button', () => {
    render(<GenfillWidgetBody widget={widgetWith({ status: 'compose' })} />);
    expect(screen.getByPlaceholderText(/describe what to generate/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate/i })).toBeTruthy();
  });

  it('generating state disables regenerate and shows skeleton', () => {
    render(<GenfillWidgetBody widget={widgetWith({ status: 'generating', prompt: 'a boat' })} />);
    expect(screen.getByTestId('genfill-skeleton')).toBeTruthy();
    expect((screen.getByRole('button', { name: /regenerate/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ready state shows preview, clip toggle, Accept and Discard', () => {
    render(<GenfillWidgetBody widget={widgetWith({
      status: 'ready', prompt: 'a boat',
      result: { assetId: 'genfill-w_gf_1', width: 100, height: 50 },
    })} />);
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByLabelText(/clip to region/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /accept/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /discard/i })).toBeTruthy();
  });

  it('clip toggle is disabled when result dims differ from the image node', () => {
    render(<GenfillWidgetBody widget={widgetWith({
      status: 'ready', prompt: 'a boat',
      result: { assetId: 'genfill-w_gf_1', width: 100, height: 50 },
    })} />);
    // No image node registered → dims null → toggle disabled, hint shown.
    expect((screen.getByLabelText(/clip to region/i) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/dimensions differ/i)).toBeTruthy();
  });

  it('error state shows message and Retry', () => {
    render(<GenfillWidgetBody widget={widgetWith({
      status: 'error', prompt: 'x',
      error: { kind: 'moderation', message: 'blocked' },
    })} />);
    expect(screen.getByText(/blocked/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('not_configured error hides Retry', () => {
    render(<GenfillWidgetBody widget={widgetWith({
      status: 'error', prompt: 'x',
      error: { kind: 'not_configured', message: 'Replicate not configured' },
    })} />);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
