"""
R4, the CT-guided, robot-assisted cryoablation suite (docs/R4-CRYO-SUITE.md): the baked furniture of the scan room and its control room, brand-free
and synthetic. The CT gantry, its moving table and the robot's ARM are live in the scene (src/scene/cryoSuite): this module draws only what stands
still, and leaves a mount, a face or a bezel exactly where the live parts attach. Conventions: kit/base.py (local +z = the front, where the user
stands; real metres; every item is `item(geo, f, ..., node=None)`). Colours: the white of the library's SolidSurface and the graphite of the
KitPlastic palette (parts.WHITE / parts.GRAPHITE); the glow is LightPanel. Materials: SolidSurface, PowderWhite, Stainless, KitPlastic, Screen,
LightPanel (no new ones).

Live screen faces sit 3 mm proud of the bezel's dark glass: every bezel here is built so its glass front is at local z = -0.003 and its rim at
-0.002 with the live face's plane at z = 0 (`_bezel`).
"""
import math

from . import parts as pt
from .base import anchor, fillet, root
from .parts import sw

SS = 'Stainless'
BODY = 'SolidSurface'
PW = 'PowderWhite'

# where the console's two gas inlets are, in the console's own frame (the cylinder cart's hoses end here)
CONSOLE_INLETS = ((-0.36, 0.30, -0.05), (-0.36, 0.25, 0.10))


def _bezel(k, w, h, border=0.022, depth=0.04, body=pt.GRAPHITE, led=True, back=None):
    """A monitor bezel centred on the live screen face (w x h) at k's origin, facing +z: a graphite shell behind the face, four rim bars round
    it (front at z = -0.002) and the dark glass (front at z = -0.003) inside. Sits entirely behind the face's plane (z <= 0). `back`: the
    material of the shell behind (default: the rim's)."""
    gm = sw(body)
    W, H = w / 2 + border, h / 2 + border
    k.rbox(back or gm, 0, -H, -(depth + 0.006) / 2, 2 * W, 2 * H, depth - 0.006, 0.012, axis='z', seg=2)
    k.box(gm, -W, h / 2, -0.006, W, H, -0.002)
    k.box(gm, -W, -H, -0.006, W, -h / 2, -0.002)
    k.box(gm, -W, -h / 2, -0.006, -w / 2, h / 2, -0.002)
    k.box(gm, w / 2, -h / 2, -0.006, W, h / 2, -0.002)
    k.box('Screen', -w / 2, -h / 2, -0.006, w / 2, h / 2, -0.003)
    if led:
        k.box('LightPanel', w / 2 - 0.045, -h / 2 - 0.0145, -0.0028, w / 2 - 0.03, -h / 2 - 0.0085, -0.0018)


def _castor(k, x, z, r, tyre, w=0.03):
    """A light castor (about 70 triangles, against 200 for parts.castor): a wheel on a fork and a short stem, wheel touching the floor at (x, z)."""
    k.cyl(tyre, (x - w / 2, r, z), (x + w / 2, r, z), r, seg=9)
    k.box(sw(pt.GRAPHITE), x - w / 2 - 0.004, r * 1.2, z - 0.025, x + w / 2 + 0.004, 2 * r + 0.02, z + 0.025)
    k.vcyl(sw(pt.GRAPHITE), x, 2 * r + 0.02, z, 0.014, 0.03, seg=6)


# --- the robot's base -------------------------------------------------------------------------------------------------------------------------
def robot_base(geo, f, node=None, tyre=None):
    """The needle-guidance robot's cart (the arm is live, not baked), 1.3 W x 0.8 D x 0.85 H on a stainless floor-docking plate, front +z (toward
    the patient): a graphite bumper over four locking castors, a white solid-surface shell with a glowing status band in a graphite groove, a
    graphite top cap, a push handle at the back, side vents, a small status display, the yellow-and-red E-stop and four stainless dock clamps.
    The column stub (white, a graphite collar, a glowing ring and a graphite cap) rises at local (-0.35, 0.2) to y = 1.05 above the floor, the
    live arm's mount (places.ts CRYO_SUITE.robot.mount). Origin: the cart's footprint centre on the floor. `tyre`: the castor tyres' material
    (default black KitPlastic). Materials: SolidSurface, Stainless, KitPlastic, Screen, LightPanel."""
    k = root(geo, f, node)
    tyre = tyre or sw(pt.BLACK)
    # the docking plate and its bolts, then the cart on it
    k.box(SS, -0.74, 0.0, -0.46, 0.74, 0.008, 0.46, bev=0.002)
    for x in (-0.6, -0.3, 0.0, 0.3, 0.6):
        for z in (-0.44, 0.44):
            k.cyl(SS, (x, 0.008, z), (x, 0.0115, z), 0.009, seg=6)
    b = k.at(0, 0.008, 0)
    for x in (-0.5, 0.5):
        for z in (-0.28, 0.28):
            _castor(b, x, z, 0.055, tyre)
    for s in (-1, 1):                                                  # dock clamps: a tab bolted over the bumper's foot and the plate
        for z in (-0.41, 0.41):
            b.box(SS, s * 0.5 - 0.06, 0.0, z - 0.03, s * 0.5 + 0.06, 0.035, z + 0.03, bev=0.003)
    b.rbox(sw(pt.GRAPHITE), 0, 0.06, 0, 1.28, 0.09, 0.78, 0.09, axis='y', seg=4)                    # bumper: y 0.06 .. 0.15
    b.rbox(BODY, 0, 0.15, 0, 1.24, 0.43, 0.74, 0.08, axis='y', seg=4)                               # lower shell: .. 0.58
    b.rbox(sw(pt.GRAPHITE), 0, 0.58, 0, 1.2, 0.02, 0.7, 0.07, axis='y', seg=4)                      # the groove
    b.box('LightPanel', -0.45, 0.585, 0.349, 0.45, 0.595, 0.353)                                     # status band
    b.rbox(BODY, 0, 0.60, 0, 1.3, 0.242, 0.8, 0.1, axis='y', seg=5)                                  # shoulder: .. 0.842
    b.rbox(sw(pt.GRAPHITE), 0, 0.842, 0, 1.26, 0.008, 0.76, 0.09, axis='y', seg=4)                  # top cap: .. 0.85
    # the column stub at the arm's mount
    cx, cz = -0.35, 0.2
    b.cyl(BODY, (cx, 0.85, cz), (cx, 1.0, cz), 0.085, seg=20)
    b.cyl(sw(pt.GRAPHITE), (cx, 0.85, cz), (cx, 0.89, cz), 0.098, seg=20)
    b.cyl('LightPanel', (cx, 0.94, cz), (cx, 0.947, cz), 0.0868, seg=20, caps=(False, False))
    b.cyl(sw(pt.GRAPHITE), (cx, 1.0, cz), (cx, 1.042, cz), 0.092, seg=20, r2=0.078)
    # E-stop, status display, side vents, push handle
    b.cyl(sw(pt.YELLOW), (0.5, 0.85, 0.28), (0.5, 0.862, 0.28), 0.04, seg=16)
    b.lathe(sw(pt.RED), [(0.0, 0.862), (0.026, 0.862), (0.03, 0.872), (0.026, 0.884), (0.0, 0.886)], seg=12, cx=0.5, cz=0.28)
    b.rbox(sw(pt.GRAPHITE), 0.41, 0.68, 0.402, 0.24, 0.12, 0.008, 0.008, axis='z', seg=2)
    b.box('Screen', 0.31, 0.69, 0.4065, 0.51, 0.79, 0.4085)
    b.box('LightPanel', 0.315, 0.672, 0.4065, 0.335, 0.677, 0.4075)
    for s in (-1, 1):
        for i in range(5):
            z = -0.16 + i * 0.08
            b.box(sw(pt.GRAPHITE), s * 0.65 - 0.003, 0.66, z - 0.012, s * 0.65 + 0.003, 0.8, z + 0.012)
    h = b.at(0, 0, -0.4, ry=math.pi)
    pt.bar_handle(h, -0.35, 0.35, 0.72, 0.0, mat=SS, r=0.012, stand=0.07, axis='x')
    return k


# --- the argon console ------------------------------------------------------------------------------------------------------------------------
def argon_console(geo, f, node=None, tyre=None, tilt=0.35):
    """A multi-needle argon cryoablation console (up to 20 needles, 4 temperature sensors), 0.7 W x 1.0 D, front +z, on four castors: a white
    solid-surface case on a graphite bumper, a sloping front panel with a 2 x 10 needle-socket field, 4 blue-ringed sensor ports and a status
    strip, a drawer, two gas inlets on the -x side (the cylinder cart's hoses end here: CONSOLE_INLETS), a push handle at the back, and a
    monitor on a graphite arm: a bezel leaning back by `tilt` rad whose dark glass is where the live canvas goes (places.ts CRYO_SUITE.console
    .screen: centre (0, 1.42, +0.35) from the footprint centre, 0.46 x 0.30 m). Anchor 'cryo:consoleScreen'. Origin: the footprint centre.
    Materials: SolidSurface, Stainless, KitPlastic, Screen, LightPanel."""
    k = root(geo, f, node)
    tyre = tyre or sw(pt.BLACK)
    for x in (-0.25, 0.25):
        for z in (-0.38, 0.38):
            _castor(k, x, z, 0.05, tyre)
    k.rbox(sw(pt.GRAPHITE), 0, 0.07, 0, 0.7, 0.09, 1.0, 0.07, axis='y', seg=4)                      # bumper: .. 0.16
    k.rbox(BODY, 0, 0.16, 0, 0.68, 0.64, 0.98, 0.06, axis='y', seg=4)                               # case: .. 0.80
    k.prism(BODY, [(0.49, 0.8), (0.49, 0.88), (0.3, 1.06), (-0.49, 1.06), (-0.49, 0.8)], 'zy', -0.335, 0.335)   # the head with the sloping panel
    # the sloping panel's frame: origin on its lower front edge, local +y up the slope, +z out of it
    dz, dy = -0.19, 0.18
    L = math.hypot(dz, dy)
    th = math.atan2(-dz, dy)
    p = k.at(0, 0.88, 0.49, rx=-th)
    p.rbox(sw(pt.GRAPHITE), 0, 0.012, 0.002, 0.63, L - 0.024, 0.01, 0.012, axis='z', seg=2)
    zf = 0.007
    for row, y in enumerate((0.205, 0.158)):                                                           # the 2 x 10 needle sockets
        for i in range(10):
            x = (i - 4.5) * 0.056
            p.cyl(SS, (x, y, zf), (x, y, zf + 0.005), 0.0155, seg=8, caps=(False, True))
            p.poly(sw(pt.BLACK), [(x + 0.0095 * math.cos(2 * math.pi * j / 8), y + 0.0095 * math.sin(2 * math.pi * j / 8), zf + 0.0052) for j in range(8)])
    for x in (-0.18, -0.06, 0.06, 0.18):                                                               # the 4 sensor ports
        p.cyl(sw(pt.BLUE), (x, 0.095, zf), (x, 0.095, zf + 0.005), 0.02, seg=10, caps=(False, True))
        p.poly(sw(pt.BLACK), [(x + 0.012 * math.cos(2 * math.pi * j / 8), 0.095 + 0.012 * math.sin(2 * math.pi * j / 8), zf + 0.0052) for j in range(8)])
    p.box('LightPanel', -0.28, 0.036, zf, 0.1, 0.043, zf + 0.0012)                                    # status strip
    p.box(sw(pt.GREEN), 0.2, 0.034, zf, 0.25, 0.046, zf + 0.0015)
    p.box(sw(pt.ORANGE), 0.26, 0.034, zf, 0.3, 0.046, zf + 0.0015)
    # the case's front: a drawer over a door, a power rocker, the gas inlets at the side, a push handle at the back
    k.box(sw(pt.GRAPHITE), -0.32, 0.498, 0.486, 0.32, 0.503, 0.492)
    pt.bar_handle(k, -0.14, 0.14, 0.74, 0.49, mat=SS, r=0.008, stand=0.03, axis='x')
    k.box(sw(pt.GREEN), 0.26, 0.60, 0.489, 0.3, 0.64, 0.4925, bev=0.002)
    for (x, y, z) in CONSOLE_INLETS:
        k.cyl(SS, (x, y, z), (x - 0.055, y, z), 0.021, seg=12)
        k.cyl(sw(pt.GRAPHITE), (x - 0.055, y, z), (x - 0.062, y, z), 0.016, seg=10)
    k.tube(SS, fillet([(-0.2, 0.8, -0.49), (-0.2, 0.8, -0.56), (-0.2, 0.98, -0.58), (0.2, 0.98, -0.58), (0.2, 0.8, -0.56), (0.2, 0.8, -0.49)],
                      0.03), 0.013, seg=10)
    # the monitor: its bezel centred on the live face (0, 1.42, 0.35), leaning back, on a graphite arm from the deck
    sy, sz = 1.42, 0.35
    s = k.at(0, sy, sz, rx=-tilt)
    _bezel(s, 0.46, 0.30)
    back = (0.0, sy - 0.05 * math.sin(tilt), sz - 0.05 * math.cos(tilt))
    k.cyl(sw(pt.GRAPHITE), (0, 1.06, -0.15), (0, 1.1, -0.15), 0.04, seg=14, r2=0.03)
    k.tube(sw(pt.GRAPHITE), fillet([(0, 1.1, -0.15), (0, 1.3, -0.15), (0, 1.38, -0.04), back], 0.05), 0.017, seg=10)
    k.cyl(sw(pt.MGREY), (0, back[1], back[2] + 0.002), (0, back[1], back[2] - 0.016), 0.03, seg=12)
    anchor(k, 'cryo:consoleScreen', 0, sy, sz, w=0.46, h=0.3, tilt=tilt)
    return k


def _gas_cylinder(k, x, y, z, r, h, body, shoulder):
    """A gas cylinder standing on (x, y, z): a 10-sided body and shoulder and a valve stub (about 120 triangles)."""
    k.lathe(sw(body), [(0, y), (r * 0.85, y), (r, y + r * 0.3), (r, y + h * 0.78)], seg=10, cx=x, cz=z)
    k.lathe(sw(shoulder), [(r, y + h * 0.78), (r * 0.8, y + h * 0.9), (r * 0.3, y + h * 0.97), (0, y + h * 0.97)], seg=10, cx=x, cz=z)
    k.vcyl(sw(pt.MGREY), x, y + h * 0.97, z, r * 0.25, h * 0.04, seg=6)


# --- the gas cylinders ------------------------------------------------------------------------------------------------------------------------
def cylinder_cart(geo, f, n=4, node=None, console_at=(1.6, 0.2), tyre=None):
    """A cart for the argon cylinders (n = 4: 3 argon in slate blue and 1 helium in orange, in a 2 x 2 group), 0.8 W x 0.6 D, front +z: a graphite
    tray on four castors, a stainless rear frame with a push handle, two chains round the cylinders, a stainless regulator and a pressure gauge on
    each, and two hoses to the console: from the regulators up and over, down behind the cart and along the floor to the console's gas inlets
    (`console_at` = the console's footprint centre in this cart's frame, same heading; CONSOLE_INLETS gives the inlets). Origin: the footprint
    centre. Materials: Stainless, KitPlastic."""
    k = root(geo, f, node)
    tyre = tyre or sw(pt.BLACK)
    slots = [(-0.2, -0.15), (0.2, -0.15), (-0.2, 0.15), (0.2, 0.15)][:n]
    for x in (-0.32, 0.32):
        for z in (-0.22, 0.22):
            _castor(k, x, z, 0.04, tyre, w=0.026)
    k.rbox(sw(pt.GRAPHITE), 0, 0.07, 0, 0.8, 0.08, 0.6, 0.04, axis='y', seg=2)                       # tray: .. 0.15
    for i, (x, z) in enumerate(slots):
        helium = (i == len(slots) - 1)
        _gas_cylinder(k, x, 0.15, z, 0.075, 0.95, pt.ORANGE if helium else pt.SLATE, pt.WHITE if helium else pt.MGREY)
        k.cyl(SS, (x, 1.1, z), (x, 1.17, z), 0.03, seg=8)                                            # regulator body
        k.cyl(sw(pt.GRAPHITE), (x, 1.14, z + 0.02), (x, 1.14, z + 0.045), 0.034, seg=10)               # gauge: a graphite rim and a white face
        k.cyl(sw(pt.WHITE), (x, 1.14, z + 0.045), (x, 1.14, z + 0.048), 0.027, seg=10)
        k.cyl(sw(pt.GRAPHITE), (x + 0.03, 1.15, z), (x + 0.065, 1.15, z), 0.009, seg=8)                # outlet stub
    for s in (-1, 1):                                                                                  # rear frame: posts, a top bar, a mid bar
        k.tube(SS, [(s * 0.36, 0.15, -0.27), (s * 0.36, 0.98, -0.27)], 0.012, seg=6)
    k.tube(SS, [(-0.36, 0.98, -0.27), (0.36, 0.98, -0.27)], 0.014, seg=6)
    k.tube(SS, [(-0.36, 0.55, -0.27), (0.36, 0.55, -0.27)], 0.01, seg=5)
    for y in (0.5, 0.82):                                                                              # chains round the group
        k.tube(SS, [(-0.285, y, -0.235), (0.285, y, -0.235), (0.285, y, 0.235), (-0.285, y, 0.235)], 0.0045, seg=4, closed=True)
    # hoses: regulator outlet -> up and over -> down the cart's east side -> along the floor -> the console's inlets
    ex, ez = console_at
    # (hose colour, the outlet's z, the lane's z down the side, the x where it turns toward the inlet), argon from the back row, helium front
    for (ix, iy, iz), (col, zs, zlane, xturn) in zip(CONSOLE_INLETS, ((pt.GRAPHITE, -0.15, -0.15, 0.62), (pt.MGREY, 0.15, 0.22, 0.9))):
        xe, zt = ex + ix, ez + iz
        path = [(0.265, 1.15, zs), (0.36, 1.2, (zs + zlane) / 2), (0.44, 1.0, zlane), (0.46, 0.3, zlane), (0.5, 0.012, zlane),
                (xturn, 0.012, zlane), (xturn + 0.12, 0.012, zt), (xe - 0.35, 0.012, zt), (xe - 0.18, iy * 0.5, zt), (xe - 0.065, iy, zt)]
        k.tube(sw(col), fillet(path, 0.07, n=2), 0.011, seg=5)
    return k


# --- the room's monitor boom --------------------------------------------------------------------------------------------------------------------
def monitor_boom(geo, f, ceiling=3.0, spread=0.6, size=(0.62, 0.38), y=1.75):
    """A ceiling-hung dual-display boom: a canopy on the ceiling, a column, a beam, and two bezels hung from it by short stems, their live faces
    at local (+-spread, y, 0) facing +z (the in-room screens: places.ts CRYO_SUITE.screens.roomPlan / roomLive; build it with heading pi so
    +z faces the table: local +x is then WEST). The beam, column and bracket sit behind the faces (local z < 0). Anchors 'cryo:boomLeft' /
    'cryo:boomRight'. Origin: the column's foot on the floor under the hub, midway between the faces. Materials: PowderWhite, KitPlastic,
    Screen, LightPanel."""
    k = root(geo, f)
    w, h = size
    zb = -0.075                                                                                        # the beam's and the column's z
    k.rbox(PW, 0, ceiling - 0.03, zb, 0.34, 0.03, 0.3, 0.03, axis='y', seg=3)                        # canopy
    k.cyl(PW, (0, ceiling - 0.03, zb), (0, 2.3, zb), 0.04, seg=16)
    k.cyl(sw(pt.GRAPHITE), (0, ceiling - 0.2, zb), (0, ceiling - 0.17, zb), 0.052, seg=16)           # a swivel collar
    top = y + h / 2 + 0.022 + 0.02
    beam_y = top + 0.22
    k.rbox(PW, 0, beam_y, zb, 2 * (spread + 0.4), 0.1, 0.075, 0.03, axis='x', seg=3)
    k.rbox(sw(pt.GRAPHITE), 0, beam_y - 0.012, zb, 0.2, 0.012, 0.09, 0.005, axis='x', seg=2)         # a joint cover under the hub
    k.cyl(PW, (0, 2.3, zb), (0, beam_y + 0.05, zb), 0.04, seg=16)
    for s in (-1, 1):
        x = s * spread
        k.cyl(PW, (x, top + 0.01, zb), (x, beam_y, zb), 0.02, seg=12)                                  # the stem from the beam
        k.box(sw(pt.GRAPHITE), x - 0.07, top - 0.02, zb, x + 0.07, top + 0.01, -0.006, bev=0.003)     # the bracket on the bezel's back
        m = k.at(x, y, 0.0)
        _bezel(m, w - 0.044, h - 0.044, back=PW)
        anchor(k, 'cryo:boomLeft' if s > 0 else 'cryo:boomRight', x, y, 0.0, w=round(w - 0.044, 3), h=round(h - 0.044, 3))
    k.tube(sw(pt.MGREY), fillet([(0.1, beam_y + 0.05, zb), (0.1, beam_y + 0.05, zb - 0.03)], 0.01), 0.008, seg=6)
    return k


# --- the control room's desks ----------------------------------------------------------------------------------------------------------------
def _desk(k, w, d, h):
    k.rbox(BODY, 0, h - 0.03, 0, w, 0.03, d, 0.008, axis='y', seg=2)
    for s in (-1, 1):
        x = s * (w / 2 - 0.035)
        k.rbox(PW, x, 0.0, 0.0, 0.03, h - 0.03, d - 0.06, 0.008, axis='z', seg=2)
        k.rbox(PW, x, 0.0, 0.0, 0.05, 0.03, d - 0.06, 0.01, axis='z', seg=2)
    k.box(sw(pt.LGREY), -w / 2 + 0.06, 0.28, -d / 2 + 0.05, w / 2 - 0.06, h - 0.07, -d / 2 + 0.065)  # modesty panel
    k.box(PW, -w / 2 + 0.2, h - 0.16, -d / 2 + 0.08, w / 2 - 0.2, h - 0.154, d / 2 - 0.1)             # cable tray


def _arm(k, x, y_bezel, d, ry=0.0, z_pole=-0.2):
    """A monitor arm: a clamp on the desk's rear edge, a pole and a bracket to the back of a bezel at (x, y_bezel, 0) turned by `ry`."""
    k.box(sw(pt.GRAPHITE), x - 0.035, 0.7, -d / 2 - 0.012, x + 0.035, 0.74, -d / 2 + 0.05, bev=0.003)
    k.vcyl(sw(pt.GRAPHITE), x, 0.74, z_pole, 0.016, y_bezel - 0.74 + 0.02, seg=10)
    bx, bz = x - 0.045 * math.sin(ry), -0.045 * math.cos(ry)
    k.tube(sw(pt.GRAPHITE), fillet([(x, y_bezel, z_pole), (x, y_bezel, z_pole + 0.05), (bx, y_bezel, bz)], 0.02), 0.012, seg=8)


def ct_desk(geo, f, w=2.8, d=0.6, h=0.74):
    """The CT operator's desk in the control room, 2.8 W x 0.6 D, the operator at local +z (build it with heading pi to face north): a white top
    on white end panels, a modesty panel and a cable tray; the live console display at local (0, 1.12, 0) (places.ts CRYO_SUITE.screens.ctConsole)
    on an arm, two flanking displays turned in, keyboard, the scan control keypad (green go, amber pause, red stop), a trackball, a gooseneck
    microphone and a handset. Anchor 'cryo:ctConsole'. Origin: the footprint centre. Materials: SolidSurface, PowderWhite, KitPlastic, Screen,
    LightPanel."""
    k = root(geo, f)
    _desk(k, w, d, h)
    sy, sw_, sh_ = 1.12, 0.54, 0.33
    _bezel(k.at(0, sy, 0.0), sw_, sh_)
    _arm(k, 0.0, sy, d)
    for s in (-1, 1):
        ry = -s * 0.3
        _bezel(k.at(s * 0.88, sy, 0.0, ry=ry), sw_, sh_, led=False)
        _arm(k, s * 0.88, sy, d, ry=ry)
    anchor(k, 'cryo:ctConsole', 0, sy, 0.0, w=sw_, h=sh_)
    kb = k.at(0, h, 0.14)
    kb.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.44, 0.018, 0.14, 0.008, axis='y', seg=2)
    kb.box(sw(pt.MGREY), -0.2, 0.018, -0.05, 0.2, 0.02, 0.05)
    kb.rbox(sw(pt.GRAPHITE), 0.34, 0, 0.0, 0.07, 0.024, 0.09, 0.03, axis='y', seg=3)                  # trackball
    kb.cyl(sw(pt.LGREY), (0.34, 0.024, 0.0), (0.34, 0.034, 0.0), 0.018, seg=12)
    kp = k.at(-0.55, h, 0.1)                                                                           # the scan control keypad
    kp.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.3, 0.022, 0.18, 0.012, axis='y', seg=2)
    for i, c in enumerate((pt.GREEN, pt.YELLOW, pt.RED)):
        kp.cyl(sw(c), (-0.08 + i * 0.08, 0.022, 0.045), (-0.08 + i * 0.08, 0.034, 0.045), 0.02, seg=12)
    kp.box(sw(pt.MGREY), -0.12, 0.022, -0.06, 0.12, 0.026, -0.01)
    mic = k.at(0.78, h, 0.2)
    mic.cyl(sw(pt.GRAPHITE), (0, 0, 0), (0, 0.012, 0), 0.04, seg=12)
    mic.tube(sw(pt.GRAPHITE), fillet([(0, 0.012, 0), (0, 0.2, 0), (0.0, 0.26, 0.07)], 0.05), 0.005, seg=6)
    mic.rbox(sw(pt.BLACK), 0, 0.25, 0.09, 0.02, 0.05, 0.02, 0.008, axis='y', seg=2)
    k.rbox(sw(pt.WHITE), -1.05, h, 0.0, 0.2, 0.05, 0.12, 0.02, axis='y', seg=2)                      # handset base
    return k


def station_desk(geo, f, w=1.4, d=0.6, h=0.74):
    """The robot planning station, 1.4 W x 0.6 D, the operator at local +z (heading pi to face north): as the CT desk with one display, the live
    one at local (0, 1.12, 0) (CRYO_SUITE.screens.robotStation), a keyboard, a 3D mouse, a white tablet and the robot's enable box (a graphite box
    with a red E-stop). Anchor 'cryo:robotStation'. Origin: the footprint centre."""
    k = root(geo, f)
    _desk(k, w, d, h)
    sy, sw_, sh_ = 1.12, 0.54, 0.33
    _bezel(k.at(0, sy, 0.0), sw_, sh_)
    _arm(k, 0.0, sy, d)
    anchor(k, 'cryo:robotStation', 0, sy, 0.0, w=sw_, h=sh_)
    kb = k.at(0, h, 0.14)
    kb.rbox(sw(pt.GRAPHITE), -0.04, 0, 0, 0.44, 0.018, 0.14, 0.008, axis='y', seg=2)
    kb.box(sw(pt.MGREY), -0.24, 0.018, -0.05, 0.16, 0.02, 0.05)
    kb.lathe(sw(pt.GRAPHITE), [(0.0, 0.0), (0.03, 0.0), (0.035, 0.012), (0.02, 0.03), (0.0, 0.032)], seg=14, cx=0.28, cz=0.0)     # a 3D mouse
    kb.cyl(sw(pt.LGREY), (0.28, 0.026, 0.0), (0.28, 0.03, 0.0), 0.032, seg=14, caps=(False, True))
    k.rbox(sw(pt.WHITE), -0.5, h, 0.12, 0.2, 0.012, 0.28, 0.012, axis='y', seg=2)                     # tablet
    k.box('Screen', -0.585, h + 0.012, -0.01, -0.415, h + 0.0135, 0.25)
    ek = k.at(0.52, h, 0.1)
    ek.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.16, 0.05, 0.12, 0.012, axis='y', seg=2)
    ek.cyl(sw(pt.YELLOW), (0.0, 0.05, 0.0), (0.0, 0.058, 0.0), 0.034, seg=14)
    ek.lathe(sw(pt.RED), [(0.0, 0.058), (0.024, 0.058), (0.028, 0.068), (0.024, 0.078), (0.0, 0.08)], seg=14)
    return k


# --- small things for the rooms ----------------------------------------------------------------------------------------------------------------------
def swivel_chair(geo, f, seat_h=0.5, mat='VinylTeal'):
    """A light task chair for the control room (about 350 triangles; kit/support.office_chair is 1.6k): a five-spoke graphite base on feet, a gas
    lift, a seat cushion and a back pad on a bar; the sitter faces +z. Origin: the column; `seat_h` = the cushion's top. Materials: KitPlastic,
    the upholstery."""
    k = root(geo, f)
    for i in range(5):
        a = 2 * math.pi * i / 5
        sp = k.at(0, 0, 0, ry=a)
        sp.box(sw(pt.GRAPHITE), -0.018, 0.045, 0.0, 0.018, 0.075, 0.25)
        sp.box(sw(pt.BLACK), -0.02, 0.0, 0.22, 0.02, 0.045, 0.27)
    k.vcyl(sw(pt.GRAPHITE), 0, 0.075, 0, 0.03, seat_h - 0.075 - 0.09, seg=8)
    k.rbox(sw(pt.GRAPHITE), 0, seat_h - 0.09, 0.0, 0.22, 0.03, 0.22, 0.02, axis='y', seg=2)
    k.rbox(mat, 0, seat_h - 0.065, 0.015, 0.46, 0.065, 0.44, 0.04, axis='y', seg=2)
    k.tube(sw(pt.GRAPHITE), [(0, seat_h - 0.07, -0.05), (0, seat_h + 0.02, -0.23), (0, seat_h + 0.2, -0.24)], 0.014, seg=5)
    k.rbox(mat, 0, seat_h + 0.14, -0.26, 0.42, 0.34, 0.07, 0.05, axis='z', seg=3)
    return k


def wall_clock(geo, f, y=2.2, r=0.15):
    """A wall clock (about 120 triangles; patient.wall_clock is 750): a graphite rim, a white face, two hands. Local +z out of the wall."""
    k = root(geo, f)
    c = k.at(0, y, 0.0, rx=math.pi / 2)         # a frame whose local +y points out of the wall (+z), for the lathe
    c.lathe(sw(pt.GRAPHITE), [(0.0, 0.0), (r, 0.0), (r, 0.03), (r - 0.012, 0.03)], seg=18)
    c.lathe(sw(pt.WHITE), [(r - 0.012, 0.026), (0.0, 0.026)], seg=18)
    k.box(sw(pt.GRAPHITE), -0.004, y - 0.0, 0.027, 0.004, y + r * 0.7, 0.029)
    k.box(sw(pt.GRAPHITE), -0.003, y - 0.0, 0.029, r * 0.55, y + 0.007, 0.031)
    return k
