import { useEffect } from 'react';
import { installKeyboardShortcuts } from '@/lib/keyboard-shortcuts';

export function KeyboardShortcuts() {
  useEffect(() => {
    return installKeyboardShortcuts();
  }, []);
  return null;
}
