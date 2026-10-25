"""
Sub-assemblies shared by the kit's items: castors, monitors, wall dispensers, gas outlets and sockets, bar handles, gas cylinders, drapes.
They take an emitter `k` (kit.base.K) and local coordinates; materials come from the shared library (materials.json roles).

KitPlastic swatches (materials.json): 0 white, 1 light grey, 2 mid grey, 3 graphite, 4 black, 5 sharps yellow, 6 signal red, 7 glove blue,
8 green, 9 orange, 10 purple, 11 slate blue, 12 pale blue, 13 crash-cart red, 14 warm white, 15 clear blue.
"""
import math

from .base import anchor, rounded_rect

PL = 'KitPlastic'


def sw(i):
    """The KitPlastic swatch i as a material name."""
    return f'{PL}:{i}'


WHITE, LGREY, MGREY, GRAPHITE, BLACK, YELLOW, RED, BLUE, GREEN, ORANGE, PURPLE, SLATE, PALEBLUE, CARTRED, WARMWHITE, CLEAR = range(16)


def castor(k, x, z, r=0.05, w=None, housing=GRAPHITE, top=None, swivel=0.0, twin=False, tyre='Rubber'):
    """A swivel castor whose wheel touches the floor at local (x, z): wheel (rubber tyre on a grey hub), fork/housing, stem up to `top`.
    `tyre`: the tyre's material ('Rubber'; a zone without Rubber can pass sw(BLACK) and save a draw call)."""
    w = w or r * 0.7
    c = k.at(x, 0, z, ry=swivel)
    trail = r * 0.45
    # wheel along local x, centre at (0, r, -trail)
    if twin:
        for s in (-1, 1):
            c.cyl(tyre, (s * w * 0.15, r, -trail), (s * (w * 0.15 + w * 0.42), r, -trail), r, seg=10)
    else:
        c.cyl(tyre, (-w / 2, r, -trail), (w / 2, r, -trail), r, seg=16)
        c.cyl(sw(MGREY), (-w / 2 - 0.002, r, -trail), (w / 2 + 0.002, r, -trail), r * 0.55, seg=10)
    # housing: a rounded hood over the wheel's top and the swivel head
    hw = w + 0.012
    c.rbox(sw(housing), 0, r * 1.15, -trail * 0.5, hw, r * 0.85, r * 1.2, r * 0.3, axis='x', seg=3)
    t = top if top is not None else r * 2.3
    if t > r * 2.0:
        c.vcyl(sw(housing), 0, r * 1.9, 0, w * 0.32, t - r * 1.9, seg=10)


def bar_handle(k, x0, x1, y, z, mat='Stainless', r=0.008, stand=0.035, axis='x'):
    """A D-handle: a round bar on two standoffs, from x0 to x1 (axis 'x') or from y=x0 to x1 at local x=y (axis 'y'), standing out along +z."""
    if axis == 'x':
        k.tube(mat, [(x0, y, z), (x0, y, z + stand), (x1, y, z + stand), (x1, y, z)], r, seg=8)
    else:
        k.tube(mat, [(y, x0, z), (y, x0, z + stand), (y, x1, z + stand), (y, x1, z)], r, seg=8)


def monitor(k, w=0.36, h=0.28, d=0.07, body=WHITE, handle=True, name=None, stand=False):
    """A monitor facing local +z, centred at the origin of k (its back at z = -d/2): a rounded plastic body, the dark glass screen, a bottom
    bezel with a control knob, a carry handle on top. Records the screen rectangle as an anchor ('screen' or name)."""
    k.rbox(sw(body), 0, -h / 2, 0, w, h, d, min(0.02, d * 0.3), axis='z', seg=3)
    bez = 0.018
    sw_, sh_ = w - 2 * bez, h - bez - 0.045
    k.box('Screen', -sw_ / 2, -h / 2 + 0.04, d / 2, sw_ / 2, -h / 2 + 0.04 + sh_, d / 2 + 0.002)
    k.cyl(sw(GRAPHITE), (w / 2 - 0.045, -h / 2 + 0.02, d / 2), (w / 2 - 0.045, -h / 2 + 0.02, d / 2 + 0.008), 0.009, seg=10)
    k.box(sw(GREEN), -w / 2 + 0.03, -h / 2 + 0.016, d / 2, -w / 2 + 0.045, -h / 2 + 0.024, d / 2 + 0.002)
    if handle:
        k.tube(sw(LGREY), [(-w * 0.3, h / 2 - 0.01, 0), (-w * 0.3, h / 2 + 0.03, 0), (w * 0.3, h / 2 + 0.03, 0), (w * 0.3, h / 2 - 0.01, 0)],
               0.009, seg=8)
    if stand:
        k.rbox(sw(GRAPHITE), 0, -h / 2 - 0.12, -d / 2 - 0.02, 0.06, 0.13, 0.03, 0.01, axis='z')
        k.rbox(sw(GRAPHITE), 0, -h / 2 - 0.13, -0.02, 0.22, 0.012, 0.17, 0.03, axis='y')
    anchor(k, name or 'screen', 0, -h / 2 + 0.04 + sh_ / 2, d / 2 + 0.002, w=round(sw_, 3), h=round(sh_, 3))


def flat_monitor(k, w=0.54, h=0.33, d=0.03, name=None):
    """A slim desktop display (workstations, nurse stations) facing +z, centred at k's origin."""
    k.rbox(sw(GRAPHITE), 0, -h / 2, 0, w, h, d, 0.006, axis='z', seg=2)
    k.box('Screen', -w / 2 + 0.008, -h / 2 + 0.018, d / 2, w / 2 - 0.008, h / 2 - 0.008, d / 2 + 0.002)
    anchor(k, name or 'screen', 0, 0.005, d / 2 + 0.002, w=round(w - 0.016, 3), h=round(h - 0.026, 3))


def dispenser(k, x, y, body=WHITE, window=CLEAR, w=0.1, h=0.22, d=0.1):
    """A wall soap / alcohol-gel dispenser: body, a window on the bottle, the push lever under it. (x, y) = its bottom centre on the wall."""
    k.rbox(sw(body), x, y, d / 2, w, h, d, 0.025, axis='y', seg=3)
    k.box(sw(window), x - w * 0.3, y + h * 0.35, d, x + w * 0.3, y + h * 0.75, d + 0.002)
    k.rbox(sw(GRAPHITE), x, y - 0.012, d * 0.62, w * 0.75, 0.03, d * 0.5, 0.01, axis='x', seg=2)


def gas_outlet(k, x, y, colour, z=0.0):
    """A medical gas outlet on a wall or service head face (at local z, facing +z): a white plate, the coloured identification collar, the
    socket."""
    k.cyl(sw(WHITE), (x, y, z), (x, y, z + 0.012), 0.036, seg=16)
    k.cyl(sw(colour), (x, y, z + 0.012), (x, y, z + 0.024), 0.026, seg=16)
    k.cyl(sw(GRAPHITE), (x, y, z + 0.024), (x, y, z + 0.03), 0.012, seg=10)


def socket(k, x, y, colour=WHITE, z=0.0, size=0.08):
    """An electrical (or data / nurse call) socket plate facing +z with two dark pin slots."""
    k.box(sw(colour), x - size / 2, y - size / 2, z, x + size / 2, y + size / 2, z + 0.009, bev=0.002)
    for s in (-1, 1):
        k.box(sw(GRAPHITE), x + s * 0.011 - 0.003, y - 0.004, z + 0.009, x + s * 0.011 + 0.003, y + 0.008, z + 0.0105)


def cylinder(k, x, y, z, r=0.05, h=0.6, body=GRAPHITE, shoulder=WHITE, axis='y'):
    """A medical gas cylinder (body + shoulder + valve) standing on (x, y, z) along local +y (or lying along local +z with axis='z')."""
    c = k.at(x, y, z, rx=(math.pi / 2 if axis == 'z' else 0.0))
    c.lathe(sw(body), [(0, 0), (r * 0.8, 0), (r, r * 0.25), (r, h * 0.8)], seg=14)
    c.lathe(sw(shoulder), [(r, h * 0.8), (r * 0.85, h * 0.9), (r * 0.35, h * 0.97), (0, h * 0.97)], seg=14)
    c.vcyl(sw(MGREY), 0, h * 0.97, 0, r * 0.25, h * 0.1, seg=8)


def drape(k, mat, w, d, y_top, hang, thick=0.006, cz=0.0, r=0.02, n=4):
    """A cloth laid over a top (w wide along x, d along z, top at y_top) hanging `hang` down both long sides: its cross-section extruded along
    z (bed blankets, sterile drapes)."""
    hw = w / 2

    def path(rad):
        pts = [(hw - r + rad, y_top - hang)]
        pts += [(hw - r + rad * math.cos(math.radians(90 * i / n)), y_top - r + rad * math.sin(math.radians(90 * i / n))) for i in range(n + 1)]
        pts += [(-hw + r + rad * math.cos(math.radians(90 + 90 * i / n)), y_top - r + rad * math.sin(math.radians(90 + 90 * i / n)))
                for i in range(n + 1)]
        pts.append((-hw + r - rad, y_top - hang))
        return pts

    k.prism(mat, path(r + thick) + list(reversed(path(r))), 'xy', cz - d / 2, cz + d / 2)


def towel_stack(k, x, z, y0, n=3, w=0.3, d=0.22, t=0.035, mat='Linen'):
    """Folded linen stacked on a shelf."""
    for i in range(n):
        k.rbox(mat, x + (i % 2) * 0.006, y0 + i * t, z, w, t - 0.002, d, 0.012, axis='x', seg=2)


def keypad(k, x, y, z, w=0.08, h=0.12, body=GRAPHITE, keys=LGREY):
    """A control keypad (bed rails, carts) facing +z."""
    k.rbox(sw(body), x, y - h / 2, z, w, h, 0.016, 0.012, axis='z', seg=2)
    for i in range(3):
        k.box(sw(keys), x - w * 0.3, y + h * 0.3 - i * h * 0.28 - 0.008, z + 0.008, x + w * 0.3, y + h * 0.3 - i * h * 0.28 + 0.008, z + 0.011)


def outline(w, d, r, seg=3):
    return rounded_rect(0, 0, w, d, r, seg)
