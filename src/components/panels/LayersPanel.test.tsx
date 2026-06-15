import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, cleanup } from '@testing-library/react';
import { LayersPanelBody } from './LayersPanel';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { Layer } from '@/store/layer-slice';

function seedLayer(overrides: Partial<Layer> & Pick<Layer, 'id' | 'name'>): void {
  useEditorStore.getState().addLayer({
    type: 'image',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    ...overrides,
  });
}

beforeEach(() => {
  useEditorStore.getState().revertAll();
  useEditorStore.getState().resetWorkspace();
  useEditorStore.getState().clearSelection?.();
  useBackendState.getState().reset();
});

afterEach(() => cleanup());

describe('LayersPanelBody — ImageNode filtering', () => {
  it('shows only the active ImageNode\'s layers when one is active', () => {
    seedLayer({ id: 'a1', name: 'AlphaPhoto' });
    seedLayer({ id: 'b1', name: 'BetaPhoto' });
    seedLayer({ id: 'b2', name: 'BetaMask' });

    const nodeA = useEditorStore.getState().addImageNode(['a1']);
    const nodeB = useEditorStore.getState().addImageNode(['b1', 'b2']);
    useEditorStore.getState().setActiveImageNode(nodeB);
    useEditorStore.getState().setActiveLayer('b1');

    render(<LayersPanelBody />);

    // Node B's layers visible (the active layer name may appear in the
    // header chip too — `getAllByText` is the safer assertion). Node A's
    // layer is filtered out entirely.
    expect(screen.getAllByText('BetaPhoto').length).toBeGreaterThan(0);
    expect(screen.getByText('BetaMask')).toBeDefined();
    expect(screen.queryByText('AlphaPhoto')).toBeNull();

    // Switch to node A → only its layer shows.
    cleanup();
    useEditorStore.getState().setActiveImageNode(nodeA);
    useEditorStore.getState().setActiveLayer('a1');
    render(<LayersPanelBody />);
    expect(screen.getAllByText('AlphaPhoto').length).toBeGreaterThan(0);
    expect(screen.queryByText('BetaPhoto')).toBeNull();
    expect(screen.queryByText('BetaMask')).toBeNull();
  });

  it('shows ALL layers when no ImageNode is active (legacy fallback)', () => {
    seedLayer({ id: 'a1', name: 'AlphaPhoto' });
    seedLayer({ id: 'b1', name: 'BetaPhoto' });

    // Register nodes but don't activate one — legacy behaviour kicks in.
    useEditorStore.getState().addImageNode(['a1']);
    useEditorStore.getState().addImageNode(['b1']);
    useEditorStore.getState().setActiveImageNode(null);

    render(<LayersPanelBody />);

    // No ImageNode active → both layers visible (filter falls back to all).
    expect(screen.getAllByText('AlphaPhoto').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BetaPhoto').length).toBeGreaterThan(0);
  });
});
