"""
Zone 'wardA' (Ward A and corridor A), designed "clean clinical modern" like the approved lobby. Ward B (zones/wardB.py) is the same design
mirrored in z: everything here is written once in ward coordinates and placed through the ward's sign, so wardB.py only sets its settings and
calls build_ward(ctx, 'B').

Ward coordinates (as src/scene/rooms/patientRoom.ts): u = metres east of an area's west wall line, v = metres from the corridor wall line
(|z| = 16) toward the outer wall (|z| = 22). World: x = x0 + u, z = s * (16 + v), s = -1 for ward A (north), +1 for ward B (south).

  Patient rooms (8 per ward, 5 x 6 m)  a real single room: the kit ward bed EXACTLY on the sim's bed (the low position: mattress top 0.49 m,
        the head section and pillow are the runtime's live backrest, so the bed is built without them), a bed-head services unit (gases,
        nurse call, reading and up-lights) on a bed-head protection board, a patient monitor on a wall arm, bedside locker, over-bed table
        (its top at the live meal tray's height), cubicle curtain track and curtain, visitor chair on the sim's seat, a patient recliner, a
        family day-bed under a punched window with a roller blind, side table and plant, a built-in wardrobe, the clinical hand-wash station
        by the door, sharps / gloves by the MedDrawer, a wall clock the patient sees, a tegular ceiling with LED panels and a flush vitals
        sensor, coved sheet-vinyl skirting, and the bed-head wall in the ward's tint (A blue, B sage: the ward's wayfinding colour).
  Corridor  plaster ceiling with one recessed LED line and a downlight over every door, combined handrail / crash rail in warm grey,
        corner guards at the jambs, a hand-rub station beside every room door, door linings in the ward's wayfinding colour, coved skirting.
  Nurse hub  a curved white solid-surface back counter with an oak top and LED lip, two workstation desks under the live screens, a tall
        glazed cabinet, an open chart rack, a plaster ceiling with LED lines, an oak slat feature wall and clock on the tinted back wall.
  Staff room / family lounge (A), clean supply / quiet room (B)  furnished on their footprints. The lab stays procedural (its robots).

Kept procedural (the runtime draws them, the model leaves their space free): people, the live backrest + pillow of every bed, the bedside
screen and its arm, the meal trays, MedDrawer cabinets in the chutes (the model fills the wall above them), door leaves, room / name plates,
hanging signs, floor lines, the hub's live screens, the lab and its robots, MealBots and their lanes (nothing stands > 0.2 m off a corridor
wall's centre line).
"""
import math

import furniture as fu
from common import Frame
from shell import line_box

try:
    from kit import arch as karch
    from kit import cafe as kcafe
    from kit import parts as kpt
    from kit import patient as kpat
    from kit import support as ksup
    from kit.base import anchor as kanchor  # noqa: F401
    from kit.base import root as kroot
    from kit.parts import sw
    from kit.patient import _rail
except Exception:      # noqa: BLE001  (no kit: the zone builds as shell only)
    karch = None

CH = 3.0            # ceiling height of every ward area (plan.json)
T = 0.2             # wall thickness
FACE = T / 2
H_WALL = 3.0
DOOR_H = 2.3
ROOM_X0 = (-25.0, -20.0, -15.0, -10.0, 5.0, 10.0, 15.0, 20.0)

TINT = {'A': 'WallTintBlue', 'B': 'WallTintSage'}          # ward A blue, ward B sage: the floor lines' colours (Accent 0 / 1)
ACCENT = {'A': 'Accent:0', 'B': 'Accent:1'}
VINYL = {'A': 'VinylTeal', 'B': 'VinylSage'}
PW = 'PowderWhite'
SS = 'Stainless'
GRAPHITE = 'KitPlastic:3'

# the room's punched window (u along the window wall), its sill and head
WIN = (0.45, 3.7, 0.72, 2.55)
# rooms that get an IV stand (not every bed has a drip)
IV_ROOMS = ('3',)


# ===================================================================================================================================================
# shell settings (wardB.py sets its own)
# ===================================================================================================================================================
def own_ceilings(w):
    return (f'corridor{w}', f'hub{w}') + tuple(f'room:{w}{i}' for i in range(1, 9))


OWN_CEILINGS = own_ceilings('A')
REPLACES = ['footprint:A*', 'footprint:hubA:*', 'footprint:staff:*', 'footprint:lounge:*']
VISIBLE_FROM = ['lobby', 'imaging', 'core', 'atrium']
PROBE = (0.0, 1.6, -14.0)
# review stills: room A3 from just inside its door, room A3 from the visitor corner back to the bed head, the corridor, the nurse hub
POSES = [((-13.9, -16.4), (-12.0, -21.5)), ((-13.7, -20.6), (-11.2, -16.6)), ((-37.5, -14.35), (36.0, -14.0)),
         ((-0.6, -13.3), (1.2, -21.6))]


def is_room_window(w, a, b):
    """A glazing span of a patient room's outer wall (the design draws a punched window there)."""
    if not w['alongX'] or abs(abs(w['c']) - 22.0) > 1e-6:
        return False
    return any(abs(a - (x0 + 0.1)) < 0.02 and abs(b - (x0 + 4.9)) < 0.02 for x0 in ROOM_X0)


def skip_glazing(w, a, b):
    return is_room_window(w, a, b)


def accent_of(ward):
    def door_accent(d):
        return ACCENT[ward] if d['id'].startswith(f'room:{ward}') else None
    return door_accent


door_accent = accent_of('A')


# ===================================================================================================================================================
# frames
# ===================================================================================================================================================
class WF:
    """A ward frame: origin x0 on the corridor wall line of ward `w`. u east, v toward the outer wall, y up."""

    def __init__(self, geo, ward, x0):
        self.geo = geo
        self.ward = ward
        self.s = -1 if ward == 'A' else 1
        self.x0 = x0
        k = kroot(geo, Frame(x0, self.s * 16.0, 0.0 if self.s > 0 else math.pi))
        self.k = k.mirror_x() if self.s < 0 else k     # local (u, y, v)

    def w(self, u, v):
        return (self.x0 + u, self.s * (16.0 + v))

    def hd(self, du, dv):
        """The plan heading of a direction (du, dv)."""
        return math.atan2(du, self.s * dv)

    def F(self, u, v, du=0.0, dv=1.0):
        x, z = self.w(u, v)
        return Frame(x, z, self.hd(du, dv))

    def at(self, u, v, toward):
        """A Frame at (u, v) whose +z looks at the ward point `toward`."""
        return self.F(u, v, toward[0] - u, toward[1] - v)

    def zr(self, v):
        """The plan z of ward v."""
        return self.s * (16.0 + v)


def wall_face_quad(geo, mat, along_x, face, into, a, b, y0, y1, gap=0.002):
    """A single quad of paint `gap` off a wall face, facing into the room (a tinted wall over the white plaster without touching the wall's
    material, which is shared by both faces)."""
    f = face + into * gap
    if along_x:
        drop = ('x0', 'x1', 'down', 'up', 'z0') if into > 0 else ('x0', 'x1', 'down', 'up', 'z1')
        geo.box(mat, a, y0, f - 0.001, b, y1, f + 0.001, drop=drop)
    else:
        drop = ('z0', 'z1', 'down', 'up', 'x0') if into > 0 else ('z0', 'z1', 'down', 'up', 'x1')
        geo.box(mat, f - 0.001, y0, a, f + 0.001, y1, b, drop=drop)


def light_castor(k, x, z, r=0.05, w=0.035, top=0.13):
    """A lighter castor than the kit's (the bed has four in every room): tyre, a graphite fork and stem."""
    k.cyl('Rubber', (x - w / 2, r, z), (x + w / 2, r, z), r, seg=10)
    k.box(GRAPHITE, x - w / 2 - 0.006, r * 1.2, z - r * 0.55, x + w / 2 + 0.006, r * 2.0, z + r * 0.55)
    k.vcyl(GRAPHITE, x, r * 2.0, z, 0.012, top - r * 2.0, seg=6)


def lay_in_ceiling(geo, rect, y, module=0.6, panels=()):
    """kit.arch.tegular_ceiling, lighter: each tile one stepped box (its face and edges, no back or rebate), the T-bars, LED panels at
    `panels` (i, j, wi, wj) grid cells."""
    x0, x1, z0, z1 = rect
    nx, nz = max(1, int(round((x1 - x0) / module))), max(1, int(round((z1 - z0) / module)))
    mx, mz = (x1 - x0) / nx, (z1 - z0) / nz
    taken = set()
    for (i, j, wi, wj) in panels:
        for a in range(wi):
            for b in range(wj):
                taken.add((i + a, j + b))
        geo.box('LightPanel', x0 + i * mx + 0.012, y - 0.004, z0 + j * mz + 0.012, x0 + (i + wi) * mx - 0.012, y, z0 + (j + wj) * mz - 0.012, drop=('up',))
    for i in range(nx):
        for j in range(nz):
            if (i, j) not in taken:
                ax, az = x0 + i * mx, z0 + j * mz
                geo.box('AcousticTile', ax + 0.014, y - 0.008, az + 0.014, ax + mx - 0.014, y + 0.004, az + mz - 0.014, drop=('up',))
    for i in range(nx + 1):
        x = x0 + i * mx
        geo.box('CeilingGrid', x - 0.012, y - 0.002, z0, x + 0.012, y + 0.006, z1, drop=('up',))
    for j in range(nz + 1):
        z = z0 + j * mz
        geo.box('CeilingGrid', x0, y - 0.0025, z - 0.012, x1, y + 0.0055, z + 0.012, drop=('up',))
    geo.box('CeilingGrid', x0, y + 0.004, z0, x1, y + 0.006, z1, drop=('up', 'x0', 'x1', 'z0', 'z1'))


def floor_lamp(k, u, v, h=1.45):
    """A slim floor lamp (room K): graphite disc base and stem, a white drum shade glowing softly."""
    k.vcyl(GRAPHITE, u, 0.0, v, 0.14, 0.015, seg=16)
    k.vcyl(GRAPHITE, u, 0.015, v, 0.011, h - 0.2, seg=6)
    k.vcyl(sw(kpt.WARMWHITE), u, h - 0.25, v, 0.17, 0.25, seg=20, caps=(False, False))
    k.disc('LEDLine', u, h - 0.24, v, 0.15, seg=16, up=False)


def side_table(k, u, v, r=0.22, h=0.5):
    """A round oak side table on a graphite pedestal (room K; lighter than furniture.side_table)."""
    k.vcyl(GRAPHITE, u, 0.0, v, r * 0.65, 0.012, seg=16)
    k.vcyl(GRAPHITE, u, 0.012, v, 0.02, h - 0.04, seg=8)
    k.vcyl('Oak', u, h - 0.025, v, r, 0.025, seg=24)


# ===================================================================================================================================================
# the ward bed (the kit bed at the sim's low position, without its head section: that is the runtime's live backrest)
# ===================================================================================================================================================
def ward_bed(geo, f, linen=True, blanket='Curtain', board='Oak'):
    """The kit's electric ward bed (kit/patient.bed) at the sim's numbers (src/scene/rooms/bedParts.ts): mattress underside 0.32 m, top 0.49 m,
    0.88 m wide; the static mattress is the foot section only (bed-local dv -0.1 .. 0.96, the hinge 0.1 m toward the head from the bed
    centre); the head section with the pillow is the runtime's instanced backrest (it tilts with the sim's recline), so the deck under it
    stays flat here. Head at local -z (toward the corridor wall), foot at +z. Rails: head pair up, foot pair down (patients get in)."""
    k = kroot(geo, f)
    deck, mt = 0.32, 0.17
    top = deck + mt
    hw = 0.5
    for x in (-0.33, 0.33):
        for z in (-0.8, 0.8):
            light_castor(k, x, z, r=0.05, top=0.13)
    k.rbox(PW, 0, 0.13, 0, 0.74, 0.06, 1.8, 0.1, axis='y', seg=4)                               # base cover
    k.rbox(GRAPHITE, 0, 0.122, 0, 0.7, 0.01, 1.74, 0.09, axis='y', seg=3)
    for z in (-0.55, 0.55):                                                                        # the lift columns, fully lowered
        k.rbox(sw(kpt.LGREY), 0, 0.19, z, 0.19, 0.05, 0.115, 0.03, axis='y', seg=3)
    fy = deck - 0.08
    for s in (-1, 1):
        k.rbox(PW, s * 0.44, fy, 0.0, 0.05, 0.06, 2.0, 0.018, axis='z', seg=3)
    for z in (-0.975, 0.975):
        k.rbox(PW, 0, fy, z, 0.84, 0.06, 0.05, 0.018, axis='x', seg=3)
    k.box(sw(kpt.LGREY), -0.42, deck - 0.03, -0.9, 0.42, deck - 0.004, 0.98, drop=('down',))       # deck panels (flat)
    for x in (-0.47, 0.47):
        for z in (-0.99, 0.99):
            k.vcyl('Rubber', x, fy - 0.01, z, 0.035, 0.08, seg=12)
    cover = 'Linen' if linen else 'VinylTeal'
    k.rbox(cover, 0, deck, 0.43, 0.88, mt, 1.06, 0.05, axis='z', seg=3)                           # mattress foot section
    if linen:
        kpt.drape(k, blanket, 0.89, 0.98, top + 0.004, 0.12, thick=0.012, cz=0.47, r=0.045)
        kpt.drape(k, 'Linen', 0.914, 0.2, top + 0.017, 0.07, thick=0.006, cz=0.07, r=0.055)
    # head board on two posts, a grip slot along its top; foot board with an oak panel and the staff panel
    k.rbox(PW, 0, deck - 0.1, -1.04, 0.96, 0.56, 0.04, 0.07, axis='z', seg=4)
    k.box(GRAPHITE, -0.28, deck + 0.4, -1.062, 0.28, deck + 0.425, -1.018)
    k.rbox(PW, 0, deck - 0.06, 1.04, 0.96, 0.42, 0.04, 0.06, axis='z', seg=4)
    k.rbox(board, 0, deck + 0.0, 1.06, 0.8, 0.29, 0.008, 0.035, axis='z', seg=3)
    st = k.at(0, deck + 0.36, 1.04, rx=math.radians(-25))
    st.rbox(GRAPHITE, 0, -0.02, 0.0, 0.34, 0.05, 0.06, 0.012, axis='x', seg=2)
    st.box('Screen', -0.07, 0.03, -0.012, 0.07, 0.032, 0.02)
    for i, c in enumerate((kpt.GREEN, kpt.LGREY, kpt.LGREY, kpt.ORANGE)):
        st.box(sw(c), -0.15 + i * 0.022, 0.03, -0.022, -0.137 + i * 0.022, 0.033, -0.01)
    for s, _nm in ((-1, 'l'), (1, 'r')):
        _rail(k.at(s * (hw - 0.025), deck, -0.55), s, 0.66, 0.0, mt, head=False)
        _rail(k.at(s * (hw - 0.025), deck, 0.5), s, 0.66, -0.27, mt, head=False)
    return k


def clock(geo, f, y=2.0, r=0.15, hour=10, minute=9):
    """A lighter wall clock than the kit's (24 segments, front faces only): graphite rim, white face, marks, hands."""
    k = kroot(geo, f)
    c = k.at(0, y, 0, rx=math.pi / 2)              # local +y points out of the wall, local -z up the wall
    c.lathe(GRAPHITE, [(0.0, 0.0), (r + 0.006, 0.0), (r + 0.006, 0.035), (r - 0.004, 0.042), (r - 0.012, 0.038)], seg=24)
    c.disc(sw(kpt.WHITE), 0, 0.03, 0, r - 0.01, seg=24)
    for i in range(12):
        a = 2 * math.pi * i / 12
        ux, uz = math.sin(a), -math.cos(a)
        L = 0.025 if i % 3 == 0 else 0.012
        rr = r - 0.03
        c.box(sw(kpt.BLACK), ux * (rr - L / 2) - 0.003, 0.03, uz * (rr - L / 2) - 0.003, ux * (rr - L / 2) + 0.003, 0.032, uz * (rr - L / 2) + 0.003,
              drop=('down',))
    for (ang, L, wd, col, yy) in ((2 * math.pi * ((hour % 12) + minute / 60) / 12, r * 0.5, 0.008, kpt.BLACK, 0.033),
                                  (2 * math.pi * minute / 60, r * 0.78, 0.006, kpt.BLACK, 0.035), (2 * math.pi * 0.62, r * 0.85, 0.002, kpt.RED, 0.037)):
        h = c.at(0, yy, 0, ry=-ang)
        h.box(sw(col), -wd / 2, 0, -L, wd / 2, 0.002, 0.02, drop=('down',))


# ===================================================================================================================================================
# a patient room
# ===================================================================================================================================================
def pedal_bin(k, u, v, lid, along_v=True):
    """A clinical / domestic pedal bin standing against a wall (room K, local u, y, v)."""
    k.rbox(sw(kpt.WHITE), u, 0.0, v, 0.32, 0.5, 0.3, 0.05, axis='y', seg=3)
    k.rbox(sw(lid), u, 0.5, v, 0.33, 0.03, 0.31, 0.055, axis='y', seg=3)
    k.rbox(GRAPHITE, u + 0.17, 0.0, v, 0.06, 0.03, 0.14, 0.01, axis='y', seg=2)


def day_bed(k, cu, cv, w, d, vinyl, back=+1):
    """A family day-bed / sofa (room K): oak frame and arms on a recessed plinth, a wipe-clean seat and two back cushions, its back toward
    `back` (+1: +v)."""
    b = back
    v0, v1 = cv - d / 2, cv + d / 2
    k.box(GRAPHITE, cu - w / 2 + 0.06, 0.0, v0 + 0.06, cu + w / 2 - 0.06, 0.06, v1 - 0.06, drop=('down',))
    k.box('Oak', cu - w / 2, 0.06, v0, cu + w / 2, 0.3, v1)
    for s in (-1, 1):                                                       # arms
        x0 = cu + s * (w / 2) - (0.08 if s > 0 else 0.0)
        k.box('Oak', x0, 0.3, v0 + 0.02, x0 + 0.08, 0.58, v1 - 0.02)
    k.rbox(vinyl, cu, 0.3, cv - b * 0.07, w - 0.17, 0.14, d - 0.2, 0.05, axis='x', seg=3)      # seat
    for s in (-1, 1):
        bk = k.at(cu + s * (w - 0.17) / 4, 0.42, cv + b * (d / 2 - 0.13), rx=math.radians(12) * b)
        bk.rbox(vinyl, 0, 0, 0, (w - 0.17) / 2 - 0.02, 0.4, 0.14, 0.05, axis='z', seg=3)
    k.box('Oak', cu - w / 2, 0.3, (v1 - 0.06) if b > 0 else v0, cu + w / 2, 0.42, (v1) if b > 0 else v0 + 0.06)


def room_window(wf, geo, w):
    """The room's punched window in the outer wall (the shell leaves this span to the design): white wall below the sill and above the head,
    piers, a slim graphite frame with two mullions, glass, a solid-surface internal sill, a roller-blind cassette with the blind a little
    down."""
    x0 = wf.x0
    s = wf.s
    a, b = x0 + 0.1, x0 + 4.9
    wa, wb, sill, head = x0 + WIN[0], x0 + WIN[1], WIN[2], WIN[3]
    rin = -s                                    # from the window line into the room, in z
    line_box(geo, 'WallClinical', w, a, b, 0.02, sill, T)
    line_box(geo, 'ShadowGap', w, a, b, 0.0, 0.02, T - 0.024, drop=('up', 'down'))
    line_box(geo, 'WallClinical', w, a, wa, sill, H_WALL + 0.06, T)
    line_box(geo, 'WallClinical', w, wb, b, sill, H_WALL + 0.06, T)
    line_box(geo, 'WallClinical', w, wa, wb, head, H_WALL + 0.06, T)
    fr = 0.09                                   # frame depth across the wall, centred 30 mm outward of the wall's centre line
    off = -rin * 0.03
    line_box(geo, 'Mullion', w, wa, wb, sill, sill + 0.06, fr, offset=off)
    line_box(geo, 'Mullion', w, wa, wb, head - 0.06, head, fr, offset=off)
    for e0, e1 in ((wa, wa + 0.06), (wb - 0.06, wb)):
        line_box(geo, 'Mullion', w, e0, e1, sill, head, fr, offset=off)
    n = 3
    for i in range(1, n):
        t = wa + (wb - wa) * i / n
        line_box(geo, 'Mullion', w, t - 0.025, t + 0.025, sill + 0.06, head - 0.06, fr * 0.8, offset=off)
    line_box(geo, 'Glass', w, wa + 0.06, wb - 0.06, sill + 0.06, head - 0.06, 0.012, offset=off)
    # internal sill: solid surface from the frame to 40 mm proud of the wall face
    c = w['c']
    z0, z1 = sorted((c + rin * 0.012, c + rin * (FACE + 0.04)))
    geo.box('SolidSurface', wa - 0.03, sill - 0.025, z0, wb + 0.03, sill, z1)
    # roller blind: a white cassette in the head of the reveal, the blind drawn down 0.3 m
    z0, z1 = sorted((c + rin * 0.03, c + rin * 0.095))
    geo.box('KitPlastic:0', wa + 0.01, head - 0.085, z0, wb - 0.01, head, z1)
    z0, z1 = sorted((c + rin * 0.06, c + rin * 0.064))
    geo.box('Curtain', wa + 0.03, head - 0.38, z0, wb - 0.03, head - 0.085, z1)
    z0, z1 = sorted((c + rin * 0.052, c + rin * 0.072))
    geo.box(GRAPHITE, wa + 0.03, head - 0.4, z0, wb - 0.03, head - 0.38, z1)


def room(ctx, ward, x0, rid):
    """One patient room. rid: 'A3'."""
    geo = ctx.geo
    wf = WF(geo, ward, x0)
    k = wf.k
    s = wf.s
    fp = ctx.fur['footprints']
    seats = {e['id']: e for e in ctx.fur['seats']}
    bed = fp[f'{rid}:bed']
    bu, bv = bed['x'] - x0, abs(bed['z']) - 16.0          # 3.2, 1.35
    tint = TINT[ward]
    vinyl = VINYL[ward]

    # --- ceiling: tegular tiles (8 x 10 modules), three LED panels, the vitals sensor flush over the bed, the curtain track ---------------------
    xa, xb = x0 + 0.1, x0 + 4.9
    za, zb = sorted((wf.zr(0.1), wf.zr(5.9)))
    nz = 10

    def jrow(j, wj=1):                         # a row counted from the corridor wall, as a world row index
        return j if s > 0 else nz - j - wj
    panels = [(4, jrow(3), 2, 1), (1, jrow(1), 2, 1), (2, jrow(7), 2, 1)]
    lay_in_ceiling(geo, (xa, xb, za, zb), CH, panels=panels)
    su_, sv_ = 3.4, 0.1 + 2.5 * 0.58           # the flush contactless vitals sensor: the tile over the patient's chest
    k.vcyl(PW, su_, CH - 0.022, sv_, 0.12, 0.014, seg=24)
    k.vcyl('Screen', su_, CH - 0.026, sv_, 0.055, 0.004, seg=20)
    k.vcyl('LEDLine', su_, CH - 0.024, sv_, 0.09, 0.002, seg=24)
    # a reading downlight over the day-bed
    dl = (2.8, 0.1 + 8.5 * 0.58)
    k.vcyl('SolidSurface', dl[0], CH - 0.012, dl[1], 0.06, 0.004, seg=20)
    k.vcyl('LEDLine', dl[0], CH - 0.014, dl[1], 0.045, 0.002, seg=20)
    ctx.downlight(*wf.w(*dl), CH, 9.0)

    # --- walls: tinted bed-head wall, coved skirting, the wall over the MedDrawer ------------------------------------------------------------
    door = ctx.pl.door(f'room:{rid}')
    d0, d1 = door['x'] - x0 - door['width'] / 2, door['x'] - x0 + door['width'] / 2      # 0.4, 1.8
    ch = next(c for c in ctx.plan['drawerChutes'] if c['room'] == rid)
    c0, c1 = ch['x'] - x0 - ch['width'] / 2, ch['x'] - x0 + ch['width'] / 2              # 3.9, 4.7
    fz = wf.zr(0.1)                                     # the corridor wall's room face (plan z)
    into = s                                            # into the room from that face, in z
    for (a, b, y0, y1) in ((0.1, d0 - 0.036, 0.1, CH), (d1 + 0.036, c0, 0.1, CH), (c1, 4.9, 0.1, CH), (d0 - 0.036, d1 + 0.036, DOOR_H + 0.036, CH),
                           (c0, c1, 1.3, CH)):
        wall_face_quad(geo, tint, True, fz, into, x0 + a, x0 + b, y0, y1)
    line_box(geo, 'WallClinical', {'alongX': True, 'c': ch['z']}, ch['x'] - ch['width'] / 2, ch['x'] + ch['width'] / 2, 1.3, H_WALL + 0.06, T)
    for (a, b) in ((0.1, d0 - 0.075), (d1 + 0.075, c0), (c1, 4.9)):
        karch.coved_skirting(geo, True, fz, into, x0 + a, x0 + b)
    karch.coved_skirting(geo, True, wf.zr(5.9), -into, x0 + 0.1, x0 + 4.9)
    za0, za1 = sorted((wf.zr(0.1), wf.zr(5.9)))
    karch.coved_skirting(geo, False, x0 + 0.1, +1, za0, za1)
    karch.coved_skirting(geo, False, x0 + 4.9, -1, za0, za1)

    # --- the bed space ----------------------------------------------------------------------------------------------------------------------
    ward_bed(geo, Frame(bed['x'], bed['z'], bed['rotationY']))
    hwc = 2.92                                           # bed-head unit centre (u): between the door's architrave and the MedDrawer
    kpat.headwall(geo, wf.F(hwc, 0.1), width=1.7, panel=None)
    # the bed-head protection board (it also hides the procedural headwall's bits, which stay drawn at runtime)
    k.box('CrashRail', hwc - 0.95, 0.3, 0.1, hwc + 0.95, 1.26, 0.165, bev=0.006)
    kpat.monitor_arm(geo, wf.F(3.8, 0.1), swing1=0.0, swing2=0.0, tilt=-12.0, y=2.05, l1=0.26, l2=0.22)
    kpat.locker(geo, wf.F(2.42, 0.43, 1.0, 0.0))
    # over-bed table: its column hard against the bed on the window side (bed-local du 0.54), its top at the live tray's height (0.995 m)
    kpat.overbed_table(geo, Frame(bed['x'] + 0.15, bed['z'] + s * 0.35, 0.0), h=0.996)
    if rid[1:] in IV_ROOMS:
        kpat.iv_pole(geo, wf.F(2.45, 1.02), bags=1, pump=True)
    # cubicle curtain round the bed, parked at the bed's east foot corner (clear of the door, the MedDrawer and the views in)
    path_len = 2 * (1.55 + 1.25 - 0.12) + 2.4
    corner = 2.68 / path_len if s < 0 else (2.68 + 2.4) / path_len
    kpat.cubicle_curtains(geo, Frame(bed['x'], bed['z'], bed['rotationY']), w=2.4, head_z=-(bv - 0.1), foot_z=1.55, ceiling=CH, drawn=0.19,
                          start=max(0.0, corner - 0.1))

    # --- by the door: the clinical hand-wash station and its bins (west wall), sharps / gloves by the MedDrawer (east wall) ---------------------
    kpat.handwash(geo, wf.F(0.1, 1.17, 1.0, 0.0), bins=False)
    pedal_bin(k, 0.27, 0.36, kpt.ORANGE)
    pedal_bin(k, 0.27, 0.7, kpt.GRAPHITE)
    kpat.sharps_and_gloves(geo, wf.F(4.9, 1.05, -1.0, 0.0), y=1.25)

    # --- the window side: day-bed, side table, plant, recliner, wardrobe, clock ---------------------------------------------------------------
    room_window(wf, geo, {'alongX': True, 'c': s * 22.0})
    sofa = fp[f'{rid}:sofa']
    day_bed(k, sofa['x'] - x0, abs(sofa['z']) - 16.0, sofa['w'], sofa['d'], vinyl, back=+1)
    t = fp[f'{rid}:table']
    side_table(k, t['x'] - x0, abs(t['z']) - 16.0, r=t['w'] / 2 - 0.01, h=0.5)
    p = fp[f'{rid}:plant']                                # the window corner: a floor lamp (no plants in patient rooms: infection control)
    floor_lamp(k, p['x'] - x0, abs(p['z']) - 16.0)
    bath = fp[f'{rid}:bath']                              # the window corner the procedural wet pod stands in: the patient recliner here
    ru, rv = bath['x'] - x0 - 0.05, abs(bath['z']) - 16.0 - 0.1
    kpat.recliner(geo, wf.at(ru, rv, (2.6, 2.7)), vinyl=vinyl)
    sb = fp[f'{rid}:sideboard']                          # the west wall: a built-in wardrobe, three oak doors
    kpat.wardrobe(geo, wf.F(0.1 + 0.25, abs(sb['z']) - 16.0, 1.0, 0.0), w=1.5, h=2.25, d=0.5, doors=3)
    clock(geo, wf.F(4.3, 5.9, 0.0, -1.0), y=2.0)

    # --- the visitor chair on the sim's seat (its hip point 0.04 m in front of the frame) --------------------------------------------------
    st = seats[f'visitor:{rid}']
    h = st['heading']
    kpat.visitor_chair(geo, Frame(st['x'] - math.sin(h) * 0.04, st['z'] - math.cos(h) * 0.04, h), vinyl=vinyl, seat_h=st['height'])


# ===================================================================================================================================================
# the corridor
# ===================================================================================================================================================
def corridor(ctx, ward):
    geo, pl = ctx.geo, ctx.pl
    s = -1 if ward == 'A' else 1
    zl = s * 16.0                    # the room wall line
    zf = s * 15.9                    # its corridor face
    into = -s                        # from that face into the corridor
    zi = s * 12.0
    # ceiling: smooth plaster with one recessed LED line down the middle, a 20 mm shadow gap along the room wall and the end wall
    G = 0.02
    xa, xb = -40.1, 40.0 - FACE - G
    zg0, zg1 = sorted((zf, zf + into * G))
    geo.box('ShadowGap', xa, CH + 0.03, zg0, xb + G, CH + 0.05, zg1, drop=('up',))
    geo.box('ShadowGap', xb, CH + 0.03, min(zf, zi), xb + G, CH + 0.05, max(zf, zi), drop=('up',))
    zc = s * 14.0
    hw = 0.025
    lx0, lx1 = -39.2, 39.2
    zs0, zs1 = sorted((zf + into * G, zi))
    geo.box('CeilingPlaster', xa, CH, zs0, xb, CH + 0.05, zc - hw, drop=('up',))
    geo.box('CeilingPlaster', xa, CH, zc + hw, xb, CH + 0.05, zs1, drop=('up',))
    geo.box('CeilingPlaster', xa, CH, zc - hw, lx0, CH + 0.05, zc + hw, drop=('up',))
    geo.box('CeilingPlaster', lx1, CH, zc - hw, xb, CH + 0.05, zc + hw, drop=('up',))
    geo.box('LEDLine', lx0, CH + 0.02, zc - hw, lx1, CH + 0.025, zc + hw, drop=('up',))
    # a bulkhead over the wide opening into the atrium
    for d in pl.doors():
        if d['kind'] == 'opening' and abs(abs(d['z']) - 12.0) < 1e-6:
            z0, z1 = sorted((zi, zi + into * -0.12))
            geo.box('CeilingPlaster', d['x'] - d['width'] / 2, CH - 0.25, z0, d['x'] + d['width'] / 2, CH, z1)
    # the room wall: rails, guards, skirting on every solid piece of its corridor face; downlights over the doors; hand-rub stations
    doors_on = [d for d in pl.doors() if d['wallAxis'] == 'x' and abs(d['z'] - zl) < 1e-6]
    edges = {}
    for d in doors_on:
        if d['kind'] == 'counter':
            continue
        leaf = d['kind'] in ('swing', 'auto')
        for e, side in ((d['x'] - d['width'] / 2, -1), (d['x'] + d['width'] / 2, +1)):
            edges[round(e, 3)] = (side, leaf)
    for w in pl.walls():
        if not (w['alongX'] and abs(w['c'] - zl) < 1e-6 and w['cls'] == 'solid'):
            continue
        a, b = w['a'], w['b']
        ra = a + (0.12 if w['cutA'] else 0.13)
        rb = b - (0.12 if w['cutB'] else 0.13)
        if rb - ra >= 0.3:
            karch.crash_rail(geo, True, zf, into, ra, rb, y=0.84, h=0.15, depth=0.105)
        sa = a + (0.075 if round(a, 3) in edges and edges[round(a, 3)][1] else 0.0)
        sb_ = b - (0.075 if round(b, 3) in edges and edges[round(b, 3)][1] else 0.0)
        if not w['cutA']:
            sa = a - 0.1 if a < -39.9 else a
        if sb_ - sa > 0.05:
            karch.coved_skirting(geo, True, zf, into, sa, sb_)
        for e in (a, b):
            if round(e, 3) not in edges:
                continue
            side, leaf = edges[round(e, 3)]
            g0, g1 = (e + side * 0.03, e + side * 0.10) if leaf else (e + side * -0.005, e + side * 0.065)
            g0, g1 = sorted((g0, g1))
            z0, z1 = sorted((zf, zf + into * 0.04))
            geo.box('CrashRail', g0, 0.04, z0, g1, 1.26, z1)
    # the end wall (x = 40): rail and skirting along its corridor face
    pz0, pz1 = sorted((zl, zi))
    karch.crash_rail(geo, False, 39.9, -1, pz0 + 0.13, pz1 - 0.13, y=0.84, h=0.15, depth=0.105)
    zz0, zz1 = sorted((zf, zi))
    karch.coved_skirting(geo, False, 39.9, -1, zz0, zz1)
    # the end wall in the ward's tint, the ward's colour as a band at the rail
    wall_face_quad(geo, TINT[ward], False, 39.9, -1, zz0, zz1, 0.1, CH)
    # the imaging suite's wall opposite the west rooms (x -40..-22): the ward's tint, rail and skirting on its corridor face
    zo = s * 12.1
    wall_face_quad(geo, TINT[ward], True, zo, s, -39.9, -22.1, 0.1, CH)
    karch.crash_rail(geo, True, zo, s, -40.0 + 0.13, -22.0 - 0.13, y=0.84, h=0.15, depth=0.105)
    karch.coved_skirting(geo, True, zo, s, -40.1, -22.1)
    # downlights over the doors of the room wall, and hand-rub stations at the patient rooms
    for d in doors_on:
        x = d['x']
        z = s * 15.25
        geo.ring(Frame(0, 0), 'SolidSurface', x, CH - 0.002, z, 0.045, 0.06, seg=24)
        geo.disc(Frame(0, 0), 'LEDLine', x, CH - 0.001, z, 0.045, seg=24)
        ctx.downlight(x, z, CH, 8.0)
        if d['id'].startswith('room:'):
            fu.dispenser(geo, True, zf, into, d['x'] - d['width'] / 2 - 0.2, y=1.15)


# ===================================================================================================================================================
# the nurse hub
# ===================================================================================================================================================
def ellipse_band(cu, cv, a, b, r0, r1, n=44):
    """The plan polygon (u, v) of an elliptical band from t = pi to 0: the centre line (a, b) offset r0..r1 (negative: inside)."""
    out, inn = [], []
    for i in range(n + 1):
        t = math.pi - math.pi * i / n
        # offset along the ellipse normal
        nx, ny = b * math.cos(t), a * math.sin(t)
        L = math.hypot(nx, ny) or 1.0
        nx, ny = nx / L, ny / L
        pu, pv = cu + a * math.cos(t), cv + b * math.sin(t)
        out.append((pu + nx * r1, pv + ny * r1))
        inn.append((pu + nx * r0, pv + ny * r0))
    return out + list(reversed(inn))


def hub_desk(k, su, sv, w=2.06, d=0.76, top_y=0.78, user=+1):
    """A workstation desk (hub K): oak top, white side panels and a modesty panel, monitor posts under the live screens (at su +- 0.4,
    sv + 0.1), a keyboard and mouse on the user's side (`user` +1: +v)."""
    k.box('Oak', su - w / 2, top_y - 0.035, sv - d / 2, su + w / 2, top_y, sv + d / 2)
    for sx in (-1, 1):
        x = su + sx * (w / 2 - 0.03)
        k.box('SolidSurface', x - 0.025, 0.0, sv - d / 2 + 0.03, x + 0.025, top_y - 0.035, sv + d / 2 - 0.03)
    k.box('SolidSurface', su - w / 2 + 0.05, 0.25, sv - user * (d / 2 - 0.08) - 0.012, su + w / 2 - 0.05, top_y - 0.035, sv - user * (d / 2 - 0.08) + 0.012)
    for sx in (-0.4, 0.4):
        x = su + sx
        vp = sv + 0.1 - user * 0.06
        k.rbox(GRAPHITE, x, top_y, vp, 0.22, 0.012, 0.16, 0.02, axis='y', seg=2)
        k.box(GRAPHITE, x - 0.02, top_y, vp - 0.012, x + 0.02, 1.02, vp + 0.012)
        k.box(GRAPHITE, x + -0.1, 0.96, vp - 0.016 + user * 0.02, x + 0.1, 1.06, vp - 0.006 + user * 0.02)
    kb = sv + user * 0.18
    k.rbox(GRAPHITE, su - 0.05, top_y, kb, 0.44, 0.018, 0.14, 0.008, axis='y', seg=2)
    k.box(sw(kpt.MGREY), su - 0.25, top_y + 0.018, kb - 0.05, su + 0.15, top_y + 0.02, kb + 0.05)
    k.rbox(GRAPHITE, su + 0.3, top_y, kb, 0.06, 0.022, 0.1, 0.03, axis='y', seg=3)


def hub(ctx, ward):
    geo = ctx.geo
    s = -1 if ward == 'A' else 1
    wf = WF(geo, ward, 0.0)
    k = wf.k
    fp = ctx.fur['footprints']
    hid = f'hub{ward}'
    # ceiling: plaster, shadow gaps on three walls, an LED line over each desk row, downlights over the back counter
    G = 0.02
    v0, v1 = 0.0, 5.9
    k.box('ShadowGap', -4.9, CH + 0.03, v1 - G, 4.9, CH + 0.05, v1, drop=('up',))
    for sx in (-1, 1):
        x0 = sx * 4.9
        k.box('ShadowGap', min(x0, x0 - sx * G), CH + 0.03, v0, max(x0, x0 - sx * G), CH + 0.05, v1, drop=('up',))
    xa, xb = -4.9 + G, 4.9 - G
    vl, hw = 1.8, 0.025
    lx0, lx1 = -3.6, 3.6
    k.box('CeilingPlaster', xa, CH, v0, xb, CH + 0.05, vl - hw, drop=('up',))
    k.box('CeilingPlaster', xa, CH, vl + hw, xb, CH + 0.05, v1 - G, drop=('up',))
    k.box('CeilingPlaster', xa, CH, vl - hw, lx0, CH + 0.05, vl + hw, drop=('up',))
    k.box('CeilingPlaster', lx1, CH, vl - hw, xb, CH + 0.05, vl + hw, drop=('up',))
    k.box('LEDLine', lx0, CH + 0.02, vl - hw, lx1, CH + 0.025, vl + hw, drop=('up',))
    for (u, v) in ((-3.2, 4.0), (-1.2, 5.0), (1.2, 5.0), (3.2, 4.0), (0.0, 3.4)):
        k.vcyl('SolidSurface', u, CH - 0.012, v, 0.06, 0.004, seg=20)
        k.vcyl('LEDLine', u, CH - 0.014, v, 0.045, 0.002, seg=20)
        ctx.downlight(*wf.w(u, v), CH, 9.0)
    # the lintel over the counter opening (the glass front runs full height either side)
    d = ctx.pl.door(hid)
    line_box(geo, 'WallClinical', {'alongX': True, 'c': d['z']}, d['x'] - d['width'] / 2, d['x'] + d['width'] / 2, DOOR_H, H_WALL + 0.06, T)
    # the curved back counter (the sim's 14 counter footprints): solid surface, an oak top with a soft LED lip on the inside, a black plinth
    A, B, CV, DEP, HT = 4.0, 2.35, 2.9, 0.55, 1.02
    k.prism(GRAPHITE, ellipse_band(0.0, CV, A, B, -DEP / 2 + 0.05, DEP / 2 - 0.03), 'xz', 0.0, 0.1)
    k.prism('SolidSurface', ellipse_band(0.0, CV, A, B, -DEP / 2, DEP / 2), 'xz', 0.1, HT - 0.04, smooth=True)
    k.prism('Oak', ellipse_band(0.0, CV, A, B, -DEP / 2 - 0.06, DEP / 2 + 0.01), 'xz', HT - 0.04, HT, smooth=True)
    k.prism('LEDLine', ellipse_band(0.0, CV, A, B, -DEP / 2 - 0.05, -DEP / 2 - 0.01, n=36), 'xz', HT - 0.046, HT - 0.04)
    # the two workstation desks under the live screens
    for side in ('W', 'E'):
        dk = fp[f'{hid}:desk{side}']
        hub_desk(k, dk['x'], abs(dk['z']) - 16.0, user=+1)
    # the open chart rack (west) and a tall glazed cabinet (east)
    r = fp[f'{hid}:rack']
    ksup.cabinet(geo, wf.F(-4.9 + 0.2, abs(r['z']) - 16.0, 1.0, 0.0), w=1.2, h=1.15, d=0.4, kind='open')
    c = fp[f'{hid}:cabinet']
    ksup.cabinet(geo, wf.F(4.9 - 0.225, abs(c['z']) - 16.0, -1.0, 0.0), w=1.1, h=2.0, d=0.45, kind='glass')
    p = fp[f'{hid}:plant']
    fu.planter(geo, p['x'], p['z'], r=0.26, seed=31 if ward == 'A' else 37, height=0.5, plant_h=1.7)
    # the back wall: the ward's tint, an oak slat feature panel behind the counter, the clock
    fz = s * 21.9
    wall_face_quad(geo, TINT[ward], True, fz, -s, -4.9, 4.9, 0.1, CH)
    fu.slat_wall(geo, True, fz, -s, -1.25, 1.25, 0.0, CH)
    karch.coved_skirting(geo, True, fz, -s, -4.9, -1.25)
    karch.coved_skirting(geo, True, fz, -s, 1.25, 4.9)
    for sx in (-1, 1):
        z0, z1 = sorted((s * 16.0, s * 21.9))
        karch.coved_skirting(geo, False, sx * 4.9, -sx, z0, z1)
    clock(geo, wf.F(-3.3, 5.9, 0.0, -1.0), y=2.2, r=0.2)


# ===================================================================================================================================================
# staff room, family lounge, quiet room, clean supply
# ===================================================================================================================================================
def sofa(k, cu, cv, w, d, mat, back=-1, legs='Oak', cushion=None):
    """A sofa (area K): upholstered base, back and arms on oak legs, its back toward `back` (-1: -v)."""
    b = back
    v0, v1 = cv - d / 2, cv + d / 2
    for su in (-1, 1):
        for sv_ in (-1, 1):
            k.vcyl(legs, cu + su * (w / 2 - 0.08), 0.0, cv + sv_ * (d / 2 - 0.08), 0.02, 0.12, seg=10)
    k.rbox(mat, cu, 0.12, cv, w, 0.2, d, 0.03, axis='x', seg=2)
    k.rbox(mat, cu, 0.32, cv - b * 0.06, w - 0.3, 0.16, d - 0.25, 0.05, axis='x', seg=3)
    k.rbox(mat, cu, 0.32, cv + b * (d / 2 - 0.1), w, 0.5, 0.2, 0.06, axis='x', seg=3)
    for su in (-1, 1):
        k.rbox(mat, cu + su * (w / 2 - 0.075), 0.32, cv, 0.15, 0.3, d, 0.05, axis='z', seg=3)
    if cushion:
        for su in (-1, 1):
            c = k.at(cu + su * (w / 2 - 0.4), 0.48, cv + b * (d / 2 - 0.26), rx=math.radians(15) * b)
            c.rbox(cushion, 0, 0, 0, 0.38, 0.36, 0.11, 0.05, axis='z', seg=3)


def armchair(k, cu, cv, mat, heading_k):
    """A lounge armchair (a sub-emitter turned to its heading; the sitter faces local +z)."""
    c = heading_k
    for su in (-1, 1):
        for sv_ in (-1, 1):
            c.vcyl('Oak', su * 0.32, 0.0, sv_ * 0.3, 0.018, 0.12, seg=10)
    c.rbox(mat, 0, 0.12, 0.0, 0.78, 0.22, 0.76, 0.04, axis='x', seg=3)
    c.rbox(mat, 0, 0.34, 0.06, 0.52, 0.12, 0.6, 0.05, axis='x', seg=3)
    bk = c.at(0, 0.34, -0.3, rx=math.radians(-10))
    bk.rbox(mat, 0, 0, 0, 0.78, 0.5, 0.16, 0.06, axis='z', seg=3)
    for su in (-1, 1):
        c.rbox(mat, su * 0.33, 0.34, 0.0, 0.12, 0.24, 0.74, 0.05, axis='z', seg=3)


def coffee_table(k, cu, cv, w, d, h=0.42):
    k.box('Oak', cu - w / 2, h - 0.03, cv - d / 2, cu + w / 2, h, cv + d / 2)
    for su in (-1, 1):
        for sv_ in (-1, 1):
            k.box('Steel', cu + su * (w / 2 - 0.06) - 0.015, 0.0, cv + sv_ * (d / 2 - 0.06) - 0.015, cu + su * (w / 2 - 0.06) + 0.015, h - 0.03,
                  cv + sv_ * (d / 2 - 0.06) + 0.015)
    k.box('Oak', cu - w / 2 + 0.06, 0.12, cv - d / 2 + 0.06, cu + w / 2 - 0.06, 0.14, cv + d / 2 - 0.06)


def staff_room(ctx):
    geo = ctx.geo
    wf = WF(geo, 'A', -40.0)
    k = wf.k
    fp = ctx.fur['footprints']
    seats = {e['id']: e for e in ctx.fur['seats']}
    uv = lambda e: (e['x'] + 40.0, abs(e['z']) - 16.0)        # noqa: E731
    # lockers under the window: six half-height staff lockers, oak doors, solid-surface top
    lu, lv = uv(fp['staff:lockers'])
    for i in range(6):
        u = lu - 1.5 + i * 0.5
        k.box('SolidSurface', u + 0.002, 0.08, lv - 0.25, u + 0.498, 0.86, lv + 0.2)
        k.box('Oak', u + 0.004, 0.09, lv - 0.25 - 0.02, u + 0.496, 0.85, lv - 0.25)
        k.box(sw(kpt.MGREY), u + 0.38, 0.62, lv - 0.29, u + 0.4, 0.74, lv - 0.27)
        k.box(sw(kpt.WHITE), u + 0.18, 0.74, lv - 0.272, u + 0.32, 0.8, lv - 0.269)
    k.box(GRAPHITE, lu - 1.48, 0.0, lv - 0.22, lu + 1.48, 0.08, lv + 0.2, drop=('down',))
    k.box('SolidSurface', lu - 1.5, 0.86, lv - 0.28, lu + 1.5, 0.89, lv + 0.24)
    # kitchenette under the window: oak base units, solid-surface worktop, a stainless sink and tap, microwave, coffee machine
    ku, kv = uv(fp['staff:kitchen'])
    L = 3.46
    k.box(GRAPHITE, ku - L / 2 + 0.02, 0.0, kv - 0.28, ku + L / 2 - 0.02, 0.1, kv + 0.3, drop=('down',))
    k.box('SolidSurface', ku - L / 2, 0.1, kv - 0.27, ku + L / 2, 0.86, kv + 0.32)
    n = 6
    for i in range(n):
        u = ku - L / 2 + i * L / n
        k.box('Oak', u + 0.002, 0.105, kv - 0.29, u + L / n - 0.002, 0.855, kv - 0.27)
        k.box(sw(kpt.MGREY), u + L / n / 2 - 0.08, 0.78, kv - 0.31, u + L / n / 2 + 0.08, 0.795, kv - 0.29)
    sx0, sx1, sz0, sz1 = ku + 0.65, ku + 1.15, kv - 0.19, kv + 0.19
    for (a0, b0, a1, b1) in ((ku - L / 2 - 0.01, kv - 0.31, sx0, kv + 0.33), (sx1, kv - 0.31, ku + L / 2 + 0.01, kv + 0.33),
                             (sx0, kv - 0.31, sx1, sz0), (sx0, sz1, sx1, kv + 0.33)):
        k.box('SolidSurface', a0, 0.86, b0, a1, 0.9, b1)
    k.tray(SS, ku + 0.9, 0.73, kv, 0.5, 0.38, 0.17, wall=0.012, r=0.03, seg=3)
    k.tube(SS, [(ku + 0.9, 0.9, kv + 0.25), (ku + 0.9, 1.15, kv + 0.25), (ku + 0.9, 1.18, kv + 0.18), (ku + 0.9, 1.1, kv + 0.08)], 0.012, seg=8)
    k.rbox(PW, ku - 1.0, 0.9, kv + 0.05, 0.5, 0.3, 0.38, 0.03, axis='y', seg=2)
    k.box('Screen', ku - 1.2, 0.95, kv - 0.142, ku - 0.88, 1.16, kv - 0.138)
    k.rbox(GRAPHITE, ku + 0.05, 0.9, kv + 0.08, 0.28, 0.38, 0.34, 0.03, axis='y', seg=2)
    # two doctors' desks under their live screens, task chairs on the sim's seats
    for i in (0, 1):
        du, dv = uv(fp[f'staff:desk{i}'])
        hub_desk(k, du, dv, w=1.76, d=0.76, user=-1)
        st = seats[f'lounge:staffA:desk:{i}']
        dx, dz = fp[f'staff:desk{i}']['x'] - st['x'], fp[f'staff:desk{i}']['z'] - st['z']
        kcafe.chair(geo, Frame(st['x'], st['z'], math.atan2(dx, dz) + 0.15), seat_h=st['height'])
    # soft seating: sofa, coffee table
    su_, sv_ = uv(fp['staff:sofa'])
    sofa(k, su_, sv_, 2.2, 0.85, 'Fabric', back=-1, cushion='FabricAccent')
    tu, tv = uv(fp['staff:table'])
    coffee_table(k, tu, tv, 0.94, 0.54)
    # the round table and four chairs
    r = fp['staff:round']
    kcafe.table(geo, Frame(r['x'], r['z']), kind='round', size=0.9, h=0.74)
    for i in range(4):
        st = seats[f'lounge:staffA:chair:{i}']
        kcafe.chair(geo, Frame(st['x'] - math.sin(st['heading']) * 0.03, st['z'] - math.cos(st['heading']) * 0.03, st['heading']), seat_h=st['height'])
    p = fp['staff:plantA']
    fu.planter(geo, p['x'], p['z'], r=0.27, seed=41, height=0.5, plant_h=1.6)
    pu, pv = uv(fp['staff:plantB'])
    floor_lamp(k, pu, pv)
    # the east wall (to room A1) in the ward tint, a clock over the round table
    wall_face_quad(geo, TINT['A'], False, -25.1, -1, -21.9, -16.1, 0.1, CH)
    clock(geo, wf.F(14.9, 2.4, -1.0, 0.0), y=2.1)
    for (along_x, face, into, a, b) in ((False, -25.1, -1, -21.9, -16.1), (False, -39.9, 1, -21.9, -16.1)):
        karch.coved_skirting(geo, along_x, face, into, a, b)


def lounge(ctx, ward):
    """Ward A's family lounge (loungeA) or ward B's quiet room (quietB): x 25..40."""
    geo = ctx.geo
    wf = WF(geo, ward, 25.0)
    k = wf.k
    fp = ctx.fur['footprints']
    seats = {e['id']: e for e in ctx.fur['seats']}
    uv = lambda e: (e['x'] - 25.0, abs(e['z']) - 16.0)        # noqa: E731
    if ward == 'A':
        for i in (0, 1):
            su_, sv_ = uv(fp[f'lounge:sofa{i}'])
            sofa(k, su_, sv_, 2.2, 0.85, 'Fabric', back=+1, cushion='FabricAccent')
            tu, tv = uv(fp[f'lounge:table{i}'])
            coffee_table(k, tu, tv, 1.04, 0.59)
        for i in (0, 1):
            st = seats[f'lounge:loungeA:arm:{i}']
            armchair(k, 0, 0, 'FabricAccent', kroot(geo, Frame(st['x'], st['z'], st['heading'])))
        for pid, seed, r in (('lounge:plant0', 51, 0.28), ('lounge:plant1', 53, 0.33)):
            p = fp[pid]
            fu.planter(geo, p['x'], p['z'], r=r, seed=seed, height=0.5, plant_h=1.7)
        pu, pv = uv(fp['lounge:play'])                       # the children's corner: a soft mat and play blocks
        k.rbox(sw(kpt.PALEBLUE), pu, 0.0, pv, 1.6, 0.025, 1.6, 0.12, axis='y', seg=4)
        for (du, dv, sz, c) in ((-0.45, -0.4, 0.4, kpt.ORANGE), (0.25, -0.45, 0.34, kpt.GREEN), (-0.1, 0.35, 0.36, kpt.SLATE), (0.4, 0.3, 0.3, kpt.YELLOW)):
            k.rbox(sw(c), pu + du, 0.025, pv + dv, sz, sz, sz, 0.06, axis='y', seg=3)
        cu, cv = uv(fp['lounge:cooler'])                      # water cooler
        k.rbox(PW, cu, 0.0, cv, 0.3, 1.0, 0.3, 0.03, axis='y', seg=3)
        k.vcyl(sw(kpt.CLEAR), cu, 1.0, cv, 0.13, 0.4, seg=20)
        k.box(sw(kpt.MGREY), cu - 0.08, 0.72, cv - 0.16, cu + 0.08, 0.8, cv - 0.14)
        tint = 'WallTintSand'
    else:
        for i in (0, 1):
            st = seats[f'lounge:quietB:arm:{i}']
            armchair(k, 0, 0, 'VinylSage', kroot(geo, Frame(st['x'], st['z'], st['heading'])))
        t = fp['quiet:table']
        side_table(k, t['x'] - 25.0, abs(t['z']) - 16.0, r=0.27, h=0.45)
        for pid, seed in (('quiet:plantW', 61), ('quiet:plantE', 63)):
            p = fp[pid]
            fu.planter(geo, p['x'], p['z'], r=0.34, seed=seed, height=0.55, plant_h=1.8)
        sh = fp['quiet:shelf']                                 # an open oak bookshelf
        ksup.cabinet(geo, wf.F(sh['x'] - 25.0, abs(sh['z']) - 16.0, 1.0, 0.0), w=1.8, h=1.2, d=0.4, kind='open')
        b = fp['quiet:bench']
        kcafe.bench(geo, Frame(b['x'], b['z'], b['rotationY'] + math.pi), length=1.5, h=0.42)
        bu_, bv_ = uv(b)
        k.rbox(sw(kpt.LGREY), bu_, 0.0, bv_ - 0.15, 2.3, 0.008, 1.9, 0.08, axis='y', seg=3)
        tint = TINT['B']
    z0, z1 = sorted((wf.zr(0.1), wf.zr(5.9)))
    wall_face_quad(geo, tint, False, 25.1, +1, z0, z1, 0.1, CH)
    karch.coved_skirting(geo, False, 25.1, +1, z0, z1)


def supply(ctx):
    """Ward B's clean supply room (x -40..-31): modular shelving with bins, tall cupboards, two linen carts, a work bench."""
    geo = ctx.geo
    wf = WF(geo, 'B', -40.0)
    k = wf.k
    fp = ctx.fur['footprints']
    for i in range(3):
        f = fp[f'supply:shelfN{i}']
        if i == 1:                                     # the middle run: closed cupboards (sterile stock)
            ksup.cabinet(geo, Frame(f['x'], f['z'], math.pi), w=2.7, h=2.0, d=0.5, kind='doors')
        else:
            ksup.shelving(geo, Frame(f['x'], f['z'], math.pi), w=2.7, h=1.9, d=0.5, shelves=5, bins=True)
    for sid, du in (('supply:shelfW', 1.0), ('supply:shelfE', -1.0)):
        f = fp[sid]
        ksup.cabinet(geo, Frame(f['x'], f['z'], math.atan2(du, 0.0)), w=2.3, h=2.0, d=0.5, kind='doors')
    for i in (0, 1):
        f = fp[f'supply:cart{i}']
        ksup.linen_cart(geo, Frame(f['x'], f['z'], math.pi / 2), w=0.9, d=0.5, h=1.3)
    b = fp['supply:bench']
    bu, bv = b['x'] + 40.0, b['z'] - 16.0
    k.box('SolidSurface', bu - 0.68, 0.1, bv - 0.3, bu + 0.68, 0.86, bv + 0.3)
    k.box(GRAPHITE, bu - 0.66, 0.0, bv - 0.28, bu + 0.66, 0.1, bv + 0.28, drop=('down',))
    k.box('SolidSurface', bu - 0.69, 0.86, bv - 0.33, bu + 0.69, 0.9, bv + 0.33)


# ===================================================================================================================================================
# the zone
# ===================================================================================================================================================
def build_ward(ctx, ward):
    if karch is None or ctx.kit is None:
        return
    for x0, i in zip(ROOM_X0, range(1, 9)):
        room(ctx, ward, x0, f'{ward}{i}')
    corridor(ctx, ward)
    hub(ctx, ward)
    if ward == 'A':
        staff_room(ctx)
        lounge(ctx, 'A')
    else:
        supply(ctx)
        lounge(ctx, 'B')


def build(ctx):
    build_ward(ctx, 'A')
