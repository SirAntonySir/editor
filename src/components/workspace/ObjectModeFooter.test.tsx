import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectModeFooter } from './ObjectModeFooter';
import { useEditorStore } from '@/store';

describe('ObjectModeFooter', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
  });

  it('renders Layers and Objects pills with counts', () => {
    render(
      <ObjectModeFooter
        imageNodeId="in-1"
        layerCount={2}
        objectCount={5}
        currentMode="objects"
      />,
    );
    expect(screen.getByRole('button', { name: /Layers/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Objects · 5/ })).toBeInTheDocument();
  });

  it('clicking Layers writes "layers" mode to the store', () => {
    render(
      <ObjectModeFooter
        imageNodeId="in-1"
        layerCount={2}
        objectCount={5}
        currentMode="objects"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Layers/ }));
    expect(useEditorStore.getState().imageNodeMode['in-1']).toBe('layers');
  });

  it('clicking Objects writes "objects" mode', () => {
    render(
      <ObjectModeFooter
        imageNodeId="in-1"
        layerCount={2}
        objectCount={5}
        currentMode="layers"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Objects · 5/ }));
    expect(useEditorStore.getState().imageNodeMode['in-1']).toBe('objects');
  });
});
