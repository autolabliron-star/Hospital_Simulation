"""
Zone 'core' (the command centre x -22..-12 and the robotic pharmacy core x -12..12, z -12..12): "clean clinical modern" around the procedural,
animated machinery, which this design leaves entirely alone (the live video wall and its base cabinets, the coordinators' displays and the
situation table's live map top; the MedVend island, gantries, dock ports, the pharmacist desks and doors, the glass perimeter and the ceiling
rail with its pods and portals).

Core: large-format light terrazzo (the glossy floor carries the glass and the LED slots), a smooth plaster ceiling at 3.0 m with recessed 50 mm LED
slots, concealed sprinklers, smoke detectors and speaker discs on a 3 m grid, a graphite floor inlay round the MedVend service zone, four fiddle-leaf
planters in the corners, stock shelving against the atrium glass and two parked medication carts. The ceiling stops at the rail's hangers (3.0 m)
and nothing stands under the rail lines but the floor.

Command centre: warm grey wool carpet (the shell's floor, meeting the core's terrazzo at the glass), four white solid-surface coordinator desks with an oak lip and cable tray
(on the procedural desk footprints; the live displays stand on them as before), task chairs on the seat points, the round situation table (a
solid-surface top for the live map) with four low-back stools, six planters, a credenza with a coffee point, and over it all a floating acoustic
cloud: a plaster band round a plaster panel faced with oak slats, uplit by a perimeter LED line, on slim rods.
"""
import math

from common import Frame
from furniture import planter
from kit import support
from kit.base import root
from kit.parts import sw, WARMWHITE, WHITE, LGREY, GRAPHITE, BLACK

CH = 3.0
COMMAND = (-22.0, -12.0, -12.0, 12.0)
CORE = (-12.0, 12.0, -12.0, 12.0)

# --- shell settings (zones/__init__.py) ---------------------------------------------------------------------------------------------------------
HERO = [(-22.0, 12.0, -12.0, 12.0)]
OWN_CEILINGS = ('command', 'core')
FLOORS = {'command': 'Fabric', 'core': 'Terrazzo'}

# review stills (plan x, z) -> look at (x, z), eye 1.6 m, 24 mm
POSES = [((-13.0, -9.8), (-19.5, 3.0)),          # the command centre from its north-east corner: desks, cloud, table, plants
         ((-9.4, 9.2), (12.0, -4.0)),           # the pharmacy core from its south-west corner: the ceiling slots, the floor inlay, planters, stock shelving on the atrium glass
         ((-20.8, 9.8), (-13.0, -4.0))]          # the command centre from its south-west: desks seen from behind, credenza

# the sim's footprints this design replaces (the live displays, bezels and the map screen are kept by the runtime)
REPLACES = ['footprint:command:desk*', 'footprint:command:chair*', 'footprint:command:stool*', 'footprint:command:plant*', 'footprint:command:table']
VISIBLE_FROM = ['wardA', 'wardB', 'atrium', 'imaging']


# --- ceilings ---------------------------------------------------------------------------------------------------------------------------------
def slotted_ceiling(geo, rect, along, slots, ext, hw=0.025):
    """A smooth plaster ceiling over rect (x0, x1, z0, z1) at CH with recessed LED slots running `along` ('x' or 'z') at the positions `slots`
    (across coordinates), lit between ext = (a0, a1) (along coordinates); the slot stays open (a dark recess) where it has no LED."""
    x0, x1, z0, z1 = rect
    if along == 'x':
        lo, hi, a_lo, a_hi = z0, z1, x0, x1
    else:
        lo, hi, a_lo, a_hi = x0, x1, z0, z1

    def box(mat, c0, c1, a0, a1, y0, y1):
        if along == 'x':
            geo.box(mat, a0, y0, c0, a1, y1, c1, drop=('up',))
        else:
            geo.box(mat, c0, y0, a0, c1, y1, a1, drop=('up',))

    edges = [lo] + [v for s in slots for v in (s - hw, s + hw)] + [hi]
    for i in range(0, len(edges), 2):
        box('CeilingPlaster', edges[i], edges[i + 1], a_lo, a_hi, CH, CH + 0.05)
    for s in slots:
        box('CeilingPlaster', s - hw, s + hw, a_lo, ext[0], CH, CH + 0.05)
        box('CeilingPlaster', s - hw, s + hw, ext[1], a_hi, CH, CH + 0.05)
        box('LEDLine', s - hw, s + hw, ext[0], ext[1], CH + 0.02, CH + 0.025)


def services(geo, rect, step=3.0, margin=1.5):
    """What every real ceiling carries: concealed sprinkler cover plates on a 3 m grid, smoke detectors and speaker discs (the lobby's)."""
    x0, x1, z0, z1 = rect
    w = Frame(0, 0)
    nx, nz = int((x1 - x0 - 2 * margin) // step) + 1, int((z1 - z0 - 2 * margin) // step) + 1
    ox = x0 + ((x1 - x0) - (nx - 1) * step) / 2
    oz = z0 + ((z1 - z0) - (nz - 1) * step) / 2
    for i in range(nx):
        for j in range(nz):
            x, z = ox + i * step, oz + j * step
            geo.cyl(w, 'SolidSurface', x, CH - 0.004, z, 0.034, 0.004, seg=16, bottom=True, top=False)
            if (i + j) % 3 == 1:
                geo.cyl(w, 'SolidSurface', x + 1.5, CH - 0.04, z + 1.5, 0.055, 0.04, seg=24, top=False)
                geo.cyl(w, 'SolidSurface', x + 1.5, CH - 0.046, z + 1.5, 0.03, 0.006, seg=16, top=False)
            elif (i + j) % 3 == 2:
                geo.cyl(w, 'SolidSurface', x - 1.5, CH - 0.02, z + 1.5, 0.08, 0.02, seg=24, top=False)


def core_ceiling(geo):
    x0, x1, z0, z1 = CORE
    slotted_ceiling(geo, (x0, x1 - 0.04, z0 + 0.04, z1 - 0.04), 'x', [-9.5, -5.0, 5.0, 9.5], (-10.0, 10.0))
    services(geo, CORE)


def command_ceiling(geo):
    x0, x1, z0, z1 = COMMAND
    slotted_ceiling(geo, (x0 + 0.04, x1, z0 + 0.04, z1 - 0.04), 'z', [-13.2], (-10.5, 10.5))
    services(geo, COMMAND, margin=1.8)
    cloud(geo)


def cloud(geo):
    """The command centre's floating acoustic cloud: a plaster band (450 mm) round a felt panel faced with oak slats at 70 mm, on six rods,
    with a perimeter LED line on its top rim that washes the ceiling."""
    cx0, cx1, cz0, cz1 = -20.0, -14.4, -9.6, 9.6
    y0, y1 = 2.62, 2.74
    b = 0.45
    for (a0, c0, a1, c1) in ((cx0, cz0, cx1, cz0 + b), (cx0, cz1 - b, cx1, cz1), (cx0, cz0 + b, cx0 + b, cz1 - b), (cx1 - b, cz0 + b, cx1, cz1 - b)):
        geo.box('CeilingPlaster', a0, y0, c0, a1, y1, c1)
    geo.box('CeilingPlaster', cx0 + b, 2.66, cz0 + b, cx1 - b, 2.68, cz1 - b, drop=('up',))
    sx0, sx1, sz0, sz1 = cx0 + b + 0.02, cx1 - b - 0.02, cz0 + b + 0.02, cz1 - b - 0.02
    pitch = 0.21
    n = int((sx1 - sx0) / pitch)
    off = ((sx1 - sx0) - (n * pitch - (pitch - 0.035))) / 2
    for i in range(n):
        x = sx0 + off + i * pitch
        geo.box('Oak', x, y0, sz0, x + 0.035, 2.665, sz1, drop=('up',))
    # perimeter LED line on the top rim (lights the ceiling): 25 mm wide, 60 mm in from the edge
    e, w = 0.06, 0.025
    for (a0, c0, a1, c1) in ((cx0 + e, cz0 + e, cx1 - e, cz0 + e + w), (cx0 + e, cz1 - e - w, cx1 - e, cz1 - e),
                             (cx0 + e, cz0 + e, cx0 + e + w, cz1 - e), (cx1 - e - w, cz0 + e, cx1 - e, cz1 - e)):
        geo.box('LEDLine', a0, y1, c0, a1, y1 + 0.004, c1, drop=('down',))
    k = root(geo, Frame(0, 0))
    for (x, z) in ((cx0 + 0.6, cz0 + 0.6), (cx1 - 0.6, cz0 + 0.6), (cx0 + 0.6, 0.0), (cx1 - 0.6, 0.0), (cx0 + 0.6, cz1 - 0.6), (cx1 - 0.6, cz1 - 0.6)):
        k.cyl('Steel', (x, y1, z), (x, CH, z), 0.006, seg=6)


# --- floors -----------------------------------------------------------------------------------------------------------------------------------
def floor_inlays(geo):
    """The core: a 14 mm graphite inlay round the MedVend service zone (flush: 5 mm proud). (The command centre's floor is carpet, the shell's.)"""
    x0, x1, z0, z1, t = -7.4, 7.4, -2.9, 2.9, 0.014
    for (a0, c0, a1, c1) in ((x0, z0, x1, z0 + t), (x0, z1 - t, x1, z1), (x0, z0, x0 + t, z1), (x1 - t, z0, x1, z1)):
        geo.box('Steel', a0, 0.0, c0, a1, 0.005, c1, drop=('down',))


# --- command centre furniture -----------------------------------------------------------------------------------------------------------------
def coordinator_desks(ctx):
    """The four coordinator desks on their footprints (2.4 x 0.78, top 740 mm: the live displays stand on them) and the task chairs on the seat points."""
    geo = ctx.geo
    seats = {s['id']: s for s in ctx.fur['seats']}
    for i in range(4):
        d = ctx.fur['footprints'][f'command:desk{i}']
        s = seats[f'command:desk:{i}']
        f = Frame(d['x'], d['z'], d['rotationY'])         # long axis along the local x; rotationY -pi/2: local +z points west, to the wall
        # the desk is built facing the wall, like the procedural one: the coordinator sits at local -z, the displays at +z
        face = Frame(d['x'], d['z'], s['heading'])
        k = root(geo, face)
        w, dd = d['w'], d['d']
        k.rbox('SolidSurface', 0, 0.70, 0, w, 0.04, dd, 0.008, axis='y', seg=2)
        k.box('Oak', -w / 2, 0.70, -dd / 2 - 0.012, w / 2, 0.74, -dd / 2)              # the oak lip on the coordinator's edge
        for sx in (-1, 1):
            x = sx * (w / 2 - 0.07)
            k.rbox('PowderWhite', x, 0.0, 0.0, 0.05, 0.03, dd - 0.1, 0.01, axis='z', seg=2)
            k.rbox('PowderWhite', x, 0.03, dd / 2 - 0.1, 0.05, 0.67, 0.05, 0.01, axis='y', seg=2)
            k.rbox('PowderWhite', x, 0.03, -dd / 2 + 0.12, 0.05, 0.67, 0.05, 0.01, axis='y', seg=2)
        k.box(sw(LGREY), -w / 2 + 0.2, 0.34, dd / 2 - 0.06, w / 2 - 0.2, 0.70, dd / 2 - 0.045)       # the modesty panel
        k.box(sw(GRAPHITE), -w / 2 + 0.25, 0.60, -dd / 2 + 0.1, w / 2 - 0.25, 0.64, -dd / 2 + 0.3)      # the cable tray
        # a slim stand under each live display (the procedural panels float 150 mm above the top at local x +-0.55, z +0.12)
        for sx in (-0.55, 0.55):
            k.rbox(sw(GRAPHITE), sx, 0.74, 0.1, 0.24, 0.012, 0.18, 0.004, axis='y', seg=2)
            k.vcyl(sw(GRAPHITE), sx, 0.752, 0.158, 0.014, 0.26, seg=10)
        # keyboard and mouse
        k.rbox(sw(GRAPHITE), -0.15, 0.74, -dd / 2 + 0.22, 0.44, 0.014, 0.14, 0.005, axis='y', seg=2)
        k.rbox(sw(GRAPHITE), 0.28, 0.74, -dd / 2 + 0.2, 0.065, 0.025, 0.1, 0.02, axis='y', seg=3)
        # the task chair: origin 50 mm behind the seat point, the sitter faces the wall
        h = s['heading']
        ox, oz = s['x'] - 0.05 * math.sin(h), s['z'] - 0.05 * math.cos(h)
        support.office_chair(geo, Frame(ox, oz, h), upholstery='VinylGrey')


def situation_table(ctx):
    geo = ctx.geo
    t = ctx.fur['footprints']['command:table']
    x, z = t['x'], t['z']
    k = root(geo, Frame(x, z))
    k.lathe('Steel', [(0.0, 0.0), (0.46, 0.0), (0.47, 0.012), (0.4, 0.03), (0.1, 0.05), (0.0, 0.05)], seg=40)
    k.vcyl('Steel', 0, 0.05, 0, 0.09, 0.67, seg=24)
    k.vcyl('ShadowGap', 0, 0.68, 0, 0.5, 0.04, seg=32)
    k.vcyl('SolidSurface', 0, 0.72, 0, 0.96, 0.05, seg=64)
    k.vcyl('Oak', 0, 0.7, 0, 0.965, 0.022, seg=64)
    # four low-back stools on the seat points
    for i in range(4):
        sp = ctx.fur['footprints'][f'command:stool{i}']
        h = math.atan2(x - sp['x'], z - sp['z'])
        s = root(geo, Frame(sp['x'], sp['z'], h))
        s.vcyl(sw(GRAPHITE), 0, 0.0, 0, 0.2, 0.02, seg=24)
        s.vcyl(sw(GRAPHITE), 0, 0.02, 0, 0.028, 0.34, seg=12)
        s.vcyl('VinylSage', 0, 0.36, 0, 0.215, 0.07, seg=32)
        s.rbox('VinylSage', 0, 0.46, -0.2, 0.36, 0.3, 0.05, 0.02, axis='z', seg=3)
        s.tube(sw(GRAPHITE), [(-0.09, 0.4, -0.12), (-0.09, 0.47, -0.2)], 0.008, seg=6)
        s.tube(sw(GRAPHITE), [(0.09, 0.4, -0.12), (0.09, 0.47, -0.2)], 0.008, seg=6)


def plants(ctx):
    for i in range(6):
        p = ctx.fur['footprints'][f'command:plant{i}']
        planter(ctx.geo, p['x'], p['z'], r=p['w'] / 2 - 0.02, seed=21 + i * 5, height=0.5, plant_h=1.75)


def credenza(geo):
    """A low oak credenza with a solid-surface top against the core glass (x = -12.65, z -3.8..3.8), a coffee point on it."""
    f = Frame(-12.55, 0.0, -math.pi / 2)         # local +z points west into the room, local x runs along z (north to south, reversed)
    k = root(geo, f)
    L, D = 3.8 / 2, 0.5 / 2
    k.box('ShadowGap', -L + 0.04, 0.0, -D + 0.03, L - 0.04, 0.08, D - 0.04, drop=('down', 'up'))
    k.box('SolidSurface', -L, 0.08, -D, L, 0.72, D)
    for i in range(6):
        x0 = -L + i * (2 * L / 6)
        k.box('Oak', x0 + 0.004, 0.09, D, x0 + 2 * L / 6 - 0.004, 0.71, D + 0.018, bev=0.002)
        k.box(sw(GRAPHITE), x0 + L / 6 - 0.07, 0.5, D + 0.018, x0 + L / 6 + 0.07, 0.515, D + 0.03)
    k.box('SolidSurface', -L - 0.02, 0.72, -D - 0.01, L + 0.02, 0.76, D + 0.03)
    cm = k.at(1.2, 0.76, 0.0)
    cm.rbox('Stainless', 0, 0, 0, 0.42, 0.44, 0.4, 0.04, axis='y', seg=3)
    cm.box(sw(BLACK), -0.17, 0.1, 0.2, 0.17, 0.3, 0.202)
    cm.box('Screen', -0.06, 0.34, 0.2, 0.06, 0.4, 0.202)
    for s in (-1, 1):
        cm.vcyl(sw(WHITE), s * 0.08, 0.1, 0.26, 0.03, 0.05, seg=10)
    for i in range(5):
        k.vcyl(sw(WHITE), -0.2 + i * 0.12, 0.76, 0.1, 0.03, 0.07, seg=10, r2=0.026)
    k.vcyl('Stainless', -1.15, 0.76, 0.0, 0.1, 0.3, seg=16)
    k.vcyl(sw(WARMWHITE), -1.15, 1.06, 0.0, 0.06, 0.04, seg=12)


# --- pharmacy core furniture --------------------------------------------------------------------------------------------------------------------
def core_extras(geo):
    for (x, z, s) in ((-10.7, -10.7, 31), (10.7, -10.7, 37), (-10.7, 10.7, 43), (10.7, 10.7, 49)):
        planter(geo, x, z, r=0.3, seed=s, height=0.55, plant_h=2.0)
    # stock shelving against the atrium glass, facing into the core
    for z in (-4.6, 4.6):
        support.shelving(geo, Frame(11.45, z, -math.pi / 2), w=1.2, h=1.9, d=0.5, shelves=5, bins=True)
    # two parked medication carts
    for (x, z, h) in ((-10.5, -8.6, math.pi / 2), (-10.5, 8.6, math.pi / 2)):
        support.med_cart(geo, Frame(x, z, h))


def build(ctx):
    geo = ctx.geo
    core_ceiling(geo)
    command_ceiling(geo)
    floor_inlays(geo)
    coordinator_desks(ctx)
    situation_table(ctx)
    plants(ctx)
    credenza(geo)
    core_extras(geo)
    # a few downlights over the doors and the desks (the slots do the rest): a white trim ring and the emitting lens, and a spot lamp in the bake
    w = Frame(0, 0)
    for (x, z) in ((0.0, -10.2), (0.0, 10.2), (-17.0, -10.6), (-17.0, 10.6)):
        geo.ring(w, 'SolidSurface', x, CH - 0.002, z, 0.045, 0.06, seg=24)
        geo.disc(w, 'LEDLine', x, CH - 0.001, z, 0.045, seg=24)
        ctx.downlight(x, z, CH, 12.0)
