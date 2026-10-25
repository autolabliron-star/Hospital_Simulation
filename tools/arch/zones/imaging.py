"""
Zone 'imaging' (Imaging (MRI, CT, X-ray, ultrasound), the blood-draw centre): "clean clinical modern", the approved lobby look carried into a calm
diagnostics department. White plaster walls with the shadow-gap skirting, clinical sheet vinyl, acoustic tegular ceilings, and the department's
colour: imaging purple (door linings, door-head signs, the directory) on pale lilac wall panels. The scanner rooms are different on purpose.

  imaging hall      x -40..-22, z -2..2: tegular ceiling with two recessed linear LED channels, the lobby's beam benches on the sim's seat rows under
                    pale lilac panels and a purple directory, an oak slat wall and a booking desk in the lobby's reception language, planters at
                    the east end (the glass wall onto the core), purple door linings, door-head signs
  control rooms     (MRI and CT) the glass partition to the scanner becomes a real viewing window (a lead-glass ribbon, 0.85..2.35 m, white plaster
                    spandrels above and below, white linings), a console desk with the live monitors' stands on it, patient lockers / printer unit
  MRI room          RF-shield cladding (pale blue-grey modular panels, dark joints, stainless base and seam strips), a luminous ceiling feature
                    over the magnet and table, a stainless threshold and the warning lamp at the RF door, coil storage, a tall cabinet
  CT, X-ray         lead-lined (graphite) door frames, stainless thresholds, a warning lamp over each door, lead-apron racks, cabinets, a lead-glass
                    screen and an exposure desk in the X-ray booth
  ultrasound        a clean couch with a paper roll, a hand-wash station, a cabinet, a stool
  blood draw        a hand-wash station, the waiting bench in the lobby's language, changing cubicle benches with hooks, a lilac wall behind the
                    cubicles (they stood against the glass wall onto the core)

The animated machines (MRI, CT, X-ray tube and rails, the radiography table, the ultrasound cart; the blood-draw robots, tube-prep machine,
check-in kiosk and send station; every live screen) are procedural at runtime and are not drawn here; this design stands on their footprints'
margins and leaves them alone. Everything designed stays inside the footprint it replaces, so collision and seat points are the sim's.
"""
import math

import furniture as fu
from common import Frame
from shell import GAP_D, GAP_H, line_box

try:
    from kit import arch as karch
    from kit import base as kbase
    from kit import patient as kpatient
    from kit import support as ksupport
except Exception:      # noqa: BLE001  (no kit: the zone still builds, without the kit's pieces)
    karch = kbase = kpatient = ksupport = None

CH = 3.0
T = 0.2
FACE = T / 2
HALL = (-40.0, -22.0, -2.0, 2.0)
LILAC = 'WallTintLilac'
BLUE = 'WallTintBlue'
PURPLE = 'Accent:4'

# --- shell settings (zones/__init__.py) ---
HERO = [HALL]
OWN_CEILINGS = ('imagingHall', 'mri')
SKIP_DOORS = ()

# doors: imaging purple on the corridor-side doors, graphite (lead-lined) on the doors into a radiation or RF room
DOOR_LINING = {'mriControl': PURPLE, 'ctControl': PURPLE, 'ultrasound': PURPLE, 'bloodDraw': PURPLE, 'xray': 'Steel', 'mriRoom': 'Steel', 'ctRoom': 'Steel'}

# review stills (plan x, z) -> look at (x, z), eye 1.6 m, 24 mm: the hall, the MRI control room, the CT room, the blood-draw centre
POSES = [((-39.2, 0.0), (-22.0, 0.0)), ((-32.1, -2.6), (-37.4, -5.2)), ((-30.3, -5.2), (-26.4, -11.6)), ((-27.3, 3.0), (-23.4, 10.6))]

# runtime hints (src/scene/building/model/region.ts: the prims standing inside each footprint are hidden while this zone is drawn)
REPLACES = [
    # hall: the seat rows, the booking desk, planters and the magazine table
    'footprint:imaging:seatsN1', 'footprint:imaging:seatsS1', 'footprint:imaging:booking', 'footprint:imaging:plant*', 'footprint:imaging:sideTable',
    # MRI control + room
    'footprint:imaging:mri:console', 'footprint:imaging:mri:lockers', 'footprint:imaging:mri:coils', 'footprint:imaging:mri:cabinet',
    # CT control + room
    'footprint:imaging:ct:console', 'footprint:imaging:ct:cabinet', 'footprint:imaging:ct:aprons', 'footprint:imaging:ct:supplies',
    # X-ray booth and room
    'footprint:imaging:xray:screen', 'footprint:imaging:xray:console', 'footprint:imaging:xray:stool', 'footprint:imaging:xray:aprons',
    'footprint:imaging:xray:cabinet',
    # ultrasound
    'footprint:imaging:us:couch', 'footprint:imaging:us:counter', 'footprint:imaging:us:cabinet', 'footprint:imaging:us:stool',
    # blood-draw centre
    'footprint:imaging:sink', 'footprint:draw:bench', 'footprint:imaging:cubicles:bench*',
    # the changing cubicles' curtains and their rail (src/scene/rooms/bloodDraw.ts, no footprint): x -23.45 front line, z 3.9..8.1
    'rect:-23.6,-23.3,3.8,8.2',
    # seating (seating()): the cubicles' partitions, the MRI and CT operators' chairs (no footprint: the rects round them), the three
    # blood-draw chairs (the rects stop short of the robots' arm cradles at z 10.56, which stay with the robots)
    'footprint:imaging:cubicles:part*',
    'rect:-36.9,-36.3,-3.7,-2.9', 'rect:-27.9,-27.3,-3.7,-2.9',
    'rect:-27.2,-26.6,9.9,10.45', 'rect:-25.5,-24.9,9.9,10.45', 'rect:-23.8,-23.2,9.9,10.45',
]
VISIBLE_FROM = ['lobby', 'core']


def door_accent(d):
    return DOOR_LINING.get(d['id'])


# --- helpers ----------------------------------------------------------------------------------------------------------------------------------------
def on_wall(geo, mat, along_x, face, into, t0, t1, u0, u1, y0, y1, drop=()):
    """A box on a wall face: along the wall t0..t1, standing out u0..u1 from the face into the room (`into` = +1 / -1 along the across axis)."""
    c0, c1 = sorted((face + into * u0, face + into * u1))
    if along_x:
        geo.box(mat, t0, y0, c0, t1, y1, c1, drop)
    else:
        geo.box(mat, c0, y0, t0, c1, y1, t1, drop)


def back_face(along_x, into):
    """The face of an on_wall box that lies against the wall (never seen: left out of the mesh and of the lightmap)."""
    if along_x:
        return 'z0' if into > 0 else 'z1'
    return 'x0' if into > 0 else 'x1'


def tint_panel(geo, along_x, face, into, a, b, mat=LILAC, y0=GAP_H, y1=CH - 0.005, t=0.012):
    """A calm tinted wall panel, just proud of the plaster (its back, bottom and top faces are hidden: left out)."""
    on_wall(geo, mat, along_x, face, into, a, b, 0.0, t, y0, y1, drop=(back_face(along_x, into), 'down', 'up'))


def K(geo, cx, cz, h=0.0):
    """A kit emitter at a frame on the floor (local +z = the heading's front)."""
    return kbase.root(geo, Frame(cx, cz, h))


# --- ceilings ---------------------------------------------------------------------------------------------------------------------------------------
def hall_ceiling(geo):
    """600 mm acoustic tegular tiles in three bands with two recessed linear LED channels (white housing, a 10 mm trough) running the hall's length."""
    x0, x1, z0, z1 = HALL
    slots = (-0.95, 0.95)
    hw = 0.075
    edges = [z0] + [v for s in slots for v in (s - hw, s + hw)] + [z1]
    for i in range(0, len(edges), 2):
        karch.tegular_ceiling(geo, (x0, x1, edges[i], edges[i + 1]), CH)
    xa, xb = x0 + FACE + 0.02, x1 - 0.03
    for s in slots:
        for za, zb in ((s - 0.075, s - 0.05), (s + 0.05, s + 0.075)):
            geo.box('SolidSurface', xa, CH - 0.026, za, xb, CH - 0.006, zb, drop=('up',))
        geo.box('LEDLine', xa, CH - 0.017, s - 0.05, xb, CH - 0.012, s + 0.05, drop=('up',))


def mri_ceiling(geo, pl):
    """The MRI room: a tegular ceiling with one large luminous panel over the magnet and the table (the room's soft light feature)."""
    r = pl.area('mri')['rect']
    karch.tegular_ceiling(geo, (r['x0'], r['x1'], r['z0'], r['z1']), CH, panels=[(4, 3, 8, 6)])


# --- viewing windows and door details ---------------------------------------------------------------------------------------------------------------
def viewing_window(geo, pl, a, b, c=-4.5, sill=0.85, head=2.35):
    """The glass partition between a control room and its scanner room, made a real viewing window: white plaster spandrels under and over the
    glass (the shell's partition glass and mullions stay in between, as the lead-glass ribbon), and white linings round the opening."""
    w = {'alongX': True, 'c': c}
    wm = pl.wall_mat(dict(w, a=a, b=b))
    line_box(geo, wm, w, a, b, GAP_H, sill, T)
    line_box(geo, 'ShadowGap', w, a, b, 0.0, GAP_H, T - 2 * GAP_D, drop=('up', 'down'))
    line_box(geo, wm, w, a, b, head, CH + 0.06, T, drop=('up',))
    lin = T + 0.008
    line_box(geo, 'DoorFrame', w, a, b, sill, sill + 0.03, lin + 0.04)                      # the sill board, proud on both faces
    line_box(geo, 'DoorFrame', w, a, b, head - 0.035, head, lin)                            # the head lining
    for x0, x1 in ((a, a + 0.035), (b - 0.035, b)):
        line_box(geo, 'DoorFrame', w, x0, x1, sill + 0.03, head - 0.035, lin)               # jamb linings


def scanner_door(geo, pl, did, into):
    """A radiation / RF door seen from the scanner room: a stainless threshold, and an illuminated-style warning lamp over it (a white housing,
    a red lens), standing on the scanner room's wall face (`into` = the way into the scanner room)."""
    d = pl.door(did)
    h = d['width'] / 2
    along_x = d['wallAxis'] == 'x'
    c = d['z'] if along_x else d['x']
    mid = d['x'] if along_x else d['z']
    w = {'alongX': along_x, 'c': c}
    line_box(geo, 'Stainless', w, mid - h, mid + h, 0.0, 0.007, 0.2 + 0.02)
    face = c + into * FACE
    on_wall(geo, 'SolidSurface', along_x, face, into, mid - 0.2, mid + 0.2, 0.0, 0.045, pl.DOOR_H + 0.14, pl.DOOR_H + 0.36)
    on_wall(geo, 'Accent:2', along_x, face, into, mid - 0.16, mid + 0.16, 0.045, 0.049, pl.DOOR_H + 0.18, pl.DOOR_H + 0.32)


# --- furniture: desks, lockers, cabinets, racks -------------------------------------------------------------------------------------------------------
def console_desk(geo, cx, cz, w, d, heading=0.0, keys=(), pedestals=True):
    """An operator's console desk (top surface at 0.74 m: the live monitors' stands stand on it). Local +z = the operator's side. Two drawer
    pedestals, a modesty panel, an oak front edge, keyboards at local x in `keys`."""
    k = K(geo, cx, cz, heading)
    top = 0.74
    k.rbox('SolidSurface', 0, top - 0.032, -0.02, w, 0.032, d - 0.04, 0.012)
    k.box('Oak', -w / 2 + 0.012, top - 0.038, d / 2 - 0.04, w / 2 - 0.012, top, d / 2)
    for s in (-1, 1):
        k.box('PowderWhite', s * (w / 2 - 0.05) - 0.02, 0.0, -d / 2 + 0.03, s * (w / 2 - 0.05) + 0.02, top - 0.032, d / 2 - 0.05)
        k.box('Steel', s * (w / 2 - 0.05) - 0.03, 0.0, -d / 2 + 0.03, s * (w / 2 - 0.05) + 0.03, 0.025, d / 2 - 0.05)
    k.box('SolidSurface', -w / 2 + 0.1, 0.32, -d / 2 + 0.04, w / 2 - 0.1, top - 0.032, -d / 2 + 0.058)        # modesty panel
    k.box('Steel', -w / 2 + 0.25, top - 0.13, -d / 2 + 0.07, w / 2 - 0.25, top - 0.12, -d / 2 + 0.22)         # cable tray
    for s in ((-1, 1) if pedestals else ()):
        px = s * (w / 2 - 0.42)
        k.box('SolidSurface', px - 0.22, 0.05, -d / 2 + 0.07, px + 0.22, top - 0.04, d / 2 - 0.06)
        for j, (y0, y1) in enumerate(((0.07, 0.28), (0.3, 0.48), (0.5, top - 0.06))):
            k.box('ShadowGap', px - 0.2, y0, d / 2 - 0.062, px + 0.2, y1, d / 2 - 0.058)
            k.box('PowderWhite', px - 0.198, y0 + 0.003, d / 2 - 0.06, px + 0.198, y1 - 0.003, d / 2 - 0.054)
            k.box('Stainless', px - 0.07, y1 - 0.035, d / 2 - 0.054, px + 0.07, y1 - 0.022, d / 2 - 0.044)
    for kx in keys:
        k.rbox('KitPlastic:3', kx, top, 0.12, 0.42, 0.016, 0.14, 0.008)
        k.rbox('KitPlastic:3', kx + 0.3, top, 0.12, 0.06, 0.02, 0.09, 0.03)


def lockers(geo, cx, cz, length, heading, h=1.85, d=0.46, n=5):
    """Patient lockers (metal stays outside zone IV): a white body on a recessed plinth, full-height doors in pale lilac with vent slots and a
    stainless pull each, an oak cap. Local +z = the doors' side."""
    k = K(geo, cx, cz, heading)
    L = length
    k.box('ShadowGap', -L / 2 + 0.02, 0.0, -d / 2 + 0.02, L / 2 - 0.02, 0.1, d / 2 - 0.04)
    k.box('SolidSurface', -L / 2, 0.1, -d / 2, L / 2, h, d / 2 - 0.025)
    k.box('Oak', -L / 2 - 0.005, h, -d / 2, L / 2 + 0.005, h + 0.03, d / 2 + 0.01)
    pw = L / n
    for i in range(n):
        x0 = -L / 2 + i * pw
        k.box(LILAC, x0 + 0.004, 0.12, d / 2 - 0.026, x0 + pw - 0.004, h - 0.02, d / 2)
        for j in range(3):
            y = h - 0.14 - j * 0.035
            k.box('ShadowGap', x0 + 0.07, y, d / 2 - 0.0005, x0 + pw - 0.07, y + 0.012, d / 2 + 0.001)
        k.box('Stainless', x0 + pw / 2 - 0.012, 1.0, d / 2, x0 + pw / 2 + 0.012, 1.2, d / 2 + 0.018)


def printer_unit(geo, cx, cz, heading, w=1.2, d=0.5):
    """The CT control room's printer and supplies unit: a white base cabinet with an oak top and a printer on it."""
    k = K(geo, cx, cz, heading)
    k.box('ShadowGap', -w / 2 + 0.03, 0.0, -d / 2 + 0.02, w / 2 - 0.03, 0.08, d / 2 - 0.04)
    k.box('SolidSurface', -w / 2, 0.08, -d / 2, w / 2, 0.83, d / 2 - 0.02)
    for s in (-1, 1):
        k.box('ShadowGap', s * w / 4 - 0.28, 0.1, d / 2 - 0.022, s * w / 4 + 0.28, 0.81, d / 2 - 0.018)
        k.box('PowderWhite', s * w / 4 - 0.278, 0.103, d / 2 - 0.02, s * w / 4 + 0.278, 0.807, d / 2 - 0.004)
        hx = s * w / 4 - s * 0.22
        k.box('Stainless', hx - 0.006, 0.4, d / 2 - 0.004, hx + 0.006, 0.7, d / 2 + 0.012)
    k.rbox('Oak', 0, 0.83, 0, w + 0.02, 0.04, d, 0.015)
    k.rbox('KitPlastic:0', -0.15, 0.87, -0.02, 0.5, 0.2, 0.34, 0.03, axis='y')
    k.box('KitPlastic:3', -0.3, 0.96, d / 2 - 0.15, 0.0, 0.975, d / 2 - 0.06)
    k.box('KitPlastic:8', 0.05, 1.0, d / 2 - 0.15, 0.07, 1.012, d / 2 - 0.13)
    k.rbox('KitPlastic:1', 0.38, 0.87, 0.0, 0.3, 0.1, 0.26, 0.02, axis='y')


def apron_rack(geo, cx, cz, length, heading):
    """A lead-apron rack against a wall: powder-coated uprights, a stainless hanging rail, four aprons in petrol vinyl with thyroid collars and a
    low oak shelf for lead gloves. Local +z = out of the wall (the footprint is 0.4 deep)."""
    k = K(geo, cx, cz, heading)
    d = 0.4
    for s in (-1, 1):
        k.box('PowderWhite', s * (length / 2 - 0.03) - 0.025, 0.0, -d / 2, s * (length / 2 - 0.03) + 0.025, 1.7, -d / 2 + 0.06)
        k.box('PowderWhite', s * (length / 2 - 0.03) - 0.025, 1.62, -d / 2, s * (length / 2 - 0.03) + 0.025, 1.68, 0.05)
    k.cyl('Stainless', (-length / 2 + 0.05, 1.6, -0.02), (length / 2 - 0.05, 1.6, -0.02), 0.014, seg=10)
    k.box('Oak', -length / 2 + 0.06, 0.12, -d / 2, length / 2 - 0.06, 0.15, 0.12)
    n = 4
    for i in range(n):
        x = -length / 2 + 0.3 + (i * (length - 0.6)) / (n - 1)
        k.rbox('VinylTeal', x, 0.72, -0.07, 0.36, 0.86, 0.045, 0.02, axis='y')
        k.rbox('VinylTeal', x, 1.52, -0.05, 0.2, 0.07, 0.05, 0.02, axis='y')
        k.box('KitPlastic:1', x - 0.07, 0.97, -0.044, x + 0.07, 1.04, -0.042)
        k.box('Stainless', x - 0.012, 1.56, -0.03, x + 0.012, 1.6, -0.01)
    for i in range(2):
        k.rbox('KitPlastic:2', -length / 2 + 0.45 + i * 0.5, 0.15, 0.0, 0.2, 0.05, 0.22, 0.02, axis='y')


def coil_unit(geo, cx, cz, length, heading):
    """MRI coil storage: white uprights, three oak shelves, a head coil, a knee coil, pale-blue flex coils and foam wedges, a cable hook."""
    k = K(geo, cx, cz, heading)
    d = 0.45
    for s in (-1, 1):
        k.box('PowderWhite', s * (length / 2 - 0.03) - 0.025, 0.0, -d / 2, s * (length / 2 - 0.03) + 0.025, 1.75, d / 2 - 0.02)
    k.box('PowderWhite', -length / 2 + 0.05, 1.72, -d / 2, length / 2 - 0.05, 1.75, d / 2 - 0.02)
    for y in (0.4, 0.9, 1.4):
        k.box('Oak', -length / 2 + 0.05, y, -d / 2, length / 2 - 0.05, y + 0.035, d / 2 - 0.02)
    # head coil: a rounded light-grey cage with a dark face opening
    k.rbox('KitPlastic:1', -0.65, 0.935, 0.0, 0.4, 0.3, 0.34, 0.07, axis='y')
    k.box('KitPlastic:3', -0.82, 1.02, 0.1, -0.48, 1.12, 0.171)
    # knee coil: a squat cylinder with a dark bore
    k.cyl('KitPlastic:1', (0.05, 0.935, 0.0), (0.05, 1.215, 0.0), 0.17, seg=24)
    k.cyl('KitPlastic:3', (0.05, 0.935, 0.0), (0.05, 1.216, 0.0), 0.1, seg=20)
    # flex coils and foam pads
    k.rbox('KitPlastic:12', 0.65, 0.435, 0.0, 0.5, 0.05, 0.32, 0.02, axis='y')
    k.rbox('KitPlastic:11', 0.65, 0.485, 0.0, 0.46, 0.04, 0.3, 0.02, axis='y')
    k.rbox('Linen', -0.5, 0.435, 0.0, 0.6, 0.07, 0.34, 0.03, axis='y')
    k.rbox('Linen', 0.25, 1.435, 0.0, 0.7, 0.1, 0.34, 0.04, axis='y')
    k.rbox('KitPlastic:12', -0.5, 1.435, 0.0, 0.44, 0.06, 0.3, 0.02, axis='y')
    k.tube('KitPlastic:3', [(-0.9, 0.9, 0.2), (-0.9, 0.72, 0.2), (-0.8, 0.5, 0.2)], 0.008, seg=6)


def tall_cabinet(geo, cx, cz, w, d, heading, kind='doors'):
    ksupport.cabinet(geo, Frame(cx, cz, heading), w=w, h=2.0, d=d, kind=kind)


def stool(geo, x, z, top, base_r=0.28):
    """A clinical stool: a graphite base, a gas column, a round wipe-clean seat, a stainless foot ring."""
    k = K(geo, x, z, 0.0)
    k.cyl('Steel', (0, 0.0, 0), (0, 0.03, 0), base_r, seg=24)
    k.cyl('Stainless', (0, 0.03, 0), (0, top - 0.08, 0), 0.03, seg=12)
    k.torus('Stainless', 0.2, 0.008, seg=24, sides=6, y=0.27)
    for a in range(3):
        t = a * 2 * math.pi / 3 + 0.5
        k.cyl('Stainless', (0, 0.27, 0), (math.cos(t) * 0.2, 0.27, math.sin(t) * 0.2), 0.006, seg=6)
    k.cyl('VinylGrey', (0, top - 0.075, 0), (0, top, 0), 0.2, seg=28)
    k.cyl('Steel', (0, top - 0.085, 0), (0, top - 0.075, 0), 0.15, seg=20)


def couch(geo, cx, cz):
    """The ultrasound couch on the footprint (0.78 x 1.95, long axis z, the head to the south): a stainless column on a graphite base, a white
    frame, a wipe-clean pad with a raised head section, a pillow, and the paper roll at the foot. Patient surface 0.69 m."""
    k = K(geo, cx, cz, 0.0)
    k.rbox('Steel', 0, 0.0, 0.0, 0.5, 0.06, 1.2, 0.04)
    k.cyl('Stainless', (0, 0.06, 0.0), (0, 0.5, 0.0), 0.1, seg=24)
    k.rbox('PowderWhite', 0, 0.5, 0.0, 0.7, 0.07, 1.9, 0.05)
    k.rbox('VinylGrey', 0, 0.57, -0.275, 0.68, 0.09, 1.25, 0.035, axis='z')
    head = k.at(0, 0.57, 0.35, rx=-0.18)           # the head section, hinged at its north edge, raised 10 degrees
    head.rbox('VinylGrey', 0, 0.0, 0.3, 0.68, 0.09, 0.6, 0.035, axis='z')
    head.rbox('Linen', 0, 0.09, 0.45, 0.38, 0.07, 0.26, 0.035)
    # the paper roll at the foot: two white brackets and the roll
    for s in (-1, 1):
        k.box('PowderWhite', s * 0.3 - 0.012, 0.57, -0.945, s * 0.3 + 0.012, 0.79, -0.91)
    k.cyl('Linen', (-0.29, 0.75, -0.93), (0.29, 0.75, -0.93), 0.055, seg=16)


def hand_wash(geo, wall_face, z0, heading):
    """The kit's hand-wash station on a west wall (the room is to the east): wall-hung basin on a splashback, sensor spout, soap and gel,
    paper towels, two pedal bins. Extends from z0 + 0.5 (south) to z0 - 1.25 (north)."""
    kpatient.handwash(geo, Frame(wall_face, z0, heading))


def booking_desk(geo, cx, cz):
    """The booking desk in the lobby's reception language: a white solid-surface body on a recessed plinth, an oak top overhanging the visitors'
    side (north) by 50 mm, a soft LED line under the lip, an oak end panel. The two procedural screens stand on it (kept)."""
    k = K(geo, cx, cz, math.pi)
    L = 2.0
    k.box('ShadowGap', -L / 2 + 0.04, 0.0, -0.26, L / 2 - 0.04, 0.1, 0.22)
    k.rbox('SolidSurface', 0, 0.1, -0.02, L, 0.86, 0.54, 0.03)
    k.rbox('Oak', 0, 0.96, -0.015, L + 0.12, 0.04, 0.62, 0.02)
    k.box('LightPanel', -L / 2 + 0.1, 0.945, 0.275, L / 2 - 0.1, 0.955, 0.292, drop=('up',))


def bench_replace(ctx):
    geo = ctx.geo
    fp, seats = ctx.fur['footprints'], ctx.fur['seats']
    for rid, fabric in (('imaging:seatsN1', 'Fabric'), ('imaging:seatsS1', 'FabricAccent')):
        r = fp[rid]
        row = rid.split('seats')[1]
        mine = sorted((s for s in seats if s['id'].startswith(f'waiting:imaging:{row}:')), key=lambda s: s['id'])
        n = len(mine)
        fu.bench_row(geo, Frame(r['x'], r['z'], r['rotationY']), n, r['w'] / n, fabric, seat_h=mine[0]['height'])
    # the blood-draw centre's three-seat bench on the west wall (seats face east)
    mine = sorted((s for s in seats if s['id'].startswith('waiting:draw:')), key=lambda s: s['id'])
    if mine:
        zs = [s['z'] for s in mine]
        pitch = zs[1] - zs[0]
        h = mine[0]['heading']
        x = mine[0]['x'] - math.sin(h) * 0.02
        fu.bench_row(geo, Frame(x, (zs[0] + zs[-1]) / 2, h), len(mine), pitch, 'FabricAccent', seat_h=mine[0]['height'])


# --- the hall -------------------------------------------------------------------------------------------------------------------------------------------
def hall(ctx):
    geo, pl, fp = ctx.geo, ctx.pl, ctx.fur['footprints']
    bench_replace(ctx)
    # lilac panels behind the two waiting alcoves (kept clear of the procedural door name plates beside the doors), a directory and a clock
    tint_panel(geo, True, -1.9, +1, -36.6, -30.4)
    tint_panel(geo, True, 1.9, -1, -31.1, -27.7)
    fu.directory_sign(geo, True, -1.9 + 0.012, +1, -35.2 + 0.2, y0=1.2, width=1.7, height=1.0, colours=(4, 4, 4, 4, 4))
    if kpatient:
        kpatient.wall_clock(geo, Frame(-29.4, 1.9 - 0.012, math.pi), y=2.25)
    # the oak slat wall behind the booking desk with the department's purple sign
    fu.slat_wall(geo, True, 1.9, -1, -39.9, -36.55, 0.0, CH)
    fu.door_sign(geo, True, 1.9 - 0.046, -1, -38.2, y0=2.2, colour=4, width=1.9, height=0.32)
    b = fp['imaging:booking']
    booking_desk(geo, b['x'], b['z'])
    # oak handrails on stand-offs along the free wall spans (above the bench backs, below the door plates)
    for along_x, face, into, a, b in ((True, -1.9, +1, -37.35, -30.25), (True, -1.9, +1, -28.55, -22.15), (True, 1.9, -1, -34.65, -33.35),
                                      (True, 1.9, -1, -31.85, -27.55), (True, 1.9, -1, -25.6, -23.4)):
        karch.handrail(geo, along_x, face, into, a, b)
    # door-head signs in imaging purple over every corridor door, on the corridor face
    for did in ('mriControl', 'ctControl', 'xray', 'ultrasound', 'bloodDraw'):
        d = pl.door(did)
        into = +1 if d['z'] < 0 else -1
        fu.door_sign(geo, True, d['z'] + into * FACE, into, d['x'], y0=pl.DOOR_H + 0.16, colour=4, width=d['width'] - 0.15)
    # planters (the lobby's fiddle-leaf figs) on the plant footprints, a low oak table with magazines on the table footprint
    for i, pid in enumerate(('imaging:plantNW', 'imaging:plantNE', 'imaging:plantSE')):
        p = fp[pid]
        fu.planter(geo, p['x'], p['z'], r=p['w'] / 2, seed=31 + i * 7)
    t = fp['imaging:sideTable']
    k = K(geo, t['x'], t['z'], 0.0)
    k.rbox('Oak', 0, 0.42, 0.0, t['w'], 0.03, t['d'], 0.015)
    for s in (-1, 1):
        k.box('Steel', s * (t['w'] / 2 - 0.05) - 0.01, 0.0, -t['d'] / 2 + 0.03, s * (t['w'] / 2 - 0.05) + 0.01, 0.42, t['d'] / 2 - 0.03)
        k.box('Steel', s * (t['w'] / 2 - 0.05) - 0.04, 0.0, -t['d'] / 2 + 0.03, s * (t['w'] / 2 - 0.05) + 0.04, 0.015, t['d'] / 2 - 0.03)
    for i, c in enumerate((12, 1, 11)):
        k.rbox(f'KitPlastic:{c}', -0.17 + i * 0.1, 0.45 + i * 0.006, 0.0, 0.2, 0.012, 0.28, 0.004)


# --- MRI control + room ---------------------------------------------------------------------------------------------------------------------------
def mri(ctx):
    geo, pl, fp = ctx.geo, ctx.pl, ctx.fur['footprints']
    # control room
    viewing_window(geo, pl, -39.9, -33.1)
    c = fp['imaging:mri:console']
    console_desk(geo, c['x'], c['z'], c['w'], c['d'], 0.0, keys=(-0.42, 0.42))
    l = fp['imaging:mri:lockers']
    lockers(geo, l['x'], l['z'], l['d'], math.pi / 2, d=l['w'])
    tint_panel(geo, True, -2.1, -1, -37.3, -31.1)
    # the RF door: stainless threshold, the warning lamp over it on the magnet-room side
    scanner_door(geo, pl, 'mriRoom', -1)
    # the magnet room: RF-shield cladding (modular panels, dark joints, stainless base and seam strips)
    rf_cladding(geo, False, -39.9, +1, -11.9, -4.6)
    rf_cladding(geo, True, -11.9, +1, -39.9, -31.1)
    rf_cladding(geo, False, -31.1, -1, -11.9, -4.6)
    cl = fp['imaging:mri:coils']
    coil_unit(geo, cl['x'], cl['z'], cl['w'], 0.0)
    cb = fp['imaging:mri:cabinet']
    tall_cabinet(geo, cb['x'], cb['z'], cb['w'], cb['d'], 0.0)


def rf_cladding(geo, along_x, face, into, a, b, y0=0.1, y1=2.55):
    """RF-shield cladding on one wall of the magnet room: pale blue-grey modular panels about 1.2 m wide with dark vertical joints, a stainless
    base strip and a stainless seam strip along the top (the shield's edge)."""
    L = b - a
    n = max(1, round(L / 1.22))
    bf = back_face(along_x, into)
    on_wall(geo, 'Stainless', along_x, face, into, a, b, 0.0, 0.03, GAP_H, y0, drop=(bf, 'down'))
    on_wall(geo, BLUE, along_x, face, into, a, b, 0.0, 0.02, y0, y1, drop=(bf, 'down', 'up'))
    for i in range(1, n):
        t = a + L * i / n
        on_wall(geo, 'ShadowGap', along_x, face, into, t - 0.005, t + 0.005, 0.0, 0.022, y0, y1, drop=(bf, 'down', 'up'))
    on_wall(geo, 'Stainless', along_x, face, into, a, b, 0.0, 0.03, y1, y1 + 0.05, drop=(bf,))


# --- CT control + room ------------------------------------------------------------------------------------------------------------------------------
def ct(ctx):
    geo, pl, fp = ctx.geo, ctx.pl, ctx.fur['footprints']
    viewing_window(geo, pl, -31.7, -24.4)
    viewing_window(geo, pl, -22.8, -22.1)
    c = fp['imaging:ct:console']
    console_desk(geo, c['x'], c['z'], c['w'], c['d'], 0.0, keys=(-0.42, 0.42))
    p = fp['imaging:ct:cabinet']
    printer_unit(geo, p['x'], p['z'], math.pi, w=p['w'], d=p['d'])
    tint_panel(geo, True, -2.1, -1, -28.5, -22.1)
    scanner_door(geo, pl, 'ctRoom', -1)
    # the CT room: a lilac wall behind the lead aprons and the supplies cabinet
    tint_panel(geo, True, -11.9, +1, -30.9, -22.1)
    a = fp['imaging:ct:aprons']
    apron_rack(geo, a['x'], a['z'], a['w'], 0.0)
    s = fp['imaging:ct:supplies']
    tall_cabinet(geo, s['x'], s['z'], s['w'], s['d'], 0.0, kind='glass')


# --- X-ray ---------------------------------------------------------------------------------------------------------------------------------------------
def xray(ctx):
    geo, pl, fp = ctx.geo, ctx.pl, ctx.fur['footprints']
    scanner_door(geo, pl, 'xray', +1)
    # the lead-glass screen across the booth: a lead-lined white lower panel with a graphite plinth, glass above in a graphite frame
    s = fp['imaging:xray:screen']
    px, pz, pw = s['x'], s['z'], s['w']
    geo.box('Steel', px - pw / 2, 0.0, pz - 0.035, px + pw / 2, 0.06, pz + 0.035)
    geo.box('SolidSurface', px - pw / 2, 0.06, pz - 0.04, px + pw / 2, 1.0, pz + 0.04)
    geo.box('Mullion', px - pw / 2, 1.0, pz - 0.035, px + pw / 2, 1.045, pz + 0.035)
    geo.box('Glass', px - pw / 2 + 0.05, 1.045, pz - 0.006, px + pw / 2 - 0.05, 1.93, pz + 0.006)
    geo.box('Mullion', px - pw / 2, 1.93, pz - 0.035, px + pw / 2, 1.98, pz + 0.035)
    for e in (-1, 1):
        geo.box('Mullion', px + e * (pw / 2 - 0.025) - 0.025, 1.045, pz - 0.035, px + e * (pw / 2 - 0.025) + 0.025, 1.93, pz + 0.035)
    geo.box('Mullion', px - 0.025, 1.045, pz - 0.03, px + 0.025, 1.93, pz + 0.03)
    # the exposure desk, the operator on its north side
    c = fp['imaging:xray:console']
    console_desk(geo, c['x'], c['z'], c['w'], c['d'], math.pi, keys=(0.0,), pedestals=False)
    st = fp['imaging:xray:stool']
    stool(geo, st['x'], st['z'], 0.57)
    # the east wall: lilac behind the apron rack and the cabinet
    tint_panel(geo, False, -34.1, -1, 2.9, 11.9)
    a = fp['imaging:xray:aprons']
    apron_rack(geo, a['x'], a['z'], a['w'], a['rotationY'])
    cb = fp['imaging:xray:cabinet']
    tall_cabinet(geo, cb['x'], cb['z'], cb['w'], cb['d'], cb['rotationY'])


# --- ultrasound ----------------------------------------------------------------------------------------------------------------------------------------
def ultrasound(ctx):
    geo, pl, fp = ctx.geo, ctx.pl, ctx.fur['footprints']
    c = fp['imaging:us:couch']
    couch(geo, c['x'], c['z'])
    st = fp['imaging:us:stool']
    stool(geo, st['x'], st['z'], 0.55)
    s = fp['imaging:us:counter']
    hand_wash(geo, -33.9, s['z'] + 0.35, math.pi / 2)
    cb = fp['imaging:us:cabinet']
    tall_cabinet(geo, cb['x'], cb['z'], cb['w'], cb['d'], cb['rotationY'])
    # a lilac wall behind the couch (the south wall)
    tint_panel(geo, True, 11.9, -1, -33.9, -28.1)


# --- blood-draw centre ---------------------------------------------------------------------------------------------------------------------------------
def draw_centre(ctx):
    geo, pl, fp = ctx.geo, ctx.pl, ctx.fur['footprints']
    s = fp['imaging:sink']
    hand_wash(geo, -27.9, s['z'] + 0.45, math.pi / 2)
    # the changing cubicles: they stood against the glass wall onto the core. A lilac wall behind them, an oak bench, hooks and a mirror in each
    on_wall(geo, LILAC, False, -22.15, +1, 3.9, 8.1, 0.0, 0.15, 0.0, CH, drop=('x1', 'down', 'up'))
    for i in range(3):
        b = fp[f'imaging:cubicles:bench{i}']
        zc = b['z']
        k = K(geo, b['x'], zc, 0.0)
        k.rbox('Oak', 0, 0.42, 0.0, b['w'], 0.035, b['d'] - 0.04, 0.012)
        for sgn in (-1, 1):
            k.box('Steel', -b['w'] / 2 + 0.03, 0.0, sgn * 0.38 - 0.015, b['w'] / 2 - 0.03, 0.42, sgn * 0.38 + 0.015)
        k.box('Stainless', 0.12, 1.5, -0.45, 0.15, 1.53, 0.45)          # the hook rail, on the lilac wall (local x 0.15 = the wall)
        for j in range(4):
            k.box('Stainless', 0.09, 1.53, -0.4 + j * 0.27 - 0.01, 0.15, 1.56, -0.4 + j * 0.27 + 0.01)
    # the robots' wall (south) and the check-in side (north, beside the door): lilac
    tint_panel(geo, True, 11.9, -1, -27.9, -22.1)
    tint_panel(geo, True, 2.1, +1, -25.5, -22.1)


def seating(ctx):
    """The last procedural furniture of the department, baked so it sits in the room's light: the MRI and CT operators' chairs on their
    console seats, the blood-draw centre's three phlebotomy chairs on their seats (facing the robots), the changing cubicles' partitions
    on their footprints (white compact-laminate panels on stainless posts, raised off the floor like real cubicle systems)."""
    if ksupport is None:
        return
    geo, fp = ctx.geo, ctx.fur['footprints']
    seats = {s['id']: s for s in ctx.fur['seats']}
    for sid in ('console:mri', 'console:ct'):
        s = seats.get(sid)
        if s:
            ksupport.pedestal_chair(geo, Frame(s['x'], s['z'], s['heading']), s['height'], back=(s['height'] + 0.05, s['height'] + 0.52),
                                    mat='VinylGrey', base_r=0.25)
    for i in range(3):
        s = seats.get(f'drawChair:robot:{i}')
        if s:
            ksupport.pedestal_chair(geo, Frame(s['x'], s['z'], s['heading']), s['height'], back=(s['height'] + 0.03, s['height'] + 0.55),
                                    mat='VinylTeal', base_r=0.23, arm_h=0.13, lean=8.0)
    for i in range(4):
        p = fp.get(f'imaging:cubicles:part{i}')
        if not p:
            continue
        x0, x1, z = p['x'] - p['w'] / 2, p['x'] + p['w'] / 2, p['z']
        geo.box('SolidSurface', x0 + 0.03, 0.15, z - 0.0125, x1, 1.95, z + 0.0125)
        geo.box('Stainless', x0, 0.0, z - 0.02, x0 + 0.035, 1.98, z + 0.02)
        geo.box('Stainless', x0 - 0.015, 0.0, z - 0.035, x0 + 0.05, 0.02, z + 0.035)
        for y in (0.4, 1.7):
            geo.box('Stainless', x1 - 0.03, y, z - 0.03, x1, y + 0.05, z + 0.03)


# --- entry ---------------------------------------------------------------------------------------------------------------------------------------------
def build(ctx):
    geo, pl = ctx.geo, ctx.pl
    hall_ceiling(geo)
    mri_ceiling(geo, pl)
    hall(ctx)
    mri(ctx)
    ct(ctx)
    xray(ctx)
    ultrasound(ctx)
    draw_centre(ctx)
    seating(ctx)
