#!/usr/bin/env python3
"""
Generate every app-icon asset from the 4Form "4, measured" mark.

── The mark ─────────────────────────────────────────────────────────────────
The numeral 4 drawn as a measured angle. A vertical stem and a horizontal
crossbar form the neutral frame; the diagonal is the limb under measurement and
is the only coloured element. Concept 1a "Angle" from the icon exploration.

Cobalt appears nowhere in the icon except the diagonal. That is the system's one
rule, and it is the same rule the app's design system runs on.

── Provenance ───────────────────────────────────────────────────────────────
Geometry is transcribed verbatim from the design handoff's production SVGs
(`design_handoff_4form_app_icon/assets/` in the Claude Design project
"Athlete AI Redesign"). Every coordinate, stroke weight and hex value below is
final — the handoff is explicit that the mark must not be redrawn by eye.

This script exists because the SVGs cannot be rasterised on this machine: there
is no rsvg-convert, Inkscape, ImageMagick, cairosvg or Pillow available. The
mark needs none of them. Every stroke is round-capped, and a round-capped stroke
is exactly the set of points within half the stroke width of a line segment — a
capsule. Signed distance to a segment renders that precisely, with analytic
anti-aliasing, in the standard library alone.

Re-run after any change to the mark:

    python3 scripts/generate-icons.py

── Optical size ladder ──────────────────────────────────────────────────────
The handoff's central requirement: do NOT scale one master down to every size.
As the icon shrinks the crossbar drops, the diagonal reaches further left, and
the stroke thickens slightly — otherwise the counter (the triangular void
between diagonal, stem and crossbar) closes and the mark reads as a blue slash
over a bone "T". Each size below carries its own hand-corrected geometry.

Acceptance check, from the handoff: at every rasterised size the counter must
show at least 3 clear device pixels of span. `verify_counter()` asserts this and
the script fails rather than emit a mark whose counter has closed.
"""

from __future__ import annotations

import pathlib
import struct
import zlib
from dataclasses import dataclass

# ── Palette ──────────────────────────────────────────────────────────────────

INK = (0x10, 0x13, 0x12)
BONE = (0xED, 0xEC, 0xE7)
COBALT = (0x24, 0x36, 0xE8)
INK_SOFT = (0x1C, 0x1F, 0x1E)
GREY_LIMB = (0x83, 0x86, 0x7F)

# All geometry is authored on a 168 x 168 viewBox.
VIEWBOX = 168.0


@dataclass(frozen=True)
class Geometry:
    """One rung of the optical size ladder, in viewBox units."""

    stem: tuple[float, float, float, float]
    crossbar: tuple[float, float, float, float]
    diagonal: tuple[float, float, float, float]
    stroke: float
    radius: float = 0.0  # corner radius; web favicons only


# Transcribed from the handoff SVGs. Do not adjust by eye.
LADDER: dict[str, Geometry] = {
    # 4form-icon-bone-1024.svg — also 180pt
    "1024": Geometry((104, 36, 104, 136), (34, 106, 134, 106), (104, 36, 38, 106), 14),
    # 4form-icon-bone-120.svg
    "120": Geometry((105, 35, 105, 136), (31, 107, 136, 107), (105, 35, 34, 107), 15),
    # 4form-icon-bone-60.svg
    "60": Geometry((106, 34, 106, 136), (28, 110, 138, 110), (106, 34, 30, 110), 17),
    # 4form-icon-bone-40.svg
    "40": Geometry((106, 33, 106, 136), (25, 114, 139, 114), (106, 33, 26, 114), 19),
    # 4form-icon-bone-29.svg / 4form-favicon-32.svg
    "29": Geometry((107, 32, 107, 136), (22, 118, 140, 118), (107, 32, 23, 118), 20),
    # 4form-favicon-16.svg
    "16": Geometry((107, 33, 107, 136), (23, 117, 139, 117), (107, 33, 24, 117), 18),
}

# Colour roles. Field of None means transparent — used for the Android
# adaptive-icon foreground, which is composited over its own background layer.
ROLES = {
    "bone": (BONE, INK, COBALT),
    "ink": (INK, BONE, COBALT),
    "tinted": (INK_SOFT, BONE, GREY_LIMB),
    "glyph": (None, INK, COBALT),
}


# ── Rendering ────────────────────────────────────────────────────────────────


def _segment_distance(px: float, py: float, seg: tuple[float, float, float, float]) -> float:
    """Shortest distance from a point to a line segment."""
    x1, y1, x2, y2 = seg
    dx, dy = x2 - x1, y2 - y1
    span = dx * dx + dy * dy
    if span == 0.0:
        t = 0.0
    else:
        t = ((px - x1) * dx + (py - y1) * dy) / span
        t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    ex, ey = x1 + t * dx - px, y1 + t * dy - py
    return (ex * ex + ey * ey) ** 0.5


def _coverage(distance: float, radius: float) -> float:
    """
    Analytic anti-aliasing: convert a signed distance to pixel coverage.

    One sample per pixel with a one-pixel linear ramp across the edge. This is
    what supersampling approximates, without 16x the work — and for a capsule
    the distance field is exact, so the edge is exact too.
    """
    sd = distance - radius
    if sd <= -0.5:
        return 1.0
    if sd >= 0.5:
        return 0.0
    return 0.5 - sd


def render(size: int, geom: Geometry, role: str) -> bytearray:
    """Render the mark at `size` px square. Returns RGBA rows, top to bottom."""
    field, frame, limb = ROLES[role]
    scale = size / VIEWBOX
    r = (geom.stroke / 2.0) * scale

    def to_px(seg: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        return (seg[0] * scale, seg[1] * scale, seg[2] * scale, seg[3] * scale)

    # Painted in SVG document order; the diagonal is last, so it wins overlaps.
    strokes = [
        (to_px(geom.stem), frame),
        (to_px(geom.crossbar), frame),
        (to_px(geom.diagonal), limb),
    ]
    corner = geom.radius * scale

    buf = bytearray(size * size * 4)
    for y in range(size):
        py = y + 0.5
        row = y * size * 4
        for x in range(size):
            px = x + 0.5

            if field is None:
                cr, cg, cb, ca = 0, 0, 0, 0.0
            else:
                cr, cg, cb = field
                ca = _field_alpha(px, py, size, corner)

            for seg, colour in strokes:
                cov = _coverage(_segment_distance(px, py, seg), r)
                if cov <= 0.0:
                    continue
                out_a = cov + ca * (1.0 - cov)
                if out_a <= 0.0:
                    continue
                cr = int(round((colour[0] * cov + cr * ca * (1.0 - cov)) / out_a))
                cg = int(round((colour[1] * cov + cg * ca * (1.0 - cov)) / out_a))
                cb = int(round((colour[2] * cov + cb * ca * (1.0 - cov)) / out_a))
                ca = out_a

            i = row + x * 4
            buf[i] = cr
            buf[i + 1] = cg
            buf[i + 2] = cb
            buf[i + 3] = int(round(ca * 255))
    return buf


def _field_alpha(px: float, py: float, size: int, corner: float) -> float:
    """Coverage of the background square, with an optional rounded corner."""
    if corner <= 0.0:
        return 1.0
    # Distance outside a rounded rect spanning the full canvas.
    qx = abs(px - size / 2.0) - (size / 2.0 - corner)
    qy = abs(py - size / 2.0) - (size / 2.0 - corner)
    if qx <= 0.0 and qy <= 0.0:
        return 1.0
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return _coverage((ax * ax + ay * ay) ** 0.5, corner)


# ── Acceptance check ─────────────────────────────────────────────────────────


def verify_counter(buf: bytearray, size: int, geom: Geometry) -> int:
    """
    Measure the counter — the triangular void between diagonal, stem and
    crossbar — in device pixels, and return its widest horizontal span.

    The handoff requires at least 3 clear pixels. Below that the mark stops
    reading as a 4, which is precisely the failure the size ladder prevents, so
    this is checked rather than trusted.
    """
    scale = size / VIEWBOX
    # Scan the band between the apex and the crossbar, left of the stem.
    y_top = int(geom.stem[1] * scale)
    y_bot = int(geom.crossbar[1] * scale)
    x_right = int(geom.stem[0] * scale)
    field = ROLES["bone"][0]

    widest = 0
    for y in range(y_top, y_bot):
        run = 0
        best = 0
        for x in range(0, x_right):
            i = (y * size + x) * 4
            # A "clear" pixel is the untouched field colour.
            if (buf[i], buf[i + 1], buf[i + 2]) == field and buf[i + 3] == 255:
                run += 1
                best = max(best, run)
            else:
                run = 0
        widest = max(widest, best)
    return widest


# ── PNG output ───────────────────────────────────────────────────────────────


def write_png(path: pathlib.Path, buf: bytearray, size: int) -> None:
    """Write RGBA pixels as a PNG. No dependencies; zlib and struct suffice."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw += buf[y * stride : (y + 1) * stride]

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


# ── Outputs ──────────────────────────────────────────────────────────────────

# Each output names the ladder rung whose geometry it must use. Picking the rung
# by output size is the whole point — see the module docstring.
OUTPUTS = [
    # file,                size, rung,  role,     what it is
    ("icon.png", 1024, "1024", "bone", "iOS/Expo master, App Store"),
    ("icon-store.png", 1024, "1024", "bone", "store listing"),
    ("icon-tinted.png", 1024, "1024", "tinted", "iOS tinted mode"),
    ("adaptive-icon.png", 1024, "1024", "glyph", "Android foreground layer"),
    ("favicon.png", 32, "29", "bone", "web favicon"),
]


def main() -> None:
    here = pathlib.Path(__file__).resolve().parent
    out = here.parent / "assets" / "images"
    out.mkdir(parents=True, exist_ok=True)

    for name, size, rung, role in ((o[0], o[1], o[2], o[3]) for o in OUTPUTS):
        geom = LADDER[rung]
        buf = render(size, geom, role)

        if role in ("bone", "ink"):
            span = verify_counter(buf, size, geom)
            if span < 3:
                raise SystemExit(
                    f"{name}: counter is {span}px wide, below the 3px minimum. "
                    f"The wrong ladder rung was used for this size."
                )
            note = f"counter {span}px"
        else:
            note = "no field to measure"

        write_png(out / name, buf, size)
        print(f"  {name:<20} {size:>5}px  rung {rung:<5} {role:<7} {note}")

    print(f"\nWrote {len(OUTPUTS)} files to {out}")


if __name__ == "__main__":
    main()
