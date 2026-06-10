import type { CandidateRegion } from '@/types/image-context';

class SegmentStoreImpl {
  private regions = new Map<string, CandidateRegion[]>();

  setRegions(imageNodeId: string, regions: CandidateRegion[]): void {
    this.regions.set(imageNodeId, [...regions]);
  }

  getRegions(imageNodeId: string): CandidateRegion[] {
    return this.regions.get(imageNodeId) ?? [];
  }

  clear(imageNodeId: string): void {
    this.regions.delete(imageNodeId);
  }

  clearAll(): void {
    this.regions.clear();
  }
}

export const segmentStore = new SegmentStoreImpl();
