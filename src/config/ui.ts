// Re-export of generated UI tokens (z-index tiers, motion durations,
// workspace layout bounds). Single source of truth lives in
// backend/app/config/ui.py — refresh via `npm run gen:types`.
//
//   import { UI } from '@/config/ui';
//   <div style={{ zIndex: UI.zTooltip }} />

export { UI } from '@shared/types/generated-config';
export type { UIType as UiConfig } from '@shared/types/generated-config';
