import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BackendStatusBadge, backendStatusView } from './BackendStatusBadge';
import { useBackendState } from '@/store/backend-state-slice';

beforeEach(() => useBackendState.getState().reset());
afterEach(() => cleanup());

describe('backendStatusView', () => {
  it('maps open to Connected/online', () => {
    expect(backendStatusView('open')).toEqual({ tone: 'online', label: 'Connected' });
  });
  it('maps connecting and reconnecting to Connecting/pending', () => {
    expect(backendStatusView('connecting')).toEqual({ tone: 'pending', label: 'Connecting' });
    expect(backendStatusView('reconnecting')).toEqual({ tone: 'pending', label: 'Connecting' });
  });
  it('maps idle and closed to Offline/offline', () => {
    expect(backendStatusView('idle')).toEqual({ tone: 'offline', label: 'Offline' });
    expect(backendStatusView('closed')).toEqual({ tone: 'offline', label: 'Offline' });
  });
});

describe('BackendStatusBadge', () => {
  it('renders the label for the current sse status', () => {
    useBackendState.setState({ sseStatus: 'open' });
    render(<BackendStatusBadge />);
    expect(screen.getByText('Connected')).toBeDefined();
  });
  it('reflects a disconnected status', () => {
    useBackendState.setState({ sseStatus: 'closed' });
    render(<BackendStatusBadge />);
    expect(screen.getByText('Offline')).toBeDefined();
  });
});
