"""
Zone 'atrium' (the healing atrium, x 12..40, z -12..12, open to the sky): a garden atrium in the building's "clean clinical modern" language.

Light terrazzo underfoot like the lobby (the glossy floor carries the sky and the sun patches), warm stone (Paving) promenades flush in it with a
graphite edge line, four lawn beds in board-formed concrete kerbs, six trees in concrete planters (leaf-card canopies, no alpha), flowering
shrubs on the sim's bush spots, oak slatted benches on stone pads, a long basalt reflecting pool along the pharmacy glass, and the cafe: the kit's
oak-slat counter, a back bar, oak deck, round oak tables and chairs along a full-height curtain wall, under a slatted oak pergola with pendants.

Everything solid stands on the procedural layout's footprints (plan.json `furniture`: bush*, tree*, bench*, pool, counter, backbar, table*,
chair*), so the sim's collision, seats and stations stay true; beds, paths, stones and the deck are ground finishes people walk across.
"""
import math
import random

import materials as mt
from common import Frame
from furniture import _leaf  # the lobby's fiddle-leaf leaf card
from kit import cafe as kcafe
from kit.base import root
from kit.parts import sw, WARMWHITE, WHITE, GRAPHITE, YELLOW
from shell import line_box

X0, X1, Z0, Z1 = 12.0, 40.0, -12.0, 12.0
CH = 3.0

LAWN = mt.role('ground.lawn')           # the shared library's mown lawn (CC0 Poly Haven sparse_grass, recoloured): the four beds ...
LAWN_B = mt.role('ground.lawn.alt')     # ... with its darker twin for every other 1 m mowing stripe (same images, one more draw call)
FOL = mt.role('plant.foliage')          # 'Foliage:<i>': one palette of 12 greens, a tone per leaf / blade (0 deep ... 7 pale tip, 8-9 blue-green, 10-11 golden)

# --- shell settings (zones/__init__.py) ---------------------------------------------------------------------------------------------------------
HERO = [(X0, X1, Z0, Z1)]
FLOORS = {'atrium': 'Terrazzo'}

# review stills (plan x, z) -> look at (x, z), eye 1.6 m, 24 mm
POSES = [((34.0, -10.2), (36.5, 4.0)),           # from the north opening: the cafe, the pergola, the tables on the curtain wall
         ((14.6, -0.4), (40.0, 1.5)),            # along the promenade from the pool end: lawns, trees, benches, the cafe
         ((26.5, 9.5), (13.2, -3.0))]            # from the south lawn across the garden: trees, benches, the pool under the pharmacy glass

# the sim's footprints this design replaces (the runtime hides the procedural pieces inside them: src/scene/building/model/region.ts); 'area:atrium'
# is a change request (beds, walks, stepping stones and the oak deck stand on no footprint: see the report)
REPLACES = ['footprint:atrium:*', 'area:atrium']
VISIBLE_FROM = ['wardA', 'wardB', 'core']


def skip_glazing(w, a, b):
    """The east façade of the atrium: the design draws its own full-height curtain wall."""
    return (not w['alongX']) and abs(w['c'] - X1) < 1e-6


# --- ground -----------------------------------------------------------------------------------------------------------------------------------
KERB_H = 0.07
KERB_W = 0.12


def lawn_h(x, z, seed):
    return 0.043 + 0.012 * math.sin(1.7 * x + 0.6 * z + seed) * math.cos(1.1 * z - 0.4 * x)


def lawn(geo, x0, x1, z0, z1, seed=0.0, cell=0.5):
    """A gently undulating lawn (the Lawn material, smooth quads), 30 to 60 mm above the terrazzo, inside the kerbs, mown in 1 m stripes along x
    (alternate rows of 0.5 m quads take the darker LawnB)."""
    def h(x, z):
        return lawn_h(x, z, seed)

    nx = max(1, round((x1 - x0) / cell))
    nz = max(1, round((z1 - z0) / cell))
    for i in range(nx):
        for j in range(nz):
            xa, xb = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
            za, zb = z0 + (z1 - z0) * j / nz, z0 + (z1 - z0) * (j + 1) / nz
            geo.poly(LAWN_B if (j // 2) % 2 else LAWN, [(xa, h(xa, za), za), (xa, h(xa, zb), zb), (xb, h(xb, zb), zb), (xb, h(xb, za), za)], smooth=True)
            # the soil under the lawn is never seen; the lawn's underside is open (single quads)


def clear_of(x, z, ex):
    """True when (x, z) is outside every exclusion: circles (x, z, r) and rects (x0, x1, z0, z1)."""
    for e in ex:
        if len(e) == 3:
            if math.hypot(x - e[0], z - e[1]) < e[2]:
                return False
        elif e[0] <= x <= e[1] and e[2] <= z <= e[3]:
            return False
    return True


class _Fol:
    """Leaf cards (furniture._leaf draws into geo.poly('Leaf', ...)) into the Foliage palette: `tone` is the swatch of the leaf being drawn."""

    def __init__(self, geo):
        self.geo = geo
        self.tone = 3

    def poly(self, mat, pts, smooth=False):
        return self.geo.poly(f'{FOL}:{self.tone}', pts, smooth)


def daisies(geo, x0, x1, z0, z1, seed, ex, per_m2=0.1):
    """A light scatter of white daisies (a flat hexagon with a yellow eye on a thin stalk) over a lawn: a few, so the lawn is not dotted."""
    rnd = random.Random(seed * 100 + 7)
    n = int((x1 - x0) * (z1 - z0) * per_m2)
    for _ in range(n):
        x, z = rnd.uniform(x0, x1), rnd.uniform(z0, z1)
        if not clear_of(x, z, ex):
            continue
        y = lawn_h(x, z, seed)
        fy = y + rnd.uniform(0.07, 0.11)
        r = rnd.uniform(0.02, 0.028)
        geo.poly(f'{FOL}:3', [(x - 0.003, y - 0.004, z), (x + 0.003, y - 0.004, z), (x, fy, z)])
        geo.poly(sw(WARMWHITE), [(x + r * math.cos(t), fy, z + r * math.sin(t)) for t in (0, 1.047, 2.094, 3.14, 4.19, 5.24)])
        geo.poly(sw(YELLOW), [(x + 0.01 * math.cos(t), fy + 0.001, z + 0.01 * math.sin(t)) for t in (0, 1.57, 3.14, 4.71)])


# --- planting: ornamental grasses and ground-cover cushions (replace the hosta-like rosettes) ----------------------------------------------------
# blade tone families: the Foliage swatches of a blade's base, middle and tip segments
GREEN, BLUE, GOLD, LIME = (1, 3, 6), (8, 9, 9), (10, 11, 7), (3, 5, 7)


def blade_clump(geo, x, z, h, seed, y=0.04, n=34, spread=0.16, fam=GREEN):
    """A clump of ornamental grass (carex / hakonechloa): n arching ribbon blades (two quads and a tip triangle, tapering, slightly twisted), the
    centre tallest, darker at the base and paler at the tip, in a mound `spread` wide and about `h` high."""
    rnd = random.Random(seed)
    for _ in range(n):
        r0 = spread * math.sqrt(rnd.random()) * 0.8
        a0 = rnd.uniform(0, 2 * math.pi)
        a = a0 + rnd.uniform(-0.45, 0.45)                           # mostly outwards
        hh = h * rnd.uniform(0.6, 1.0) * (1.0 - 0.3 * r0 / max(spread, 1e-3))
        lean = hh * rnd.uniform(0.3, 0.8)
        w0 = rnd.uniform(0.009, 0.015)
        ca, sa = math.cos(a), math.sin(a)
        bx, bz = x + math.cos(a0) * r0, z + math.sin(a0) * r0
        tw = rnd.uniform(-0.8, 0.8)
        st = []
        for t, wf in ((0.0, 1.0), (0.38, 0.95), (0.72, 0.6), (1.0, 0.0)):
            d = lean * t * t
            yy = y + hh * t * (1.0 - 0.35 * t)
            px, pz = bx + ca * d, bz + sa * d
            wv = w0 * wf * 0.5
            ac, as_ = math.cos(tw * t), math.sin(tw * t)             # the ribbon twists a little along its length
            st.append(((px - sa * wv * ac, yy + wv * as_, pz + ca * wv * ac), (px + sa * wv * ac, yy - wv * as_, pz - ca * wv * ac), (px, yy, pz)))
        j = rnd.randint(-1, 1) if fam in (GREEN, LIME) else 0         # a shade lighter or darker per blade
        for k in range(2):
            geo.poly(f'{FOL}:{max(0, min(11, fam[k] + j))}', [st[k][0], st[k][1], st[k + 1][1], st[k + 1][0]])
        geo.poly(f'{FOL}:{fam[2]}', [st[2][0], st[2][1], st[3][2]])


def _small_leaf(geo, base, phi, theta, L, W):
    """A small ovate leaf (four triangles, folded along the midrib, the tip a little down): base point, azimuth phi, elevation theta."""
    cp, sp, ct, st_ = math.cos(phi), math.sin(phi), math.cos(theta), math.sin(theta)
    d = (ct * cp, st_, ct * sp)
    a = (-sp, 0.0, cp)
    n = (a[1] * d[2] - a[2] * d[1], a[2] * d[0] - a[0] * d[2], a[0] * d[1] - a[1] * d[0])

    def p(u, v, wv):
        return (base[0] + u * a[0] + v * d[0] + wv * n[0], base[1] + u * a[1] + v * d[1] + wv * n[1], base[2] + u * a[2] + v * d[2] + wv * n[2])

    B, M, T = p(0, 0, 0), p(0, 0.5 * L, -0.01 * L), p(0, L, -0.14 * L)
    R, Lf = p(W / 2, 0.45 * L, 0.06 * W), p(-W / 2, 0.45 * L, 0.06 * W)
    for q in ([B, R, M], [M, R, T], [B, M, Lf], [M, T, Lf]):
        geo.poly('Leaf', q)


def cushion(geo, x, z, r, seed, y=0.04, tones=(2, 5), flowers=False):
    """A low mound of ground cover (geranium / bergenia like): ~30 small ovate leaves in a dome r wide and 0.1 to 0.2 m high, the centre's leaves
    steeper and a shade paler than the rim's; a few white flowers on thin stalks for some."""
    rnd = random.Random(seed)
    fol = _Fol(geo)
    n = max(14, int(34 * (r / 0.2) ** 2))
    for _ in range(n):
        a = rnd.uniform(0, 2 * math.pi)
        q = math.sqrt(rnd.random())
        rad = r * 0.9 * q
        theta = math.radians(62 - 40 * q + rnd.uniform(-8, 8))
        L = rnd.uniform(0.07, 0.115) * (0.8 + r)
        by = y + 0.035 * (1.0 - q * q) + rnd.uniform(0.0, 0.012)
        fol.tone = max(0, min(11, rnd.randint(tones[0], tones[1]) + (1 if q < 0.45 else 0)))
        _small_leaf(fol, (x + math.cos(a) * rad * 0.7, by, z + math.sin(a) * rad * 0.7), a, theta, L, L * rnd.uniform(0.62, 0.8))
    if flowers:
        for _ in range(max(3, int(n * 0.2))):
            a = rnd.uniform(0, 2 * math.pi)
            rad = r * 0.7 * math.sqrt(rnd.random())
            fx, fz = x + math.cos(a) * rad, z + math.sin(a) * rad
            fy = y + 0.17 + rnd.uniform(0.0, 0.06)
            geo.poly(f'{FOL}:3', [(fx - 0.002, y + 0.08, fz), (fx + 0.002, y + 0.08, fz), (fx, fy, fz)])
            rr = rnd.uniform(0.014, 0.02)
            geo.poly(sw(WARMWHITE), [(fx + rr * math.cos(t), fy, fz + rr * math.sin(t)) for t in (0, 1.047, 2.094, 3.14, 4.19, 5.24)])


MULCH_W = 0.95
MULCH_H = 0.052


def _border_row(geo, rnd, pts_fn, length, seed0, kind):
    """Fill one row of a border: pts_fn(s) -> (x, z) at distance s along it; clumps `grass`, cushions `cush` or a mix `mixed`."""
    s = rnd.uniform(0.1, 0.3)
    i = 0
    while s < length - 0.1:
        x, z = pts_fn(s)
        sd = seed0 + i
        if kind == 'grass':
            fam = rnd.choice((GREEN, GREEN, LIME, BLUE, GOLD))
            blade_clump(geo, x, z, rnd.uniform(0.34, 0.62), sd, y=MULCH_H - 0.004, n=rnd.randint(24, 34), spread=rnd.uniform(0.13, 0.2), fam=fam)
            s += rnd.uniform(0.45, 0.75)
        else:
            tones = rnd.choice(((2, 4), (3, 6), (8, 9), (1, 3)))
            cushion(geo, x, z, rnd.uniform(0.19, 0.29), sd, y=MULCH_H - 0.004, tones=tones, flowers=(rnd.random() < 0.3))
            s += rnd.uniform(0.27, 0.42)
        i += 1


def kerb_planting(geo, x0, x1, z0, z1, kerbs, seed):
    """A planted border along the inside of each kerb: a 0.95 m band of dark mulch (Soil, 9 mm proud of the lawn) with a back row of ornamental
    grass clumps against the kerb and a front row of ground-cover cushions spilling towards the lawn, jittered and overlapping."""
    rnd = random.Random(seed + 5)
    mw = MULCH_W
    for side in kerbs:
        if side in 'we':
            xa, xb = (x0, x0 + mw) if side == 'w' else (x1 - mw, x1)
            za, zb = (z0 + (mw if 'n' in kerbs else 0.0), z1 - (mw if 's' in kerbs else 0.0))
            geo.box('Soil', xa, 0.0, z0 if 'n' not in kerbs else z0 + mw, xb, MULCH_H, z1 if 's' not in kerbs else z1 - mw, drop=('down',))
            L = zb - za
            for off, kind in ((0.26, 'grass'), (0.68, 'cush')):
                xr = xa + off if side == 'w' else xb - off
                _border_row(geo, rnd, lambda s, xr=xr: (xr + rnd.uniform(-0.07, 0.07), za + s), L, int(seed * 100) + (side == 'e') * 4000 + off * 1000, kind)
        else:
            za, zb = (z0, z0 + mw) if side == 'n' else (z1 - mw, z1)
            geo.box('Soil', x0, 0.0, za, x1, MULCH_H, zb, drop=('down',))
            L = x1 - x0
            for off, kind in ((0.26, 'grass'), (0.68, 'cush')):
                zr = za + off if side == 'n' else zb - off
                _border_row(geo, rnd, lambda s, zr=zr: (x0 + s, zr + rnd.uniform(-0.07, 0.07)), L, int(seed * 100) + 8000 + (side == 's') * 4000 + off * 1000, kind)


def bed(geo, x0, x1, z0, z1, kerbs, seed):
    """A lawn bed with concrete kerbs on the sides named in `kerbs` ('w', 'e', 'n', 's'; no kerb where it meets the glass)."""
    lawn(geo, x0, x1, z0, z1, seed)
    k = KERB_W
    if 'w' in kerbs:
        geo.box('Concrete', x0 - k, 0.0, z0, x0, KERB_H, z1, drop=('down',))
    if 'e' in kerbs:
        geo.box('Concrete', x1, 0.0, z0, x1 + k, KERB_H, z1, drop=('down',))
    if 'n' in kerbs:
        geo.box('Concrete', x0 - (k if 'w' in kerbs else 0), 0.0, z0 - k, x1 + (k if 'e' in kerbs else 0), KERB_H, z0, drop=('down',))
    if 's' in kerbs:
        geo.box('Concrete', x0 - (k if 'w' in kerbs else 0), 0.0, z1, x1 + (k if 'e' in kerbs else 0), KERB_H, z1 + k, drop=('down',))


def paving_band(geo, x0, x1, z0, z1, edge=True):
    """Stone paving flush in the terrazzo (4 mm proud) with a 12 mm graphite edge line along its long sides."""
    geo.box('Paving', x0, 0.0, z0, x1, 0.004, z1, drop=('down',))
    if edge:
        e = 0.012
        if x1 - x0 > z1 - z0:
            for z in (z0 - e, z1):
                geo.box('Steel', x0, 0.0, z, x1, 0.006, z + e, drop=('down',))
        else:
            for x in (x0 - e, x1):
                geo.box('Steel', x, 0.0, z0, x + e, 0.006, z1, drop=('down',))


def ground(geo):
    # beds (the procedural beds' footprint, now with kerbs; the lawn runs to the glass where there is no kerb)
    beds = [(14.4, 32.4, -11.88, -1.3, 'wes', 0.0), (14.4, 32.4, 1.3, 11.88, 'wen', 1.9), (35.4, 39.85, -11.88, -3.2, 'ws', 3.1),
            (35.4, 39.85, 9.2, 11.88, 'wn', 4.4)]
    # no tuft on a stone: stepping stones, bench pads and the tree planters
    ex = [(20.0, -4.7, 0.5), (25.0, -4.7, 0.5), (20.0, 4.7, 0.5), (25.0, 4.7, 0.5)] + [(x, z, 0.55) for (x, z, _h, _r, _s) in TREES]
    ex += [(bx - 1.15, bx + 1.15, bz - 0.65, bz + 0.65) for (bx, bz) in ((18.4, -10.4), (22.4, -10.4), (18.4, 10.4), (22.4, 10.4))]
    ex += [(x, z, 0.5) for (x, z) in BUSHES]
    for (a, b, c, d, kk, sd) in beds:
        bed(geo, a, b, c, d, kk, sd)
        daisies(geo, a + 0.1, b - 0.1, c + 0.1, d - 0.1, sd, ex)
        kerb_planting(geo, a, b, c, d, kk, sd)
    # promenades: along z = 0 from the pool end to the deck, and the two arrivals from the corridor openings (x = 34)
    paving_band(geo, 14.2, 32.4, -1.1, 1.1)
    paving_band(geo, 32.8, 35.2, -11.9, -2.4)
    paving_band(geo, 32.8, 35.2, 9.0, 11.9)
    # stepping stones across the lawns towards the benches
    for (x, z) in ((20.0, -4.7), (25.0, -4.7), (20.0, 4.7), (25.0, 4.7)):
        geo.cyl(Frame(x, z), 'Paving', 0, 0.0, 0, 0.4, 0.07, seg=24, bottom=False)


def deck(geo):
    """The cafe's oak deck: boards along x with 6 mm gaps, 25 mm proud of the terrazzo."""
    x0, x1, z0, z1 = 32.4, 39.9, -2.4, 9.0
    w, g = 0.14, 0.006
    n = int((z1 - z0) / (w + g))
    for i in range(n):
        z = z0 + i * (w + g)
        geo.box('Oak', x0, 0.0, z, x1, 0.025, z + w, drop=('down',))
    # a graphite edge where the deck meets the stone
    geo.box('Steel', x0 - 0.012, 0.0, z0, x0, 0.027, z1, drop=('down',))
    geo.box('Steel', x0 - 0.012, 0.0, z0 - 0.012, x1, 0.027, z0, drop=('down',))


# --- planting ---------------------------------------------------------------------------------------------------------------------------------
def tree(geo, x, z, height, radius, seed):
    """A tree in a round concrete planter (0.6 m across, on the sim's tree footprint): a leaning trunk and branches, and a canopy of ~800 leaf
    cards (no alpha) in a flattened ellipsoid, denser at its rim."""
    rnd = random.Random(seed)
    f = Frame(x, z)
    ph = 0.46
    geo.cyl(f, 'Concrete', 0, 0.0, 0, 0.3, ph, seg=32, top=False, bottom=False)
    geo.ring(f, 'Concrete', 0, ph, 0, 0.275, 0.3, seg=32, down=False)
    geo.cyl(f, 'Concrete', 0, ph - 0.06, 0, 0.275, 0.06, seg=32, top=False, bottom=False, inward=True)
    geo.disc(f, 'Soil', 0, ph - 0.05, 0, 0.275, seg=32, down=False)
    k = root(geo, f)
    lean = (rnd.uniform(-0.18, 0.18), rnd.uniform(-0.18, 0.18))
    trunk_h = height * 0.42
    k.tube('Soil', [(0, ph - 0.05, 0), (lean[0] * 0.4, ph + trunk_h * 0.5, lean[1] * 0.4), (lean[0], ph + trunk_h, lean[1])], 0.045, seg=8)
    ry = height * 0.25
    cy = height - ry * 0.9
    rx = radius
    top = (lean[0], ph + trunk_h, lean[1])
    # branches into the canopy
    for _ in range(6):
        a = rnd.uniform(0, 2 * math.pi)
        d = rnd.uniform(0.45, 0.8) * rx
        end = (lean[0] + math.cos(a) * d, cy + rnd.uniform(-0.4, 0.4) * ry, lean[1] + math.sin(a) * d)
        mid = ((top[0] + end[0]) / 2, (top[1] + end[1]) / 2 - 0.05, (top[2] + end[2]) / 2)
        k.tube('Soil', [top, mid, end], 0.022, seg=6)
    fol = _Fol(geo)
    n = 1000
    for _ in range(n):
        while True:
            v = (rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))
            m = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
            if m > 1e-3:
                break
        u = (v[0] / m, v[1] / m, v[2] / m)
        r = 0.5 + 0.5 * rnd.random() ** 0.45
        px, py, pz = lean[0] + u[0] * rx * r, cy + u[1] * ry * r, lean[1] + u[2] * rx * r
        if py < 1.75:
            py = 1.75 + rnd.random() * 0.3
        phi = math.atan2(u[2], u[0]) + rnd.uniform(-0.9, 0.9)
        theta = math.radians(max(-15.0, min(65.0, math.degrees(math.asin(max(-1, min(1, u[1])))) + rnd.uniform(-20, 20))))
        size = rnd.uniform(0.21, 0.35)
        light = 0.5 * (0.5 + 0.5 * u[1]) + 0.5 * r                  # the sunlit crown and the outer rim are paler, the inside deeper
        fol.tone = max(0, min(7, int(round(1.0 + 4.5 * light + rnd.uniform(-1.3, 1.3)))))
        _leaf(fol, (x + px, py, z + pz), phi, theta, size, size * 0.58, droop=size * rnd.uniform(0.08, 0.22))


def shrub(geo, x, z, seed, flower=True):
    """A flowering shrub on a bush footprint (radius 0.4): ~70 leaf cards in a mound 0.8 m high and a scatter of warm-white blossoms."""
    rnd = random.Random(seed)
    fol = _Fol(geo)
    for _ in range(130):
        a = rnd.uniform(0, 2 * math.pi)
        r = 0.5 * rnd.random() ** 0.6
        y = 0.12 + 0.8 * (1 - (r / 0.5) ** 2) * rnd.uniform(0.55, 1.0)
        size = rnd.uniform(0.14, 0.24)
        fol.tone = max(0, min(7, int(round(1.5 + 3.5 * (y - 0.12) / 0.8 + rnd.uniform(-1.2, 1.2)))))
        _leaf(fol, (x + math.cos(a) * r, y, z + math.sin(a) * r), a + rnd.uniform(-0.6, 0.6), math.radians(rnd.uniform(25, 70)), size, size * 0.55,
              droop=size * 0.15)
    if flower:
        k = root(geo, Frame(x, z))
        for _ in range(14):
            a = rnd.uniform(0, 2 * math.pi)
            r = 0.46 * rnd.random() ** 0.7
            y = 0.2 + 0.78 * (1 - (r / 0.46) ** 2) * rnd.uniform(0.7, 1.0)
            k.sphere(sw(WARMWHITE), (math.cos(a) * r, y + 0.08, math.sin(a) * r), rnd.uniform(0.04, 0.065), seg=8, rings=4)


TREES = [  # footprint ids atrium:tree0..5: (x, z, height, canopy radius, seed)
    (23.2, -7.7, 4.8, 1.7, 3), (28.8, -7.7, 4.4, 1.6, 5), (15.9, -10.4, 4.2, 1.5, 7),
    (38.2, -10.3, 4.6, 1.5, 11), (23.2, 7.7, 4.2, 1.7, 13), (38.2, 10.3, 4.2, 1.5, 17),
]
BUSHES = [(18.2, -11.3), (20.1, -11.3), (22.0, -11.3), (24.8, -11.3), (18.2, 11.3), (20.1, 11.3), (22.0, 11.3), (24.8, 11.3), (27.0, -11.2),
          (27.0, 11.2)]


def planting(geo, fur):
    fp = fur['footprints']
    # ornamental grass between the shrubs along the north and south glass, and at the kerb ends
    n = 0
    rnd = random.Random(31)
    for sz in (-1, 1):
        x = 15.0
        while x < 32.0:
            if clear_of(x, sz * 11.3, [(bx, bz, 0.45) for (bx, bz) in BUSHES] + [(15.9, sz * 10.4, 0.5)]):
                blade_clump(geo, x, sz * (11.45 + 0.2 * math.sin(x * 2.1)), 0.5 + 0.25 * math.sin(x * 1.3 + sz), 900 + n, n=rnd.randint(36, 52),
                            spread=0.2, fam=rnd.choice((GREEN, LIME, GREEN, GOLD)))
                n += 1
            x += 0.5
    for i, (x, z, h, r, s) in enumerate(TREES):
        p = fp.get(f'atrium:tree{i}')
        tx, tz = (p['x'], p['z']) if p else (x, z)
        tree(geo, tx, tz, h, r, s)
        geo.cyl(Frame(tx, tz), 'Soil', 0, 0.0, 0, 0.95, MULCH_H, seg=32, bottom=False)       # a mulch ring round the planter: cushions and grass
        for k in range(6):
            a = 2 * math.pi * k / 6 + i + rnd.uniform(-0.15, 0.15)
            cushion(geo, tx + math.cos(a) * 0.62, tz + math.sin(a) * 0.62, rnd.uniform(0.17, 0.24), 600 + i * 20 + k, y=MULCH_H - 0.004,
                    tones=rnd.choice(((2, 4), (3, 6), (8, 9))), flowers=(k % 3 == 0))
        for k in range(4):
            a = 2 * math.pi * (k + 0.5) / 4 + i * 0.7
            blade_clump(geo, tx + math.cos(a) * 0.74, tz + math.sin(a) * 0.74, rnd.uniform(0.3, 0.5), 650 + i * 20 + k, y=MULCH_H - 0.004,
                        n=30, spread=0.15, fam=rnd.choice((GREEN, LIME, BLUE)))
    for (x, z) in ((20.0, -4.7), (25.0, -4.7), (20.0, 4.7), (25.0, 4.7)):     # and a cushion and a tuft at each stepping stone
        a = 0.7 + 0.37 * x
        cushion(geo, x + math.cos(a) * 0.58, z + math.sin(a) * 0.58, 0.2, 700 + int(x + z), y=lawn_h(x, z, 0.0 if z < 0 else 1.9), tones=(2, 5), flowers=True)
        blade_clump(geo, x + math.cos(a + 3.3) * 0.56, z + math.sin(a + 3.3) * 0.56, 0.28, 710 + int(x + z), y=lawn_h(x, z, 0.0 if z < 0 else 1.9), n=26, spread=0.11, fam=LIME)
    for i, (x, z) in enumerate(BUSHES):
        p = fp.get(f'atrium:bush{i}')
        shrub(geo, p['x'] if p else x, p['z'] if p else z, 40 + i, flower=(i % 3 != 1))


# --- benches ----------------------------------------------------------------------------------------------------------------------------------
def benches(ctx):
    geo = ctx.geo
    for fid, p in sorted(ctx.fur['footprints'].items()):
        if not fid.startswith('atrium:bench'):
            continue
        f = Frame(p['x'], p['z'], p['rotationY'])
        # a stone pad flush with the kerb height, so the legs stand on stone, not in the lawn
        geo.fbox(f, 'Paving', -1.05, 0.0, -0.55, 1.05, 0.062, 0.55, drop=('down',))
        geo.fbox(f, 'Steel', -1.05 - 0.012, 0.0, -0.55, -1.05, 0.064, 0.55, drop=('down',))
        kcafe.bench(geo, Frame(p['x'], p['z'], p['rotationY'], y=0.062), length=p['w'], h=0.44, d=0.5)


# --- the pool ----------------------------------------------------------------------------------------------------------------------------------
def pool(geo):
    """A long basalt reflecting pool along the pharmacy glass: a concrete coping 160 mm proud, a graphite basin, a 1 cm sheet of water 40 mm
    below the coping, five stainless bubblers."""
    x0, x1, z0, z1 = 12.2, 14.0, -8.85, 8.85
    t = 0.2
    top = 0.16
    for (a0, b0, a1, b1) in ((x0, z0, x1, z0 + t), (x0, z1 - t, x1, z1), (x0, z0 + t, x0 + t, z1 - t), (x1 - t, z0 + t, x1, z1 - t)):
        geo.box('Concrete', a0, 0.0, b0, a1, top, b1, drop=('down',))
    geo.box('Steel', x0 + t, 0.0, z0 + t, x1 - t, 0.03, z1 - t, drop=('down',))
    geo.box('Glass', x0 + t, 0.115, z0 + t, x1 - t, 0.12, z1 - t, drop=('down',))
    k = root(geo, Frame(0, 0))
    for i in range(5):
        z = -6.5 + i * 3.25
        k.vcyl('Stainless', (x0 + x1) / 2, 0.03, z, 0.022, 0.1, seg=12, r2=0.016)
        k.vcyl('Stainless', (x0 + x1) / 2, 0.09, z, 0.034, 0.02, seg=16)


# --- the cafe ---------------------------------------------------------------------------------------------------------------------------------
def cafe_counter(ctx):
    geo = ctx.geo
    fp = ctx.fur['footprints']
    c, bb = fp['atrium:counter'], fp['atrium:backbar']
    # front counter: the kit's oak-slat counter on the counter footprint, customers on the +z (east) side
    kcafe.counter(geo, Frame(c['x'], c['z'], c['rotationY']), length=c['w'] - 0.1, depth=c['d'] - 0.04, back=False)
    # back bar on the back bar footprint, 1.14 m high (the menu board's posts stand on it)
    f = Frame(bb['x'], bb['z'], bb['rotationY'])
    k = root(geo, f)
    L, D = bb['w'] / 2, bb['d'] / 2
    k.box('ShadowGap', -L + 0.04, 0.0, -D + 0.03, L - 0.04, 0.1, D - 0.04, drop=('down', 'up'))
    k.box('SolidSurface', -L, 0.1, -D, L, 1.10, D)
    k.box('SolidSurface', -L - 0.02, 1.10, -D - 0.01, L + 0.02, 1.14, D + 0.03)
    n = int(2 * L / 0.6)
    for i in range(n):
        x0 = -L + 0.03 + i * (2 * L - 0.06) / n
        k.box('Oak', x0 + 0.004, 0.115, D, x0 + (2 * L - 0.06) / n - 0.004, 1.085, D + 0.016, bev=0.002)
    # espresso machine and grinder on the top, clear of the menu board posts (local x +-0.85)
    cm = k.at(1.3, 1.14, 0.0)
    cm.rbox('Stainless', 0, 0, 0, 0.75, 0.48, 0.46, 0.04, axis='y', seg=3)
    cm.box(sw(GRAPHITE), -0.36, 0.1, 0.22, 0.36, 0.4, 0.232)
    for s in (-1, 1):
        cm.vcyl('Stainless', s * 0.2, 0.18, 0.26, 0.032, 0.06, seg=12)
    cm.box('Screen', -0.08, 0.34, 0.232, 0.08, 0.4, 0.234)
    cm.vcyl(sw(GRAPHITE), 0.0, 0.48, 0.0, 0.1, 0.05, seg=16)
    gr = k.at(-1.3, 1.14, 0.0)
    gr.rbox(sw(GRAPHITE), 0, 0, 0, 0.22, 0.4, 0.24, 0.03, axis='y', seg=3)
    gr.vcyl(sw(WHITE), 0, 0.4, 0, 0.07, 0.1, seg=16, r2=0.1)


def cafe_seating(ctx):
    geo = ctx.geo
    fp = ctx.fur['footprints']
    for i in range(4):
        t = fp[f'atrium:table{i}']
        kcafe.table(geo, Frame(t['x'], t['z']), kind='round', size=0.72, h=0.74)
        for s in 'ab':
            c = fp[f'atrium:chair{i}{s}']
            # the sitter faces the table
            h = math.atan2(t['x'] - c['x'], t['z'] - c['z'])
            kcafe.chair(geo, Frame(c['x'], c['z'], h), seat_h=0.45)


def pergola(geo):
    """A slatted oak pergola over the counter: four graphite posts at its corners, two beams, oak slats at 150 mm, four pendants. It frames the
    cafe and throws a stripe pattern on the deck."""
    x0, x1, z0, z1, y = 32.3, 36.3, 0.8, 5.2, 2.78
    k = root(geo, Frame(0, 0))
    for (x, z) in ((x0, z0), (x0, z1), (x1, z0), (x1, z1)):
        geo.cyl(Frame(x, z), 'Steel', 0, 0.0, 0, 0.045, y, seg=16, bottom=False)
    for z in (z0, z1):
        geo.box('Steel', x0 - 0.1, y, z - 0.05, x1 + 0.1, y + 0.16, z + 0.05)
    n = int((x1 - x0 + 0.2) / 0.15)
    for i in range(n + 1):
        x = x0 - 0.1 + i * 0.15
        geo.box('Oak', x, y + 0.16, z0 - 0.15, x + 0.05, y + 0.2, z1 + 0.15)
    for i in range(4):
        z = 1.5 + i * 1.0
        x = 34.9
        k.cyl('Steel', (x, y, z), (x, 2.28, z), 0.004, seg=6)
        k.vcyl('SolidSurface', x, 2.16, z, 0.13, 0.12, seg=24, r2=0.1)
        k.disc('LightPanel', x, 2.159, z, 0.1, seg=24, up=False)


def curtain_wall(geo, pl):
    """The east façade: a full-height glazed curtain wall (the lobby's: graphite mullions at ~1.5 m, sill and head profiles, a transom at door
    height) from the floor to the wall head."""
    H = CH
    for w in pl.walls():
        if w['cls'] != 'glassCut':
            continue
        for a, b in pl.spans(w):
            if not skip_glazing(w, a, b):
                continue
            line_box(geo, 'Mullion', w, a, b, 0.0, 0.06, 0.16)
            line_box(geo, 'Mullion', w, a, b, H - 0.06, H + 0.06, 0.16)
            line_box(geo, 'Mullion', w, a, b, pl.DOOR_H, pl.DOOR_H + 0.05, 0.12)
            line_box(geo, 'Glass', w, a, b, 0.06, H - 0.06, 0.012)
            n = max(1, round((b - a) / 1.5))
            for k in range(n + 1):
                t = a + (b - a) * k / n
                line_box(geo, 'Mullion', w, max(a, t - 0.025), min(b, t + 0.025), 0.06, H - 0.06, 0.16)


def build(ctx):
    geo, pl = ctx.geo, ctx.pl
    ground(geo)
    deck(geo)
    planting(geo, ctx.fur)
    benches(ctx)
    pool(geo)
    cafe_counter(ctx)
    cafe_seating(ctx)
    pergola(geo)
    curtain_wall(geo, pl)
