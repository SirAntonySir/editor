// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { buildRegionsSections } from './command-palette';

const EMPTY_CONTEXT = {
  subjects: [], lighting: 'flat', dominantTones: [], mood: '',
  candidateRegions: [], modelName: '', modelVersion: '', generatedAt: '',
};

beforeEach(() => {
  maskStore.clear();
  objectOwnership._resetForTests();
  useAiSession.setState({ context: null });
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({
    activeObjectId: null,
    activeMaskRef: null,
    committedMaskRef: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  vi.restoreAllMocks();
});

describe('buildRegionsSections', () => {
  it('returns empty array when there are no objects and no AI context', () => {
    expect(buildRegionsSections()).toHaveLength(0);
  });

  it('returns empty array when there are only unlabeled objects', () => {
    maskStore.register({
      layerId: 'L1', width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    expect(buildRegionsSections()).toHaveLength(0);
  });

  it('returns a single Regions section with labeled Objects', () => {
    const id1 = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(id1, 'node-A');

    const sections = buildRegionsSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('regions');
    expect(sections[0].title).toBe('Regions');
    expect(sections[0].commands).toHaveLength(1);
    expect(sections[0].commands[0].label).toBe('Sky');
  });

  it('includes AI regions with a maskRef', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'Subject', maskRef: 'ref-subject' }],
      } as unknown as never,
    });

    const sections = buildRegionsSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].commands[0].label).toBe('Subject');
  });

  it('omits AI regions without a maskRef', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'Horizon', maskRef: null }],
      } as unknown as never,
    });

    expect(buildRegionsSections()).toHaveLength(0);
  });

  it('Object wins on duplicate label — only one entry per label', () => {
    const maskId = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, 'node-A');
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'sky', maskRef: 'ai-ref' }],
      } as unknown as never,
    });

    const sections = buildRegionsSections();
    expect(sections[0].commands).toHaveLength(1);
    expect(sections[0].commands[0].label).toBe('Sky'); // Object label wins
  });

  it('commands are sorted alphabetically by label', () => {
    maskStore.register({
      layerId: 'L1', label: 'Zebra',
      width: 10, height: 10, data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    maskStore.register({
      layerId: 'L2', label: 'Apple',
      width: 10, height: 10, data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });

    const sections = buildRegionsSections();
    const labels = sections[0].commands.map((c) => c.label);
    expect(labels).toEqual(['Apple', 'Zebra']);
  });

  it('Object onSelect calls setActiveObjectId', () => {
    const maskId = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, 'node-A');

    const sections = buildRegionsSections();
    const cmd = sections[0].commands[0];
    cmd.run?.();

    expect(useEditorStore.getState().activeObjectId).toBe(maskId);
  });

  it('AI region onSelect calls setActiveMask + commitMask', () => {
    useAiSession.setState({
      context: {
        ...EMPTY_CONTEXT,
        candidateRegions: [{ label: 'Background', maskRef: 'ref-bg' }],
      } as unknown as never,
    });

    const sections = buildRegionsSections();
    const cmd = sections[0].commands[0];
    cmd.run?.();

    const state = useEditorStore.getState();
    expect(state.committedMaskRef).toBe('ref-bg');
    expect(state.activeObjectId).toBeNull();
  });
});
