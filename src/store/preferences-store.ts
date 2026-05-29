import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AccentColor {
  name: string;
  value: string;
  hover: string;
}

export const ACCENT_COLORS: AccentColor[] = [
  { name: 'Blue', value: '#0071e3', hover: '#0077ed' },
  { name: 'Purple', value: '#8b5cf6', hover: '#7c3aed' },
  { name: 'Pink', value: '#ec4899', hover: '#db2777' },
  { name: 'Red', value: '#ef4444', hover: '#dc2626' },
  { name: 'Orange', value: '#f97316', hover: '#ea580c' },
  { name: 'Yellow', value: '#eab308', hover: '#ca8a04' },
  { name: 'Green', value: '#22c55e', hover: '#16a34a' },
  { name: 'Teal', value: '#14b8a6', hover: '#0d9488' },
];

export type RadiusScale = 'none' | 'small' | 'medium' | 'large' | 'full';

const RADIUS_VALUES: Record<RadiusScale, { panel: string; button: string; sm: string }> = {
  none: { panel: '0px', button: '0px', sm: '0px' },
  small: { panel: '6px', button: '4px', sm: '3px' },
  medium: { panel: '8px', button: '6px', sm: '4px' },
  large: { panel: '16px', button: '12px', sm: '8px' },
  full: { panel: '20px', button: '16px', sm: '10px' },
};

export type RightSidebarTab = 'inspector' | 'ai';

export interface PreferencesState {
  themeMode: ThemeMode;
  accentColor: string;
  radiusScale: RadiusScale;
  showPreferences: boolean;
  rightSidebarCollapsed: boolean;
  rightSidebarWidth: number;
  rightSidebarTab: RightSidebarTab;

  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string) => void;
  setRadiusScale: (scale: RadiusScale) => void;
  setShowPreferences: (show: boolean) => void;
  toggleRightSidebar: () => void;
  setRightSidebarWidth: (w: number) => void;
  setRightSidebarTab: (tab: RightSidebarTab) => void;
}

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;

function clampSidebarWidth(w: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(w)));
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      accentColor: '#0071e3',
      radiusScale: 'medium',
      showPreferences: false,
      rightSidebarCollapsed: false,
      rightSidebarWidth: 264,
      rightSidebarTab: 'inspector',

      setThemeMode: (mode) => set({ themeMode: mode }),
      setAccentColor: (color) => set({ accentColor: color }),
      setRadiusScale: (scale) => set({ radiusScale: scale }),
      setShowPreferences: (show) => set({ showPreferences: show }),
      toggleRightSidebar: () =>
        set((s) => ({ rightSidebarCollapsed: !s.rightSidebarCollapsed })),
      setRightSidebarWidth: (w) =>
        set({ rightSidebarWidth: clampSidebarWidth(w) }),
      setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),
    }),
    {
      name: 'editor-preferences',
      partialize: (state) => ({
        themeMode: state.themeMode,
        accentColor: state.accentColor,
        radiusScale: state.radiusScale,
        rightSidebarCollapsed: state.rightSidebarCollapsed,
        rightSidebarWidth: state.rightSidebarWidth,
        rightSidebarTab: state.rightSidebarTab,
      }),
    },
  ),
);

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyPreferences(state: Pick<PreferencesState, 'themeMode' | 'accentColor' | 'radiusScale'>) {
  const root = document.documentElement;

  // Theme
  const isDark = state.themeMode === 'dark' || (state.themeMode === 'system' && getSystemDark());
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');

  // Accent color
  const accent = ACCENT_COLORS.find((c) => c.value === state.accentColor);
  if (accent) {
    root.style.setProperty('--color-accent', accent.value);
    root.style.setProperty('--color-accent-hover', accent.hover);
  }

  // Radius
  const radii = RADIUS_VALUES[state.radiusScale];
  root.style.setProperty('--radius-panel', radii.panel);
  root.style.setProperty('--radius-button', radii.button);
  root.style.setProperty('--radius-sm', radii.sm);
}
