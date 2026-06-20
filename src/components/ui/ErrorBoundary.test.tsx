import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ message = 'kaboom' }: { message?: string }): null {
  throw new Error(message);
}

// Shared mutable flag the "Try again" test flips between renders.
const maybeState = { shouldThrow: true };
function Maybe(): ReactNode {
  if (maybeState.shouldThrow) throw new Error('still bad');
  return <div>recovered</div>;
}

describe('ErrorBoundary', () => {
  // Silence the unavoidable React console.error noise that React emits when a
  // child throws — we want a clean test log.
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error is thrown', () => {
    const { getByText, queryByTestId } = render(
      <ErrorBoundary label="test">
        <div>hello</div>
      </ErrorBoundary>,
    );
    expect(getByText('hello')).toBeInTheDocument();
    expect(queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('renders the fallback when a child throws and surfaces the error message', () => {
    const { getByTestId, getByText } = render(
      <ErrorBoundary label="test">
        <Boom message="something broke" />
      </ErrorBoundary>,
    );
    const fallback = getByTestId('error-boundary-fallback');
    expect(fallback).toBeInTheDocument();
    expect(fallback.dataset.label).toBe('test');
    expect(getByText(/something broke/)).toBeInTheDocument();
  });

  it('invokes onError with the error and a componentStack', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary label="test" onError={onError}>
        <Boom message="watch this" />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [err, info] = onError.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('watch this');
    expect(typeof (info as { componentStack: string }).componentStack).toBe('string');
  });

  it('Try again button resets the boundary so children re-mount', () => {
    // Toggle lives on the shared `maybeState` object so the module-scope
    // `Maybe` component can read it without requiring a nested function.
    maybeState.shouldThrow = true;
    const { getByTestId, queryByText, getByText } = render(
      <ErrorBoundary label="test">
        <Maybe />
      </ErrorBoundary>,
    );
    expect(getByTestId('error-boundary-fallback')).toBeInTheDocument();
    // Stop throwing for the next render.
    maybeState.shouldThrow = false;
    fireEvent.click(getByTestId('error-boundary-retry'));
    expect(queryByText(/still bad/)).toBeNull();
    expect(getByText('recovered')).toBeInTheDocument();
  });

  it('uses a custom fallback render prop when supplied', () => {
    const { getByText } = render(
      <ErrorBoundary
        label="test"
        fallback={(err, retry) => (
          <button onClick={retry}>custom {err.message}</button>
        )}
      >
        <Boom message="x" />
      </ErrorBoundary>,
    );
    expect(getByText('custom x')).toBeInTheDocument();
  });
});
