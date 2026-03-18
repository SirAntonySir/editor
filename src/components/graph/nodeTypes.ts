import { SourceNode } from './nodes/SourceNode';
import { AdjustmentNode } from './nodes/AdjustmentNode';
import { CropNode } from './nodes/CropNode';
import { BlendNode } from './nodes/BlendNode';
import { OutputNode } from './nodes/OutputNode';
import type { NodeTypes } from '@xyflow/react';

export const nodeTypes: NodeTypes = {
  source: SourceNode,
  light: AdjustmentNode,
  color: AdjustmentNode,
  kelvin: AdjustmentNode,
  curves: AdjustmentNode,
  levels: AdjustmentNode,
  filter: AdjustmentNode,
  crop: CropNode,
  blend: BlendNode,
  output: OutputNode,
};
