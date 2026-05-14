/**
 * Migrate a v1 (.edp manifest) to v2 by synthesising a linear `main` branch
 * containing a single root node holding the loaded state.
 */
import type { HistoryTreeSnapshot, SerializableState, DocumentMeta } from './types';

export interface ManifestV1 {
  version: 1;
  meta: DocumentMeta;
  layers: unknown[];
  activeLayerId: string | null;
  graphPositions: Record<string, unknown>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  curvePoints?: Record<string, Record<string, number[]>>;
}

export interface ManifestV2 extends Omit<ManifestV1, 'version'> {
  version: 2;
  history: HistoryTreeSnapshot;
}

export function isV1(m: { version: number }): m is ManifestV1 {
  return m.version === 1;
}

export function migrateV1ToV2(
  m: ManifestV1,
  rootState: SerializableState,
): ManifestV2 {
  const rootId = crypto.randomUUID();
  const history: HistoryTreeSnapshot = {
    nodes: {
      [rootId]: {
        id: rootId,
        parentId: null,
        childIds: [],
        label: 'Initial (migrated)',
        timestamp: m.meta.modifiedAt ?? Date.now(),
        kind: 'root',
        metaSnapshot: rootState,
        estimatedSize: 4096,
      },
    },
    rootId,
    currentNodeId: rootId,
    currentBranch: 'main',
    branchHeads: { main: rootId },
  };
  return { ...m, version: 2, history };
}
