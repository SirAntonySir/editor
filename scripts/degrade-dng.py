#!/usr/bin/env python3
"""Degrade a DNG into a corrective-task study stimulus.

Writes a *copy* of the input DNG whose develop (LibRaw camera-WB path, as used
by the editor backend) comes out with a wrong white balance and/or degraded
exposure/tone. The original file is never modified. Requires exiftool.

Levers (all survive the backend's develop, which auto-brightens and therefore
neutralizes any plain linear exposure change — BaselineExposure is ignored by
LibRaw entirely):

  --neutral-r-scale / --neutral-b-scale
        Scale the DNG's AsShotNeutral R/B components. >1 on R and <1 on B
        produces a COOL (blue) cast at develop; the inverse produces WARM.
  --gamma
        Bake a power curve into a LinearizationTable → smooth "underexposed"
        look (mids/shadows sink, top anchored so auto-bright can't undo it).
  --black-level
        Raise BlackLevel → crushed blacks / contrasty look.

Caveat: gamma/black-level act on the raw values BEFORE the WB multipliers, so
they also shift color balance (green-ward). Calibrate the neutral scales
together with the tone lever and verify visually through the editor.

Calibrated examples (2026-07-10, verified correctable in-editor):
  Cool + underexposed:  --neutral-r-scale 1.06 --neutral-b-scale 0.86 --gamma 1.3
  Warm + crushed:       --neutral-r-scale 0.65 --neutral-b-scale 1.37 --black-level 200

Do not push casts much past these strengths: the WB widget's warm end
(10000K) cannot neutralize a stronger blue cast than the "cool" example above
(verified empirically — the correction ceiling is real).
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def _exiftool(*args: str) -> str:
    proc = subprocess.run(
        ["exiftool", *args], capture_output=True, text=True, check=True
    )
    return proc.stdout.strip()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("input", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--neutral-r-scale", type=float, default=1.0)
    p.add_argument("--neutral-b-scale", type=float, default=1.0)
    p.add_argument("--gamma", type=float, default=None,
                   help="LinearizationTable power curve (>1 = darker mids)")
    p.add_argument("--black-level", type=int, default=None)
    p.add_argument("--patch-thumbnail", action="store_true",
                   help="overwrite the DNG's embedded thumbnail with the "
                        "degraded render (Finder icons show the embedded "
                        "thumbnail, which otherwise keeps the original look); "
                        "needs rawpy+cv2+tifffile (backend venv)")
    args = p.parse_args()

    if args.output.resolve() == args.input.resolve():
        print("refusing to overwrite the input; give a different output path",
              file=sys.stderr)
        return 2
    shutil.copyfile(args.input, args.output)

    tag_args: list[str] = []

    if args.neutral_r_scale != 1.0 or args.neutral_b_scale != 1.0:
        raw = _exiftool("-s3", "-AsShotNeutral", str(args.input))
        r, g, b = (float(x) for x in raw.split())
        r *= args.neutral_r_scale
        b *= args.neutral_b_scale
        tag_args.append(f"-AsShotNeutral={r:.6f} {g:.6f} {b:.6f}")

    if args.gamma is not None:
        wl = int(_exiftool("-s3", "-WhiteLevel", str(args.input)).split()[0])
        table = " ".join(
            str(round(wl * (i / wl) ** args.gamma)) if i <= wl else str(wl)
            for i in range(4096)
        )
        tab_file = Path("/tmp/degrade-dng-lintab.txt")
        tab_file.write_text(table)
        tag_args.append(f"-LinearizationTable<={tab_file}")

    if args.black_level is not None:
        tag_args.append(f"-BlackLevel={args.black_level}")

    if not tag_args:
        print("no degradation requested; output is a plain copy", file=sys.stderr)
        return 0

    _exiftool("-overwrite_original", *tag_args, str(args.output))

    if args.patch_thumbnail:
        _patch_thumbnail(args.output)

    print(f"wrote {args.output}")
    for line in _exiftool("-s", "-AsShotNeutral", "-BlackLevel",
                          str(args.output)).splitlines():
        print(" ", line)
    return 0


def _patch_thumbnail(path: Path) -> None:
    """Overwrite the embedded reduced-resolution thumbnail (IFD0, uncompressed
    RGB strip) with a render of the degraded raw, so Finder/Quick Look icons
    show the degraded look instead of the export-time original."""
    import cv2
    import numpy as np
    import rawpy
    import tifffile

    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(use_camera_wb=True, output_bps=8, no_auto_bright=False)
    with tifffile.TiffFile(str(path)) as tf:
        page = tf.pages[0]
        h, w, _ = page.shape
        off, count = page.dataoffsets[0], page.databytecounts[0]
        if page.compression != 1 or count != h * w * 3:
            print("  thumbnail not an uncompressed RGB strip; skipping patch",
                  file=sys.stderr)
            return
    thumb = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_AREA)
    with open(path, "r+b") as f:
        f.seek(off)
        f.write(np.ascontiguousarray(thumb).tobytes())
    print("  embedded thumbnail patched")


if __name__ == "__main__":
    raise SystemExit(main())
