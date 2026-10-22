"""
Zone 'er': triage (x -62..-44, z -22..-6) and the emergency department (x -62..-44, z 6..22), designed in the lobby's approved language
("clean clinical modern"): light grey-blue sheet vinyl with a coved skirting, white walls, a 600 mm tegular acoustic ceiling with lay-in LED
panels, light oak and white solid surface for the counters, and the emergency red of the lobby's door linings as the wayfinding colour.

Both halls are written once in hall coordinates (v = metres from the outer wall into the hall; the ER is the triage mirrored in z), exactly as
src/scene/rooms/triageEr.ts lays them out, so every seat, footprint, bay and live monitor of the sim stays true:

- the bays along the outer wall (ER 6, triage 4): a solid bed-head wall with a clerestory over it (the ribbon glazing is raised to 2.05 m so
  the services can run on the wall), a bedhead services trunking (gases, sockets, nurse call, up/down light) over a protection panel, bay
  curtains on ceiling tracks (closed along the shared sides, gathered at the front), a low ER trolley on the sim's trolley footprint (mattress
  top 0.44 m: the sim's patients lie and sit on it), the live monitor's support (ER: an articulated wall arm; triage: a roll stand) under the
  procedural live bezel, a bay number plate, alcohol gel; the ER's bay 1 (west, beside the ambulance doors) is the resus bay with a ceiling
  supply pendant;
- the ER's nurse station on the north wall facing every bay (a long white counter with an oak transaction top, monitors, task chairs, a back
  counter, the department's tracking board, a lowered plaster bulkhead with LED slots and downlights over it);
- the clean supply runs on the east walls (tall store, prep counter with a sink and wall cabinets, bin shelving, a medication cart), the crash
  carts, hand-wash stations, wall clocks, a red wayfinding band above the door heads, the triage desk with its vitals station by the west
  glazing, parked wheelchairs, a parked transfer trolley by the ambulance doors and the ambulance canopy outside them.

Moving things (the paramedics' stretcher, people, the live monitor faces, the procedural screens) stay the runtime's: the design draws around
them and replaces only the static procedural furniture (REPLACES).
"""
import math

import furniture as fu
from common import Frame
from shell import GAP_H, line_box

try:                                    # the furniture kit (tools/arch/kit): present in this repo; guarded so the shell still builds without it
    from kit import arch as ka, er as ke, patient as kp, support as ks
    from kit import parts as pt
    from kit.base import anchor, fillet, root
    from kit.parts import sw
except Exception:                       # noqa: BLE001
    ka = None

CH = 3.0                                # ceiling height of both halls
X0, X1 = -61.9, -44.1                   # inner faces of the west façade and the spine wall
WALL_IN = 21.9                          # |z| of the outer walls' inner face
BAY_D = 2.3                             # how deep the bays reach into the hall (the sim's nav band)
SILL = 2.05                             # the clerestory's sill over the bed-head walls
TOP = 0.44                              # the trolleys' mattress top (TROLLEY.top in src/scene/rooms/bedParts.ts)
PW, SS = 'PowderWhite', 'Stainless'

TRIAGE = (-62.0, -44.0, -22.0, -6.0)
ER = (-62.0, -44.0, 6.0, 22.0)
HALLS = {'triage': (-1, 4), 'er': (+1, 6)}      # area -> (s: the outer wall's side in z, bays)

# --- shell settings (zones/__init__.py) ---
HERO = [ER]
OWN_CEILINGS = ('triage', 'er')
DOOR_ACCENT = {'ambulance': 'Accent:2'}
# --- runtime hints ---
# every static piece of the procedural triage / ER furniture is redrawn here (trolleys, monitor stands, curtains and their rails, the triage
# desk and chairs, the supply runs, the crash carts, the parked trolley); the live bezels and screens always stay (region.ts keptAlways)
REPLACES = ['footprint:er:*', 'footprint:triage:*']
VISIBLE_FROM = ['lobby']
# --- review and bake hints ---
POSES = [((-49.6, 6.7), (-55.5, 20.5)),          # the ER from the lobby door
         ((-59.3, 17.0), (-60.7, 21.4)),         # the resus bay, close
         ((-51.2, 14.6), (-56.8, 7.0)),          # the nurse station
         ((-45.6, -8.2), (-57.0, -20.0))]        # triage
PROBE = (-53.0, 1.6, 14.0)                       # the ER hall at eye height (stainless, glass and the satin vinyl)


def skip_glazing(w, a, b):
    """The outer walls behind the bays (z = +-22): the design raises their glazing to a clerestory over the bed heads."""
    return w['alongX'] and abs(abs(w['c']) - 22.0) < 1e-6


def door_accent(d):
    return DOOR_ACCENT.get(d['id'])


# --- hall coordinates ---------------------------------------------------------------------------------------------------------------------------
def zv(s, v):
    """Plan z of the point v metres from the hall's outer wall."""
    return s * (22.0 - v)


def h_in(s):
    """The heading whose local +z points from the outer wall into the hall."""
    return 0.0 if s < 0 else math.pi


def bays(n):
    w = (X1 - X0) / n
    return [(X0 + i * w, X0 + (i + 1) * w) for i in range(n)]


def W(geo):
    """An emitter in plan coordinates."""
    return root(geo, Frame(0.0, 0.0, 0.0))


# --- architecture -------------------------------------------------------------------------------------------------------------------------------
def clerestory(geo, pl):
    """The outer walls behind the bays: a solid bed-head wall to SILL, a solid-surface sill, then glazing to the ceiling in slim graphite
    frames, a mullion on every bay line and mid bay."""
    for w in pl.walls():
        if w['cls'] != 'glassCut' or not skip_glazing(w, 0, 0):
            continue
        s = 1 if w['c'] > 0 else -1
        n = HALLS['er' if s > 0 else 'triage'][1]
        for a, b in pl.spans(w):
            line_box(geo, pl.wall_mat(dict(w, a=a, b=b)), w, a, b, GAP_H, SILL, pl.T)
            line_box(geo, 'ShadowGap', w, a, b, 0.0, GAP_H, pl.T - 0.024, drop=('up', 'down'))
            line_box(geo, 'SolidSurface', w, a, b, SILL, SILL + 0.025, 0.06, offset=-s * (pl.T / 2 + 0.01))
            line_box(geo, 'Mullion', w, a, b, SILL, SILL + 0.05, 0.1)
            line_box(geo, 'Mullion', w, a, b, CH - 0.06, CH + 0.06, 0.1)
            line_box(geo, 'Glass', w, a, b, SILL + 0.05, CH - 0.06, 0.012)
            ts = sorted({a, b} | {x for (x0, x1) in bays(n) for x in (x0, (x0 + x1) / 2) if a + 0.1 < x < b - 0.1})
            for t in ts:
                line_box(geo, 'Mullion', w, max(a, t - 0.025), min(b, t + 0.025), SILL + 0.05, CH - 0.06, 0.1)


def wall_runs(s):
    """The inner wall faces of a hall as (along_x, face, into, a, b) runs, door openings (with their architraves) left out."""
    zin = s * WALL_IN                  # outer wall
    zdoor = s * 6.1                    # the lobby wall with the hall's door at x -51..-49
    runs = [(True, zin, -s, X0, X1),
            (True, zdoor, s, X0, -51.08), (True, zdoor, s, -48.92, X1),
            (False, X1, -1, min(zdoor, zin), max(zdoor, zin))]
    if s > 0:      # the ER's west façade: the ambulance doors at z 9.2..11.6
        runs += [(False, X0, +1, 6.1, 9.12), (False, X0, +1, 11.68, WALL_IN)]
    else:
        runs += [(False, X0, +1, -WALL_IN, -6.1)]
    return runs


def skirting(geo, s):
    for (ax, face, into, a, b) in wall_runs(s):
        ka.coved_skirting(geo, ax, face, into, a, b, mat='TheatreFloor' if (ax and abs(face) > 21) else 'SheetVinyl')


def red_band(geo, s):
    """The emergency red as a slim wayfinding band above the door heads on the hall's inner walls (door wall and spine wall)."""
    y0, y1 = 2.44, 2.52
    for (ax, face, into, a, b) in wall_runs(s):
        if ax and abs(face) > 21:
            continue                    # not on the bed-head wall (the clerestory)
        if not ax and face < -60:
            continue                    # not on the west façade
        if ax:
            geo.box('Accent:2', a, y0, min(face, face + into * 0.004), b, y1, max(face, face + into * 0.004))
        else:
            geo.box('Accent:2', min(face, face + into * 0.004), y0, a, max(face, face + into * 0.004), y1, b)


def tegular(geo, rect, y, panels=(), skip=(), module=0.6):
    """The 600 mm tegular acoustic ceiling over rect (kit.arch.tegular_ceiling, plus `skip`: cells the design fills itself). Returns the
    grid (x0, z0, mx, mz) so features can be placed on it."""
    x0, x1, z0, z1 = rect
    nx, nz = int(round((x1 - x0) / module)), int(round((z1 - z0) / module))
    mx, mz = (x1 - x0) / nx, (z1 - z0) / nz
    taken = set(skip)
    for (i, j, wi, wj) in panels:
        for a in range(wi):
            for b in range(wj):
                taken.add((i + a, j + b))
        geo.box('LightPanel', x0 + i * mx + 0.012, y - 0.004, z0 + j * mz + 0.012, x0 + (i + wi) * mx - 0.012, y, z0 + (j + wj) * mz - 0.012,
                drop=('up',))
    for i in range(nx):
        for j in range(nz):
            if (i, j) in taken:
                continue
            ax, az = x0 + i * mx, z0 + j * mz
            geo.box('AcousticTile', ax + 0.018, y - 0.008, az + 0.018, ax + mx - 0.018, y + 0.012, az + mz - 0.018, drop=('up',))
            geo.box('AcousticTile', ax + 0.012, y, az + 0.012, ax + mx - 0.012, y + 0.012, az + mz - 0.012, drop=('up', 'down'))
    for i in range(nx + 1):
        x = x0 + i * mx
        geo.box('CeilingGrid', x - 0.012, y - 0.002, z0, x + 0.012, y + 0.002, z1, drop=('up',))
    for j in range(nz + 1):
        z = z0 + j * mz
        geo.box('CeilingGrid', x0, y - 0.0025, z - 0.012, x1, y + 0.0015, z + 0.012, drop=('up',))


class Grid:
    """The ceiling grid of one hall: cells by plan position."""

    def __init__(self, rect, module=0.6):
        self.x0, x1, self.z0, z1 = rect
        self.nx, self.nz = int(round((x1 - self.x0) / module)), int(round((z1 - self.z0) / module))
        self.mx, self.mz = (x1 - self.x0) / self.nx, (z1 - self.z0) / self.nz

    def cell(self, x, z, wi=1, wj=1):
        """The (i, j) of a wi x wj block centred as near as the grid allows on (x, z)."""
        i = int(round((x - self.x0) / self.mx - wi / 2))
        j = int(round((z - self.z0) / self.mz - wj / 2))
        return max(0, min(self.nx - wi, i)), max(0, min(self.nz - wj, j))

    def centre(self, i, j, wi=1, wj=1):
        return self.x0 + (i + wi / 2) * self.mx, self.z0 + (j + wj / 2) * self.mz

    def inside(self, x0, x1, z0, z1):
        """The cells lying wholly inside a plan rect."""
        out = []
        for i in range(self.nx):
            for j in range(self.nz):
                ax, az = self.x0 + i * self.mx, self.z0 + j * self.mz
                if ax >= x0 - 1e-6 and ax + self.mx <= x1 + 1e-6 and az >= z0 - 1e-6 and az + self.mz <= z1 + 1e-6:
                    out.append((i, j))
        return out


def diffuser(geo, g, i, j, y):
    """A 600 mm square ceiling swirl diffuser in a grid cell: a white face plate with concentric slots."""
    x0, z0 = g.x0 + i * g.mx + 0.014, g.z0 + j * g.mz + 0.014
    x1, z1 = g.x0 + (i + 1) * g.mx - 0.014, g.z0 + (j + 1) * g.mz - 0.014
    geo.box('SolidSurface', x0, y - 0.006, z0, x1, y + 0.01, z1, drop=('up',))
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    for r in (0.09, 0.16, 0.23):
        t = 0.008
        for (a0, b0, a1, b1) in ((cx - r, cz - r, cx + r, cz - r + t), (cx - r, cz + r - t, cx + r, cz + r),
                                 (cx - r, cz - r + t, cx - r + t, cz + r - t), (cx + r - t, cz - r + t, cx + r, cz + r - t)):
            geo.box('ShadowGap', a0, y - 0.0068, b0, a1, y - 0.006, b1, drop=('up',))


def downlight_fitting(geo, x, y, z):
    w = Frame(0, 0)
    geo.ring(w, 'SolidSurface', x, y - 0.002, z, 0.045, 0.06, seg=24)
    geo.disc(w, 'LEDLine', x, y - 0.001, z, 0.045, seg=24)


def ceiling(ctx, s):
    """The hall's tegular ceiling: an LED panel over every bay and a regular field over the hall, swirl diffusers, sprinklers and smoke
    detectors; in the ER a lowered plaster bulkhead with LED slots and downlights over the nurse station."""
    geo = ctx.geo
    zs = sorted((s * WALL_IN, s * 6.1))
    rect = (X0, X1, zs[0], zs[1])
    g = Grid(rect)
    area, n = ('er', 6) if s > 0 else ('triage', 4)
    panels, skip = [], set()
    used = set()

    def add(i, j, wi, wj):
        cells = {(i + a, j + b) for a in range(wi) for b in range(wj)}
        if cells & used:
            return
        used.update(cells)
        panels.append((i, j, wi, wj))

    # over every bay: a 600 x 1200 panel along the trolley
    for k, (x0, x1) in enumerate(bays(n)):
        cx = (x0 + x1) / 2
        if s > 0 and k == 0:          # the resus bay: two panels either side of the pendant's drop
            add(*g.cell(cx + 0.55, zv(s, 1.32), 1, 2), 1, 2)
            add(*g.cell(cx - 0.75, zv(s, 1.9), 1, 1), 1, 1)
            continue
        add(*g.cell(cx, zv(s, 1.32), 1, 2), 1, 2)
        if n == 4:                    # the wide triage cubicles: one over the chair too
            add(*g.cell(cx - 1.25, zv(s, 1.1), 1, 1), 1, 1)
    # the bulkhead over the nurse station
    if s > 0:
        BH = (-59.6, -53.2, 6.1, 9.0)
        for c in g.inside(*BH):
            skip.add(c)
            used.add(c)
    # the hall: continuous linear LED luminaires in the grid lines, east-west across the hall (the lobby's slots, in the clinical ceiling)
    lines = []
    for v in (5.0, 8.6, 12.2):
        j = int(round((zv(s, v) - g.z0) / g.mz))
        lines.append(g.z0 + j * g.mz)
    # swirl diffusers between the panel rows, sprinklers and smoke detectors on a ~3 m grid
    diffs = []
    for v in (6.5, 10.1):
        for x in (-58.9, -53.0, -47.1):
            c = g.cell(x, zv(s, v))
            if c not in used:
                used.add(c)
                skip.add(c)
                diffs.append(c)
    tegular(geo, rect, CH, panels, skip)
    for (i, j) in diffs:
        diffuser(geo, g, i, j, CH)
    w = Frame(0, 0)
    for v in (3.3, 6.5, 9.7, 12.9):
        for x in (-60.4, -57.4, -54.5, -51.5, -48.5, -45.6):
            i, j = g.cell(x, zv(s, v))
            px, pz = g.centre(i, j)
            if (i, j) in used:
                continue
            geo.cyl(w, 'SolidSurface', px, CH - 0.012, pz, 0.034, 0.004, seg=16, bottom=True, top=False)
    for (x, v) in ((-56.0, 6.8), (-50.0, 10.4), (-47.0, 6.8)):
        i, j = g.cell(x, zv(s, v))
        if (i, j) in used:
            continue
        px, pz = g.centre(i, j)
        geo.cyl(w, 'SolidSurface', px, CH - 0.05, pz, 0.055, 0.042, seg=24, top=False)
        geo.cyl(w, 'SolidSurface', px, CH - 0.056, pz, 0.03, 0.006, seg=16, top=False)
    for zl in lines:
        a, b = X0 + 0.9, X1 - 0.9
        geo.box('PowderWhite', a, CH - 0.016, zl - 0.04, b, CH + 0.01, zl + 0.04, drop=('up',))
        geo.box('LEDLine', a + 0.02, CH - 0.0175, zl - 0.027, b - 0.02, CH - 0.016, zl + 0.027, drop=('up',))
    if s > 0:
        bulkhead(ctx, BH)
    return g


def bulkhead(ctx, rect):
    """A plaster bulkhead lowered to 2.72 m over the nurse station: two recessed LED slots along it, downlights on its front edge."""
    geo = ctx.geo
    x0, x1, z0, z1 = rect
    y = 2.72
    geo.box('CeilingPlaster', x0, y + 0.05, z0, x1, CH - 0.004, z1, drop=('up',))
    slots = (7.35, 8.15)
    hw = 0.025
    edges = [z0] + [v for c in slots for v in (c - hw, c + hw)] + [z1]
    for i in range(0, len(edges), 2):
        geo.box('CeilingPlaster', x0, y, edges[i], x1, y + 0.05, edges[i + 1], drop=('up',))
    sx0, sx1 = x0 + 0.45, x1 - 0.45
    for c in slots:
        geo.box('CeilingPlaster', x0, y, c - hw, sx0, y + 0.05, c + hw, drop=('up',))
        geo.box('CeilingPlaster', sx1, y, c - hw, x1, y + 0.05, c + hw, drop=('up',))
        geo.box('LEDLine', sx0, y + 0.02, c - hw, sx1, y + 0.025, c + hw, drop=('up',))
    for x in (-58.6, -56.4, -54.2):
        downlight_fitting(geo, x, y, 8.7)
        ctx.downlight(x, 8.7, y, 10.0)


# --- the bay ------------------------------------------------------------------------------------------------------------------------------------
def bay_trolley(geo, f, lying=True, rails='up'):
    """A low ER trolley at its lowest working height (mattress top TOP = the sim's TROLLEY.top): four 150 mm castors under a rounded base
    cover, twin short hydraulic columns, a platform with corner bumpers, a vinyl mattress made up with a sheet, stainless side rails, push
    handles, a folding IV pole. Origin: footprint centre; head toward local -z. `lying`: an ER bay (pillow, foot handle, a folded blanket);
    else triage (the patient sits on the foot end: nothing there)."""
    k = root(geo, f, None)
    for x in (-0.25, 0.25):
        for z in (-0.7, 0.7):
            pt.castor(k, x, z, r=0.065, w=0.04, top=0.17, swivel=0.25 * (1 if x > 0 else -1), housing=pt.GRAPHITE)
    k.rbox(PW, 0, 0.15, 0, 0.6, 0.075, 1.5, 0.12, axis='y', seg=4)
    k.rbox('Rubber', 0, 0.14, 0, 0.64, 0.025, 1.56, 0.13, axis='y', seg=4)
    for z in (-0.4, 0.4):
        k.at(0, 0, z).lathe(sw(pt.GRAPHITE), [(0.0, 0.22), (0.07, 0.22), (0.06, 0.245), (0.07, 0.27), (0.06, 0.29), (0.0, 0.29)], seg=16)
    k.rbox(PW, 0, 0.29, 0, 0.74, 0.045, 1.96, 0.04, axis='y', seg=4)
    for x in (-0.37, 0.37):
        for z in (-0.98, 0.98):
            k.vcyl('Rubber', x, 0.28, z, 0.032, 0.065, seg=12)
    m0 = 0.335
    k.rbox('VinylTeal', 0, m0, 0, 0.68, 0.085, 1.9, 0.035, axis='z', seg=3)
    k.rbox('Linen', 0, m0 + 0.075, 0.0, 0.69, 0.016, 1.88, 0.006, axis='z', seg=2)
    if lying:
        k.rbox('Linen', 0, m0 + 0.08, -0.72, 0.52, 0.06, 0.3, 0.028, axis='x', seg=4)
        k.rbox('Curtain', 0, m0 + 0.088, 0.78, 0.66, 0.022, 0.32, 0.01, axis='x', seg=2)
    # side rails: a stainless tube frame on each side (up: a guard beside the patient; down: folded along the platform)
    for sx in (-1, 1):
        if rails == 'up':
            y0, y1, L, zc = TOP + 0.0, TOP + 0.3, 1.1, -0.15
        else:
            y0, y1, L, zc = 0.13, 0.31, 1.1, -0.15
        x = sx * 0.39
        k.tube(SS, fillet([(x, y0, zc - L / 2), (x, y1, zc - L / 2), (x, y1, zc + L / 2), (x, y0, zc + L / 2)], 0.05), 0.011, seg=10)
        for i in range(1, 4):
            z = zc - L / 2 + L * i / 4
            k.tube(SS, [(x, y0 + 0.02, z), (x, y1, z)], 0.007, seg=8)
    ends = ((-1.0, -1), (1.0, 1)) if lying else ((-1.0, -1),)
    for zz, sg in ends:
        k.tube(SS, fillet([(-0.27, 0.31, zz), (-0.27, 0.56, zz + sg * 0.06), (0.27, 0.56, zz + sg * 0.06), (0.27, 0.31, zz)], 0.05), 0.014,
               seg=10)
    if lying:
        k.vcyl(SS, -0.35, 0.2, -0.99, 0.011, 1.38, seg=10)
        k.tube(SS, [(-0.35, 1.58, -0.99), (-0.27, 1.58, -0.99), (-0.25, 1.6, -0.99)], 0.004, seg=6)
        k.tube(SS, [(-0.35, 1.58, -0.99), (-0.43, 1.58, -0.99), (-0.45, 1.6, -0.99)], 0.004, seg=6)
    return k


def arm_support(geo, s, mx, zb):
    """The ER bays' monitor: an articulated wall arm from a channel on the bed-head wall to a VESA mount behind the live bezel (the bezel and
    its live face are the runtime's, centred (mx, 1.3, zb))."""
    k = W(geo)
    zf = s * WALL_IN
    xc = mx + 0.24
    o = -s                              # into the hall
    k.rbox(PW, xc, 0.98, zf + o * 0.016, 0.07, 0.74, 0.032, 0.01, axis='y', seg=2)
    k.rbox(sw(pt.LGREY), xc, 1.07, zf + o * 0.05, 0.06, 0.08, 0.06, 0.012, axis='y', seg=2)
    y = 1.1
    p0 = (xc, y, zf + o * 0.06)
    p1 = (mx + 0.2, y, zf + o * 0.3)
    p2 = (mx, y, zb - o * 0.075)
    for a, b in ((p0, p1), (p1, p2)):
        k.tube(PW, [a, b], 0.021, seg=12)
    for p in (p0, p1, p2):
        k.vcyl(PW, p[0], y - 0.035, p[2], 0.028, 0.07, seg=14)
    k.vcyl(PW, p2[0], y + 0.035, p2[2], 0.016, 0.1, seg=10)
    k.box(sw(pt.LGREY), mx - 0.06, 1.2, min(zb - o * 0.03, zb - o * 0.075), mx + 0.06, 1.36, max(zb - o * 0.03, zb - o * 0.075))


def stand_support(geo, s, mx, zb):
    """The triage cubicles' vitals monitor: a five-castor roll stand with a basket, its mount behind the live bezel (mx, 1.3, zb)."""
    k = W(geo)
    o = -s
    zp = zb - o * 0.08
    v = k.at(mx, 0, zp)
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        v.tube(sw(pt.GRAPHITE), [(0, 0.07, 0), (math.cos(a) * 0.25, 0.05, math.sin(a) * 0.25)], 0.012, seg=6)
        pt.castor(v, math.cos(a) * 0.26, math.sin(a) * 0.26, r=0.025, w=0.02, top=0.05)
    v.vcyl(sw(pt.GRAPHITE), 0, 0.04, 0, 0.03, 0.05, seg=12)
    v.vcyl(sw(pt.LGREY), 0, 0.07, 0, 0.016, 1.13, seg=10)
    v.tray(sw(pt.LGREY), 0, 0.8, o * 0.11, 0.22, 0.13, 0.07, wall=0.006, r=0.02, seg=2)
    k.box(sw(pt.LGREY), mx - 0.06, 1.2, min(zb - o * 0.03, zp), mx + 0.06, 1.36, max(zb - o * 0.03, zp))
    k.tube(sw(pt.GRAPHITE), [(mx + 0.05, 1.22, zp), (mx + 0.12, 1.0, zp + o * 0.05), (mx + 0.08, 0.86, zp + o * 0.1)], 0.004, seg=5,
           caps=False)


SEG = {0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg'}


def digit(k, d, x, y, h, z, mat='Accent:5'):
    """A seven-segment numeral (h high) with its bottom-left at local (x, y), standing proud of z."""
    w, t = h * 0.56, h * 0.15
    seg = {'a': (x, y + h - t, x + w, y + h), 'g': (x, y + (h - t) / 2, x + w, y + (h + t) / 2), 'd': (x, y, x + w, y + t),
           'f': (x, y + h / 2, x + t, y + h), 'b': (x + w - t, y + h / 2, x + w, y + h),
           'e': (x, y, x + t, y + h / 2), 'c': (x + w - t, y, x + w, y + h / 2)}
    for c in SEG[d]:
        a0, b0, a1, b1 = seg[c]
        k.box(mat, a0, b0, z, a1, b1, z + 0.003)


def bay_plate(geo, s, x, number, y=1.76, resus=False):
    """A bay number plate on the bed-head wall: white, a red field with the white numeral (the resus bay's plate is red all over)."""
    k = root(geo, Frame(x, s * WALL_IN, h_in(s)))
    wdt = 0.36 if not resus else 0.5
    k.rbox('SolidSurface', 0, y, 0.008, wdt, 0.2, 0.016, 0.004, axis='z', seg=2)
    k.box('Accent:2', -wdt / 2 + 0.02, y + 0.02, 0.016, (wdt / 2 - 0.02) if resus else (-wdt / 2 + 0.18), y + 0.18, 0.019)
    digit(k, number, -wdt / 2 + 0.065, y + 0.045, 0.11, 0.019, mat=sw(pt.WHITE))
    if not resus:
        for i, L in enumerate((0.11, 0.07)):
            k.box('Accent:5', -wdt / 2 + 0.2, y + 0.11 - i * 0.04, 0.016, -wdt / 2 + 0.2 + L, y + 0.125 - i * 0.04, 0.0185)
    else:
        for i, L in enumerate((0.24, 0.16)):
            k.box(sw(pt.WHITE), -wdt / 2 + 0.17, y + 0.11 - i * 0.045, 0.019, -wdt / 2 + 0.17 + L, y + 0.13 - i * 0.045, 0.022)


def solve_arms(dx, dz, l1=0.9, l2=0.7):
    """Swing angles (degrees) of a two-arm pendant (theatre.supply_pendant) that put its head at the local offset (dx, dz) from the mount."""
    d = min(math.hypot(dx, dz), l1 + l2 - 1e-3)
    c2 = max(-1.0, min(1.0, (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2)))
    s2 = -math.acos(c2)
    s1 = math.atan2(dx, dz) - math.atan2(l2 * math.sin(s2), l1 + l2 * math.cos(s2))
    return math.degrees(s1), math.degrees(s2)


def resus_pendant(geo, s, cx):
    """The resus bay's ceiling supply pendant: the mount over the bay, the service head beside the trolley's head end, on the side away from
    the monitor, its shelves facing the patient."""
    mx, mz = cx - 0.6, zv(s, 1.95)
    hx, hz = cx - 0.98, zv(s, 0.85)
    h = math.pi / 2                     # local +z east: the head's shelves face the trolley
    dx, dz = hx - mx, hz - mz
    lx = dx * math.cos(h) - dz * math.sin(h)
    lz = dx * math.sin(h) + dz * math.cos(h)
    s1, s2 = solve_arms(lx, lz)
    from kit.theatre import supply_pendant
    supply_pendant(geo, Frame(mx, mz, h), node=None, ceiling=CH, kind='resus', swing1=s1, swing2=s2)


def bay(ctx, s, k, x0, x1, n):
    geo = ctx.geo
    cx = (x0 + x1) / 2
    hi = h_in(s)
    zf = s * WALL_IN
    lying = s > 0
    resus = lying and k == 0
    bay_trolley(geo, Frame(cx, zv(s, 1.32), hi), lying=lying, rails='up' if lying else 'down')
    kp.headwall(geo, Frame(cx, zf, hi), width=1.7 if lying else 1.9)
    mx, zb = cx + 0.9, zv(s, 0.58)
    (arm_support if lying else stand_support)(geo, s, mx, zb)
    # gel at the bay's other side, a bay plate over the headwall
    g = root(geo, Frame(cx - (1.18 if lying else 1.55), zf, hi))
    pt.dispenser(g, 0, 1.02)
    bay_plate(geo, s, cx, k + 1, resus=resus)
    if not lying:
        kp.sharps_and_gloves(geo, Frame(cx + 1.62, zf, hi), y=1.0)
        kp.visitor_chair(geo, Frame(cx - 1.3, zv(s, 1.15), math.pi / 2), vinyl='VinylTeal')
    if resus:
        resus_pendant(geo, s, cx)
    if lying and k in (2, 4):
        dressing_trolley(geo, Frame(cx - 0.98, zv(s, 1.85), hi + 0.2))
    # curtains on ceiling tracks: a U round the bay (no leg along a hall wall); the curtain closed along the shared right-hand side and
    # wrapped round its front corner, gathered; the last bay's curtain gathered at its free front corner
    first, last = k == 0, k == n - 1
    xl = (x0 + 0.06) if not first else (X0 + 0.04)
    xr = (x1 - 0.06) if not last else (X1 - 0.04)
    zw, zfr = s * (WALL_IN - 0.15), zv(s, BAY_D)
    path = ([] if first else [(xl, zw)]) + [(xl, zfr), (xr, zfr)] + ([] if last else [(xr, zw)])
    f = Frame(0.0, 0.0, 0.0)
    fp = kp.curtain_track(geo, f, path, CH, r=0.22)
    total = sum(math.hypot(fp[i + 1][0] - fp[i][0], fp[i + 1][1] - fp[i][1]) for i in range(len(fp) - 1))
    side = abs(zfr - zw)
    if not last:
        frac = min(1.0, (side + 0.45) / total)
        kp.curtain(geo, f, fp, CH, drawn=frac, start=1.0 - frac)
    else:
        kp.curtain(geo, f, fp, CH, drawn=0.11, start=0.89)
    return cx


def dressing_trolley(geo, f):
    """A stainless dressing / procedure trolley: four posts on small castors, two trays, a few packs and a glove box on top."""
    k = root(geo, f, None)
    w, d = 0.6, 0.42
    for x in (-w / 2 + 0.03, w / 2 - 0.03):
        for z in (-d / 2 + 0.03, d / 2 - 0.03):
            pt.castor(k, x, z, r=0.038, w=0.025, top=0.09)
            k.vcyl(SS, x, 0.09, z, 0.012, 0.8, seg=10)
    for y in (0.3, 0.86):
        k.tray(SS, 0, y, 0, w, d, 0.03, wall=0.006, r=0.015, seg=2)
    k.box(sw(pt.BLUE), -0.24, 0.89, -0.15, -0.02, 0.98, -0.02, bev=0.004)
    k.box(sw(pt.WHITE), 0.02, 0.89, -0.17, 0.26, 0.92, 0.0)
    k.box(sw(pt.PALEBLUE), 0.0, 0.89, 0.04, 0.24, 0.905, 0.18)
    k.box(sw(pt.WHITE), -0.22, 0.33, -0.15, 0.2, 0.42, 0.15, bev=0.004)


def hung_sign(geo, x, z, along_x=True, width=1.5):
    """A ceiling-hung directional sign (double sided): a white board on two rods, a red field and lettering bars on both faces."""
    k = root(geo, Frame(x, z, 0.0 if along_x else math.pi / 2))
    y0, y1, t = 2.32, 2.62, 0.035
    k.rbox('SolidSurface', 0, y0, 0, width, y1 - y0, t, 0.006, axis='z', seg=2)
    for sd in (-1, 1):
        zf = sd * t / 2
        za, zb = sorted((zf, zf + sd * 0.003))
        k.box('Accent:2', -width / 2 + 0.03, y0 + 0.03, za, -width / 2 + 0.27, y1 - 0.03, zb)
        for i, L in enumerate((0.62, 0.44)):
            k.box('Accent:5', -width / 2 + 0.36, y0 + 0.17 - i * 0.08, za, -width / 2 + 0.36 + L, y0 + 0.21 - i * 0.08, zb)
    for xx in (-width / 2 + 0.12, width / 2 - 0.12):
        k.vcyl(SS, xx, y1, 0, 0.005, CH - y1, seg=6)


def bay_floor(geo, s):
    """The bays' floor zone in the deeper grey-green clinical vinyl, up to the curtain line."""
    za, zb = sorted((s * WALL_IN, zv(s, BAY_D)))
    geo.box('TheatreFloor', X0, 0.0, za, X1, 0.0015, zb, drop=('down',))


# --- the nurse station, supply runs, triage desk --------------------------------------------------------------------------------------------------
def nurse_station(ctx):
    """The ER's nurse station on the north wall, facing every bay: the kit counter (white, oak transaction top with an LED lip, a lowered
    accessible end toward the door), four monitors, three task chairs; behind it a back counter with a printer and files, the tracking board
    and a wall clock."""
    geo = ctx.geo
    ke.nurse_station(geo, Frame(-56.4, 7.95, 0.0), length=5.4, depth=1.2, monitors=4, low_end=True)
    for x in (-58.3, -56.7, -55.1):
        ks.office_chair(geo, Frame(x, 7.05, 0.15 * (1 if x > -56 else -1)), node=None, upholstery='VinylGrey')
    k = W(geo)
    zb0, zb1 = 6.1, 6.62
    xa, xb = -59.3, -53.5
    k.box(sw(pt.GRAPHITE), xa + 0.02, 0.0, zb0, xb - 0.02, 0.1, zb1 - 0.05, drop=('down',))
    k.box('SolidSurface', xa, 0.1, zb0, xb, 0.88, zb1)
    k.box('Oak', xa - 0.01, 0.88, zb0, xb + 0.01, 0.915, zb1 + 0.02)
    nd = 6
    for i in range(1, nd):
        x = xa + (xb - xa) * i / nd
        k.box('ShadowGap', x - 0.002, 0.12, zb1, x + 0.002, 0.86, zb1 + 0.001)
    for i in range(nd):
        x = xa + (xb - xa) * (i + 0.5) / nd
        pt.bar_handle(k.at(x, 0, zb1, ry=0.0), -0.08, 0.08, 0.8, 0.0)
    # printer, file trays
    k.rbox(sw(pt.LGREY), -58.6, 0.915, 6.38, 0.46, 0.26, 0.4, 0.03, axis='y', seg=3)
    k.box(sw(pt.GRAPHITE), -58.78, 1.12, 6.56, -58.42, 1.15, 6.6)
    for i in range(3):
        k.box(sw(pt.SLATE), -54.4, 0.915 + i * 0.07, 6.18, -54.05, 0.93 + i * 0.07, 6.48)
    # the tracking board (the runtime may draw a live board at anchor screen:erBoard) and a clock
    # an oak slat panel over the back counter (the lobby's feature wall, in the department's heart), the board hung on it
    fu.slat_wall(geo, True, 6.1, +1, xa, xb, 0.915, 2.38)
    bx, by, bw, bh = -56.4, 1.78, 1.9, 1.07
    zf = 6.1 + 0.035
    k.rbox(sw(pt.GRAPHITE), bx, by - bh / 2, zf + 0.025, bw, bh, 0.05, 0.01, axis='z', seg=2)
    k.box('Screen', bx - bw / 2 + 0.02, by - bh / 2 + 0.02, zf + 0.05, bx + bw / 2 - 0.02, by + bh / 2 - 0.02, zf + 0.053)
    anchor(k, 'screen:erBoard', bx, by, zf + 0.053, w=round(bw - 0.04, 3), h=round(bh - 0.04, 3), facing='+z')
    kp.wall_clock(geo, Frame(-52.4, 6.1, 0.0), y=2.12)


def supply_run(ctx, s):
    """The clean supply run on the hall's east wall (the sim's supply footprint, |z| 7.78..14.42): a tall store, a prep counter with a sink,
    wall cabinets and an LED strip under them, bin shelving, a medication cart; the crash cart beside the door."""
    geo = ctx.geo
    h = -math.pi / 2                    # facing west
    zs = lambda a: s * a                # noqa: E731
    ks.cabinet(geo, Frame(X1 - 0.24, zs(8.27), h), w=0.94, h=2.1, d=0.46, kind='doors')
    # the prep counter |z| 8.78..12.28
    a, b = sorted((zs(8.78), zs(12.28)))
    k = W(geo)
    d = 0.6
    xf = X1 - d + 0.02
    k.box(sw(pt.GRAPHITE), xf + 0.06, 0.0, a + 0.02, X1, 0.1, b - 0.02, drop=('down',))
    k.box('SolidSurface', xf, 0.1, a, X1, 0.87, b)
    k.box('SolidSurface', xf - 0.02, 0.87, a - 0.01, X1, 0.9, b + 0.01)
    n = 6
    for i in range(1, n):
        z = a + (b - a) * i / n
        k.box('ShadowGap', xf - 0.001, 0.12, z - 0.002, xf, 0.85, z + 0.002)
    for i in range(n):
        z = a + (b - a) * (i + 0.5) / n
        pt.bar_handle(k.at(xf, 0, z, ry=-math.pi / 2), -0.07, 0.07, 0.79, 0.0)
    # sink and gooseneck at the door end of the counter
    zsink = zs(9.5)
    k.tray(SS, X1 - 0.3, 0.76, zsink, 0.36, 0.42, 0.14, wall=0.01, r=0.03, seg=3)
    k.vcyl(SS, X1 - 0.08, 0.9, zsink, 0.018, 0.2, seg=12)
    k.tube(SS, fillet([(X1 - 0.08, 1.08, zsink), (X1 - 0.08, 1.2, zsink), (X1 - 0.24, 1.2, zsink), (X1 - 0.24, 1.1, zsink)], 0.05), 0.012,
           seg=10)
    k.box('SolidSurface', X1 - 0.012, 0.9, zsink - 0.45, X1, 1.4, zsink + 0.45)
    pt.dispenser(root(geo, Frame(X1, zsink - 0.38, h)), 0, 1.12)
    pt.dispenser(root(geo, Frame(X1, zsink + 0.38, h)), 0, 1.12, body=pt.WHITE, window=pt.PALEBLUE)
    # wall cabinets over the counter, the LED strip under them
    wd = 0.35
    k.box('SolidSurface', X1 - wd, 1.5, a, X1, 2.2, b)
    for i in range(1, 4):
        z = a + (b - a) * i / 4
        k.box('ShadowGap', X1 - wd - 0.001, 1.52, z - 0.002, X1 - wd, 2.18, z + 0.002)
    for i in range(4):
        z = a + (b - a) * (i + 0.5) / 4
        k.box(SS, X1 - wd - 0.02, 1.53, z - 0.004, X1 - wd, 1.68, z + 0.004)
    k.box('LightPanel', X1 - wd + 0.03, 1.495, a + 0.05, X1 - 0.03, 1.5, b - 0.05)
    # bin shelving and the medication cart
    ks.shelving(geo, Frame(X1 - 0.26, zs(12.95), h), w=1.2, h=1.85, d=0.5, shelves=5, bins=True)
    ks.med_cart(geo, Frame(X1 - 0.3, zs(13.98), h), node=None)
    # the crash cart by the door (the sim's cart footprint), drawers to the hall
    ke.crash_cart(geo, Frame(-45.4, zs(7.1), h))
    # a hand-wash station past the run, on the east wall
    kp.handwash(geo, Frame(X1, zs(16.6), h), bins=True)
    ka.crash_rail(geo, False, X1, -1, *sorted((zs(17.4), zs(19.6))))


def triage_desk(ctx):
    """The triage desk by the west glazing (the sim's desk footprint, x -61.83..-61.07, z -14.03..-10.97): a white solid-surface desk with an
    oak top and modesty panel, stands under the procedural screens (they face the patients' chairs), two patient chairs, a vitals station."""
    geo = ctx.geo
    k = W(geo)
    xa, xb, za, zb = -61.86, -61.07, -14.03, -10.97
    k.box('Oak', xa, 0.74, za, xb, 0.775, zb)
    for z in (za, zb - 0.03):
        k.box('SolidSurface', xa + 0.02, 0.0, z, xb - 0.04, 0.74, z + 0.03)
    k.box('SolidSurface', xa + 0.02, 0.18, za + 0.03, xa + 0.05, 0.74, zb - 0.03)
    k.box('Oak', xa + 0.1, 0.36, za + 0.03, xa + 0.13, 0.72, zb - 0.03)
    # stands under the procedural screens (centred x -61.55, y 1.07, z -12.5 -+ 0.765; 0.5 x 0.34, facing east)
    for zc in (-12.5 - 0.765, -12.5 + 0.765):
        k.box(sw(pt.GRAPHITE), -61.72, 0.775, zc - 0.09, -61.56, 0.785, zc + 0.09)
        k.box(sw(pt.GRAPHITE), -61.66, 0.785, zc - 0.025, -61.63, 0.95, zc + 0.025)
        k.box(sw(pt.GRAPHITE), -61.68, 0.93, zc - 0.07, -61.6, 1.0, zc + 0.07)
    k.box(sw(pt.LGREY), -61.5, 0.775, -12.62, -61.36, 0.8, -12.38)
    for zc in (-13.25, -11.75):
        kp.visitor_chair(geo, Frame(-60.55, zc, -math.pi / 2), vinyl='VinylTeal', seat_h=0.47)
    ke.vitals_stand(geo, k, -61.35, -14.55)


def outside(ctx):
    """The ambulance entrance outside the ER's west doors: a white canopy on two columns with downlights, the bay's hatched markings on the
    forecourt, bollards."""
    geo = ctx.geo
    k = W(geo)
    d = ctx.pl.door('ambulance')
    zc = d['z']
    x0, x1, z0, z1 = -68.6, -62.1, zc - 3.6, zc + 3.6
    k.box('PowderWhite', x0, 3.25, z0, x1, 3.5, z1)
    k.box('PowderWhite', x0 - 0.02, 3.2, z0 - 0.02, x0 + 0.06, 3.52, z1 + 0.02)
    for z in (z0 + 0.35, z1 - 0.35):
        k.vcyl('Steel', x0 + 0.35, 0.0, z, 0.08, 3.25, seg=20)
    for x in (-66.6, -64.2):
        for z in (zc - 1.6, zc + 1.6):
            k.disc('LightPanel', x, 3.248, z, 0.06, seg=16, up=False)
            ctx.downlight(x, z, 3.24, 8.0)
    # hatched yellow ambulance bay on the forecourt (paving top -0.01), and the red "keep clear" line at the doors
    hx0, hx1, hz0, hz1 = -71.5, -63.0, zc - 2.0, zc + 2.0
    y = -0.0098
    t = 0.1
    for (a0, b0, a1, b1) in ((hx0, hz0, hx1, hz0 + t), (hx0, hz1 - t, hx1, hz1), (hx0, hz0, hx0 + t, hz1), (hx1 - t, hz0, hx1, hz1)):
        k.box(sw(pt.YELLOW), a0, y, b0, a1, y + 0.002, b1)
    for i in range(1, 9):
        x = hx0 + (hx1 - hx0) * i / 9
        k.box(sw(pt.YELLOW), x - 0.05, y, hz0 + t, x + 0.05, y + 0.002, hz1 - t)
    for z in (zc - 2.6, zc + 2.6):
        k.vcyl(SS, -62.7, 0.0, z, 0.06, 0.9, seg=16)
        k.vcyl(sw(pt.GRAPHITE), -62.7, 0.75, z, 0.062, 0.04, seg=16)


def ambulance_side(ctx):
    """Inside the ambulance doors: the parked transfer trolley (the sim's handover footprint), a clock and an IV pole."""
    geo = ctx.geo
    ke.stretcher(geo, Frame(-60.8, 15.0, math.pi), node=None, backrest=15, rails='down')
    kp.wall_clock(geo, Frame(X0, 13.2, math.pi / 2), y=2.25)


def wheelchairs(ctx):
    for (x, a) in ((-60.95, 0.08), (-60.15, -0.05)):
        ks.wheelchair(ctx.geo, Frame(x, -6.85, math.pi + a), node=None)
    kp.wall_clock(ctx.geo, Frame(-56.0, -6.1, math.pi), y=2.12)


def build(ctx):
    if ka is None:
        return
    geo, pl = ctx.geo, ctx.pl
    clerestory(geo, pl)
    for area, (s, n) in HALLS.items():
        skirting(geo, s)
        bay_floor(geo, s)
        red_band(geo, s)
        hung_sign(geo, -50.0, zv(s, 11.2))
        ceiling(ctx, s)
        for k, (x0, x1) in enumerate(bays(n)):
            bay(ctx, s, k, x0, x1, n)
        supply_run(ctx, s)
    nurse_station(ctx)
    kp.handwash(geo, Frame(-60.6, 6.1, 0.0), bins=True)
    triage_desk(ctx)
    ambulance_side(ctx)
    wheelchairs(ctx)
    if not ctx.context:
        outside(ctx)
