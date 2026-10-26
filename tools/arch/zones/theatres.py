"""
Zone 'theatres' (Level 2, drawn x -62..-40, z -22..22, y = 4.2): the robotic theatre suite, designed "clean clinical modern" like the approved
lobby (docs/handover/look-lobby.md): a real modern operating suite around the procedural da Vinci 5 theatre.

  l2Or        the robotic theatre. Anti-static theatre floor coved up the walls, seamless sage-grey wall panels (1.2 m modules, fine joints), a
              sealed plaster ceiling with flush LED panels and the laminar-flow (UCV) canopy over the table, a flush control panel and clock, a
              wall-mounted PACS display, recessed glazed storage, low-level extract grilles. EVERYTHING ELSE IN THE ROOM IS PROCEDURAL AND STAYS:
              the table, the robot's patient cart, both consoles, the vision cart, the anaesthesia machine and stool, the back table, the Mayo
              stand, the circulator's desk, the surgical lights' bodies + their animated faces, the anaesthesia pendant and the boom, the live
              endoscope screens and their bezels (src/scene/rooms/surgery/or.ts, src/scene/surgery/*). Nothing here stands in their space.
  l2Hall      the theatre hall: theatre floor, a three-bay stainless scrub trough on the theatre's wall, a glazed gown cabinet, crash rails, an
              "in use" lamp over the theatre door (the door lined in the diagnostics purple of the signs), hand-rub dispensers.
  l2PreOp     pre-op / admissions: four curtained trolley bays on the north façade (a raised 1.3 m sill so the bed-head trunking runs under the
              windows), trunking-mounted monitor arms that carry the live monitors' bezels, IV stands, an admissions counter in the lobby desk
              language, beam seating on the waiting row, casework, a planter, a hand-wash station and a clock.
  l2Pacu      recovery: three bays on the south façade (same raised-sill bed-head detail), a nurse island under the live station screens, a
              casework wall with glazed wall units, a sage accent wall, a planter, a hand-wash station, a clock.
  l2Lounge    the family lounge (the north half of the old lounge, z 2..10): terrazzo, floor-to-ceiling glazing on the west façade, a warm sand
              wall with an oak slat feature behind the sofa, a wool rug, wing armchairs with footstools facing the view, two sofas, low oak
              tables, a tea point and water cooler, planters, a smooth plaster ceiling with a recessed LED slot and reading downlights.
  l2Cryo      R4, the CT-guided, robot-assisted cryoablation suite (docs/R4-CRYO-SUITE.md, the south of the old lounge, z 13..22): the scan room.
              Anti-static theatre floor coved up the walls, sage wall panels, a windowless west wall behind the gantry, a sealed plaster ceiling
              with flush LED panels, a lead-glass observation window onto the control room, lead-lined door frames with stainless guards, an
              "X-ray in use" lamp and a radiation sign at the door, the robot's cart on its docking plate, the argon console with its cylinder
              cart, the ceiling monitor boom, a supply cabinet with lead aprons and a hand-wash. THE CT GANTRY, ITS TABLE AND THE ROBOT'S ARM
              ARE LIVE (src/scene/cryoSuite) and are not baked.
  l2CryoControl  the cryo control room (z 10..13): the CT operator's desk and the robot planning station under the observation glass,
              with and the bezels the live screens sit in, a clock and a case-list display.
  l2Staff     lockers, a wipe-clean sofa, a meeting table with oak chairs, a kitchenette with wall units, a theatre-list whiteboard, a planter.
  l2Sterile   white powder-coated storage racks with clear-blue bins on three walls.
  l2Corridor  terrazzo, floor-to-ceiling glazing on the east side, a plaster ceiling with a recessed LED slot and wall-washing downlights,
              oak benches with their backs to the glass (facing the theatre's viewing window), crash rails, a directory.

Every piece of furniture stands on the procedural layout's anchors (plan.json `furniture`: seats, footprints), so the sim's seats, collision
and screens stay true; REPLACES lists the procedural pieces this design draws instead (the runtime hides them; screens, bezels, seats and
collision always stay).
"""
import math

import furniture as fu
from common import Frame
from shell import GAP_D, GAP_H, R, line_box, ribbon_glazing

try:
    from kit import arch, cafe, ctcryo, er, patient, support, theatre
    from kit import parts as pt
    from kit.base import fillet, root
    from kit.parts import sw
except Exception:      # noqa: BLE001  (no kit: build() falls back to the shell)
    arch = None

CH = 3.0
T = 0.2
DOOR_H = 2.3

PREOP = (-62.0, -44.0, -22.0, -10.0)
STAFF = (-62.0, -53.0, -10.0, -2.0)
STERILE = (-53.0, -44.0, -10.0, -2.0)
HALL = (-62.0, -44.0, -2.0, 2.0)
OR = (-53.0, -44.0, 2.0, 10.0)
PACU = (-53.0, -44.0, 10.0, 22.0)
LOUNGE = (-62.0, -53.0, 2.0, 10.0)
CRYOCTL = (-62.0, -53.0, 10.0, 13.0)
CRYO = (-62.0, -53.0, 13.0, 22.0)
CORRIDOR = (-44.0, -40.0, -16.0, 16.0)

# --- shell settings (zones/__init__.py) ---
HERO = [OR, LOUNGE, CRYO]
OWN_CEILINGS = ('l2Or', 'l2Lounge', 'l2Corridor', 'l2Cryo', 'l2CryoControl')
FLOORS = {'l2Or': 'TheatreFloor', 'l2Hall': 'TheatreFloor', 'l2Corridor': 'Terrazzo', 'l2Lounge': 'Terrazzo',
          'l2LiftA': 'Terrazzo', 'l2LiftB': 'Terrazzo', 'l2Cryo': 'TheatreFloor'}

# --- runtime hints ---
# the procedural furniture this design draws instead (src/scene/rooms/surgery/shell.ts footprints). In the OR (or.ts) only the static
# furniture is replaced (or_furniture); its table, consoles, carts, robot, lights and screens are procedural / animated and stay.
REPLACES = [
    'footprint:l2:preop:bed*',        # trolley, monitor pole (the live monitor's bezel stays: metalDark above 1 m), IV pole, per bay
    'footprint:l2:preop:div*',        # bay curtains
    'footprint:l2:preop:desk',        # admissions counter (its two atlas screens stay)
    'footprint:l2:preop:waiting',     # beam seating (the information screen above stays)
    'footprint:l2:preop:table',
    'footprint:l2:preop:plant',
    'footprint:l2:preop:supply',
    'footprint:l2:pacu:bed*',
    'footprint:l2:pacu:div*',
    'footprint:l2:pacu:island',       # nurse island (the live station monitor and the chart screen stay)
    'footprint:l2:pacu:supply',
    'footprint:l2:pacu:plant',
    'footprint:l2:lounge:*',
    'footprint:l2:staff:*',
    'footprint:l2:sterile:*',
    'footprint:l2:hall:scrub',
    'footprint:l2:hall:cabinet',
    'footprint:l2:corridor:bench*',
    # R4: the cryoablation suite's static furniture (kit/ctcryo.py). The CT (l2:cryo:ct:*: gantry, rotor, moving table) is live and stays procedural.
    'footprint:l2:cryo:robot',
    'footprint:l2:cryo:console',
    'footprint:l2:cryo:cylinders',
    'footprint:l2:cryo:cabinet',
    'footprint:l2:cryo:boom',
    'footprint:l2:cryoctl:*',
    # the theatre's static furniture (or_furniture): back table, Mayo stand, the anaesthetist's stool, the console chairs (with the consoles'
    # foot pedals, which stand in the chairs' footprints), the circulator's desk (its monitor, stand and keyboard stay: metalDark above 1 m)
    'footprint:l2:or:backtable',
    'footprint:l2:or:mayo',
    'footprint:l2:or:stool',
    'footprint:l2:or:console:surgeon:chair',
    'footprint:l2:or:console:teach:chair',
    'footprint:l2:or:desk',
]

# review stills (plan x, z) -> look at (x, z), eye 1.6 m above the level-2 floor, 24 mm
POSES = [
    ((-44.7, 9.4), (-51.6, 3.4)),       # the theatre from its south-east corner: canopy, control panel, storage and PACS on the west wall
    ((-44.6, -0.9), (-55.0, 1.3)),      # the theatre hall from the corridor: scrub trough, theatre door, lounge opening
    ((-44.9, 13.4), (-51.0, 21.2)),     # recovery: the three bays on the south façade, the island
    ((-53.7, 9.4), (-61.0, 2.8)),       # the family lounge toward the north-west: glazing, armchairs, the sofa
    ((-53.8, 15.2), (-59.5, 18.0)),     # the cryoablation scan room from its door: console, robot cart, the gantry's place, the observation glass
    ((-53.6, 11.2), (-58.5, 13.5)),     # the cryo control room: the operator's desk and the robot station under the observation glass
    ((-61.3, 21.2), (-55.6, 14.6)),     # the scan room from its south-west corner: boom, robot, console, the door, the glass
]

# the reflection probe (the terrazzo is glossy): the family lounge, where the glossy floor and the big glazing are (z 6: the lounge is z 2..10)
PROBE = (-57.5, 1.6, 6.0)

# accent swatches (materials.json Accent.palette): 0 ward A blue, 1 ward B green, 2 emergency red, 3 atrium orange, 4 diagnostics purple, 5 grey
# (src/content/signs.json: the robotic theatre is 'diagnostics', recovery 'wardB', the CT cryoablation suite 'diagnostics')
DOOR_ACCENT = {'l2Or': 'Accent:4', 'l2Pacu': 'Accent:1', 'l2Cryo': 'Accent:4', 'l2CryoInner': 'Accent:4', 'l2CryoControl': 'Accent:5'}


def door_accent(d):
    return DOOR_ACCENT.get(d['id'])


def skip_glazing(w, a, b):
    """The spans this design draws itself: the pre-op and recovery façades (a raised sill over the bed-head trunking), the lounge's west
    façade and the corridor's east side (floor-to-ceiling glazing)."""
    m = (a + b) / 2
    if w['alongX'] and abs(w['c'] + 22.0) < 1e-6 and PREOP[0] <= m <= PREOP[1]:
        return True
    if w['alongX'] and abs(w['c'] - 22.0) < 1e-6 and PACU[0] <= m <= PACU[1]:
        return True
    if not w['alongX'] and abs(w['c'] + 62.0) < 1e-6 and LOUNGE[2] <= m <= LOUNGE[3]:
        return True
    if not w['alongX'] and abs(w['c'] + 40.0) < 1e-6 and CORRIDOR[2] <= m <= CORRIDOR[3]:
        return True
    # the CT scan room has no windows (a radiation room): if the plan still lists glazing on its outer walls, cryo_room() draws them solid
    if not w['alongX'] and abs(w['c'] + 62.0) < 1e-6 and CRYO[2] <= m <= CRYO[3]:
        return True
    if w['alongX'] and abs(w['c'] - 22.0) < 1e-6 and CRYO[0] <= m <= CRYO[1]:
        return True
    return False


# --- small helpers ------------------------------------------------------------------------------------------------------------------------------
def wbox(geo, mat, along_x, face, into, t0, t1, y0, y1, u0, u1, drop=()):
    """A box on a wall face: t0..t1 along the wall, y0..y1 up, u0..u1 out from the face into the room."""
    c0, c1 = sorted((face + into * u0, face + into * u1))
    t0, t1 = sorted((t0, t1))
    if along_x:
        geo.box(mat, t0, y0, c0, t1, y1, c1, drop)
    else:
        geo.box(mat, c0, y0, t0, c1, y1, t1, drop)


def wall_at(along_x, face, into, t):
    """A Frame on a wall face at t along the wall, local +z into the room (the kit's wall-item convention)."""
    if along_x:
        return Frame(t, face, 0.0 if into > 0 else math.pi)
    return Frame(face, t, math.pi / 2 if into > 0 else -math.pi / 2)


def minus(a, b, holes):
    """The parts of a..b outside every hole (h0, h1)."""
    out = [(a, b)]
    for h0, h1 in holes:
        nxt = []
        for s0, s1 in out:
            if h1 <= s0 or h0 >= s1:
                nxt.append((s0, s1))
                continue
            if h0 > s0:
                nxt.append((s0, h0))
            if h1 < s1:
                nxt.append((h1, s1))
        out = nxt
    return [(s0, s1) for s0, s1 in out if s1 - s0 > 0.06]


def door_holes(pl, along_x, c, pad=0.085):
    """The door openings (plus their architraves) on the wall line `c`."""
    out = []
    for d in pl.plan['doors']:
        if d['level'] != 2 or (d['wallAxis'] == 'x') != along_x:
            continue
        if abs((d['z'] if along_x else d['x']) - c) > 1e-6:
            continue
        m = d['x'] if along_x else d['z']
        out.append((m - d['width'] / 2 - pad, m + d['width'] / 2 + pad))
    return out


def downlight(ctx, x, z, ch=CH, power=14.0):
    """A recessed downlight: a white trim ring, the lens, and the spot lamp for the bake."""
    w = Frame(0, 0)
    ctx.geo.ring(w, 'SolidSurface', x, ch - 0.002, z, 0.045, 0.06, seg=24)
    ctx.geo.disc(w, 'LEDLine', x, ch - 0.001, z, 0.045, seg=24)
    ctx.downlight(x, z, ch, power)


def plaster_ceiling(geo, x0, x1, z0, z1, ch=CH, slots=(), holes=()):
    """A smooth plaster ceiling over x0..x1, z0..z1 with recessed 50 mm LED slots: `slots` = (axis 'x'|'z', at, from, to); `holes` = rects
    (x0, x1, z0, z1) left open (a canopy fills them)."""
    hw = 0.025
    # cut the rect into strips around the slots (slots along z cut x; along x cut z), then around the holes
    xs = [x0, x1]
    zs = [z0, z1]
    for ax, at, a, b in slots:
        (xs if ax == 'z' else zs).extend((at - hw, at + hw))
        (zs if ax == 'z' else xs).extend((a, b))
    for (hx0, hx1, hz0, hz1) in holes:
        xs.extend((hx0, hx1))
        zs.extend((hz0, hz1))
    xs = sorted(set(round(v, 4) for v in xs if x0 - 1e-6 <= v <= x1 + 1e-6))
    zs = sorted(set(round(v, 4) for v in zs if z0 - 1e-6 <= v <= z1 + 1e-6))
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if any(hx0 < cx < hx1 and hz0 < cz < hz1 for (hx0, hx1, hz0, hz1) in holes):
                continue
            slot = None
            for ax, at, a, b in slots:
                if ax == 'z' and abs(cx - at) < hw + 1e-6 and a < cz < b:
                    slot = 1
                if ax == 'x' and abs(cz - at) < hw + 1e-6 and a < cx < b:
                    slot = 1
            if slot:
                geo.box('LEDLine', xs[i], ch + 0.02, zs[j], xs[i + 1], ch + 0.025, zs[j + 1], drop=('up',))
                geo.box('CeilingPlaster', xs[i], ch + 0.025, zs[j], xs[i + 1], ch + 0.05, zs[j + 1], drop=('up',))
                continue
            geo.box('CeilingPlaster', xs[i], ch, zs[j], xs[i + 1], ch + 0.05, zs[j + 1], drop=('up',))


def curtain_wall(geo, w, a, b, pitch=1.5):
    """Floor-to-ceiling glazing (the lobby's curtain wall): sill and head profiles, a transom at door height, deep slim mullions."""
    M, G = R('mullion', 'Mullion'), R('glass', 'Glass')
    line_box(geo, M, w, a, b, 0.0, 0.06, 0.16)
    line_box(geo, M, w, a, b, CH - 0.06, CH + 0.06, 0.16)
    line_box(geo, M, w, a, b, DOOR_H, DOOR_H + 0.05, 0.12)
    line_box(geo, G, w, a, b, 0.06, CH - 0.06, 0.012)
    n = max(1, round((b - a) / pitch))
    for k in range(n + 1):
        t = a + (b - a) * k / n
        line_box(geo, M, w, max(a, t - 0.025), min(b, t + 0.025), 0.06, CH - 0.06, 0.16)


# --- furniture made here (the kit's emitter; local +z = the front) ----------------------------------------------------------------------------
def base_run(geo, f, length, depth, h=0.9, top='Oak', front='SolidSurface', sink=None, module=0.6):
    """Base cabinets against a wall: a recessed black plinth, a white carcass, door fronts with grey bar pulls, a worktop (an inset stainless
    sink at local x `sink`)."""
    k = root(geo, f)
    L, D = length, depth
    pl = 0.1
    k.box(sw(pt.BLACK), -L / 2 + 0.01, 0, -D / 2, L / 2 - 0.01, pl, D / 2 - 0.06, drop=('down',))
    k.box('SolidSurface', -L / 2, pl, -D / 2, L / 2, h - 0.04, D / 2 - 0.02)
    n = max(1, round(L / module))
    dw = L / n
    for i in range(n):
        x0 = -L / 2 + i * dw
        k.box(front, x0 + 0.002, pl + 0.003, D / 2 - 0.02, x0 + dw - 0.002, h - 0.045, D / 2, bev=0.002)
        pt.bar_handle(k, x0 + 0.1, x0 + dw - 0.1, h - 0.11, D / 2, mat=sw(pt.MGREY), r=0.006, stand=0.025, axis='x')
    y0, y1 = h - 0.04, h
    z0, z1 = -D / 2, D / 2 + 0.02
    if sink is None:
        k.box(top, -L / 2 - 0.01, y0, z0, L / 2 + 0.01, y1, z1, bev=0.003)
    else:
        sw_, sd = 0.5, 0.38
        sz = 0.0
        k.box(top, -L / 2 - 0.01, y0, z0, sink - sw_ / 2, y1, z1, bev=0.003)
        k.box(top, sink + sw_ / 2, y0, z0, L / 2 + 0.01, y1, z1, bev=0.003)
        k.box(top, sink - sw_ / 2, y0, z0, sink + sw_ / 2, y1, sz - sd / 2, bev=0.003)
        k.box(top, sink - sw_ / 2, y0, sz + sd / 2, sink + sw_ / 2, y1, z1, bev=0.003)
        k.tray('Stainless', sink, h - 0.2, sz, sw_, sd, 0.2 + 0.004, wall=0.012, r=0.03, seg=3, floor_t=0.01)
        sp = [(sink, h, -D / 2 + 0.06), (sink, h + 0.3, -D / 2 + 0.06), (sink, h + 0.32, -D / 2 + 0.2), (sink, h + 0.24, -D / 2 + 0.24)]
        k.tube('Stainless', sp, 0.012, seg=10)
    return k


def wall_units(geo, f, length, y0=1.45, h=0.72, d=0.35, glass=False, module=0.6):
    """Wall-hung cupboards (white carcass; glazed doors with white frames when `glass`)."""
    k = root(geo, f)
    L = length
    k.box('SolidSurface', -L / 2, y0, 0.0, L / 2, y0 + h, d - 0.02)
    n = max(1, round(L / module))
    dw = L / n
    for i in range(n):
        x0 = -L / 2 + i * dw + 0.002
        x1 = x0 + dw - 0.004
        if glass:
            fw = 0.045
            for (a0, b0, a1, b1) in ((x0, y0, x0 + fw, y0 + h), (x1 - fw, y0, x1, y0 + h), (x0, y0, x1, y0 + fw), (x0, y0 + h - fw, x1, y0 + h)):
                k.box('SolidSurface', a0, b0, d - 0.02, a1, b1, d, bev=0.002)
            k.box('Glass', x0 + fw, y0 + fw, d - 0.012, x1 - fw, y0 + h - fw, d - 0.008)
            for j in range(3):
                xb = x0 + 0.06 + j * (dw - 0.12) / 3
                k.box(sw((pt.WHITE, pt.PALEBLUE, pt.WARMWHITE)[(i + j) % 3]), xb, y0 + 0.03, 0.04, xb + (dw - 0.16) / 3, y0 + 0.24 + 0.04 * (j % 2), d - 0.08)
                k.box(sw((pt.CLEAR, pt.WHITE, pt.PALEBLUE)[(i + j) % 3]), xb, y0 + h / 2 + 0.02, 0.04, xb + (dw - 0.16) / 3, y0 + h / 2 + 0.2, d - 0.08)
            k.box('SolidSurface', x0, y0 + h / 2 - 0.01, 0.0, x1, y0 + h / 2 + 0.01, d - 0.03)
        else:
            k.box('SolidSurface', x0, y0, d - 0.02, x1, y0 + h, d, bev=0.002)
            pt.bar_handle(k, x0 + 0.1, x1 - 0.1, y0 + 0.06, d, mat=sw(pt.MGREY), r=0.006, stand=0.025, axis='x')
    return k


def sofa(geo, f, length=2.2, depth=0.85, seat_h=0.5, mat='FabricAccent', seats=2, legs='Oak'):
    """A low modern sofa: tapered legs, an upholstered base, square arms, seat and back cushions (seat top at seat_h)."""
    k = root(geo, f)
    L, D = length, depth
    arm = 0.16
    for x in (-L / 2 + 0.07, L / 2 - 0.07):
        for z in (-D / 2 + 0.07, D / 2 - 0.07):
            k.cyl(legs, (x, 0.0, z), (x, 0.13, z), 0.018, seg=10, r2=0.024)
    k.rbox(mat, 0, 0.13, 0.0, L, 0.2, D, 0.03, axis='x', seg=3)
    for s in (-1, 1):
        k.rbox(mat, s * (L / 2 - arm / 2), 0.13, 0.0, arm, 0.5, D, 0.05, axis='z', seg=4)
    k.rbox(mat, 0, 0.33, -D / 2 + 0.085, L - 2 * arm, 0.52, 0.17, 0.04, axis='x', seg=3)
    cw = (L - 2 * arm) / seats
    for i in range(seats):
        x = -L / 2 + arm + cw * (i + 0.5)
        k.rbox(mat, x, 0.33, 0.07, cw - 0.012, seat_h + 0.012 - 0.33, D - 0.2, 0.05, axis='x', seg=4)
        b = k.at(x, seat_h, -D / 2 + 0.24, rx=math.radians(-9))
        b.rbox(mat, 0, 0, 0, cw - 0.02, 0.42, 0.18, 0.07, axis='x', seg=4)
    return k


def armchair(geo, f, mat='Fabric', seat_h=0.46, stool=True):
    """A wing armchair (the family lounge's recliner place: 0.8 x 1.05 m with its footstool; the seat point 0.1 m behind the footprint's
    centre, as the layout puts it)."""
    k = root(geo, f)
    W = 0.78
    z0, z1 = -0.52, 0.2
    for x in (-W / 2 + 0.06, W / 2 - 0.06):
        for z in (z0 + 0.06, z1 - 0.06):
            k.cyl('Oak', (x * 1.04, 0.0, z * 1.04), (x, 0.17, z), 0.014, seg=10, r2=0.02)
    k.rbox(mat, 0, 0.17, (z0 + z1) / 2, W, 0.15, z1 - z0, 0.03, axis='x', seg=3)
    k.rbox(mat, 0, 0.32, -0.1, W - 0.24, seat_h + 0.012 - 0.32, 0.54, 0.05, axis='x', seg=4)
    for s in (-1, 1):
        k.rbox(mat, s * (W / 2 - 0.06), 0.32, (z0 + 0.04 + z1) / 2, 0.12, 0.31, z1 - z0 - 0.04, 0.05, axis='z', seg=4)
    b = k.at(0, 0.32, -0.43, rx=math.radians(-11))
    b.rbox(mat, 0, 0, 0, W - 0.04, 0.78, 0.16, 0.06, axis='x', seg=4)
    for s in (-1, 1):            # wings
        b.rbox(mat, s * (W / 2 - 0.045), 0.42, 0.1, 0.09, 0.36, 0.2, 0.04, axis='z', seg=3)
    if stool:
        for x in (-0.18, 0.18):
            for z in (0.29, 0.47):
                k.cyl('Oak', (x, 0.0, z), (x, 0.1, z), 0.012, seg=8)
        k.rbox(mat, 0, 0.1, 0.38, 0.48, 0.3, 0.26, 0.05, axis='y', seg=4)
    return k


def low_table(geo, f, w=0.94, d=0.54, h=0.42, top='Oak'):
    k = root(geo, f)
    for x in (-w / 2 + 0.06, w / 2 - 0.06):
        for z in (-d / 2 + 0.06, d / 2 - 0.06):
            k.vcyl('Steel', x, 0, z, 0.014, h - 0.03, seg=10)
    k.rbox('Steel', 0, 0.12, 0, w - 0.1, 0.012, d - 0.1, 0.02, axis='y', seg=3)
    k.rbox(top, 0, h - 0.03, 0, w, 0.03, d, 0.03, axis='y', seg=4)
    return k


def meeting_table(geo, f, w=1.4, d=0.8, h=0.74):
    k = root(geo, f)
    for x in (-w / 2 + 0.12, w / 2 - 0.12):
        k.box('Steel', x - 0.02, 0, -d / 2 + 0.08, x + 0.02, 0.03, d / 2 - 0.08)
        k.box('Steel', x - 0.02, 0.03, -0.03, x + 0.02, h - 0.035, 0.03)
        k.box('Steel', x - 0.02, h - 0.06, -d / 2 + 0.1, x + 0.02, h - 0.035, d / 2 - 0.1)
    k.rbox('Oak', 0, h - 0.035, 0, w, 0.035, d, 0.02, axis='y', seg=3)
    return k


def bench(geo, f, length=2.0, seat=0.43):
    """A corridor bench with a back: graphite steel frames, an oak seat, two oak back rails (front +z)."""
    k = root(geo, f)
    for x in (-length / 2 + 0.2, 0.0, length / 2 - 0.2):
        k.box('Steel', x - 0.02, 0, 0.15, x + 0.02, seat - 0.03, 0.19)
        k.box('Steel', x - 0.02, 0, -0.21, x + 0.02, seat - 0.03, -0.17)
        k.box('Steel', x - 0.02, seat - 0.06, -0.21, x + 0.02, seat - 0.03, 0.19)
        k.box('Steel', x - 0.015, seat - 0.03, -0.235, x + 0.015, seat + 0.43, -0.205)
    k.box('Oak', -length / 2, seat - 0.03, -0.23, length / 2, seat, 0.23, bev=0.006)
    for y in (seat + 0.13, seat + 0.3):
        k.box('Oak', -length / 2 + 0.05, y, -0.26, length / 2 - 0.05, y + 0.11, -0.235, bev=0.005)
    return k


def stretcher_bay(ctx, bx, bz, head, face, sign, ids):
    """One trolley bay: the trolley (the patient's mattress top at 0.8 m), the bed-head trunking under the raised window sill, a monitor arm on
    the trunking that holds the live monitor's bezel, and an IV stand on its footprint.
    head: the trolley heading (0 = head north); face: the head wall's face; sign: +1 when the room lies at +z from it; ids: footprint ids."""
    geo = ctx.geo
    er.stretcher(geo, Frame(bx, bz, head), deck=0.74, backrest=0.0, rails='up', linen=True)
    patient.headwall(geo, Frame(bx, face, 0.0 if sign > 0 else math.pi), width=2.0, y=1.02)
    mon = ctx.fur['footprints'].get(ids + ':monitor')
    if mon:
        u = abs(mon['z'] + sign * 0.03 - face)          # the bezel's centre (the pole's circle is 3 cm behind it)
        k = root(geo, Frame(mon['x'], face, 0.0 if sign > 0 else math.pi))
        k.vcyl('PowderWhite', 0, 1.24, 0.04, 0.022, 0.24, seg=14)
        k.rbox('PowderWhite', 0, 1.395, (0.04 + u - 0.06) / 2, 0.045, 0.045, u - 0.06 - 0.04, 0.018, axis='z', seg=3)
        k.vcyl('PowderWhite', 0, 1.36, u - 0.07, 0.026, 0.08, seg=14)
        k.box(sw(pt.LGREY), -0.06, 1.33, u - 0.055, 0.06, 1.47, u - 0.03, bev=0.004)
    iv = ctx.fur['footprints'].get(ids + ':iv')
    if iv:
        patient.iv_pole(geo, Frame(iv['x'], iv['z'], head), height=2.0, hooks=4, bags=1, pump=True)


def bay_curtains(geo, dividers, wall_face, sign, front_z, x0, x1):
    """Ceiling tracks between the bays (wall to front) and one along the front of the row; the divider curtains drawn two thirds from the wall,
    the front ones gathered at each divider."""
    w = Frame(0, 0)
    zs = wall_face + sign * 0.08
    patient.curtain_track(geo, w, [(x0, front_z), (x1, front_z)], ceiling=CH)
    for xd in dividers:
        fp = patient.curtain_track(geo, w, [(xd, zs), (xd, front_z)], ceiling=CH)
        patient.curtain(geo, w, fp, ceiling=CH, drawn=0.62, start=0.0)
        patient.curtain(geo, w, [(xd - 1.2, front_z), (xd - 0.01, front_z)], ceiling=CH, drawn=0.3, start=0.7)


def screen_stand(k, x, z, y0, y1):
    """A slim desk stand under one of the procedural screens (they float over the top otherwise)."""
    k.rbox(sw(pt.GRAPHITE), x, y0, z, 0.2, 0.012, 0.15, 0.03, axis='y', seg=3)
    k.vcyl(sw(pt.GRAPHITE), x, y0, z - 0.03, 0.017, y1 - y0, seg=12)


def or_furniture(ctx):
    """The theatre's static furniture on the procedural room's own footprints and seats (src/scene/rooms/surgery/or.ts; places.ts SURGERY),
    baked so it takes the room's light and contact shadows: the draped back table, the Mayo stand at the table's foot, the anaesthetist's
    stool, the two console operators' chairs with the consoles' foot pedals (they stand in the chairs' footprints), the circulator's standing
    desk. The devices stay procedural and live: table, robot cart, consoles, vision cart, anaesthesia machine, lights, pendant, boom, every
    screen and bezel (the desk's monitor, its stand and the keyboard stay too: metalDark above 1 m)."""
    geo = ctx.geo
    fp = ctx.fur['footprints']
    seats = {s['id']: s for s in ctx.fur['seats']}
    # the back table (places.ts SURGERY.backTable: 0.75 x 1.5 m, its long side along z; top 0.9 m), draped, instruments laid out
    bt = fp.get('l2:or:backtable')
    if bt:
        theatre.instrument_table(geo, Frame(bt['x'] + 0.0375, bt['z'], math.pi / 2), w=1.5, d=0.72, h=0.9, draped=True)
    # the Mayo stand: its column south of the tray, the tray cantilevered north over the table's foot (0.95 m)
    my = fp.get('l2:or:mayo')
    if my:
        theatre.mayo_stand(geo, Frame(my['x'], my['z'] + 0.05, math.pi), h=0.98)
    # the anaesthetist's stool (seat 0.55, a low back)
    st = seats.get('console:or:anaes')
    if st:
        support.pedestal_chair(geo, Frame(st['x'], st['z'], st['heading']), st['height'], back=(st['height'] + 0.08, st['height'] + 0.26), arms=False,
                       base_r=0.23)
    # the console operators' chairs (seat 0.45, facing west to the viewer) and each console's foot pedals: a graphite tray with five pedals,
    # 0.5..0.78 m in front of the console's centre (or.ts buildConsole)
    for who in ('surgeon', 'teach'):
        s = seats.get('console:or:' + who)
        if s:
            support.pedestal_chair(geo, Frame(s['x'], s['z'], s['heading']), s['height'], back=(s['height'] + 0.03, s['height'] + 0.5))
        con = fp.get('l2:or:console:' + who)
        if con:
            k = root(geo, Frame(con['x'], con['z'], con['rotationY']))
            k.box(sw(pt.GRAPHITE), -0.28, 0.0, 0.5, 0.28, 0.04, 0.78, bev=0.008)
            for i in range(5):
                x = -0.24 + i * 0.12
                k.box(sw(pt.GRAPHITE if i % 2 else pt.MGREY), x - 0.04, 0.04, 0.56, x + 0.04, 0.07, 0.7, bev=0.006)
                k.box('Rubber', x - 0.036, 0.07, 0.58, x + 0.036, 0.074, 0.68)
    # the circulator's standing desk against the north wall (1.4 x 0.42, top 1.0 m): a white carcass on a recessed plinth, three drawers,
    # an oak top; a phone and a document tray on it (the monitor, its stand and the keyboard are procedural)
    dk = fp.get('l2:or:desk')
    if dk:
        k = root(geo, Frame(dk['x'], dk['z'], 0.0))
        k.box('ShadowGap', -0.66, 0.0, -0.19, 0.66, 0.08, 0.17)
        k.box('SolidSurface', -0.7, 0.08, -0.21, 0.7, 0.96, 0.21, bev=0.006)
        for i in range(3):
            x0 = -0.68 + i * 0.4533
            k.box('SolidSurface', x0 + 0.004, 0.55, 0.21, x0 + 0.449, 0.93, 0.218, bev=0.003)
            k.box(sw(pt.MGREY), x0 + 0.13, 0.9, 0.218, x0 + 0.32, 0.912, 0.232, bev=0.003)
        k.box('Oak', -0.73, 0.96, -0.23, 0.73, 1.0, 0.23, bev=0.004)
        k.rbox(sw(pt.WHITE), 0.45, 1.0, 0.08, 0.14, 0.03, 0.16, 0.015, axis='y', seg=2)
        k.box(sw(pt.GRAPHITE), 0.41, 1.03, 0.04, 0.49, 1.045, 0.12, bev=0.004)
        k.box(sw(pt.LGREY), -0.62, 1.0, -0.05, -0.36, 1.03, 0.15, bev=0.004)


# --- rooms ------------------------------------------------------------------------------------------------------------------------------------
def operating_room(ctx):
    """The robotic theatre's architecture: floor coves, wall panels, sealed ceiling + UCV canopy, flush wall equipment. Nothing stands on the
    floor: the procedural room (or.ts) owns it."""
    geo, pl = ctx.geo, ctx.pl
    x0, x1, z0, z1 = OR[0] + T / 2, OR[1] - T / 2, OR[2] + T / 2, OR[3] - T / 2
    # the viewing window from the corridor (east wall, glassFull z 2.8..5.8; the glass runs between the solid pieces' ends)
    win = (2.9 - 0.02, 5.7 + 0.02)
    door = door_holes(pl, True, OR[2])
    walls = [  # (along_x, face, into, a, b, holes)
        (True, z0, +1, x0, x1, door),
        (True, z1, -1, x0, x1, []),
        (False, x0, +1, z0 + 0.01, z1 - 0.01, []),
        (False, x1, -1, z0 + 0.01, z1 - 0.01, [win]),
    ]
    for along_x, face, into, a, b, holes in walls:
        for s0, s1 in minus(a, b, holes):
            arch.coved_skirting(geo, along_x, face, into, s0, s1, h=0.1, mat='TheatreFloor')
        # seamless panels in 1.2 m modules with fine joints; over the door the panels continue above its head
        n = max(1, round((b - a) / 1.2))
        edges = [a + (b - a) * i / n for i in range(n + 1)]
        cuts = sorted(set([round(e, 5) for e in edges] + [round(h, 5) for hh in holes for h in hh if a < h < b]))
        for i in range(len(cuts) - 1):
            s0, s1 = cuts[i], cuts[i + 1]
            g0 = 0.002 if any(abs(s0 - e) < 1e-4 for e in edges[1:-1]) else 0.0
            g1 = 0.002 if any(abs(s1 - e) < 1e-4 for e in edges[1:-1]) else 0.0
            mid = (s0 + s1) / 2
            hole = next((hh for hh in holes if hh[0] - 1e-6 <= mid <= hh[1] + 1e-6), None)
            if hole is not None and hole is win:
                continue
            lo = 0.1 if hole is None else DOOR_H + 0.085
            wbox(geo, 'WallTintSage', along_x, face, into, s0 + g0, s1 - g1, lo, CH, 0.0, 0.01)
    # the sealed ceiling: plaster with flush LED panels around the laminar-flow canopy over the table (the procedural light hub hangs in it)
    tbl = (-49.2, 5.9)
    cs = 3.2
    can = (tbl[0] - cs / 2, tbl[0] + cs / 2, tbl[1] - cs / 2, tbl[1] + cs / 2)
    plaster_ceiling(geo, x0, x1, z0, z1, holes=[can])
    theatre.laminar_canopy(geo, Frame(tbl[0], tbl[1]), ceiling=CH, size=cs)
    panels = [(-52.3, -51.7, 5.3, 6.5), (-46.7, -46.1, 5.3, 6.5), (-51.7, -50.5, 2.75, 3.35), (-46.7, -45.5, 2.75, 3.35),
              (-51.7, -50.5, 8.6, 9.2), (-47.9, -46.7, 8.6, 9.2)]
    for (a0, a1, b0, b1) in panels:
        geo.box('SolidSurface', a0 - 0.02, CH - 0.004, b0 - 0.02, a1 + 0.02, CH, b1 + 0.02, drop=('up',))
        geo.box('LightPanel', a0, CH - 0.006, b0, a1, CH - 0.003, b1, drop=('up',))
    for (x, z) in ((-52.0, 3.2), (-45.2, 4.5), (-52.0, 8.7), (-45.2, 9.3)):
        downlight(ctx, x, z, power=10.0)
    # the north wall, west of the door: a flush theatre control panel (status screen, timers, gases, lights) and the clock above it
    fz = z0 + 0.01
    wbox(geo, 'Stainless', True, fz, +1, -51.05, -50.15, 1.2, 1.85, 0.0, 0.012)
    wbox(geo, 'Screen', True, fz, +1, -50.97, -50.23, 1.46, 1.78, 0.012, 0.014)
    for i, c in enumerate((pt.GREEN, pt.WHITE, pt.WHITE, pt.YELLOW, pt.RED)):
        t = -50.95 + i * 0.15
        wbox(geo, sw(c), True, fz, +1, t, t + 0.1, 1.28, 1.36, 0.012, 0.02)
    patient.wall_clock(geo, wall_at(True, fz, +1, -50.6), y=2.4)
    # the west wall: recessed glazed storage (the cart parks and drives along it: flush, 2 cm proud) and a PACS display
    fx = x0 + 0.01
    for (a, b) in ((3.9, 5.1),):
        y0, y1, fr = 0.35, 2.2, 0.04
        wbox(geo, 'Stainless', False, fx, +1, a, b, y0, y1, 0.0, 0.003)                       # the recess's back
        m = (a + b) / 2
        for (s0, s1, ya, yb) in ((a, b, y0, y0 + fr), (a, b, y1 - fr, y1), (a, a + fr, y0, y1), (b - fr, b, y0, y1), (m - 0.01, m + 0.01, y0, y1)):
            wbox(geo, 'Stainless', False, fx, +1, s0, s1, ya, yb, 0.0, 0.024)                 # the frame and the meeting stile
        for (s0, s1) in ((a + fr, m - 0.01), (m + 0.01, b - fr)):
            wbox(geo, 'Glass', False, fx, +1, s0, s1, y0 + fr, y1 - fr, 0.02, 0.022)
            for y in (0.8, 1.25, 1.7):
                wbox(geo, sw(pt.LGREY), False, fx, +1, s0 + 0.005, s1 - 0.005, y, y + 0.01, 0.003, 0.018)
                for j in range(2):
                    t = s0 + 0.04 + j * 0.27
                    wbox(geo, sw((pt.PALEBLUE, pt.WHITE, pt.CLEAR)[j + (1 if y > 1 else 0)]), False, fx, +1, t, t + 0.2, y + 0.01, y + 0.17 + 0.04 * j, 0.003, 0.016)
    wbox(geo, 'Stainless', False, fx, +1, 6.2, 7.4, 1.2, 1.92, 0.0, 0.015)
    wbox(geo, 'Screen', False, fx, +1, 6.25, 7.35, 1.25, 1.87, 0.015, 0.017)
    # the east wall over the consoles: a teaching display (flush, above the consoles' status panels)
    ex = x1 - 0.01
    wbox(geo, 'Stainless', False, ex, -1, 7.05, 8.45, 1.95, 2.75, 0.0, 0.015)
    wbox(geo, 'Screen', False, ex, -1, 7.1, 8.4, 2.0, 2.7, 0.015, 0.017)
    # low-level extract grilles in two corners
    for (along_x, face, into, a) in ((False, fx, +1, 2.4), (False, x1 - 0.01, -1, 9.25)):
        wbox(geo, 'Stainless', along_x, face, into, a, a + 0.42, 0.14, 0.52, 0.0, 0.012)
        for i in range(8):
            y = 0.18 + i * 0.042
            wbox(geo, 'ShadowGap', along_x, face, into, a + 0.03, a + 0.39, y, y + 0.018, 0.012, 0.013)


def hall(ctx):
    geo, pl = ctx.geo, ctx.pl
    fn, fs = HALL[2] + T / 2, HALL[3] - T / 2     # the hall's north and south wall faces
    sink = ctx.fur['footprints'].get('l2:hall:scrub')
    sx = sink['x'] if sink else -49.4
    theatre.scrub_sink(geo, Frame(sx, fs, math.pi), bays=3)
    cab = ctx.fur['footprints'].get('l2:hall:cabinet')
    if cab:
        support.cabinet(geo, Frame(cab['x'], cab['z'], 0.0), w=cab['w'], h=1.9, d=cab['d'], kind='glass')
    # crash rails along both walls, broken at the doors and the fittings
    n_holes = door_holes(pl, True, HALL[2]) + ([(cab['x'] - cab['w'] / 2 - 0.05, cab['x'] + cab['w'] / 2 + 0.05)] if cab else [])
    for s0, s1 in minus(HALL[0] + T / 2, HALL[1], n_holes):
        arch.crash_rail(geo, True, fn, +1, s0, s1)
    s_holes = door_holes(pl, True, HALL[3]) + [(sx - 1.05, sx + 1.05)]
    for s0, s1 in minus(HALL[0] + T / 2, HALL[1], s_holes):
        arch.crash_rail(geo, True, fs, -1, s0, s1)
    # the theatre door: an "in use" lamp over it, hand-rub beside it
    d = pl.door('l2Or')
    wbox(geo, sw(pt.GRAPHITE), True, fs, -1, d['x'] - 0.22, d['x'] + 0.22, 2.48, 2.62, 0.0, 0.05)
    wbox(geo, 'Accent:2', True, fs, -1, d['x'] - 0.19, d['x'] + 0.19, 2.505, 2.595, 0.05, 0.053)
    fu.dispenser(geo, True, fs, -1, d['x'] + d['width'] / 2 + 0.45)
    # the hall's end wall in the theatre sage: it closes the vista down the hall
    wbox(geo, 'WallTintSage', False, HALL[0] + T / 2, +1, fn, fs, 0.02, CH, 0.0, 0.004)
    for did in ('l2Staff', 'l2Sterile'):
        d = pl.door(did)
        fu.dispenser(geo, True, fn, +1, d['x'] + d['width'] / 2 + 0.4)


def preop(ctx):
    geo, pl = ctx.geo, ctx.pl
    fp = ctx.fur['footprints']
    face = PREOP[2] + T / 2
    xs = []
    for i in range(4):
        tr = fp.get(f'l2:preop:bed{i}:trolley')
        if not tr:
            continue
        xs.append(tr['x'])
        stretcher_bay(ctx, tr['x'], tr['z'], 0.0, face, +1, f'l2:preop:bed{i}')
    divs = sorted(f['x'] for k, f in fp.items() if k.startswith('l2:preop:div'))
    if xs:
        front = fp[f'l2:preop:bed0:trolley']['z'] + 1.85
        bay_curtains(geo, divs, face, +1, front, PREOP[0] + T / 2 + 0.05, max(divs) if divs else xs[-1] + 1.4)
    # the admissions counter (lobby desk language): white body, oak top, an LED lip on the visitor's (east) side; stands under its screens
    d = fp.get('l2:preop:desk')
    if d:
        k = root(geo, Frame(d['x'], d['z'], math.pi / 2))       # local +z = east (the visitor), local x = -z
        L = d['d']
        k.box(sw(pt.BLACK), -L / 2 + 0.03, 0, -0.12, L / 2 - 0.03, 0.08, 0.1, drop=('down',))
        k.box('SolidSurface', -L / 2 + 0.05, 0.08, -0.15, L / 2 - 0.05, 1.0, 0.15, bev=0.004)
        k.box('Oak', -L / 2, 1.0, -0.2, L / 2, 1.04, 0.2, bev=0.003)
        k.box('LEDLine', -L / 2 + 0.08, 0.985, 0.155, L / 2 - 0.08, 0.995, 0.17)
        for x in (-0.45, 0.45):
            screen_stand(k, x, -0.02, 1.04, 1.18)
    w = fp.get('l2:preop:waiting')
    if w:
        fu.bench_row(geo, Frame(w['x'], w['z'], w['rotationY']), 4, w['w'] / 4, 'FabricAccent', seat_h=0.37)
    t = fp.get('l2:preop:table')
    if t:
        fu.side_table(geo, t['x'], t['z'], r=0.25)
    p = fp.get('l2:preop:plant')
    if p:
        fu.planter(geo, p['x'], p['z'], r=p['w'] / 2, seed=5)
    s = fp.get('l2:preop:supply')
    if s:
        base_run(geo, Frame(s['x'], s['z'], math.pi), s['w'] - 0.06, s['d'] - 0.06, h=0.94)
    # hand-wash station and a clock on the east wall, between the bays and the admissions counter
    ex = PREOP[1] - T / 2
    patient.handwash(geo, wall_at(False, ex, -1, -19.4))
    patient.sharps_and_gloves(geo, wall_at(False, ex, -1, -20.6), y=1.2)
    patient.wall_clock(geo, wall_at(False, ex, -1, -17.0), y=2.15)


def pacu(ctx):
    geo, pl = ctx.geo, ctx.pl
    fp = ctx.fur['footprints']
    face = PACU[3] - T / 2
    xs = []
    for i in range(3):
        tr = fp.get(f'l2:pacu:bed{i}:trolley')
        if not tr:
            continue
        xs.append(tr['x'])
        stretcher_bay(ctx, tr['x'], tr['z'], math.pi, face, -1, f'l2:pacu:bed{i}')
    divs = sorted(f['x'] for k, f in fp.items() if k.startswith('l2:pacu:div'))
    if xs:
        front = fp['l2:pacu:bed0:trolley']['z'] - 1.85
        bay_curtains(geo, divs, face, -1, front, xs[0] - 1.1, xs[-1] + 1.1)
    # the nurse island under the live station screens (top at 0.99 like the procedural one: the screens' anchors stand on it)
    isl = fp.get('l2:pacu:island')
    if isl:
        k = root(geo, Frame(isl['x'], isl['z'], 0.0))
        L, D = isl['w'], isl['d']
        k.box(sw(pt.BLACK), -L / 2 + 0.08, 0, -D / 2 + 0.08, L / 2 - 0.08, 0.08, D / 2 - 0.08, drop=('down',))
        k.box('SolidSurface', -L / 2 + 0.05, 0.08, -D / 2 + 0.05, L / 2 - 0.05, 0.95, D / 2 - 0.05, bev=0.004)
        k.box('Oak', -L / 2, 0.95, -D / 2, L / 2, 0.99, D / 2, bev=0.003)
        k.box('SolidSurface', -L / 2 + 0.02, 0.99, -D / 2 + 0.02, L / 2 - 0.02, 1.13, -D / 2 + 0.06, bev=0.003)     # privacy upstand (north)
        k.box('LEDLine', -L / 2 + 0.1, 0.935, -D / 2 + 0.045, L / 2 - 0.1, 0.945, -D / 2 + 0.06)
        for x in (-0.5, 0.5):
            screen_stand(k, x, 0.13, 0.99, 1.13)
            k.box(sw(pt.GRAPHITE), x - 0.2, 0.99, 0.24, x + 0.2, 1.005, 0.36, bev=0.002)          # keyboards
    s = fp.get('l2:pacu:supply')
    if s:
        f = Frame(s['x'], s['z'], math.pi / 2)
        run = s['d'] - 0.1                  # the cabinet footprint is z 12.2..15.6 (R4: both cryo doors clear it): the sink sits near its south end
        base_run(geo, f, run, s['w'] - 0.05, h=0.94, sink=-(run / 2 - 0.62))
        wall_units(geo, Frame(PACU[0] + T / 2, s['z'], math.pi / 2), max(1.2, s['d'] - 0.9), y0=1.45, glass=True)
    p = fp.get('l2:pacu:plant')
    if p:
        fu.planter(geo, p['x'], p['z'], r=p['w'] / 2, seed=9)
    # a sage accent wall (north) behind the island, the recovery board's wall
    nf = PACU[2] + T / 2
    wbox(geo, 'WallTintSage', True, nf, +1, PACU[0] + T / 2, PACU[1] - T / 2, 0.02, CH, 0.0, 0.004)
    patient.handwash(geo, wall_at(True, nf, +1, -51.6))
    ex = PACU[1] - T / 2
    patient.wall_clock(geo, wall_at(False, ex, -1, 16.8), y=2.15)
    patient.sharps_and_gloves(geo, wall_at(False, ex, -1, 18.6), y=1.2)


def lounge(ctx):
    """The family lounge, the north half of the old one (z 2..10; the south half is the cryoablation suite): re-laid on the layout's footprints."""
    geo, pl = ctx.geo, ctx.pl
    fp = ctx.fur['footprints']
    # the floor-to-ceiling west façade
    for w in pl.walls():
        if w['cls'] == 'glassCut' and not w['alongX'] and abs(w['c'] + 62.0) < 1e-6:
            for a, b in pl.spans(w):
                if skip_glazing(w, a, b) and LOUNGE[2] <= (a + b) / 2 <= LOUNGE[3]:
                    curtain_wall(geo, w, a, b)
    # the east wall: warm sand plaster, an oak slat feature behind the sofa that stands against it
    ef = LOUNGE[1] - T / 2
    s0f = fp.get('l2:lounge:sofa0')
    sz = s0f['z'] if s0f else 6.6
    sa, sb = max(LOUNGE[2] + T / 2, sz - 1.6), min(LOUNGE[3] - T / 2, sz + 1.6)
    for t0, t1 in ((LOUNGE[2] + T / 2, sa), (sb, LOUNGE[3] - T / 2)):
        if t1 - t0 > 0.05:
            wbox(geo, 'WallTintSand', False, ef, -1, t0, t1, 0.02, CH, 0.0, 0.004)
    fu.slat_wall(geo, False, ef, -1, sa, sb, 0.0, CH)
    # the rug under the sofa group (covers the procedural rug plane)
    rg = fp.get('l2:lounge:rug')
    k = root(geo, Frame(rg['x'] if rg else -56.2, rg['z'] if rg else 6.6))
    k.rbox('Fabric', 0, 0.0, 0, 3.0, 0.018, 3.6, 0.06, axis='y', seg=3)
    # seating
    for i in range(4):
        r = fp.get(f'l2:lounge:recliner{i}')
        if r:
            armchair(geo, Frame(r['x'], r['z'], r['rotationY']), mat='Fabric', seat_h=0.46)
    for k_, t in sorted(fp.items()):
        if k_.startswith('l2:lounge:side'):
            fu.side_table(geo, t['x'], t['z'], r=t['w'] / 2 - 0.01, h=0.5)
    for i in range(2):
        s = fp.get(f'l2:lounge:sofa{i}')
        if s:
            sofa(geo, Frame(s['x'], s['z'], s['rotationY']), length=s['w'], depth=s['d'], seat_h=0.5, mat='FabricAccent')
        t = fp.get(f'l2:lounge:table{i}')
        if t:
            low_table(geo, Frame(t['x'], t['z'], t['rotationY']), w=t['w'], d=t['d'], h=0.4)
    # the tea point on the south wall (the control room's north wall behind it) and the water cooler
    tea = fp.get('l2:lounge:tea')
    if tea:
        f = Frame(tea['x'], tea['z'], math.pi)
        base_run(geo, f, tea['w'] - 0.06, tea['d'] - 0.06, h=0.9, top='SolidSurface', front='Oak', sink=0.9)
        k = root(geo, f)
        k.rbox('Stainless', -0.9, 0.9, -0.05, 0.3, 0.42, 0.28, 0.03, axis='y', seg=3)          # water boiler
        k.box(sw(pt.BLACK), -0.98, 1.1, 0.09, -0.82, 1.22, 0.095)
        k.rbox(sw(pt.GRAPHITE), -0.2, 0.9, -0.08, 0.32, 0.4, 0.36, 0.03, axis='y', seg=3)      # coffee machine
        k.box('Stainless', -0.3, 0.9, 0.06, -0.1, 0.93, 0.12)
        for i in range(6):
            k.vcyl(sw(pt.WHITE), 0.3 + (i % 3) * 0.09, 0.9, -0.05 + (i // 3) * 0.1, 0.035, 0.09, seg=12)
    c = fp.get('l2:lounge:cooler')
    if c:
        k = root(geo, Frame(c['x'], c['z'], math.pi))
        k.rbox(sw(pt.WHITE), 0, 0, 0, 0.32, 1.0, 0.32, 0.04, axis='y', seg=3)
        k.box(sw(pt.LGREY), -0.1, 0.7, 0.16, 0.1, 0.86, 0.165)
        k.box(sw(pt.GRAPHITE), -0.08, 0.62, 0.12, 0.08, 0.64, 0.17)
        k.vcyl(sw(pt.CLEAR), 0, 1.0, 0, 0.13, 0.36, seg=20)
    for pid, seed in (('l2:lounge:plantN', 13), ('l2:lounge:plantS', 21)):
        p = fp.get(pid)
        if p:
            fu.planter(geo, p['x'], p['z'], r=p['w'] / 2 - 0.02, seed=seed)
    # ceiling: smooth plaster with a recessed LED slot down the room, reading lights over the armchairs, wall washers on the slats
    plaster_ceiling(geo, LOUNGE[0] + 0.08, LOUNGE[1] - T / 2, LOUNGE[2] + T / 2, LOUNGE[3] - T / 2, slots=[('z', -57.6, LOUNGE[2] + 0.5, LOUNGE[3] - 0.5)])
    for z in (4.0, 6.2, 8.4):
        downlight(ctx, -60.3, z, power=12.0)
    for z in (sa + 0.5, sz + 0.4, sb - 0.4):
        downlight(ctx, -53.55, z, power=12.0)
    for x in (-57.4, -55.0):
        downlight(ctx, x, 8.9, power=12.0)


def staff(ctx):
    geo = ctx.geo
    fp = ctx.fur['footprints']
    lk = fp.get('l2:staff:lockers')
    if lk:
        # lockers: the door fronts at the procedural lockers' face, so its handles (metalDark above 1 m, always kept) sit on them
        k = root(geo, Frame(lk['x'], lk['z'], 0.0))
        L, D = lk['w'], lk['d']
        k.box(sw(pt.BLACK), -L / 2 + 0.01, 0, -D / 2, L / 2 - 0.01, 0.1, D / 2 - 0.05, drop=('down',))
        k.box('SolidSurface', -L / 2, 0.1, -D / 2, L / 2, 1.95, D / 2 - 0.02)
        n = 6
        for i in range(n):
            x0 = -L / 2 + i * L / n + 0.002
            k.box('Oak', x0, 0.103, D / 2 - 0.02, x0 + L / n - 0.004, 1.947, D / 2, bev=0.002)
            pt.keypad(k, x0 + L / n / 2 + 0.1, 1.42, D / 2)
    s = fp.get('l2:staff:sofa')
    if s:
        sofa(geo, Frame(s['x'], s['z'], s['rotationY']), length=s['w'], depth=s['d'], seat_h=0.5, mat='VinylTeal', legs='Steel')
    t = fp.get('l2:staff:table')
    if t:
        low_table(geo, Frame(t['x'], t['z'], t['rotationY']), w=t['w'], d=t['d'])
    m = fp.get('l2:staff:meeting')
    if m:
        meeting_table(geo, Frame(m['x'], m['z'], 0.0), w=m['w'], d=m['d'], h=0.74)
    for i in range(4):
        c = fp.get(f'l2:staff:chair{i}')
        if c:
            cafe.chair(geo, Frame(c['x'], c['z'], 0.0 if c['z'] < (m['z'] if m else -5.6) else math.pi), seat_h=0.47)
    kt = fp.get('l2:staff:kitchen')
    if kt:
        f = Frame(kt['x'], kt['z'], -math.pi / 2)
        base_run(geo, f, kt['d'] - 0.06, kt['w'] - 0.06, h=0.92, top='SolidSurface', front='Oak', sink=0.6)
        wall_units(geo, Frame(STAFF[1] - T / 2, kt['z'], -math.pi / 2), kt['d'] - 0.06, y0=1.5, glass=False)
        k = root(geo, f)
        k.rbox(sw(pt.GRAPHITE), -0.7, 0.92, -0.05, 0.3, 0.38, 0.32, 0.03, axis='y', seg=3)      # coffee machine
        k.rbox('Stainless', -0.2, 0.92, -0.08, 0.2, 0.24, 0.16, 0.06, axis='y', seg=4)           # kettle
    p = fp.get('l2:staff:plant')
    if p:
        fu.planter(geo, p['x'], p['z'], r=p['w'] / 2, seed=17)
    # the theatre list whiteboard on the south wall, east of the door
    sf = STAFF[3] - T / 2
    wbox(geo, 'Stainless', True, sf, -1, -56.2, -54.0, 1.0, 2.1, 0.0, 0.012)
    wbox(geo, 'SolidSurface', True, sf, -1, -56.17, -54.03, 1.03, 2.07, 0.012, 0.016)
    for i in range(6):
        y = 1.85 - i * 0.12
        wbox(geo, sw(pt.SLATE if i % 2 else pt.GRAPHITE), True, sf, -1, -56.0, -55.0 + 0.3 * (i % 3), y, y + 0.025, 0.016, 0.017)


def sterile(ctx):
    """White racks of wrapped instrument sets (pale blue sterile wraps, white drape packs), a grey bin row on the bottom shelf."""
    geo = ctx.geo
    for k_, f in ctx.fur['footprints'].items():
        if not k_.startswith('l2:sterile:rack'):
            continue
        w, d, h, n = f['w'] - 0.02, f['d'], 1.9, 5
        support.shelving(geo, Frame(f['x'], f['z'], f['rotationY']), w=w, h=h, d=d, shelves=n, bins=False)
        k = root(geo, Frame(f['x'], f['z'], f['rotationY']))
        packs = max(3, int((w - 0.08) / 0.48))
        pw = (w - 0.08) / packs
        for i in range(n - 1):
            y = 0.12 + (h - 0.25) * i / (n - 1) + 0.02
            for j in range(packs):
                x = -w / 2 + 0.04 + pw * j
                hh = 0.1 + 0.05 * ((i * 3 + j) % 3)
                c = (pt.PALEBLUE, pt.PALEBLUE, pt.WHITE, pt.SLATE)[(i + 2 * j) % 4] if i else pt.LGREY
                k.box(sw(c), x + 0.02, y, -d / 2 + 0.05, x + pw - 0.02, y + hh, d / 2 - 0.06, bev=0.006 if i else 0.0)


def corridor(ctx):
    geo, pl = ctx.geo, ctx.pl
    for w in pl.walls():
        if w['cls'] == 'glassCut' and not w['alongX'] and abs(w['c'] + 40.0) < 1e-6:
            for a, b in pl.spans(w):
                if skip_glazing(w, a, b):
                    curtain_wall(geo, w, a, b)
    x0, x1 = CORRIDOR[0] + T / 2, CORRIDOR[1] - 0.08
    plaster_ceiling(geo, x0, x1, CORRIDOR[2] + T / 2, CORRIDOR[3] - T / 2, slots=[('z', -42.0, -15.2, 15.2)])
    for z in (-13.0, -9.0, -5.5, 6.8, 10.0, 14.5):
        downlight(ctx, -43.45, z, power=12.0)
    for b_ in ('l2:corridor:bench0', 'l2:corridor:bench1'):
        f = ctx.fur['footprints'].get(b_)
        if f:
            bench(geo, Frame(f['x'], f['z'], -math.pi / 2), length=f['d'], seat=0.43)
    # crash rail on the west wall between the doors, the viewing window and the hall opening; a directory facing the lifts' way
    wf = CORRIDOR[0] + T / 2
    holes = door_holes(pl, False, CORRIDOR[0]) + [(2.75, 5.85)]
    for s0, s1 in minus(CORRIDOR[2] + T / 2, CORRIDOR[3] - T / 2, holes):
        arch.crash_rail(geo, False, wf, +1, s0, s1)
    fu.directory_sign(geo, False, wf, +1, -8.0, y0=1.15, width=1.4, height=0.95, colours=(4, 1, 3, 5))


def facades(ctx):
    """The pre-op and recovery façades: the window sill raised to 1.3 m so the bed-head trunking runs under the glass, a white window board."""
    geo, pl = ctx.geo, ctx.pl
    for w in pl.walls():
        if w['cls'] != 'glassCut' or not w['alongX']:
            continue
        for a, b in pl.spans(w):
            if not skip_glazing(w, a, b):
                continue
            ribbon_glazing(geo, pl, w, a, b, sill=1.3)
            into = +1 if w['c'] < 0 else -1
            wbox(geo, 'SolidSurface', True, w['c'] + into * T / 2, into, a, b, 1.3, 1.322, -0.05, 0.035)


# --- R4: the CT-guided, robot-assisted cryoablation suite (docs/R4-CRYO-SUITE.md) ---------------------------------------------------------------------
# Footprint rects (drawn x0, x1, z0, z1) of docs/R4-CRYO-SUITE.md section 2, used when the plan does not carry the footprint (the plan wins).
CRYO_RECTS = {
    'l2:cryo:robot': (-58.25, -56.95, 15.85, 16.65),
    'l2:cryo:console': (-59.35, -58.65, 14.1, 15.1),
    'l2:cryo:cylinders': (-61.0, -60.2, 14.1, 14.7),
    'l2:cryo:cabinet': (-61.0, -58.6, 21.35, 21.9),
    'l2:cryo:boom': (-57.5, -57.3, 19.2, 19.4),
    'l2:cryoctl:desk': (-61.4, -58.6, 12.2, 12.8),
    'l2:cryoctl:station': (-58.0, -56.6, 12.2, 12.8),
}


def cryo_fp(ctx, key):
    f = ctx.fur['footprints'].get(key)
    if f:
        return f
    x0, x1, z0, z1 = CRYO_RECTS[key]
    return {'id': key, 'x': (x0 + x1) / 2, 'z': (z0 + z1) / 2, 'w': x1 - x0, 'd': z1 - z0, 'rotationY': 0.0}


def solid_span(geo, pl, w, a, b):
    """A span of outer glazing drawn as a solid wall instead (the scan room has no windows)."""
    line_box(geo, pl.wall_mat(dict(w, a=a, b=b)), w, a, b, GAP_H, pl.H + 0.06, T, drop=('up',))
    line_box(geo, R('wall.shadowGap', 'ShadowGap'), w, a, b, 0.0, GAP_H, T - 2 * GAP_D, drop=('up', 'down'))


def sage_panels(geo, along_x, face, into, a, b, holes=()):
    """Seamless sage wall panels in 1.2 m modules with fine joints, 10 mm proud of a wall face (the theatre's wall language); over a door the
    panels continue above its head."""
    n = max(1, round((b - a) / 1.2))
    edges = [a + (b - a) * i / n for i in range(n + 1)]
    cuts = sorted(set([round(e, 5) for e in edges] + [round(h, 5) for hh in holes for h in hh if a < h < b]))
    for i in range(len(cuts) - 1):
        s0, s1 = cuts[i], cuts[i + 1]
        g0 = 0.002 if any(abs(s0 - e) < 1e-4 for e in edges[1:-1]) else 0.0
        g1 = 0.002 if any(abs(s1 - e) < 1e-4 for e in edges[1:-1]) else 0.0
        mid = (s0 + s1) / 2
        hole = next((hh for hh in holes if hh[0] - 1e-6 <= mid <= hh[1] + 1e-6), None)
        lo = 0.1 if hole is None else DOOR_H + 0.085
        wbox(geo, 'WallTintSage', along_x, face, into, s0 + g0, s1 - g1, lo, CH, 0.0, 0.01)


def door_of(pl, did, default):
    """(mid, width) of a door on its wall line, from the plan (else the brief's)."""
    try:
        d = pl.door(did)
        return (d['z'] if d['wallAxis'] == 'z' else d['x']), d['width']
    except StopIteration:
        return default


def trefoil(geo, f, size=0.3):
    """A radiation warning sign on a wall (local +z out of the wall, origin at the sign's centre on the wall face): a yellow plate with the
    black trefoil (a hub and three 60-degree blades)."""
    k = root(geo, f)
    k.rbox(sw(pt.YELLOW), 0, -size / 2, 0.005, size, size, 0.01, 0.02, axis='z', seg=3)
    z = 0.0106
    r0, r1 = size * 0.1, size * 0.4

    def pt_(r, a):
        return (r * math.cos(a), r * math.sin(a), z)

    for c in (90, 210, 330):
        a0, a1 = math.radians(c - 30), math.radians(c + 30)
        n = 6
        outer = [pt_(r1, a0 + (a1 - a0) * i / n) for i in range(n + 1)]
        inner = [pt_(r0, a1 - (a1 - a0) * i / n) for i in range(n + 1)]
        k.poly(sw(pt.BLACK), outer + inner)
    k.poly(sw(pt.BLACK), [pt_(size * 0.06, 2 * math.pi * i / 14) for i in range(14)])       # the hub
    return k


def xray_lamp(geo, along_x, face, into, t, w=0.5):
    """The "X-ray in use" lamp over a door: a graphite housing, a red panel and a glowing strip (the theatre hall's lamp, wider)."""
    wbox(geo, sw(pt.GRAPHITE), along_x, face, into, t - w / 2, t + w / 2, 2.47, 2.63, 0.0, 0.05)
    wbox(geo, 'Accent:2', along_x, face, into, t - w / 2 + 0.03, t + w / 2 - 0.03, 2.495, 2.605, 0.05, 0.053)
    wbox(geo, 'LightPanel', along_x, face, into, t - w / 2 + 0.07, t + w / 2 - 0.07, 2.535, 2.565, 0.053, 0.0545)


def lead_frame(geo, along_x, face, into, mid, width, lead=True):
    """A lead-lined door frame: a graphite-grey leaded cover band round the architrave (the lining's skin: 50 mm wide; `lead`) and stainless
    door guards 0.1..1.0 m on the wall beside it."""
    h = width / 2 + 0.075
    if lead:
        wbox(geo, sw(pt.MGREY), along_x, face, into, mid - h - 0.05, mid - h, 0.0, DOOR_H + 0.125, 0.0, 0.006)
        wbox(geo, sw(pt.MGREY), along_x, face, into, mid + h, mid + h + 0.05, 0.0, DOOR_H + 0.125, 0.0, 0.006)
        wbox(geo, sw(pt.MGREY), along_x, face, into, mid - h, mid + h, DOOR_H + 0.075, DOOR_H + 0.125, 0.0, 0.006)
    for sg in (-1, 1):
        a0 = mid + sg * (h + 0.05)
        a1 = mid + sg * (h + 0.3)
        wbox(geo, 'Stainless', along_x, face, into, a0, a1, 0.1, 1.0, 0.0, 0.004)


def cryo_room(ctx):
    """The cryoablation scan room (z 13..22): architecture, the observation window, and the baked equipment. The CT gantry, its rotor and the
    moving table, and the robot's arm, are LIVE (src/scene/cryoSuite): nothing here stands in the gantry's or the table's space."""
    geo, pl = ctx.geo, ctx.pl
    x0, x1, z0, z1 = CRYO[0] + T / 2, CRYO[1] - T / 2, CRYO[2] + T / 2, CRYO[3] - T / 2      # wall faces -61.9, -53.1, 13.1, 21.9
    for w in pl.walls():                                                                      # no windows in a radiation room
        if w['cls'] != 'glassCut':
            continue
        for a, b in pl.spans(w):
            m = (a + b) / 2
            if (not w['alongX'] and abs(w['c'] + 62.0) < 1e-6 and CRYO[2] <= m <= CRYO[3]) or \
                    (w['alongX'] and abs(w['c'] - 22.0) < 1e-6 and CRYO[0] <= m <= CRYO[1]):
                solid_span(geo, pl, w, a, b)
    door_e = door_holes(pl, False, CRYO[1])
    door_n = door_holes(pl, True, CRYO[2])
    walls = [  # (along_x, face, into, a, b, holes)
        (False, x0, +1, z0 + 0.01, z1 - 0.01, []),
        (False, x1, -1, z0 + 0.01, z1 - 0.01, door_e),
        (True, z1, -1, x0, x1, []),
        (True, z0, +1, x0, x1, door_n),
    ]
    for along_x, face, into, a, b, holes in walls:
        for s0, s1 in minus(a, b, holes):
            arch.coved_skirting(geo, along_x, face, into, s0, s1, h=0.1, mat='TheatreFloor')
    # sage panels behind the gantry (west) and on the supply wall (south); the east wall stays white plaster
    sage_panels(geo, False, x0 + 0.01, +1, z0 + 0.01, z1 - 0.01)
    sage_panels(geo, True, z1 - 0.01, -1, x0 + 0.01, x1 - 0.01)

    # the observation window: the glass wall (z = 13) is full-height glass from the shell; below 0.95 and above 2.3 it is solid, and the lead
    # glass sits in a stainless frame between two piers (the control room's desks stand under it)
    wall = R('wall.hero', 'WallPaint')
    hole = door_n[0] if door_n else (-54.885, -53.515)
    xe = hole[0]                                                                                # the door's west edge, with its architrave
    wx0, wx1 = x0 + 0.4, xe - 0.4
    zc0, zc1 = CRYO[2] - T / 2 + 0.002, CRYO[2] + T / 2 - 0.002
    geo.box(wall, x0, GAP_H, zc0, xe, 0.95, zc1)
    geo.box(wall, x0, 2.3, zc0, xe, CH, zc1, drop=('up',))
    geo.box(wall, x0, 0.95, zc0, wx0, 2.3, zc1)
    geo.box(wall, wx1, 0.95, zc0, xe, 2.3, zc1)
    for zz0, zz1 in ((zc0 + 0.02, zc1 - 0.02),):
        geo.box('Stainless', wx0, 0.95, zz0, wx1, 0.985, zz1)                                  # sill
        geo.box('Stainless', wx0, 2.265, zz0, wx1, 2.3, zz1)                                   # head
        geo.box('Stainless', wx0, 0.985, zz0, wx0 + 0.03, 2.265, zz1)
        geo.box('Stainless', wx1 - 0.03, 0.985, zz0, wx1, 2.265, zz1)
    geo.box('Oak', wx0 - 0.02, 0.95, zc1 - 0.02, wx1 + 0.02, 0.97, zc1 + 0.07)       # a ledge on the scan-room side (the sill's cap)

    # doors: the scan-room door (a lead-lined frame on both leaves' scan-room side, stainless guards both sides) and its lamp and sign
    mid, wd = door_of(pl, 'l2Cryo', (16.8, 1.8))
    lead_frame(geo, False, x1, -1, mid, wd)
    lead_frame(geo, False, CRYO[1] + T / 2, +1, mid, wd, lead=False)                          # guards on the recovery side too
    xray_lamp(geo, False, CRYO[1] + T / 2, +1, mid, w=0.5)
    xray_lamp(geo, False, x1, -1, mid, w=0.5)
    trefoil(geo, Frame(CRYO[1] + T / 2, mid + wd / 2 + 0.6, math.pi / 2, y=1.55), size=0.3)
    mid2, wd2 = door_of(pl, 'l2CryoInner', (-54.2, 1.2))
    lead_frame(geo, True, z0, +1, mid2, wd2)
    fu.dispenser(geo, False, x1, -1, mid + wd / 2 + 0.5)

    # the ceiling: sealed plaster with a recessed LED slot along the bore line and flush LED panels
    slots = [('x', 17.4, CRYO[0] + 0.4, CRYO[1] - 0.4)]
    plaster_ceiling(geo, x0, x1, z0, z1, slots=slots)
    panels = [(-60.9, -59.7, 14.3, 14.9), (-58.1, -56.9, 14.3, 14.9), (-55.3, -54.1, 14.3, 14.9),
              (-60.9, -59.7, 19.9, 20.5), (-55.3, -54.1, 19.9, 20.5), (-59.1, -57.9, 20.5, 21.1)]
    for (a0, a1, b0, b1) in panels:
        geo.box('SolidSurface', a0 - 0.02, CH - 0.004, b0 - 0.02, a1 + 0.02, CH, b1 + 0.02, drop=('up',))
        geo.box('LightPanel', a0, CH - 0.006, b0, a1, CH - 0.003, b1, drop=('up',))
    for (x, z) in ((-59.0, 15.9), (-55.5, 15.2), (-55.5, 19.3), (-59.8, 20.8), (-57.3, 14.5)):
        downlight(ctx, x, z, power=10.0)

    # the baked equipment (the footprints of docs/R4-CRYO-SUITE.md; the CT and the robot's arm are live)
    rb = cryo_fp(ctx, 'l2:cryo:robot')
    ctcryo.robot_base(geo, Frame(rb['x'], rb['z'], 0.0))
    cs = cryo_fp(ctx, 'l2:cryo:console')
    ctcryo.argon_console(geo, Frame(cs['x'], cs['z'], 0.0))
    cy = cryo_fp(ctx, 'l2:cryo:cylinders')
    ctcryo.cylinder_cart(geo, Frame(cy['x'], cy['z'], 0.0), console_at=(cs['x'] - cy['x'], cs['z'] - cy['z']))
    bm = cryo_fp(ctx, 'l2:cryo:boom')
    ctcryo.monitor_boom(geo, Frame(bm['x'], bm['z'], math.pi), ceiling=CH, spread=0.6)
    cb = cryo_fp(ctx, 'l2:cryo:cabinet')
    base_run(geo, Frame(cb['x'], cb['z'], math.pi), cb['w'] - 0.04, cb['d'] - 0.04, h=0.92, top='SolidSurface', front='Oak')
    wall_units(geo, Frame(cb['x'], z1, math.pi), cb['w'] - 0.04, y0=1.35, glass=False)
    # south wall: a gas panel at the head end, lead aprons on a rail, a hand-wash, a clock on the west wall
    pk = root(geo, wall_at(True, z1 - 0.01, -1, -57.9))
    pk.box('Stainless', -0.3, 1.1, 0.0, 0.3, 1.6, 0.012)
    for i, (xx, yy, cc) in enumerate(((-0.14, 1.45, pt.WHITE), (0.14, 1.45, pt.BLUE), (-0.14, 1.25, pt.YELLOW), (0.14, 1.25, pt.GREEN))):
        pt.gas_outlet(pk, xx, yy, cc, z=0.012)
    ar = root(geo, wall_at(True, z1 - 0.01, -1, -56.4))
    for xx in (-0.85, 0.85):
        ar.cyl('Stainless', (xx, 1.6, 0.0), (xx, 1.6, 0.09), 0.008, seg=8)
    ar.cyl('Stainless', (-0.85, 1.6, 0.09), (0.85, 1.6, 0.09), 0.011, seg=10)
    for xx in (-0.55, 0.0, 0.55):
        ar.rbox(sw(pt.SLATE), xx, 0.72, 0.125, 0.46, 0.86, 0.03, 0.025, axis='z', seg=3)
        ar.box(sw(pt.MGREY), xx - 0.14, 1.4, 0.1, xx + 0.14, 1.58, 0.105)
        ar.box(sw(pt.WHITE), xx - 0.1, 1.0, 0.141, xx + 0.1, 1.05, 0.1425)
    ctcryo.wall_clock(geo, wall_at(False, x0 + 0.01, +1, 20.4), y=2.3)


def cryo_control(ctx):
    """The cryo control room (z 10..13): the CT operator's desk and the robot planning station under the observation glass, their chairs."""
    geo, pl = ctx.geo, ctx.pl
    d = cryo_fp(ctx, 'l2:cryoctl:desk')
    ctcryo.ct_desk(geo, Frame(d['x'], d['z'], math.pi), w=d['w'], d=d['d'])
    st = cryo_fp(ctx, 'l2:cryoctl:station')
    ctcryo.station_desk(geo, Frame(st['x'], st['z'], math.pi), w=st['w'], d=st['d'])
    # the operators' swivel chairs stay procedural (cryoRoom.ts draws them without a footprint, so no replaces key can hide them)
    x0, x1, z0, z1 = CRYOCTL[0] + T / 2, CRYOCTL[1] - T / 2, CRYOCTL[2] + T / 2, CRYOCTL[3] - T / 2     # -61.9, -53.1, 10.1, 12.9
    for along_x, face, into, a, b, holes in ((True, z0, +1, x0, x1, []), (False, x1, -1, z0, z1, door_holes(pl, False, CRYOCTL[1])),
                                              (True, z1, -1, x0, x1, door_holes(pl, True, CRYOCTL[3]))):
        for s0, s1 in minus(a, b, holes):
            arch.coved_skirting(geo, along_x, face, into, s0, s1, h=0.1)
    # the ceiling: plaster with three flush LED panels (a plain plaster ceiling keeps the zone's triangle budget: no tegular tiles here)
    plaster_ceiling(geo, x0, x1, z0, z1)
    for (a0, a1, b0, b1) in ((-60.6, -59.4, 11.2, 11.8), (-57.9, -56.7, 11.2, 11.8), (-55.2, -54.0, 11.2, 11.8)):
        geo.box('SolidSurface', a0 - 0.02, CH - 0.004, b0 - 0.02, a1 + 0.02, CH, b1 + 0.02, drop=('up',))
        geo.box('LightPanel', a0, CH - 0.006, b0, a1, CH - 0.003, b1, drop=('up',))
    for x in (-60.0, -57.3):
        downlight(ctx, x, 12.2, power=8.0)
    # the north wall: the case-list display (flush, stainless) and a clock; a hand-rub by the door
    wbox(geo, 'Stainless', True, z0, +1, -59.3, -57.9, 1.45, 2.15, 0.0, 0.015)
    wbox(geo, 'Screen', True, z0, +1, -59.25, -57.95, 1.5, 2.1, 0.015, 0.017)
    ctcryo.wall_clock(geo, wall_at(True, z0, +1, -56.3), y=2.2)
    mid, wd = door_of(pl, 'l2CryoControl', (11.0, 1.0))
    fu.dispenser(geo, False, x1, -1, mid + wd / 2 + 0.45)


def build(ctx):
    if arch is None:
        return
    facades(ctx)
    operating_room(ctx)
    or_furniture(ctx)
    hall(ctx)
    preop(ctx)
    pacu(ctx)
    lounge(ctx)
    cryo_room(ctx)
    cryo_control(ctx)
    staff(ctx)
    sterile(ctx)
    corridor(ctx)
