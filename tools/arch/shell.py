"""
The architecture of a region, TO the sim's floor plan (assets-src/arch/plan.json): floors, walls with a shadow-gap skirting, glazing, lintels,
door frames with real profiles, and the suspended tegular ceilings outside the hero spaces.

Coverage rule (shared with the runtime filter src/scene/building/model/region.ts): an area, a wall piece or a door is the model's when its CENTRE is
in the region, and it is then built WHOLE (never clipped), so the procedural building, which hides by the same centres, leaves no gap and no double.
"""
import math

from common import Frame, WORLD

# areas whose ceiling and floor the hero design (lobby.py) draws itself
HERO_CEILINGS = ('lobby', 'spine')
PUBLIC_FLOORS = ('lobby', 'spine', 'cafe')

GAP_H = 0.02      # shadow-gap skirting: height ...
GAP_D = 0.012     # ... and depth of the recess on each face


class Plan:
    def __init__(self, plan, region):
        self.plan = plan
        self.WALL = plan['wall']
        self.H = self.WALL['height']
        self.T = self.WALL['thickness']
        self.DOOR_H = self.WALL['doorHeight']
        self.rx0, self.rx1, self.rz0, self.rz1, self.level = region

    def covers(self, x, z):
        return self.rx0 <= x <= self.rx1 and self.rz0 <= z <= self.rz1

    def areas(self):
        for a in self.plan['areas']:
            r = a['rect']
            if a['level'] == self.level and self.covers((r['x0'] + r['x1']) / 2, (r['z0'] + r['z1']) / 2):
                yield a

    def area(self, aid):
        return next(a for a in self.plan['areas'] if a['id'] == aid)

    def walls(self):
        for w in self.plan['walls']:
            if w['level'] != self.level or w['cls'] == 'skip':
                continue
            mx, mz = ((w['a'] + w['b']) / 2, w['c']) if w['alongX'] else (w['c'], (w['a'] + w['b']) / 2)
            if self.covers(mx, mz):
                yield w

    def doors(self):
        for d in self.plan['doors']:
            if d['level'] == self.level and self.covers(d['x'], d['z']):
                yield d

    def door(self, did):
        return next(d for d in self.plan['doors'] if d['id'] == did)


def line_box(geo, mat, w, a, b, y0, y1, across, offset=0.0, drop=()):
    """A box on a wall line (along a..b), `across` thick, centred `offset` off the line."""
    c = w['c'] + offset
    if w['alongX']:
        geo.box(mat, a, y0, c - across / 2, b, y1, c + across / 2, drop)
    else:
        geo.box(mat, c - across / 2, y0, a, c + across / 2, y1, b, drop)


def floors(geo, pl):
    for a in pl.areas():
        r = a['rect']
        mat = 'Terrazzo' if a['id'] in PUBLIC_FLOORS else 'Vinyl'
        geo.box(mat, r['x0'], -0.05, r['z0'], r['x1'], 0.0, r['z1'], drop=('down',))


def solid_wall(geo, pl, w):
    T = pl.T
    a = w['a'] - (0 if w['cutA'] else T / 2)
    b = w['b'] + (0 if w['cutB'] else T / 2)
    line_box(geo, 'WallPaint', w, a, b, GAP_H, pl.H, T, drop=('up',))
    line_box(geo, 'ShadowGap', w, a, b, 0.0, GAP_H, T - 2 * GAP_D, drop=('up', 'down'))


def breaks_of(pl, w):
    out = set()
    for q in pl.plan['walls']:
        if q['level'] != pl.level or q['alongX'] == w['alongX'] or q['cls'] == 'skip':
            continue
        touches = abs(q['a'] - w['c']) < 0.011 or abs(q['b'] - w['c']) < 0.011
        if touches and w['a'] + 0.05 < q['c'] < w['b'] - 0.05:
            out.add(q['c'])
    return sorted(out)


def glazing_spans(pl, w):
    """The runs of an outer glazing piece between the partitions meeting it (the same as layout/shell.ts glazingSpans)."""
    T = pl.T
    a = w['a'] + (0 if w['cutA'] else T / 2)
    b = w['b'] - (0 if w['cutB'] else T / 2)
    stops = [a]
    for t in breaks_of(pl, w):
        stops += [t - T / 2, t + T / 2]
    stops.append(b)
    return [(stops[i], stops[i + 1]) for i in range(0, len(stops) - 1, 2) if stops[i + 1] - stops[i] >= 0.3]


def ribbon_glazing(geo, pl, w, a, b, sill=0.9):
    """Outer-shell glazing outside the hero space: a painted sill wall, glass to the ceiling, slim mullions on the procedural panel rhythm."""
    T = pl.T
    H = pl.H
    line_box(geo, 'WallPaint', w, a, b, GAP_H, sill, T, drop=())
    line_box(geo, 'ShadowGap', w, a, b, 0.0, GAP_H, T - 2 * GAP_D, drop=('up', 'down'))
    line_box(geo, 'Mullion', w, a, b, sill, sill + 0.05, 0.1)
    line_box(geo, 'Mullion', w, a, b, H - 0.06, H, 0.1)
    line_box(geo, 'Glass', w, a, b, sill + 0.05, H - 0.06, 0.012)
    n = max(1, round((b - a) / 1.3))
    for k in range(n + 1):
        t = a + (b - a) * k / n
        line_box(geo, 'Mullion', w, max(a, t - 0.025), min(b, t + 0.025), sill + 0.05, H - 0.06, 0.1)


def glass_partition(geo, pl, w):
    """A full-height glass partition (the imaging suite): tall panels in a slim aluminium frame."""
    T = pl.T
    H = pl.H
    a = w['a'] + (0 if w['cutA'] else T / 2)
    b = w['b'] - (0 if w['cutB'] else T / 2)
    if b - a < 0.3:
        return
    line_box(geo, 'Mullion', w, a, b, 0.0, 0.1, 0.08)
    line_box(geo, 'Mullion', w, a, b, H - 0.05, H, 0.08)
    line_box(geo, 'Glass', w, a, b, 0.1, H - 0.05, 0.012)
    n = max(1, round((b - a) / 2.2))
    for k in range(n + 1):
        t = a + (b - a) * k / n
        line_box(geo, 'Mullion', w, max(a, t - 0.025), min(b, t + 0.025), 0.1, H - 0.05, 0.07)


def walls(geo, pl, skip=None):
    """Every covered wall piece; `skip(w, a, b)` returns True for a glazing span the hero design draws itself."""
    for w in pl.walls():
        if w['cls'] == 'solid':
            solid_wall(geo, pl, w)
        elif w['cls'] == 'glassCut':
            for a, b in glazing_spans(pl, w):
                if skip and skip(w, a, b):
                    continue
                ribbon_glazing(geo, pl, w, a, b)
        elif w['cls'] == 'glassFull':
            glass_partition(geo, pl, w)


def door_frame(geo, pl, d, mat='DoorFrame'):
    """A real door frame: a lining across the wall (centred on the opening's edge like the procedural jambs, so the procedural leaves fit),
    an architrave on both faces, the head, and a slim stop."""
    T = pl.T
    DH = pl.DOOR_H
    h = d['width'] / 2
    along_x = d['wallAxis'] == 'x'
    c = d['z'] if along_x else d['x']
    mid = d['x'] if along_x else d['z']
    w = {'alongX': along_x, 'c': c}
    lin = T + 0.008          # the lining is just proud of both wall faces
    arc = 0.012              # architrave thickness, proud of the lining
    for s in (-1, 1):
        e = mid + s * h
        a, b = sorted((e - s * 0.035, e + s * 0.035))
        line_box(geo, mat, w, a, b, 0.0, DH + 0.035, lin)
        # architraves: 70 mm wide, on both faces, reaching out over the wall
        a2, b2 = sorted((e - s * 0.035, e + s * 0.075))
        for side in (-1, 1):
            line_box(geo, mat, w, a2, b2, 0.0, DH + 0.075, arc, offset=side * (lin / 2 + arc / 2))
        # a stop: 15 mm proud of the lining into the opening, 40 mm wide, mid wall
        a3, b3 = sorted((e - s * 0.035, e - s * 0.05))
        line_box(geo, mat, w, a3, b3, 0.0, DH, 0.04)
    line_box(geo, mat, w, mid - h - 0.035, mid + h + 0.035, DH, DH + 0.035, lin)
    for side in (-1, 1):
        line_box(geo, mat, w, mid - h - 0.075, mid + h + 0.075, DH + 0.035, DH + 0.075, arc, offset=side * (lin / 2 + arc / 2))


def doors(geo, pl, frame_mat=None, skip=()):
    """Lintels over every covered door with a leaf (a wall from the door head to the ceiling), and its frame."""
    T = pl.T
    for d in pl.doors():
        if d['kind'] in ('opening', 'counter') or d['id'] in skip:
            continue
        h = d['width'] / 2
        along_x = d['wallAxis'] == 'x'
        w = {'alongX': along_x, 'c': d['z'] if along_x else d['x']}
        mid = d['x'] if along_x else d['z']
        line_box(geo, 'WallPaint', w, mid - h - 0.02, mid + h + 0.02, pl.DOOR_H, pl.H, T, drop=('up',))
        door_frame(geo, pl, d, (frame_mat(d) if frame_mat else None) or 'DoorFrame')


def grid_ceiling(geo, a, ch):
    """A 600 mm tegular lay-in ceiling: the grid as a recessed plane, tiles 8 mm below it with a 24 mm reveal, a 600 x 1200 LED panel every
    2.4 m (the procedural rhythm), the border tiles cut equally on both sides as a ceiling fixer would."""
    r = a['rect']
    x0, x1, z0, z1 = r['x0'], r['x1'], r['z0'], r['z1']
    geo.box('CeilingGrid', x0, ch, z0, x1, ch + 0.03, z1, drop=('up',))
    m = 0.6
    nx = int(math.floor((x1 - x0) / m))
    nz = int(math.floor((z1 - z0) / m))
    ox = x0 + ((x1 - x0) - nx * m) / 2
    oz = z0 + ((z1 - z0) - nz * m) / 2
    xs = [x0] + [ox + i * m for i in range(nx + 1)] + [x1]
    zs = [z0] + [oz + i * m for i in range(nz + 1)] + [z1]
    xs = sorted(set(round(v, 4) for v in xs))
    zs = sorted(set(round(v, 4) for v in zs))
    g = 0.012
    panels = set()
    # panels: every 4th column, every 4th row pair (0.6 x 1.2), away from the border
    for i in range(2, len(xs) - 3, 4):
        for j in range(2, len(zs) - 4, 4):
            panels.add((i, j))
            panels.add((i, j + 1))
            geo.box('LightPanel', xs[i] + g, ch - 0.01, zs[j] + g, xs[i + 1] - g, ch, zs[j + 2] - g, drop=('up',))
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            if (i, j) in panels:
                continue
            ax0, ax1, az0, az1 = xs[i], xs[i + 1], zs[j], zs[j + 1]
            if ax1 - ax0 < 0.05 or az1 - az0 < 0.05:
                continue
            geo.box('CeilingTile', ax0 + g, ch - 0.008, az0 + g, ax1 - g, ch + 0.012, az1 - g, drop=('up',))


def ceilings(geo, pl):
    for a in pl.areas():
        if a['id'] in HERO_CEILINGS or a['ceiling'] is None:
            continue
        grid_ceiling(geo, a, a['ceiling'])


def paving(geo, pl):
    """Outside, in front of the west façade: stone paving."""
    geo.box('Paving', pl.rx0 - 14, -0.06, pl.rz0 - 8, -62.0 - pl.T / 2, -0.01, pl.rz1 + 8, drop=('down',))
