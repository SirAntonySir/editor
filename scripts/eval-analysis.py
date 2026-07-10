#!/usr/bin/env python3
"""Evaluate the analysis pipeline against ground-truth stimulus pairs.

For each (original, degraded) image pair, decode both (DNG via LibRaw, TIFF/web
via the same develop path the app uses), run the mechanical cheap-pass + the
severity floors, and report whether the degraded image trips the corrective
problems that the original does not. This is the thesis's measurable
before/after for suggestion quality.

Tier 1 (default, free): mechanical detection + grounding floors. Asserts the
planted defect is detected on the degraded image and quiet on the original.

Tier 2 (--llm, costs API calls; needs ANTHROPIC_API_KEY): also runs the full
augment pass and reports the LLM's problems[] before grounding, so you can see
calibration drift.

Usage:
  python scripts/eval-analysis.py \
      --pair original.dng degraded.dng \
      [--pair orig2.dng degr2.dng ...] [--llm]

Run from the backend venv so app.* imports resolve:
  cd backend && . .venv/bin/activate && python ../scripts/eval-analysis.py ...
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

# Make the backend package importable regardless of CWD.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services.analysis_eval import SEVERITY_GATE_DEFAULT, evaluate_rgb  # noqa: E402


def _decode_rgb(path: Path) -> np.ndarray:
    """Decode any supported stimulus to a uint8 RGB array, mirroring the app's
    open path: DNG/TIFF through the develop service, web images through PIL."""
    import cv2

    data = path.read_bytes()
    ext = path.suffix.lower()
    if ext in (".dng", ".tif", ".tiff") or ext.lstrip(".") in _RAW_EXTS:
        from app.services.raw_decode import develop_raw_to_png16
        png = develop_raw_to_png16(data)
        bgr = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_UNCHANGED)
        rgb16 = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        return (rgb16 // 257).astype(np.uint8) if rgb16.dtype == np.uint16 else rgb16
    from PIL import Image
    import io
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))


_RAW_EXTS = {
    "cr2", "cr3", "crw", "nef", "nrw", "arw", "sr2", "srf", "raf", "orf",
    "rw2", "pef", "srw", "raw", "3fr", "erf", "kdc", "mos", "x3f", "iiq", "rwl",
}

_CORRECTIVE = (
    "strong_color_cast", "crushed_shadows", "clipped_highlights",
    "low_contrast", "local_underexposure", "local_overexposure",
)


def _report_pair(original: Path, degraded: Path, *, run_llm: bool) -> bool:
    orig = evaluate_rgb(_decode_rgb(original))
    degr = evaluate_rgb(_decode_rgb(degraded))

    print(f"\n=== {original.name}  →  {degraded.name}")
    print(f"  cast_strength : {orig.cast_strength:.3f} → {degr.cast_strength:.3f}")
    print(f"  median_luma   : {orig.median_luma:.0f} → {degr.median_luma:.0f}")
    print(f"  contrast      : {orig.contrast_p10_p90:.0f} → {degr.contrast_p10_p90:.0f}")

    # Degradation is "detectable" if it either newly trips a corrective floor
    # OR meaningfully worsens one that already clears the gate. The latter
    # matters for naturally-defective scenes (a dark, blue seascape already
    # reads as cast+underexposed; the degradation intensifies rather than
    # introduces) — the analysis still has signal, just not a fresh threshold.
    _WORSEN_DELTA = 0.1
    detectable = []
    for kind in _CORRECTIVE:
        o = orig.floors.get(kind, 0.0)
        d = degr.floors.get(kind, 0.0)
        mark = ""
        if d >= SEVERITY_GATE_DEFAULT and o < SEVERITY_GATE_DEFAULT:
            mark = "  <-- newly tripped"
            detectable.append(kind)
        elif d >= SEVERITY_GATE_DEFAULT and d - o >= _WORSEN_DELTA:
            mark = f"  <-- intensified (+{d - o:.2f})"
            detectable.append(kind)
        print(f"  floor[{kind:22}] {o:.2f} → {d:.2f}{mark}")

    ok = bool(detectable)
    print("  RESULT:", f"PASS — detectable via {', '.join(detectable)}" if ok
          else "FAIL — degradation left no corrective-floor signal")

    if run_llm:
        _report_llm(degraded)
    return ok


def _report_llm(degraded: Path) -> None:
    print("  --- LLM tier (augment pass, pre-grounding) ---")
    try:
        import cv2

        from app.services.anthropic_client import AnthropicClient
        rgb = _decode_rgb(degraded)
        ok, buf = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        client = AnthropicClient()
        soft = client.augment_context_soft_fields(
            image_bytes=buf.tobytes(), mime_type="image/jpeg",
            base_context_json={}, cheap_pass_summary={},
        )
        for p in soft.problems:
            print(f"    LLM: {p.kind} sev={p.severity:.2f} — {p.display_label}")
    except Exception as exc:  # noqa: BLE001
        print(f"    LLM tier skipped: {exc}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pair", nargs=2, action="append", metavar=("ORIGINAL", "DEGRADED"),
                    required=True, help="an (original, degraded) stimulus pair")
    ap.add_argument("--llm", action="store_true", help="also run the LLM augment tier")
    args = ap.parse_args()

    results = [
        _report_pair(Path(o), Path(d), run_llm=args.llm)
        for o, d in args.pair
    ]
    passed = sum(results)
    print(f"\n{passed}/{len(results)} pairs detectable.")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
