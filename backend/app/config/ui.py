"""UI tokens — z-index tiers, motion durations, workspace layout bounds.

These are authored here so the frontend consumes them through the generated TS
binding (shared/types/generated.ts), giving us a single source of truth for
'design tokens that aren't colors'. Color/radius/shadow tokens stay in
src/index.css as CSS custom properties (see CLAUDE.md visual register).

Numeric values only — no string tokens. The codegen pipeline turns this model
into a TS const object the frontend imports.
"""

from pydantic import BaseModel


class UiConfig(BaseModel):
    """Numeric UI tokens shared between backend and frontend."""

    # --- Z-index stacking (ascending) ---
    # Use these instead of inline z-[60] / zIndex: 5 / etc.
    z_overlay: int = 50      # workspace overlays, resize handles
    z_popover: int = 60      # suggestion chips, command palette
    z_modal: int = 70        # dialogs
    z_tooltip: int = 80      # always-on-top hints

    # --- Motion durations (ms) ---
    # Map to Framer Motion `duration` and Tailwind `duration-[Nms]`.
    motion_fast_ms: int = 120
    motion_base_ms: int = 200
    motion_slow_ms: int = 280

    # --- Image-node display sizing (workspace-slice.ts) ---
    image_node_display_width_default: int = 600
    image_node_display_width_min: int = 120
    image_node_display_width_max: int = 4000
    split_gap_px: int = 24

    # --- Info-widget default sizes (workspace-slice.ts) ---
    info_widget_histogram_w: int = 320
    info_widget_histogram_h: int = 180
    info_widget_palette_w: int = 320
    info_widget_palette_h: int = 120
    info_widget_cast_w: int = 220
    info_widget_cast_h: int = 160
    info_widget_stats_w: int = 280
    info_widget_stats_h: int = 120
