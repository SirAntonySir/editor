import { describe, it, expect } from 'vitest';
import { parseSseLine } from './sse-subscriber';

describe('parseSseLine', () => {
  it('parses a complete data: line into a StateEvent', () => {
    const json = JSON.stringify({
      revision: 5,
      kind: 'widget.created',
      payload: { widget: { id: 'w_1' } },
      emitted_at: '2026-05-23T00:00:00Z',
    });
    const ev = parseSseLine(`data: ${json}`);
    expect(ev).not.toBeNull();
    expect(ev!.kind).toBe('widget.created');
    expect(ev!.revision).toBe(5);
  });

  it('returns null for non-data lines', () => {
    expect(parseSseLine('event: widget.created')).toBeNull();
    expect(parseSseLine('')).toBeNull();
    expect(parseSseLine(': keepalive')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSseLine('data: not-json')).toBeNull();
  });
});
