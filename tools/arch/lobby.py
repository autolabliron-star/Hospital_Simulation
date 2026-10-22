"""
The hero space: the entrance lobby (x -62..-44, z -6..6, ceiling 3.0 m) and the spine it opens into, designed "clean clinical modern":
light terrazzo, white walls with a shadow-gap skirting, a smooth plaster ceiling with recessed linear LED slots and a few downlights, a full-height
glazed curtain wall on the west façade around the automatic entrance, one light-oak slat feature wall behind reception, a long white solid-surface
reception desk with an oak top, modular upholstered benches on the sim's seat rows, concrete planters with fiddle-leaf figs, a side table and
restrained wayfinding in the floor lines' colours (door frames, a directory panel).

Every piece of furniture stands on the procedural layout's anchors (plan.json `furniture`), so the sim's seat points and collision stay true.
"""
import math

import furniture as fu
from common import Frame
from shell import glazing_spans, line_box

LOBBY = (-62.0, -44.0, -6.0, 6.0)
SPINE = (-44.0, -40.0, -16.0, 16.0)
CH = 3.0

# accent swatches (materials.json Accent.palette): 0 ward A blue, 1 ward B green, 2 emergency red, 3 atrium orange, 4 diagnostics purple, 5 text grey
DOOR_ACCENT = {'triage': 'Accent:2', 'er': 'Accent:2', 'imaging': 'Accent:4'}

# downlights (plan x, z): wall washers over the benches and the oak wall, a pair at the reception
DOWNLIGHTS = [(x, -5.45) for x in (-60.6, -58.6, -56.6, -54.6, -52.6)] + [(x, 5.45) for x in (-60.6, -58.6, -56.6)] + \
             [(-47.0, -5.45), (-47.0, 5.45), (-45.6, 0.0 - 3.6), (-45.6, 3.6)]


def in_lobby_facade(w, a, b):
    """True for a glazing span of the west façade inside the lobby: the hero curtain wall replaces the ribbon glazing there."""
    return (not w['alongX']) and abs(w['c'] + 62.0) < 1e-6 and a >= LOBBY[2] - 0.2 and b <= LOBBY[3] + 0.2


def door_accent(d):
    return DOOR_ACCENT.get(d['id'])


def ceiling(geo):
    """Smooth plaster ceilings with recessed 50 mm LED slots (lobby: three running east-west; spine: one north-south) and a plaster bulkhead
    marking the lobby / spine threshold. The slab strips leave the slot open; the diffuser sits 20 mm up in it."""
    x0, x1, z0, z1 = LOBBY
    # a 20 mm shadow gap where the ceiling meets the walls and the glazing (the slab stops short, a dark recess 30 mm up)
    G = 0.02
    face = 0.1
    x0, z0, z1 = x0 + face + G, z0 + face + G, z1 - face - G
    for (a0, b0, a1, b1) in ((x0 - G, z0 - G, x1, z0), (x0 - G, z1, x1, z1 + G), (x0 - G, z0, x0, z1)):
        geo.box('ShadowGap', a0, CH + 0.03, b0, a1, CH + 0.05, b1, drop=('up',))
    slots = [-3.0, 0.0, 3.0]
    sx0, sx1 = -61.0, -45.0
    hw = 0.025
    edges = [z0] + [v for s in slots for v in (s - hw, s + hw)] + [z1]
    for i in range(0, len(edges), 2):
        geo.box('CeilingPlaster', x0, CH, edges[i], x1, CH + 0.05, edges[i + 1], drop=('up',))
    for s in slots:
        geo.box('CeilingPlaster', x0, CH, s - hw, sx0, CH + 0.05, s + hw, drop=('up',))
        geo.box('CeilingPlaster', sx1, CH, s - hw, x1, CH + 0.05, s + hw, drop=('up',))
        geo.box('LEDLine', sx0, CH + 0.02, s - hw, sx1, CH + 0.025, s + hw, drop=('up',))
    # spine
    X0, X1, Z0, Z1 = SPINE
    X0, X1, Z0, Z1 = X0 + face + G, X1 - face - G, Z0 + face + G, Z1 - face - G
    for (a0, b0, a1, b1) in ((X1, Z0 - G, X1 + G, Z1 + G), (X0 - G, Z0 - G, X1, Z0), (X0 - G, Z1, X1, Z1 + G), (X0 - G, Z0, X0, -6.0), (X0 - G, 6.0, X0, Z1)):
        geo.box('ShadowGap', a0, CH + 0.03, b0, a1, CH + 0.05, b1, drop=('up',))
    # the lobby slab runs on under the bulkhead to meet the spine's
    geo.box('CeilingPlaster', -44.0, CH, -6.0, X0, CH + 0.05, 6.0, drop=('up',))
    sc = -42.0
    sz0, sz1 = -15.2, 15.2
    geo.box('CeilingPlaster', X0, CH, Z0, sc - hw, CH + 0.05, Z1, drop=('up',))
    geo.box('CeilingPlaster', sc + hw, CH, Z0, X1, CH + 0.05, Z1, drop=('up',))
    geo.box('CeilingPlaster', sc - hw, CH, Z0, sc + hw, CH + 0.05, sz0, drop=('up',))
    geo.box('CeilingPlaster', sc - hw, CH, sz1, sc + hw, CH + 0.05, Z1, drop=('up',))
    geo.box('LEDLine', sc - hw, CH + 0.02, sz0, sc + hw, CH + 0.025, sz1, drop=('up',))
    # the bulkhead over the 12 m opening between lobby and spine
    geo.box('CeilingPlaster', -44.25, CH - 0.32, -6.0, -43.75, CH, 6.0, drop=('up',))
    # downlights: a white trim ring and the emitting lens
    w = Frame(0, 0)
    for (x, z) in DOWNLIGHTS:
        geo.ring(w, 'SolidSurface', x, CH - 0.002, z, 0.045, 0.06, seg=24)
        geo.disc(w, 'LEDLine', x, CH - 0.001, z, 0.045, seg=24)
    services(geo)


def services(geo):
    """What every real ceiling carries: concealed sprinkler cover plates on a 3 m grid, smoke detectors, and linear slot air diffusers
    along the glazing."""
    w = Frame(0, 0)
    for x in (-60.0, -57.0, -54.0, -51.0, -48.0, -45.2):
        for z in (-4.5, -1.5, 1.5, 4.5):
            geo.cyl(w, 'SolidSurface', x, CH - 0.004, z, 0.034, 0.004, seg=16, bottom=True, top=False)
    for z in (-12.0, -6.0, 6.0, 12.0):
        geo.cyl(w, 'SolidSurface', -41.2, CH - 0.004, z, 0.034, 0.004, seg=16, bottom=True, top=False)
    for (x, z) in ((-57.5, -1.5), (-49.5, 1.5), (-42.8, -9.0), (-42.8, 9.0)):
        geo.cyl(w, 'SolidSurface', x, CH - 0.04, z, 0.055, 0.04, seg=24, top=False)
        geo.cyl(w, 'SolidSurface', x, CH - 0.046, z, 0.03, 0.006, seg=16, top=False)
    for z0, z1 in ((-5.4, -2.1), (2.1, 5.4)):
        x = -61.35
        geo.box('SolidSurface', x - 0.05, CH - 0.003, z0, x + 0.05, CH, z1, drop=('up',))
        for dx in (-0.018, 0.018):
            geo.box('ShadowGap', x + dx - 0.007, CH - 0.004, z0 + 0.02, x + dx + 0.007, CH - 0.003, z1 - 0.02, drop=('up',))


def curtain_wall(geo, pl):
    """The west façade of the lobby: full-height glazing with deep slim mullions, a transom at door height, and the automatic entrance's frame."""
    H = CH
    T = pl.T
    for w in pl.walls():
        if w['cls'] != 'glassCut':
            continue
        for a, b in glazing_spans(pl, w):
            if not in_lobby_facade(w, a, b):
                continue
            line_box(geo, 'Mullion', w, a, b, 0.0, 0.06, 0.16)              # sill profile
            line_box(geo, 'Mullion', w, a, b, H - 0.06, H + 0.06, 0.16)     # head (up past the ceiling's shadow gap)
            line_box(geo, 'Mullion', w, a, b, pl.DOOR_H, pl.DOOR_H + 0.05, 0.12)   # transom
            line_box(geo, 'Glass', w, a, b, 0.06, H - 0.06, 0.012)
            n = max(1, round((b - a) / 1.5))
            for k in range(n + 1):
                t = a + (b - a) * k / n
                line_box(geo, 'Mullion', w, max(a, t - 0.025), min(b, t + 0.025), 0.06, H - 0.06, 0.16)
    # the entrance: heavy jambs on the opening's edges, a header with the door operator, glass and a mullion above
    d = pl.door('entrance')
    h = d['width'] / 2
    w = {'alongX': False, 'c': d['x']}
    for s in (-1, 1):
        e = d['z'] + s * h
        lo_, hi_ = sorted((e - s * 0.04, e + s * 0.06))
        line_box(geo, 'Mullion', w, lo_, hi_, 0.0, H, 0.18)
    line_box(geo, 'Mullion', w, d['z'] - h - 0.04, d['z'] + h + 0.04, pl.DOOR_H, pl.DOOR_H + 0.16, 0.22)
    line_box(geo, 'Mullion', w, d['z'] - h, d['z'] + h, H - 0.06, H + 0.06, 0.16)
    line_box(geo, 'Glass', w, d['z'] - h, d['z'] + h, pl.DOOR_H + 0.16, H - 0.06, 0.012)
    line_box(geo, 'Mullion', w, d['z'] - 0.025, d['z'] + 0.025, pl.DOOR_H + 0.16, H - 0.06, 0.12)
    # floor track of the sliding doors, and a recessed entrance matting well inside them
    line_box(geo, 'Steel', w, d['z'] - h, d['z'] + h, 0.0, 0.004, 0.2)
    geo.box('Steel', d['x'] + T / 2 + 0.1, -0.01, d['z'] - h - 0.3, d['x'] + T / 2 + 2.6, 0.001, d['z'] + h + 0.3, drop=('down',))
    geo.box('Matting', d['x'] + T / 2 + 0.115, -0.01, d['z'] - h - 0.285, d['x'] + T / 2 + 2.585, 0.002, d['z'] + h + 0.285, drop=('down',))
    # outside: a slim white canopy on two columns over the entrance, with two downlights
    geo.box('WallPaint', -64.8, H + 0.1, -2.6, -62.1, H + 0.32, 2.6)
    for z in (-2.35, 2.35):
        geo.cyl(Frame(-64.5, z), 'Steel', 0, 0, 0, 0.05, H + 0.1, seg=16, top=False, bottom=False)
    for z in (-1.2, 1.2):
        geo.disc(Frame(0, 0), 'LightPanel', -63.5, H + 0.098, z, 0.05, seg=16)


def furniture(geo, plan):
    fur = plan['furniture']
    fp = {f['id']: f for f in fur['footprints']}
    seats = {s['id']: s for s in fur['seats']}
    # reception: the station footprint is 3.0 x 1.6, centred 0.48 m in front of the receptionist's spot
    rec = fp['lobby:reception']
    h = rec['rotationY']
    rx = rec['x'] - math.sin(h) * 0.48
    rz = rec['z'] - math.cos(h) * 0.48
    fu.reception_desk(geo, Frame(rx, rz, h), length=rec['w'])
    # benches on the seat rows (the 3-seat rows in the accent fabric)
    for rid, fabric in (('lobby:seatsN1', 'Fabric'), ('lobby:seatsN2', 'FabricAccent'), ('lobby:seatsS1', 'Fabric'), ('lobby:seatsS2', 'FabricAccent')):
        r = fp[rid]
        row = rid.split('seats')[1]
        group = 'triage' if row.startswith('N') else 'er'
        mine = sorted((s for s in seats.values() if s['id'].startswith(f'waiting:{group}:{row}:')), key=lambda s: s['id'])
        n = len(mine)
        pitch = r['w'] / n
        fu.bench_row(geo, Frame(r['x'], r['z'], r['rotationY']), n, pitch, fabric, seat_h=mine[0]['height'])
    for i, pid in enumerate(('lobby:plantNW', 'lobby:plantSW')):
        p = fp[pid]
        fu.planter(geo, p['x'], p['z'], r=p['w'] / 2, seed=11 + i * 7)
    t = fp['lobby:sideTable']
    fu.side_table(geo, t['x'], t['z'], r=t['w'] / 2 - 0.01)


def feature_wall(geo, pl):
    """Light-oak vertical slats on the north wall behind the reception, from the waiting bench to the triage door's architrave."""
    tri = pl.door('triage')
    face = tri['z'] + pl.T / 2
    fu.slat_wall(geo, True, face, +1, -56.3, tri['x'] - tri['width'] / 2 - 0.09, 0.0, CH)


def wayfinding(geo, pl):
    """A directory on the spine's east wall, north of the imaging door, facing the entrance; a door-head sign over the triage and ER doors."""
    d = pl.door('imaging')
    face = d['x'] - pl.T / 2
    fu.directory_sign(geo, False, face, -1, -3.6, y0=1.0, width=1.6, height=1.05, colours=(0, 3, 4, 1, 2))
    for did, into in (('triage', +1), ('er', -1)):
        d = pl.door(did)
        face = d['z'] + into * pl.T / 2
        fu.door_sign(geo, True, face, into, d['x'], y0=pl.DOOR_H + 0.16, colour=2)
        # a hand-rub dispenser beside each clinical door
        fu.dispenser(geo, True, face, into, d['x'] + d['width'] / 2 + 0.45)
    # the exit sign hung inside the entrance, facing into the lobby
    fu.exit_sign(geo, -60.9, -1.5)


def build(geo, pl, plan):
    ceiling(geo)
    curtain_wall(geo, pl)
    furniture(geo, plan)
    feature_wall(geo, pl)
    wayfinding(geo, pl)
