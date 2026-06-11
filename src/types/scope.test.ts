import { describe, it, expect } from 'vitest';
import { scopeEquals, GLOBAL_SCOPE, type Scope } from './scope';

describe('scopeEquals', () => {
  it('global equals global', () => {
    expect(scopeEquals(GLOBAL_SCOPE, { kind: 'global' })).toBe(true);
  });

  it('mask equals same mask_id', () => {
    const a: Scope = { kind: 'mask', mask_id: 'm1' };
    const b: Scope = { kind: 'mask', mask_id: 'm1' };
    expect(scopeEquals(a, b)).toBe(true);
  });

  it('mask different mask_id is not equal', () => {
    const a: Scope = { kind: 'mask', mask_id: 'm1' };
    const b: Scope = { kind: 'mask', mask_id: 'm2' };
    expect(scopeEquals(a, b)).toBe(false);
  });

  it('mask:proposed equals same label', () => {
    const a: Scope = { kind: 'mask:proposed', label: 'face' };
    const b: Scope = { kind: 'mask:proposed', label: 'face' };
    expect(scopeEquals(a, b)).toBe(true);
  });

  it('named_region equals same label', () => {
    const a: Scope = { kind: 'named_region', label: 'sky' };
    const b: Scope = { kind: 'named_region', label: 'sky' };
    expect(scopeEquals(a, b)).toBe(true);
  });

  it('different kinds are not equal', () => {
    const a: Scope = { kind: 'global' };
    const b: Scope = { kind: 'mask', mask_id: 'm1' };
    expect(scopeEquals(a, b)).toBe(false);
  });

  it('image_node equals same id and layer_ids order', () => {
    const a: Scope = { kind: 'image_node', imageNodeId: 'in-1', layerIds: ['l-1', 'l-2'] };
    const b: Scope = { kind: 'image_node', imageNodeId: 'in-1', layerIds: ['l-1', 'l-2'] };
    expect(scopeEquals(a, b)).toBe(true);
  });

  it('image_node different image_node_id is not equal', () => {
    const a: Scope = { kind: 'image_node', imageNodeId: 'in-1', layerIds: [] };
    const b: Scope = { kind: 'image_node', imageNodeId: 'in-2', layerIds: [] };
    expect(scopeEquals(a, b)).toBe(false);
  });

  it('image_node different layer_ids order is not equal', () => {
    const a: Scope = { kind: 'image_node', imageNodeId: 'in-1', layerIds: ['l-1', 'l-2'] };
    const b: Scope = { kind: 'image_node', imageNodeId: 'in-1', layerIds: ['l-2', 'l-1'] };
    expect(scopeEquals(a, b)).toBe(false);
  });
});
