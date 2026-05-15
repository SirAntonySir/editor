import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import type { MaskRef } from '@/types/scope';

export function extractLayerFromMask(args: {
  sourceLayerId: string;
  maskRef: MaskRef;
  name?: string;
}): string {
  const editor = useEditorStore.getState();
  const source = editor.layers.find((l) => l.id === args.sourceLayerId);
  if (!source) throw new Error(`extractLayerFromMask: layer ${args.sourceLayerId} not found`);
  const mask = maskStore.get(args.maskRef);
  if (!mask) throw new Error(`extractLayerFromMask: mask ${args.maskRef} not found`);
  const newId = crypto.randomUUID();
  const name = args.name ?? (mask.label ? `${source.name} · ${mask.label}` : `${source.name} · branch`);
  editor.addLayer({
    id: newId,
    type: 'image',
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    parentLayerId: args.sourceLayerId,
    layerMask: args.maskRef,
  });
  editor.setActiveLayer(newId);
  return newId;
}
