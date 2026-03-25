import { useRef, useState, useEffect } from 'react';

/**
 * Returns a ref and a boolean indicating whether the element is visible
 * in the viewport (with a configurable rootMargin buffer).
 *
 * Inspired by chaiNNer's IfVisible pattern — prevents expensive rendering
 * (canvas thumbnails, previews) for off-screen graph nodes.
 */
export function useIfVisible<T extends HTMLElement>(
  rootMargin = '200px',
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, visible];
}
