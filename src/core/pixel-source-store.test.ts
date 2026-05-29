import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  putSource,
  getSource,
  deleteOne,
  deletePrefix,
  __resetForTests,
} from './pixel-source-store';

function makeBlob(text: string): Blob {
  return new Blob([text], { type: 'image/png' });
}

async function readText(blob: Blob | null): Promise<string | null> {
  if (!blob) return null;
  return await blob.text();
}

describe('pixel-source-store', () => {
  beforeEach(async () => {
    await __resetForTests();
  });

  it('returns null for missing keys', async () => {
    const got = await getSource('s1', 'l1');
    expect(got).toBeNull();
  });

  it('round-trips a blob through put then get', async () => {
    await putSource('s1', 'l1', makeBlob('hello'));
    const got = await getSource('s1', 'l1');
    expect(await readText(got)).toBe('hello');
  });

  it('overwrites on a second put with the same key', async () => {
    await putSource('s1', 'l1', makeBlob('first'));
    await putSource('s1', 'l1', makeBlob('second'));
    const got = await getSource('s1', 'l1');
    expect(await readText(got)).toBe('second');
  });

  it('keeps entries independent across (sessionId, layerId) tuples', async () => {
    await putSource('s1', 'l1', makeBlob('a'));
    await putSource('s1', 'l2', makeBlob('b'));
    await putSource('s2', 'l1', makeBlob('c'));
    expect(await readText(await getSource('s1', 'l1'))).toBe('a');
    expect(await readText(await getSource('s1', 'l2'))).toBe('b');
    expect(await readText(await getSource('s2', 'l1'))).toBe('c');
  });

  it('deleteOne removes a single entry and leaves siblings', async () => {
    await putSource('s1', 'l1', makeBlob('a'));
    await putSource('s1', 'l2', makeBlob('b'));
    await deleteOne('s1', 'l1');
    expect(await getSource('s1', 'l1')).toBeNull();
    expect(await readText(await getSource('s1', 'l2'))).toBe('b');
  });

  it('deletePrefix removes only entries with the matching sessionId', async () => {
    await putSource('s1', 'l1', makeBlob('a'));
    await putSource('s1', 'l2', makeBlob('b'));
    await putSource('s2', 'l1', makeBlob('c'));
    await deletePrefix('s1');
    expect(await getSource('s1', 'l1')).toBeNull();
    expect(await getSource('s1', 'l2')).toBeNull();
    expect(await readText(await getSource('s2', 'l1'))).toBe('c');
  });

  it('deletePrefix on a missing session is a no-op', async () => {
    await putSource('s1', 'l1', makeBlob('a'));
    await deletePrefix('nope');
    expect(await readText(await getSource('s1', 'l1'))).toBe('a');
  });
});
