/* eslint-disable react-hooks/refs --
 * Intentional render-time ref pattern: useMemoObject is a well-known
 * stable-reference helper (cf. chaiNNer, react-use). Reading and writing
 * ref.current during render is the only way to implement "useMemo with shallow
 * equality" — useMemo itself doesn't guarantee reference stability across
 * re-renders. There is no effect or state involved; the ref is a mutable cache.
 */
import { useRef } from 'react';

/**
 * Memoizes an object by shallow-comparing its values (not reference).
 *
 * Returns the same reference as long as all values are equal, preventing
 * unnecessary re-renders of children that receive the object as a prop.
 *
 * Inspired by chaiNNer's useMemoObject pattern.
 */
export function useMemoObject<T extends Record<string, unknown>>(obj: T): T {
  const ref = useRef(obj);

  if (!shallowEqual(ref.current, obj)) {
    ref.current = obj;
  }

  return ref.current;
}

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
