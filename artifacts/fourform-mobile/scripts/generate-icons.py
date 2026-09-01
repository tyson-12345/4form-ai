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
Every coordinate below is transcribed verbatim from the production SVGs in the
design handoff (`design_handoff_4form_app_icon/assets/`, Claude Design project
"Athlete AI Redesign"). The handoff is explicit that the mark must not be
redrawn by eye, and it means it: interpolating the intermediate rungs from the
1024 and 29 ones gets every single value wrong.

This script exists because the SVGs cannot be rasterised on this machine —
there is no rsvg-convert, Inkscape, ImageMagick, cairosvg or Pillow here. The
mark needs none of them. Every stroke is round-capped, and a round-capped
stroke is exactly the set of points within half the stroke width of a line
segment: a capsule. Signed distance to a segment renders that precisely, with
analytic anti-aliasing, using only the standard library.

Re-run after any change to the mark:

    python3 scripts/generate-icons.py

── Optical size ladder ──────────────────────────────────────────────────────
The handoff's central requirement: do NOT scale one master down to every size.
As the icon shrinks the crossbar drops, the diagonal reaches further left, and
the stroke thickens — otherwise the counter (the triangular void between
diagonal, stem and crossbar) closes and the mark reads as a blue slash over a
bone "T". Each rung below carries its own hand-corrected geometry.

Acceptance check, from the handoff: at every rasterised size the counter must
show at least 3 clear device pixels of span. `measure_counter()` asserts it, and
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

VIEWBOX = 168.0  # all geometry is authored on a 168 x 168 viewBox


@dataclass(frozen=True)
class Geometry:
    """One rung of the optical size ladder, in viewBox units."""

    stem: tuple[float, float, float, float]
    crossbar: tuple[float, float, float, float]
    diagonal: tuple[float, float, float, float]
    stroke: float

    def segments(self):
        return (self.stem, self.crossbar, self.diagonal)


# Transcribed from the handoff SVGs. Do not adjust by eye.
LADDER: dict[str, Geometry] = {
    # 4form-icon-bone-1024.svg — also 180pt
    "1024": Geometry((104, 36, 104, 136), (34, 106, 134, 106), (104, 36, 38, 106), 14),
    # 4form-icon-bone-120.svg
    "120": Geometry((104, 38, 104, 135), (34, 107, 134, 107), (104, 38, 37, 107), 15),
    # 4form-icon-bone-60.svg
    "60": Geometry((105, 36, 105, 136), (31, 110, 137, 110), (105, 36, 32, 110), 17),
    # 4form-icon-bone-40.svg
    "40": Geometry((106, 34, 106, 136), (28, 114, 136, 114), (106, 34, 28, 114), 19),
    # 4form-icon-bone-29.svg / 4form-favicon-32.svg
    "29": Geometry((107, 32, 107, 136), (22, 118, 140, 118), (107, 32, 23, 118), 20),
    # 4form-favicon-16.svg
    "16": Geometry((108, 30, 108, 136), (20, 117, 142, 117), (108, 30, 21, 117), 18),
}

# (field, frame, limb). A field of None is transparent — used where the platform
# supplies its own background layer.
ROLES = {
    "bone": (BONE, INK, COBALT),
    "ink": (INK, BONE, COBALT),
    "tinted": (INK_SOFT, BONE, GREY_LIMB),
    "glyph-ink": (None, INK, COBALT),  # Android foreground, over a bone layer
    "glyph-bone": (None, BONE, COBALT),  # splash, over the ink backgroundColor
}

FAVICON_RADIUS = 42.0  # viewBox units; web favicons only — platforms mask the rest


# ── Geometry helpers ─────────────────────────────────────────────────────────


def _scaled_about_centre(geom: Geometry, factor: float) -> Geometry:
    c = VIEWBOX / 2.0

    def s(seg):
        return tuple(c + (v - c) * factor for v in seg)

    return Geometry(s(geom.stem), s(geom.crossbar), s(geom.diagonal), geom.stroke * factor)


def fit_to_fraction(geom: Geometry, fraction: float) -> Geometry:
    """
    Shrink the mark so its inked bounding box spans `fraction` of the canvas.

    Android's adaptive icon is a 108dp canvas of which only the central 66dp is
    guaranteed visible — every launcher mask crops outside it. The foreground
    layer must therefore be inset, not full-bleed, or the diagonal loses its
    tip on a circular mask.
    """
    r = geom.stroke / 2.0
    xs, ys = [], []
    for x1, y1, x2, y2 in geom.segments():
        xs += [x1 - r, x1 + r, x2 - r, x2 + r]
        ys += [y1 - r, y1 + r, y2 - r, y2 + r]
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    return _scaled_about_centre(geom, (VIEWBOX * fraction) / extent)


# ── Rendering ────────────────────────────────────────────────────────────────


def _segment_distance(px, py, x1, y1, dx, dy, span):
    if span == 0.0:
        t = 0.0
    else:
        t = ((px - x1) * dx + (py - y1) * dy) / span
        t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    ex, ey = x1 + t * dx - px, y1 + t * dy - py
    return (ex * ex + ey * ey) ** 0.5


def _coverage(distance: float, radius: float) -> float:
    """
    Analytic anti-aliasing: a signed distance converted to pixel coverage with a
    one-pixel linear ramp. This is what supersampling approximates — but for a
    capsule the distance field is exact, so the edge is exact, at 1 sample.
    """
    sd = distance - radius
    if sd <= -0.5:
        return 1.0
    if sd >= 0.5:
        return 0.0
    return 0.5 - sd


def render(size: int, geom: Geometry, role: str, corner: float = 0.0) -> bytearray:
    """Render the mark at `size` px square. Returns RGBA rows, top to bottom."""
    field, frame, limb = ROLES[role]
    scale = size / VIEWBOX
    r = (geom.stroke / 2.0) * scale
    corner_px = corner * scale

    # Precompute per-stroke constants and a bounding box, so the vast majority
    # of pixels skip the distance maths entirely.
    strokes = []
    for seg, colour in zip(geom.segments(), (frame, frame, limb)):
        x1, y1, x2, y2 = (v * scale for v in seg)
        dx, dy = x2 - x1, y2 - y1
        pad = r + 1.0
        strokes.append(
            {
                "x1": x1, "y1": y1, "dx": dx, "dy": dy,
                "span": dx * dx + dy * dy, "colour": colour,
                "x0b": min(x1, x2) - pad, "x1b": max(x1, x2) + pad,
                "y0b": min(y1, y2) - pad, "y1b": max(y1, y2) + pad,
            }
        )

    buf = bytearray(size * size * 4)
    for y in range(size):
        py = y + 0.5
        row = y * size * 4
        active = [s for s in strokes if s["y0b"] <= py <= s["y1b"]]
        for x in range(size):
            px = x + 0.5

            if field is None:
                cr = cg = cb = 0
                ca = 0.0
            else:
                cr, cg, cb = field
                ca = 1.0 if corner_px <= 0.0 else _field_alpha(px, py, size, corner_px)

            for s in active:
                if px < s["x0b"] or px > s["x1b"]:
                    continue
                cov = _coverage(
                    _segment_distance(px, py, s["x1"], s["y1"], s["dx"], s["dy"], s["span"]), r
                )
                if cov <= 0.0:
                    continue
                col = s["colour"]
                out_a = cov + ca * (1.0 - cov)
                cr = int(round((col[0] * cov + cr * ca * (1.0 - cov)) / out_a))
                cg = int(round((col[1] * cov + cg * ca * (1.0 - cov)) / out_a))
                cb = int(round((col[2] * cov + cb * ca * (1.0 - cov)) / out_a))
                ca = out_a

            i = row + x * 4
            buf[i] = cr
            buf[i + 1] = cg
            buf[i + 2] = cb
            buf[i + 3] = int(round(ca * 255))
    return buf


def _field_alpha(px: float, py: float, size: int, corner: float) -> float:
    """Coverage of the background square with a rounded corner."""
    half = size / 2.0
    qx = abs(px - half) - (half - corner)
    qy = abs(py - half) - (half - corner)
    if qx <= 0.0 and qy <= 0.0:
        return 1.0
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return _coverage((ax * ax + ay * ay) ** 0.5, corner)


# ── Acceptance check ─────────────────────────────────────────────────────────


def measure_counter(buf: bytearray, size: int, geom: Geometry, role: str) -> int:
    """
    Measure the counter — the triangular void between diagonal, stem and
    crossbar — and return its widest horizontal run in device pixels.

    The handoff requires at least 3. Below that the mark stops reading as a 4,
    which is the exact failure the size ladder exists to prevent, so it is
    measured rather than trusted.
    """
    field = ROLES[role][0]
    scale = size / VIEWBOX
    y_top = max(0, int(geom.stem[1] * scale))
    y_bot = min(size, int(geom.crossbar[1] * scale))
    x_right = min(size, int(geom.stem[0] * scale))

    widest = 0
    for y in range(y_top, y_bot):
        run = best = 0
        base = y * size * 4
        for x in range(x_right):
            # "Clear" = untouched by any stroke. That is bare transparency for
            # the glyph roles and the field colour otherwise — NOT a fixed
            # colour: in the tinted role the frame is bone, so testing against
            # bone would count the frame itself as clear and measure nothing.
            i = base + x * 4
            clear = buf[i + 3] == 0 if field is None else (buf[i], buf[i + 1], buf[i + 2]) == field
            if clear:
                run += 1
                if run > best:
                    best = run
            else:
                run = 0
        if best > widest:
            widest = best
    return widest


# ── PNG output ───────────────────────────────────────────────────────────────


def write_png(path: pathlib.Path, buf: bytearray, size: int) -> None:
    """
    Write the pixels as a PNG. zlib and struct are all this needs.

    Fully opaque images are written as truecolour **without** an alpha channel.
    That is not an optimisation: App Store Connect rejects an app icon that
    carries an alpha channel at all ("The app icon can't be transparent nor
    contain an alpha channel"), and an all-255 alpha channel still counts. The
    transparent assets — the Android foreground and the splash — keep theirs,
    because the platform composites them over its own background layer.
    """

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    has_alpha = any(buf[i] != 255 for i in range(3, len(buf), 4))
    channels = 4 if has_alpha else 3
    colour_type = 6 if has_alpha else 2

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        base = y * size * 4
        if has_alpha:
            raw += buf[base : base + size * 4]
        else:
            for x in range(size):
                i = base + x * 4
                raw += buf[i : i + 3]

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, colour_type, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


# ── Outputs ──────────────────────────────────────────────────────────────────

# name, size, ladder rung, role, corner radius, inset fraction
# The rung is chosen by OUTPUT size, which is the entire point of the ladder.
OUTPUTS = [
    ("icon.png", 1024, "1024", "bone", 0.0, None),
    ("icon-store.png", 1024, "1024", "bone", 0.0, None),
    ("icon-tinted.png", 1024, "1024", "tinted", 0.0, None),
    # Android foreground: inset to the central 66dp of the 108dp canvas.
    ("adaptive-icon.png", 1024, "1024", "glyph-ink", 0.0, 66.0 / 108.0),
    # Splash sits on app.json's #101312 backgroundColor, so the frame is bone.
    ("splash.png", 1284, "1024", "glyph-bone", 0.0, 0.42),
    ("favicon.png", 32, "29", "bone", FAVICON_RADIUS, None),
]


def main() -> None:
    out = pathlib.Path(__file__).resolve().parent.parent / "assets" / "images"
    out.mkdir(parents=True, exist_ok=True)

    for name, size, rung, role, corner, inset in OUTPUTS:
        geom = LADDER[rung]
        if inset is not None:
            geom = fit_to_fraction(geom, inset)

        buf = render(size, geom, role, corner)
        span = measure_counter(buf, size, geom, role)
        if span < 3:
            raise SystemExit(
                f"{name}: counter measured {span}px, below the 3px minimum — "
                f"the wrong ladder rung was used for this size."
            )

        write_png(out / name, buf, size)
        inset_note = f" inset {inset:.2f}" if inset else ""
        print(f"  {name:<20} {size:>5}px  rung {rung:<5} {role:<11} counter {span}px{inset_note}")

    print(f"\nWrote {len(OUTPUTS)} files to {out}")


if __name__ == "__main__":
    main()
