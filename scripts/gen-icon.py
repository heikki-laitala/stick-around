#!/usr/bin/env python3
"""Generate the Stick Around app icon.

Produces src-tauri/icons/icon.png at 1024x1024. The icon is a goofy
RPG-hero stick figure: too-big wizard hat, tiny shield, wooden sword
raised high, tongue-out grin. Run this only when the design changes;
the PNG is checked in.
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

SIZE = 1024
OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons", "icon.png")


def vertical_gradient(w: int, h: int, top: tuple[int, int, int], bot: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for y in range(h):
        t = y / (h - 1)
        r = int(top[0] * (1 - t) + bot[0] * t)
        g = int(top[1] * (1 - t) + bot[1] * t)
        b = int(top[2] * (1 - t) + bot[2] * t)
        for x in range(w):
            px[x, y] = (r, g, b, 255)
    return img


def rounded_mask(w: int, h: int, radius: int) -> Image.Image:
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    return mask


def main() -> None:
    # Fantasy-dusk gradient — purple up top fading to warm pink at the
    # horizon. Feels like an RPG title screen without being too serious.
    bg = vertical_gradient(SIZE, SIZE, (88, 62, 168), (255, 140, 120))
    bg.putalpha(rounded_mask(SIZE, SIZE, int(SIZE * 0.22)))

    d = ImageDraw.Draw(bg)

    # A big cartoon moon behind the hero — RPG mood, cheap to draw.
    d.ellipse((720, 120, 930, 330), fill=(255, 240, 200, 240))
    d.ellipse((760, 150, 810, 200), fill=(255, 225, 170, 200))
    d.ellipse((820, 220, 860, 260), fill=(255, 225, 170, 200))

    # Distant mountain silhouettes.
    mountain_col = (60, 40, 90, 255)
    d.polygon([(0, 820), (180, 640), (340, 800), (500, 660),
               (700, 820), (900, 700), (1024, 780), (1024, 1024), (0, 1024)],
              fill=mountain_col)

    stroke = 32
    white = (255, 255, 255, 255)
    black = (26, 18, 46, 255)

    def line(a, b, color=white, w=stroke):
        d.line([a, b], fill=color, width=w)
        rr = w // 2
        for (x, y) in (a, b):
            d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=color)

    # Ground plane.
    ground_y = 890
    d.rectangle((0, ground_y, SIZE, ground_y + 12), fill=(40, 26, 70, 255))

    # ─── Stick hero ──────────────────────────────────────────────────────
    # Posed in a triumphant "sword held high" stance, slightly leaning back.
    head_cx, head_cy, head_r = 512, 420, 100
    neck = (512, 540)
    hip = (512, 720)

    # Right arm raised high and outward to clear the hat. Left arm holds shield.
    r_shoulder = (545, 560)
    r_elbow = (680, 460)
    r_hand = (780, 320)    # sword grip — far enough right of the hat brim
    l_shoulder = (480, 560)
    l_elbow = (420, 640)
    l_hand = (380, 700)    # shield grip

    # Legs in a heroic stance — feet apart, slightly bent knees.
    l_hip = (500, 720)
    l_knee = (440, 810)
    l_foot = (420, 885)
    r_hip = (524, 720)
    r_knee = (590, 810)
    r_foot = (610, 885)

    # Body parts (order matters so the torso sits under the shield/hat).
    line(neck, hip)
    line(l_shoulder, l_elbow); line(l_elbow, l_hand)
    line(r_shoulder, r_elbow); line(r_elbow, r_hand)
    line(l_hip, l_knee); line(l_knee, l_foot)
    line(r_hip, r_knee); line(r_knee, r_foot)

    # Head (white with dark outline).
    d.ellipse((head_cx - head_r, head_cy - head_r,
               head_cx + head_r, head_cy + head_r),
              fill=white, outline=black, width=8)

    # ─── Tiny shield (pot-lid style) ────────────────────────────────────
    sh_cx, sh_cy, sh_r = 340, 720, 90
    d.ellipse((sh_cx - sh_r, sh_cy - sh_r, sh_cx + sh_r, sh_cy + sh_r),
              fill=(180, 190, 210, 255), outline=black, width=8)
    d.ellipse((sh_cx - sh_r + 20, sh_cy - sh_r + 20,
               sh_cx + sh_r - 20, sh_cy + sh_r - 20),
              outline=(100, 110, 130, 255), width=6)
    # Cartoon star emblem in the middle.
    star_pts = []
    import math as _m
    for i in range(10):
        ang = -_m.pi / 2 + i * _m.pi / 5
        rr = 38 if i % 2 == 0 else 16
        star_pts.append((sh_cx + rr * _m.cos(ang), sh_cy + rr * _m.sin(ang)))
    d.polygon(star_pts, fill=(255, 220, 80, 255), outline=black)

    # ─── Oversized wizard hat ───────────────────────────────────────────
    # Brim first (so the cone sits on top of it).
    brim_y = head_cy - head_r + 10
    d.ellipse((head_cx - 180, brim_y - 25, head_cx + 180, brim_y + 40),
              fill=(52, 30, 110, 255), outline=black, width=8)
    # Cone — tilts slightly to the left for comic flop.
    tip = (head_cx - 110, head_cy - 360)
    left = (head_cx - 150, brim_y - 5)
    right = (head_cx + 170, brim_y - 5)
    d.polygon([tip, left, right], fill=(72, 42, 150, 255), outline=black, width=8)
    # Gold band + star on the cone.
    d.polygon([
        (head_cx - 140, brim_y - 40),
        (head_cx + 160, brim_y - 40),
        (head_cx + 130, brim_y - 75),
        (head_cx - 115, brim_y - 75),
    ], fill=(240, 200, 70, 255), outline=black)
    # Little yellow star near the tip.
    star2 = []
    for i in range(10):
        ang = -_m.pi / 2 + i * _m.pi / 5
        rr = 22 if i % 2 == 0 else 9
        star2.append((tip[0] + 40 + rr * _m.cos(ang), tip[1] + 80 + rr * _m.sin(ang)))
    d.polygon(star2, fill=(255, 230, 90, 255), outline=black)

    # ─── Wooden sword (+1 stick) ────────────────────────────────────────
    # Drawn after the hat so it reads as being held up in front/above. The
    # blade is angled from the raised hand toward the upper-right corner.
    sword_tip = (910, 130)
    sword_base = r_hand
    wood = (170, 110, 55, 255)
    wood_dark = (90, 55, 28, 255)
    # Cross-guard first (sits between hand and blade, perpendicular to blade).
    gx, gy = r_hand
    d.line([(gx - 55, gy + 30), (gx + 55, gy - 30)],
           fill=(210, 170, 90, 255), width=20)
    # Blade — a thicker polygon so it reads clearly at small sizes.
    import math as _m2
    dx = sword_tip[0] - sword_base[0]
    dy = sword_tip[1] - sword_base[1]
    length = _m2.hypot(dx, dy)
    nx, ny = -dy / length, dx / length  # normal to the blade direction
    half_w = 30
    d.polygon([
        (sword_base[0] + nx * half_w, sword_base[1] + ny * half_w),
        (sword_base[0] - nx * half_w, sword_base[1] - ny * half_w),
        (sword_tip[0] - nx * 6, sword_tip[1] - ny * 6),
        (sword_tip[0] + nx * 6, sword_tip[1] + ny * 6),
    ], fill=wood, outline=black)
    # Wood grain stripe down the middle.
    d.line([sword_base, sword_tip], fill=wood_dark, width=4)
    # Sparkle near the tip.
    for (sx, sy, sr) in [(900, 110, 16), (940, 160, 10), (870, 90, 8)]:
        d.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), fill=(255, 255, 220, 255))

    # ─── Goofy face ─────────────────────────────────────────────────────
    # Left eye: wide open with pupil looking sideways.
    le_cx, le_cy = head_cx - 38, head_cy - 10
    d.ellipse((le_cx - 28, le_cy - 28, le_cx + 28, le_cy + 28),
              fill=white, outline=black, width=5)
    d.ellipse((le_cx - 6 - 13, le_cy + 4 - 13, le_cx - 6 + 13, le_cy + 4 + 13),
              fill=black)
    # Right eye: winking — a curved line.
    re_cx, re_cy = head_cx + 38, head_cy - 14
    d.arc((re_cx - 32, re_cy - 18, re_cx + 32, re_cy + 22),
          start=200, end=340, fill=black, width=9)

    # Big goofy grin with a tongue sticking out.
    d.chord((head_cx - 44, head_cy + 10, head_cx + 44, head_cy + 70),
            start=0, end=180, fill=black, outline=black)
    # Tongue (pink).
    d.ellipse((head_cx + 6, head_cy + 45, head_cx + 42, head_cy + 82),
              fill=(255, 130, 170, 255), outline=black, width=4)
    d.line([(head_cx + 24, head_cy + 55), (head_cx + 24, head_cy + 78)],
           fill=black, width=3)

    # Eyebrows — perky little arcs.
    d.arc((le_cx - 36, head_cy - 70, le_cx + 12, head_cy - 34),
          start=210, end=340, fill=black, width=7)
    d.arc((re_cx - 14, head_cy - 72, re_cx + 34, head_cy - 36),
          start=210, end=340, fill=black, width=7)

    # ─── Speech bubble with "!" ─────────────────────────────────────────
    bx0, by0, bx1, by1 = 200, 150, 370, 290
    d.ellipse((bx0, by0, bx1, by1), fill=white, outline=black, width=6)
    d.polygon([(330, 270), (360, 320), (310, 285)], fill=white, outline=black)
    # Exclamation mark.
    d.rectangle((276, 178, 296, 240), fill=black)
    d.ellipse((273, 250, 299, 276), fill=black)

    bg.save(OUT, "PNG")
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
