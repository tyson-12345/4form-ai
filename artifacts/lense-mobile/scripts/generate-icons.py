#!/usr/bin/env python3
"""
Generate every app-icon asset from the Caliper "A, measured across" mark.

── Why this is a script and not a folder of exported PNGs ───────────────────
The icon is pure geometry: two round-capped strokes on a field. Committing only
the rasters would mean the source of truth lives in a design tool nobody can
run from the repo. This script *is* the source — the PNGs are build output that
happen to be committed because Expo needs them on disk.

Re-run after any change to the mark:

    python3 scripts/generate-icons.py

── The mark ─────────────────────────────────────────────────────────────────
Design: claude.ai/design "Athlete-AI-App-Icon-A1", variant 01 · PRIMARY.

An "A" whose crossbar is the live measurement. One rule holds every variant:
the letter is the neutral, the crossbar is the measurement, and cobalt appears
nowhere else. This is the same rule the app's design system runs on — cobalt is
reserved, never decorative.

── Optical compensation ─────────────────────────────────────────────────────
The design specifies different geometry per size: as the icon shrinks the
strokes thicken and the apex drops, so the crossbar keeps its own row of pixels
instead of merging into the legs. Those measurements are transcribed exactly in
SPECS below rather than interpolated — they are design decisions, not a curve.

Rendering is done by hand at 8x and downsampled, because a round-capped stroke
is just a capsule (a rectangle plus a disc at each end) and Pillow draws those
exactly. No SVG rasterizer is available on this machine, and adding one as a
dependency for four PNGs would be a poor trade.
"""

from __future__ import annotations

import math
import pathlib
from dataclasses import dataclass

from PIL import Image, ImageDraw

# ── Palette (Caliper) ────────────────────────────────────────────────────────

INK = "#101312"
BONE = "#EDECE7"
COBALT = "#2436E8"
WHITE = "#FFFFFF"
TINT_FIELD = "#1C1F1E"
TINT_BAR = "#83867F"

# The artwork's own coordinate space, matching the design's SVG viewBox.
VIEWBOX = 168.0

# Supersampling factor. 8x is well past the point of visible improvement at
# 1024px and still renders in under a second.
SS = 8


@dataclass(frozen=True)
class Spec:
    """Geometry for one optical size, transcribed from the design."""

    apex_y: float
    """Y of the A's apex. Drops as the icon shrinks."""
    leg_bottom: float
    """Y where the legs end."""
    letter_w: float
    """Letter stroke width."""
    bar_x1: float
    bar_x2: float
    bar_w: float
    """Crossbar stroke width."""


# Keyed by the design's own size labels. Values are exact, not interpolated.
SPECS: dict[str, Spec] = {
    "180pt": Spec(apex_y=44, leg_bottom=128, letter_w=14, bar_x1=64, bar_x2=104, bar_w=12),
    "120pt": Spec(apex_y=44, leg_bottom=128, letter_w=15, bar_x1=64, bar_x2=104, bar_w=13),
    "60pt": Spec(apex_y=46, leg_bottom=128, letter_w=17, bar_x1=64, bar_x2=104, bar_w=14),
    "40pt": Spec(apex_y=48, leg_bottom=128, letter_w=19, bar_x1=65, bar_x2=103, bar_w=16),
    "29pt": Spec(apex_y=50, leg_bottom=126, letter_w=22, bar_x1=66, bar_x2=102, bar_w=18),
    "32px": Spec(apex_y=50, leg_bottom=126, letter_w=22, bar_x1=66, bar_x2=102, bar_w=18),
    "16px": Spec(apex_y=52, leg_bottom=126, letter_w=24, bar_x1=66, bar_x2=102, bar_w=20),
}

# The A's legs. X positions are constant across every size.
LEG_LEFT_X = 50.0
LEG_RIGHT_X = 118.0
APEX_X = 84.0


def capsule(draw: ImageDraw.ImageDraw, p0, p1, width: float, fill) -> None:
    """
    Draw a round-capped line segment.

    A stroke with `stroke-linecap="round"` is geometrically a rectangle between
    the two endpoints plus a disc centred on each. Drawing it that way is exact
    — no approximation of the cap, and joins between segments come out round for
    free because the discs overlap.
    """
    x0, y0 = p0
    x1, y1 = p1
    r = width / 2.0

    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if length > 0:
        # Unit normal, scaled to the stroke's half-width.
        nx, ny = -dy / length * r, dx / length * r
        draw.polygon(
            [
                (x0 + nx, y0 + ny),
                (x1 + nx, y1 + ny),
                (x1 - nx, y1 - ny),
                (x0 - nx, y0 - ny),
            ],
            fill=fill,
        )

    for cx, cy in ((x0, y0), (x1, y1)):
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def rounded_rect_mask(size: int, radius: float) -> Image.Image:
    """An 8-bit mask for a rounded square, supersampled then reduced."""
    big = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, size * SS - 1, size * SS - 1], radius=radius * SS, fill=255
    )
    return big.resize((size, size), Image.LANCZOS)


def draw_mark(
    size: int,
    spec: Spec,
    letter: str,
    bar: str,
    *,
    field: str | None,
    corner_radius: float | None = None,
    mark_scale: float = 1.0,
) -> Image.Image:
    """
    Render the mark at `size` px.

    `field=None` leaves the background transparent (Android's adaptive
    foreground, which is composited over its own background layer).
    `mark_scale` shrinks the artwork within the canvas without moving it off
    centre — used to fit Android's safe zone.
    """
    canvas = size * SS
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if field is not None:
        if corner_radius is None:
            draw.rectangle([0, 0, canvas - 1, canvas - 1], fill=field)
        else:
            draw.rounded_rectangle(
                [0, 0, canvas - 1, canvas - 1], radius=corner_radius * SS, fill=field
            )

    # Map viewBox units to pixels, scaled about the canvas centre.
    unit = (canvas / VIEWBOX) * mark_scale
    offset = canvas / 2.0 - (VIEWBOX / 2.0) * unit

    def pt(x: float, y: float) -> tuple[float, float]:
        return (offset + x * unit, offset + y * unit)

    # The A: two legs meeting at the apex. Drawn as separate capsules — the
    # overlapping end discs produce the round join the design specifies.
    lw = spec.letter_w * unit
    capsule(draw, pt(LEG_LEFT_X, spec.leg_bottom), pt(APEX_X, spec.apex_y), lw, letter)
    capsule(draw, pt(LEG_RIGHT_X, spec.leg_bottom), pt(APEX_X, spec.apex_y), lw, letter)

    # The crossbar — the measurement, and the only cobalt in the system.
    capsule(draw, pt(spec.bar_x1, 100), pt(spec.bar_x2, 100), spec.bar_w * unit, bar)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / "assets" / "images"
    out.mkdir(parents=True, exist_ok=True)

    written: list[tuple[str, str]] = []

    def save(img: Image.Image, name: str, note: str, *, flatten: str | None = None) -> None:
        path = out / name
        if flatten is not None:
            # iOS rejects an icon with an alpha channel outright.
            bg = Image.new("RGB", img.size, flatten)
            bg.paste(img, mask=img.split()[3])
            bg.save(path, "PNG")
        else:
            img.save(path, "PNG")
        written.append((name, note))

    # ── iOS / primary app icon ──
    # 1024x1024, square, no alpha, no rounded corners: iOS applies its own mask,
    # and a pre-rounded icon shows dark corners inside it.
    save(
        draw_mark(1024, SPECS["180pt"], BONE, COBALT, field=INK),
        "icon.png",
        "1024 · iOS + primary · square, opaque",
        flatten=INK,
    )

    # ── Android adaptive foreground ──
    # Transparent, and the artwork must survive an aggressive circular mask.
    # Android guarantees only the centre 66/108 of the canvas; the mark's
    # bounding box diagonal is scaled to fit inside that circle.
    bbox_w = (LEG_RIGHT_X - LEG_LEFT_X) + SPECS["180pt"].letter_w
    bbox_h = (SPECS["180pt"].leg_bottom - SPECS["180pt"].apex_y) + SPECS["180pt"].letter_w
    diagonal = math.hypot(bbox_w, bbox_h)
    safe_fraction = 66.0 / 108.0
    adaptive_scale = (VIEWBOX * safe_fraction) / diagonal

    save(
        draw_mark(
            1024, SPECS["180pt"], BONE, COBALT, field=None, mark_scale=adaptive_scale
        ),
        "adaptive-icon.png",
        f"1024 · Android foreground · transparent, {adaptive_scale:.3f}x for safe zone",
    )

    # ── Splash ──
    # Same field as the icon so launch reads as one continuous surface. The mark
    # is small: a splash is a held breath, not a billboard.
    save(
        draw_mark(1284, SPECS["180pt"], BONE, COBALT, field=INK, mark_scale=0.34),
        "splash.png",
        "1284 · splash · mark on ink",
        flatten=INK,
    )

    # ── Web favicon ──
    # Uses the 32px optical spec: thicker strokes, dropped apex, so the crossbar
    # still reads at tab size.
    save(
        draw_mark(48, SPECS["32px"], BONE, COBALT, field=INK, corner_radius=10),
        "favicon.png",
        "48 · web favicon · 32px optical spec",
    )

    # ── Store / marketing (cobalt field, roles inverted) ──
    save(
        draw_mark(1024, SPECS["180pt"], WHITE, INK, field=COBALT),
        "icon-store.png",
        "1024 · store listing · cobalt field",
        flatten=COBALT,
    )

    # ── iOS tinted / monochrome ──
    save(
        draw_mark(1024, SPECS["180pt"], BONE, TINT_BAR, field=TINT_FIELD),
        "icon-tinted.png",
        "1024 · iOS tinted · no hue, bar reads by value",
        flatten=TINT_FIELD,
    )

    width = max(len(n) for n, _ in written)
    for name, note in written:
        print(f"  {name:<{width}}  {note}")


if __name__ == "__main__":
    main()
