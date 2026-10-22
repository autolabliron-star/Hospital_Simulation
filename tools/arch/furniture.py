"""
Parametric furniture for the look pass, placed on the sim's own anchors (plan.json `furniture`: seats, footprints, stations). Every piece stays
inside its footprint (collision and the people's seat points come from the procedural layout, unchanged).

Frames follow the layout builder: heading h, local +z = (sin h, cos h) is the way a seat faces / the visitor side of a desk, local +x = (cos h, -sin h).
"""
import math
import random

from common import Frame


# --- reception desk -------------------------------------------------------------------------------------------------------------------------------
def reception_desk(geo, f, length=3.0, low_from=0.75):
    """A long solid-surface reception desk, standing height, with a lowered accessible counter at local x > low_from, an oak transaction top,
    a recessed kick plinth and a soft LED line under the top's lip on the visitor side. The receptionist stands at local (0, 0); visitors are
    at local +z. The procedural screens (kept at runtime) stand on the high top at local z 0.85, y ~1.08."""
    L = length / 2
    z0, z1 = 0.62, 1.22          # the counter body
    hi, lo = 1.03, 0.76          # body heights (tops 40 mm above)
    # kick plinth, recessed 40 mm on the visitor face and both ends
    geo.fbox(f, 'ShadowGap', -L + 0.04, 0.0, z0 + 0.03, L - 0.04, 0.1, z1 - 0.04, drop=('down', 'up'))
    # body: high part and the lowered accessible section
    geo.fbox(f, 'SolidSurface', -L, 0.1, z0, low_from, hi, z1, drop=('down',))
    geo.fbox(f, 'SolidSurface', low_from, 0.1, z0, L, lo, z1, drop=('down',))
    # oak tops with a 50 mm overhang toward the visitors
    geo.fbox(f, 'Oak', -L - 0.02, hi, z0 - 0.02, low_from, hi + 0.04, z1 + 0.05)
    geo.fbox(f, 'Oak', low_from, lo, z0 - 0.02, L + 0.02, lo + 0.04, z1 + 0.05)
    # LED line under the lips (the visitor face glows softly)
    geo.fbox(f, 'LightPanel', -L + 0.05, hi - 0.012, z1 + 0.012, low_from - 0.05, hi - 0.004, z1 + 0.032, drop=('up',))
    geo.fbox(f, 'LightPanel', low_from + 0.05, lo - 0.012, z1 + 0.012, L - 0.05, lo - 0.004, z1 + 0.032, drop=('up',))
    # the receptionist's side: a work shelf at desk height between the returns, legroom below
    geo.fbox(f, 'SolidSurface', -L + 0.28, 0.72, 0.3, L - 0.28, 0.75, z0)
    # returns at both ends (the U of the procedural desk), plinth recessed
    for s in (-1, 1):
        xa, xb = (s * (L - 0.26), s * L) if s > 0 else (s * L, s * (L - 0.26))
        top = lo if s > 0 and low_from < L else hi
        geo.fbox(f, 'ShadowGap', xa + 0.03, 0.0, -0.3 + 0.03, xb - 0.03, 0.1, z0, drop=('down', 'up'))
        geo.fbox(f, 'SolidSurface', xa, 0.1, -0.3, xb, top, z0, drop=('down',))
        geo.fbox(f, 'Oak', xa - 0.01, top, -0.32, xb + 0.01, top + 0.04, z0 - 0.02)


# --- waiting benches -----------------------------------------------------------------------------------------------------------------------------
def bench_row(geo, f, n, pitch, fabric='Fabric', seat_h=0.37):
    """Modular beam seating: upholstered seat and back pads on a slim powder-coated steel beam and T-legs, an arm with an oak pad between seats.
    Seat i's hip point is local ((i - (n-1)/2) * pitch, seat_h, 0.02), exactly the layout's seat point."""
    w = n * pitch
    top = seat_h + 0.015          # the cushion top sits 15 mm above the hip point (the pad compresses)
    # beam and legs
    geo.fbox(f, 'Steel', -w / 2 + 0.06, 0.22, -0.11, w / 2 - 0.06, 0.27, -0.05)
    legs = [-w / 2 + 0.14, w / 2 - 0.14] + ([0.0] if n >= 4 else [])
    for x in legs:
        geo.fbox(f, 'Steel', x - 0.025, 0.02, -0.105, x + 0.025, 0.22, -0.055)
        geo.fbox(f, 'Steel', x - 0.03, 0.0, -0.25, x + 0.03, 0.02, 0.21)
    for i in range(n):
        x = (i - (n - 1) / 2) * pitch
        cw = pitch - 0.05
        # seat pan and cushion
        geo.fbox(f, 'Steel', x - cw / 2 + 0.02, 0.27, -0.2, x + cw / 2 - 0.02, top - 0.075, 0.22)
        geo.fbox(f, fabric, x - cw / 2, top - 0.075, -0.21, x + cw / 2, top, 0.26)
        # back pad, leaning back 9 degrees, on a steel spine
        tilt = math.radians(9)
        geo.fbox(f, fabric, x - cw / 2, top + 0.05, -0.27, x + cw / 2, top + 0.43, -0.205, tilt=tilt, pivot=(top, -0.24))
        geo.fbox(f, 'Steel', x - 0.02, 0.24, -0.3, x + 0.02, top + 0.3, -0.27, tilt=tilt, pivot=(top, -0.24))
    # arms at every seat boundary: a front post and an oak pad
    for k in range(n + 1):
        x = -w / 2 + k * pitch
        x = min(max(x, -w / 2 + 0.0125), w / 2 - 0.0125)
        geo.fbox(f, 'Steel', x - 0.0125, top - 0.075, 0.12, x + 0.0125, top + 0.2, 0.15)
        geo.fbox(f, 'Steel', x - 0.0125, top - 0.075, -0.18, x + 0.0125, top - 0.05, 0.15)
        geo.fbox(f, 'Oak', x - 0.0175, top + 0.2, -0.17, x + 0.0175, top + 0.225, 0.2)


# --- planter and plant ---------------------------------------------------------------------------------------------------------------------------
def _leaf(geo, base, phi, theta, L, W, droop):
    """A fiddle-leaf: broad, folded along the midrib, tip drooping. base: plan point; phi: azimuth (plan, from +x toward +z); theta: elevation."""
    cp, sp, ct, st = math.cos(phi), math.sin(phi), math.cos(theta), math.sin(theta)
    d = (ct * cp, st, ct * sp)             # along the leaf
    a = (-sp, 0.0, cp)                     # across (horizontal)
    n = (a[1] * d[2] - a[2] * d[1], a[2] * d[0] - a[0] * d[2], a[0] * d[1] - a[1] * d[0])   # a x d: the leaf's upper side

    def p(u, v, wv):
        return (base[0] + u * a[0] + v * d[0] + wv * n[0], base[1] + u * a[1] + v * d[1] + wv * n[1], base[2] + u * a[2] + v * d[2] + wv * n[2])

    cup = 0.07 * W
    B = p(0, 0, 0)
    m1, m2 = p(0, 0.38 * L, -0.02 * L), p(0, 0.78 * L, -droop * 0.5)
    r1, r2 = p(W / 2, 0.38 * L, cup), p(0.42 * W, 0.8 * L, cup - droop * 0.5)
    l1, l2 = p(-W / 2, 0.38 * L, cup), p(-0.42 * W, 0.8 * L, cup - droop * 0.5)
    tip = p(0, L, -droop)
    for q in ([B, r1, m1], [m1, r1, r2, m2], [m2, r2, tip], [B, m1, l1], [l1, m1, m2, l2], [l2, m2, tip]):
        geo.poly('Leaf', q)


def planter(geo, x, z, r=0.3, seed=1, height=0.55, plant_h=1.85):
    """A round board-formed concrete planter with a fiddle-leaf fig: three stems, broad leaves in a 137.5 degree spiral, no alpha textures."""
    f = Frame(x, z)
    geo.cyl(f, 'Concrete', 0, 0, 0, r, height, seg=32, top=False, bottom=False)
    # a 25 mm rim (top annulus) and the inner wall down to the soil
    geo.ring(f, 'Concrete', 0, height, 0, r - 0.025, r, seg=32, down=False)
    geo.cyl(f, 'Concrete', 0, height - 0.06, 0, r - 0.025, 0.06, seg=32, top=False, bottom=False, inward=True)
    geo.disc(f, 'Soil', 0, height - 0.05, 0, r - 0.025, seg=32, down=False)
    rnd = random.Random(seed)
    golden = math.radians(137.5)
    k = 0
    for s in range(3):
        a0 = s * 2 * math.pi / 3 + rnd.uniform(-0.3, 0.3)
        lean = rnd.uniform(0.04, 0.1)
        sx, sz = math.cos(a0) * 0.06, math.sin(a0) * 0.06
        top = plant_h - s * 0.22 + rnd.uniform(-0.05, 0.05)
        # the stem, in three leaning segments
        segs = 3
        pts = []
        for i in range(segs + 1):
            t = i / segs
            pts.append((x + sx + math.cos(a0) * lean * t * t * 3, height - 0.05 + (top - height) * t, z + sz + math.sin(a0) * lean * t * t * 3))
        for i in range(segs):
            (x0, y0, z0), (x1, y1, z1) = pts[i], pts[i + 1]
            fs = Frame(x0, z0)
            geo.cyl(fs, 'Soil', 0, y0, 0, 0.014 - 0.003 * i, y1 - y0, seg=6, top=False, bottom=False, r_top=0.012 - 0.003 * i)
            # the segment leans: shift the top ring by moving the next frame (the cylinders are short; a small kink reads as a real stem)
        n_leaves = 13 + rnd.randint(0, 4)
        for j in range(n_leaves):
            t = 0.42 + 0.58 * (j / (n_leaves - 1))
            y = height + (top - height) * t
            ti = min(segs - 1e-6, t * segs)
            i0 = int(ti)
            fr = ti - i0
            bx = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * fr
            bz = pts[i0][2] + (pts[i0 + 1][2] - pts[i0][2]) * fr
            phi = k * golden + rnd.uniform(-0.2, 0.2)
            k += 1
            size = 0.2 + 0.16 * (1 - abs(t - 0.62) * 1.4) + rnd.uniform(-0.03, 0.03)
            theta = math.radians(rnd.uniform(10, 45) if t < 0.9 else rnd.uniform(40, 70))
            base = (bx + math.cos(phi) * 0.02, y, bz + math.sin(phi) * 0.02)
            _leaf(geo, base, phi, theta, size, size * 0.66, droop=size * rnd.uniform(0.12, 0.25))


# --- small tables ---------------------------------------------------------------------------------------------------------------------------------
def side_table(geo, x, z, r=0.25, h=0.45):
    f = Frame(x, z)
    geo.cyl(f, 'Steel', 0, 0, 0, r * 0.7, 0.015, seg=32)
    geo.cyl(f, 'Steel', 0, 0.015, 0, 0.022, h - 0.04, seg=12, top=False, bottom=False)
    geo.cyl(f, 'Oak', 0, h - 0.025, 0, r, 0.025, seg=40)


# --- walls ---------------------------------------------------------------------------------------------------------------------------------------
def slat_wall(geo, along_x, face, into, a, b, y0=0.0, y1=3.0, slat=0.042, depth=0.03, pitch=0.07):
    """A vertical oak slat wall on a wall face: a dark acoustic felt backing and slats `slat` wide, `depth` deep at `pitch`. `face` is the
    wall face's coordinate (z for a wall along x), `into` (+1/-1) the direction into the room."""
    n = int((b - a - slat) / pitch)
    off = ((b - a) - (n * pitch + slat)) / 2

    def bx(t0, t1, u0, u1, ya, yb, mat):
        c0, c1 = sorted((face + into * u0, face + into * u1))
        if along_x:
            geo.box(mat, t0, ya, c0, t1, yb, c1)
        else:
            geo.box(mat, c0, ya, t0, c1, yb, t1)

    bx(a, b, 0.0, 0.012, y0, y1, 'ShadowGap')
    for i in range(n + 1):
        t = a + off + i * pitch
        bx(t, t + slat, 0.012, 0.012 + depth, y0 + 0.03, y1 - 0.01, 'Oak')


def directory_sign(geo, along_x, face, into, centre, y0=1.0, width=1.6, height=1.05, colours=(0, 1, 2, 3, 4)):
    """A wall-mounted wayfinding directory: a white solid-surface panel, a colour tab per destination (the floor lines' colours, Accent
    swatches) and dark bars standing in for the lettering."""
    def bx(t0, t1, u0, u1, ya, yb, mat):
        c0, c1 = sorted((face + into * u0, face + into * u1))
        if along_x:
            geo.box(mat, t0, ya, c0, t1, yb, c1)
        else:
            geo.box(mat, c0, ya, t0, c1, yb, t1)

    a, b = centre - width / 2, centre + width / 2
    bx(a, b, 0.0, 0.025, y0, y0 + height, 'SolidSurface')
    # a header bar
    bx(a + 0.08, a + 0.08 + 0.7, 0.025, 0.028, y0 + height - 0.13, y0 + height - 0.07, 'Accent:5')
    rows = len(colours)
    rh = (height - 0.25) / rows
    for k, ci in enumerate(colours):
        yt = y0 + height - 0.2 - k * rh
        bx(a + 0.08, a + 0.16, 0.025, 0.031, yt - rh * 0.72, yt, f'Accent:{ci}')
        ln = 0.42 + 0.23 * ((k * 37) % 5) / 4
        bx(a + 0.22, a + 0.22 + ln, 0.025, 0.028, yt - rh * 0.48, yt - rh * 0.25, 'Accent:5')
        # an arrow block at the far end
        bx(b - 0.16, b - 0.08, 0.025, 0.028, yt - rh * 0.6, yt - rh * 0.12, 'Accent:5')


def door_sign(geo, along_x, face, into, centre, y0, colour, width=1.3, height=0.3):
    """A door-head sign: a white panel with a colour block at its leading end and dark bars for the lettering."""
    def bx(t0, t1, u0, u1, ya, yb, mat):
        c0, c1 = sorted((face + into * u0, face + into * u1))
        if along_x:
            geo.box(mat, t0, ya, c0, t1, yb, c1)
        else:
            geo.box(mat, c0, ya, t0, c1, yb, t1)

    a, b = centre - width / 2, centre + width / 2
    bx(a, b, 0.0, 0.03, y0, y0 + height, 'SolidSurface')
    bx(a, a + height, 0.03, 0.034, y0, y0 + height, f'Accent:{colour}')
    bx(a + height + 0.08, a + height + 0.08 + 0.62, 0.03, 0.033, y0 + height * 0.42, y0 + height * 0.62, 'Accent:5')


def dispenser(geo, along_x, face, into, at, y=1.05):
    """A wall-mounted hand-rub dispenser: a white body, a grey nozzle, a drip tray."""
    def bx(t0, t1, u0, u1, ya, yb, mat):
        c0, c1 = sorted((face + into * u0, face + into * u1))
        if along_x:
            geo.box(mat, t0, ya, c0, t1, yb, c1)
        else:
            geo.box(mat, c0, ya, t0, c1, yb, t1)

    bx(at - 0.06, at + 0.06, 0.0, 0.1, y, y + 0.26, 'SolidSurface')
    bx(at - 0.045, at + 0.045, 0.1, 0.104, y + 0.08, y + 0.2, 'Steel')
    bx(at - 0.05, at + 0.05, 0.0, 0.11, y - 0.12, y - 0.1, 'Steel')


def exit_sign(geo, x, z, w=0.36, h=0.17):
    """A ceiling-hung emergency exit sign: a white box on two rods, the green face toward +x (into the lobby)."""
    from common import Frame
    f = Frame(x, z, math.pi / 2)        # local +z = +x
    y0 = 2.55
    geo.cbox(f, 'SolidSurface', 0, y0, 0, w + 0.03, h + 0.03, 0.05)
    geo.cbox(f, 'Accent:1', 0, y0 + 0.015, 0.026, w - 0.01, h - 0.01, 0.003)
    for s in (-1, 1):
        geo.cyl(f, 'Steel', s * w * 0.35, y0 + h + 0.03, 0, 0.004, 3.0 - (y0 + h + 0.03), seg=6, top=False, bottom=False)
