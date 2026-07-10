"""Self-verification of corrective suggestions: after applying a suggestion's
params through the CPU preview, the problem's own mechanical metric must have
moved in the right direction, or the suggestion is retried/flagged."""

from __future__ import annotations

from app.schemas.enriched_context import Problem
from app.services.suggestion_verification import verify_correction
from app.state.context_stats import CheapPassResult


def _cheap(**over) -> CheapPassResult:
    base = dict(
        luma_histogram=[0] * 256,
        rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        clipped_shadows_pct=0.0,
        clipped_highlights_pct=0.0,
        median_luma=120.0,
        contrast_p10_p90=140.0,
        cast_strength=0.0,
        cast_direction=(0.0, 0.0),
    )
    base.update(over)
    return CheapPassResult(**base)


def _p(kind: str, **over) -> Problem:
    return Problem(kind=kind, severity=0.6, suggested_fused_tools=["x"], **over)


# ---- cast --------------------------------------------------------------


def test_cast_correction_improves_when_strength_drops():
    r = verify_correction(
        _p("strong_color_cast"), _cheap(cast_strength=0.46), _cheap(cast_strength=0.20)
    )
    assert r.verifiable and r.improved


def test_cast_correction_fails_when_strength_barely_moves():
    r = verify_correction(
        _p("strong_color_cast"), _cheap(cast_strength=0.46), _cheap(cast_strength=0.44)
    )
    assert r.verifiable and not r.improved


def test_cast_correction_fails_when_strength_rises():
    r = verify_correction(
        _p("strong_color_cast"), _cheap(cast_strength=0.46), _cheap(cast_strength=0.55)
    )
    assert r.verifiable and not r.improved


# ---- exposure ----------------------------------------------------------


def test_underexposure_improves_when_median_rises_toward_mid():
    r = verify_correction(
        _p("local_underexposure"), _cheap(median_luma=18.0), _cheap(median_luma=95.0)
    )
    assert r.verifiable and r.improved


def test_underexposure_fails_when_median_barely_moves():
    r = verify_correction(
        _p("local_underexposure"), _cheap(median_luma=18.0), _cheap(median_luma=25.0)
    )
    assert r.verifiable and not r.improved


def test_overexposure_improves_when_median_drops_toward_mid():
    r = verify_correction(
        _p("local_overexposure"), _cheap(median_luma=240.0), _cheap(median_luma=150.0)
    )
    assert r.verifiable and r.improved


# ---- clipping / contrast ----------------------------------------------


def test_clipped_highlights_improves_when_clip_pct_shrinks():
    r = verify_correction(
        _p("clipped_highlights"),
        _cheap(clipped_highlights_pct=6.0),
        _cheap(clipped_highlights_pct=2.0),
    )
    assert r.verifiable and r.improved


def test_low_contrast_improves_when_spread_widens():
    r = verify_correction(
        _p("low_contrast"), _cheap(contrast_p10_p90=27.0), _cheap(contrast_p10_p90=80.0)
    )
    assert r.verifiable and r.improved


# ---- unverifiable ------------------------------------------------------


def test_judgement_kind_is_unverifiable():
    r = verify_correction(
        _p("soft_focus"), _cheap(), _cheap(cast_strength=0.9)
    )
    assert not r.verifiable


def test_clipping_with_negligible_before_is_unverifiable():
    # Almost nothing was clipped to begin with — nothing to verify recovery of.
    r = verify_correction(
        _p("clipped_highlights"),
        _cheap(clipped_highlights_pct=0.1),
        _cheap(clipped_highlights_pct=0.05),
    )
    assert not r.verifiable


# ---- end-to-end glue: render + recompute cheap pass + verify -----------


def _jpeg_bytes(arr) -> bytes:
    import io

    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _kelvin_warm_widget(temperature: float):
    from app.schemas.widget import (
        ControlBinding, ControlSchema, NodeParamTarget, Scope, Widget,
        WidgetNode, WidgetOrigin, WidgetPreview,
    )
    scope = Scope.model_validate({"kind": "global"})
    return Widget(
        id="w_v", intent="warm", op_id="warm_grade",
        origin=WidgetOrigin(kind="mcp_autonomous"),
        scope=scope,
        nodes=[WidgetNode(id="n_k", type="kelvin", params={"temperature": temperature},
                          scope=scope, inputs=[], widget_id="w_v", layer_id="l1")],
        bindings=[ControlBinding(
            param_key="temperature", label="T", control_type="slider",
            target=NodeParamTarget(node_id="n_k", param_key="temperature"),
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50}),
            value=temperature, default=0,
        )],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    )


def test_measure_and_verify_confirms_a_real_cast_correction():
    import numpy as np

    from app.services.suggestion_verification import measure_and_verify
    # Strong blue cast: B high, R low.
    arr = np.zeros((48, 48, 3), dtype=np.uint8)
    arr[:, :, 0] = 60
    arr[:, :, 1] = 110
    arr[:, :, 2] = 200
    result = measure_and_verify(
        _p("strong_color_cast"), _jpeg_bytes(arr), "image/jpeg",
        _kelvin_warm_widget(1200.0), max_dim=48,
    )
    assert result is not None and result.verifiable and result.improved


def test_measure_and_verify_returns_none_for_unsupported_widget():
    import numpy as np

    from app.services.suggestion_verification import measure_and_verify
    w = _kelvin_warm_widget(1200.0)
    w.nodes[0].type = "unsupported_op"
    arr = np.full((16, 16, 3), 128, dtype=np.uint8)
    assert measure_and_verify(
        _p("strong_color_cast"), _jpeg_bytes(arr), "image/jpeg", w, max_dim=16,
    ) is None
