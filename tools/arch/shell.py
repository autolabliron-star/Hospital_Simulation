"""
The architecture of a zone, TO the sim's floor plan (assets-src/arch/plan.json): floors, walls with a shadow-gap skirting, glazing, lintels,
door frames with real profiles, and the suspended tegular ceilings outside the hero spaces; plus the never-exported context a bake needs
(stand-ins for the zones not built, the roof slabs, the façade fascia over the ceilings, the lawn).

Coverage rule (zone rollout, computed once in tools/arch/export-plan.ts and written into plan.json as `zone` fields): an area belongs to the zone
that lists it in tools/arch/zones.json; a wall piece or a door to the first listed zone of its level whose rects contain its CENTRE; a span of
outer glazing (`glassCut` pieces are split at the partitions meeting them, plan.json `spans`) to the zone containing the span's centre. Every
piece is built WHOLE by its owner (never clipped), so the procedural building, hiding by the same rule, leaves no gap and no double.

All y here are relative to the zone's level floor; `Geo(y0=level y)` lifts level 2 on finalize.
"""
import math

import materials as _mt
from common import Frame, WORLD


def R(role, default):
    """The material of a building role (materials.json `roles`), or `default` when the library has no such role."""
    try:
        return _mt.role(role)
    except Exception:      # noqa: BLE001
        return default


# floors in the public spaces are role floor.public (terrazzo), elsewhere floor.clinical, unless a design module says otherwise (FLOORS)
PUBLIC_FLOORS = ('lobby', 'spine', 'cafe')

GAP_H = 0.02      # shadow-gap skirting: height ...
GAP_D = 0.012     # ... and depth of the recess on each face

# context (never exported): the top of each level's roof slab above its floor, and the slab's depth
ROOF_TOP = {1: 4.1, 2: 3.6}
ROOF_D = 0.2


class Plan:
    """The plan seen from one zone: its areas, wall pieces, glazing spans and doors (by the plan's `zone` fields), its level and level height.
    A design module tunes it before the shell is built: `hero` rects (walls bounding them get the hero `WallPaint`), `own_ceilings` (areas whose
    ceiling the design draws itself), `floors` (area id -> floor material)."""

    def __init__(self, plan, zones, zid):
        self.plan = plan
        self.zones = zones
        self.zone = next(z for z in zones if z['id'] == zid)
        self.id = zid
        self.WALL = plan['wall']
        self.H = self.WALL['height']
        self.T = self.WALL['thickness']
        self.DOOR_H = self.WALL['doorHeight']
        self.level = self.zone['level']
        self.level_y = next(lv['y'] for lv in plan['levels'] if lv['id'] == self.level)
        self.rects = [(r['x0'], r['x1'], r['z0'], r['z1']) for r in self.zone['rects']]
        self.rx0 = min(r[0] for r in self.rects)
        self.rx1 = max(r[1] for r in self.rects)
        self.rz0 = min(r[2] for r in self.rects)
        self.rz1 = max(r[3] for r in self.rects)
        self.hero = []          # rects (x0, x1, z0, z1) of the hero spaces
        self.own_ceilings = ()  # area ids whose ceiling the design draws
        self.floors = {}        # area id -> floor material

    def wall_mat(self, w):
        """'WallPaint' for the walls of the hero spaces (their own dense, clean lightmap), 'WallClinical' for the rest."""
        for (x0, x1, z0, z1) in self.hero:
            if w['alongX']:
                if z0 - 0.15 <= w['c'] <= z1 + 0.15 and min(w['b'], x1) - max(w['a'], x0) > 0.05:
                    return R('wall.hero', 'WallPaint')
            elif x0 - 0.15 <= w['c'] <= x1 + 0.15 and min(w['b'], z1) - max(w['a'], z0) > 0.05:
                return R('wall.hero', 'WallPaint')
        return R('wall', 'WallClinical')

    def floor_mat(self, aid):
        return self.floors.get(aid) or (R('floor.public', 'Terrazzo') if aid in PUBLIC_FLOORS else R('floor.clinical', 'Vinyl'))

    def covers(self, x, z):
        """True when (x, z) is inside one of the zone's rects (borders included)."""
        return any(x0 - 1e-6 <= x <= x1 + 1e-6 and z0 - 1e-6 <= z <= z1 + 1e-6 for (x0, x1, z0, z1) in self.rects)

    def areas(self):
        for a in self.plan['areas']:
            if a.get('zone') == self.id:
                yield a

    def area(self, aid):
        return next(a for a in self.plan['areas'] if a['id'] == aid)

    def spans(self, w):
        """The glazing spans of a glassCut piece that are this zone's."""
        return [(s['a'], s['b']) for s in w.get('spans', ()) if s['zone'] == self.id]

    def walls(self):
        for w in self.plan['walls']:
            if w['level'] != self.level or w['cls'] == 'skip':
                continue
            if w['cls'] == 'glassCut':
                if self.spans(w):
                    yield w
            elif w.get('zone') == self.id:
                yield w

    def doors(self):
        for d in self.plan['doors']:
            if d['level'] == self.level and d.get('zone') == self.id:
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
        mat = pl.floor_mat(a['id'])
        geo.box(mat, r['x0'], -0.05, r['z0'], r['x1'], 0.0, r['z1'], drop=('down',))


def solid_wall(geo, pl, w):
    T = pl.T
    # an un-cut end runs on into the crossing wall to fill the corner, stopping 3 mm short of its far face (no coplanar faces to flicker)
    a = w['a'] - (0 if w['cutA'] else T / 2 - 0.003)
    b = w['b'] + (0 if w['cutB'] else T / 2 - 0.003)
    # walls run 60 mm past the ceiling line, so the ceilings' perimeter shadow gaps look into the wall, not into the plenum
    line_box(geo, pl.wall_mat(w), w, a, b, GAP_H, pl.H + 0.06, T, drop=('up',))
    line_box(geo, R('wall.shadowGap', 'ShadowGap'), w, a, b, 0.0, GAP_H, T - 2 * GAP_D, drop=('up', 'down'))


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
    line_box(geo, pl.wall_mat(dict(w, a=a, b=b)), w, a, b, GAP_H, sill, T, drop=())
    line_box(geo, R('wall.shadowGap', 'ShadowGap'), w, a, b, 0.0, GAP_H, T - 2 * GAP_D, drop=('up', 'down'))
    line_box(geo, R('mullion', 'Mullion'), w, a, b, sill, sill + 0.05, 0.1)
    line_box(geo, R('mullion', 'Mullion'), w, a, b, H - 0.06, H, 0.1)
    line_box(geo, R('glass', 'Glass'), w, a, b, sill + 0.05, H - 0.06, 0.012)
    n = max(1, round((b - a) / 1.3))
    for k in range(n + 1):
        t = a + (b - a) * k / n
        line_box(geo, R('mullion', 'Mullion'), w, max(a, t - 0.025), min(b, t + 0.025), sill + 0.05, H - 0.06, 0.1)


def glass_partition(geo, pl, w):
    """A full-height glass partition (the imaging suite): tall panels in a slim aluminium frame."""
    T = pl.T
    H = pl.H
    a = w['a'] + (0 if w['cutA'] else T / 2)
    b = w['b'] - (0 if w['cutB'] else T / 2)
    if b - a < 0.3:
        return
    line_box(geo, R('mullion', 'Mullion'), w, a, b, 0.0, 0.1, 0.08)
    line_box(geo, R('mullion', 'Mullion'), w, a, b, H - 0.05, H, 0.08)
    line_box(geo, R('glass', 'Glass'), w, a, b, 0.1, H - 0.05, 0.012)
    n = max(1, round((b - a) / 2.2))
    for k in range(n + 1):
        t = a + (b - a) * k / n
        line_box(geo, R('mullion', 'Mullion'), w, max(a, t - 0.025), min(b, t + 0.025), 0.1, H - 0.05, 0.07)


def walls(geo, pl, skip=None):
    """Every covered wall piece; `skip(w, a, b)` returns True for a glazing span the hero design draws itself."""
    for w in pl.walls():
        if w['cls'] == 'solid':
            solid_wall(geo, pl, w)
        elif w['cls'] == 'glassCut':
            for a, b in pl.spans(w):
                if skip and skip(w, a, b):
                    continue
                ribbon_glazing(geo, pl, w, a, b)
        elif w['cls'] == 'glassFull':
            glass_partition(geo, pl, w)


def door_frame(geo, pl, d, lining=None, mat=None):
    """A real door frame: a lining across the wall (centred on the opening's edge like the procedural jambs, so the procedural leaves fit),
    an architrave on both faces, the head, and a slim stop. `lining` may be a wayfinding colour (the reveal), the architraves stay white."""
    T = pl.T
    DH = pl.DOOR_H
    mat = mat or R('door.frame', 'DoorFrame')
    lining = lining or mat
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
        line_box(geo, lining, w, a, b, 0.0, DH + 0.035, lin)
        # architraves: 70 mm wide, on both faces, reaching out over the wall
        a2, b2 = sorted((e - s * 0.035, e + s * 0.075))
        for side in (-1, 1):
            line_box(geo, mat, w, a2, b2, 0.0, DH + 0.075, arc, offset=side * (lin / 2 + arc / 2))
        # a stop: 15 mm proud of the lining into the opening, 40 mm wide, mid wall
        a3, b3 = sorted((e - s * 0.035, e - s * 0.05))
        line_box(geo, mat, w, a3, b3, 0.0, DH, 0.04)
    line_box(geo, lining, w, mid - h - 0.035, mid + h + 0.035, DH, DH + 0.035, lin)
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
        line_box(geo, pl.wall_mat(dict(w, a=mid - h, b=mid + h)), w, mid - h - 0.02, mid + h + 0.02, pl.DOOR_H, pl.H + 0.06, T, drop=('up',))
        door_frame(geo, pl, d, (frame_mat(d) if frame_mat else None) or None)


def grid_ceiling(geo, a, ch):
    """A 600 mm tegular lay-in ceiling: the grid as a recessed plane, tiles 8 mm below it with a 24 mm reveal, a 600 x 1200 LED panel every
    2.4 m (the procedural rhythm), the border tiles cut equally on both sides as a ceiling fixer would."""
    r = a['rect']
    x0, x1, z0, z1 = r['x0'], r['x1'], r['z0'], r['z1']
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
            geo.box(R('ceiling.lightPanel', 'LightPanel'), xs[i] + g, ch - 0.01, zs[j] + g, xs[i + 1] - g, ch, zs[j + 2] - g, drop=('up',))
    # the exposed T-bar flanges in the reveals (24 mm, 6 mm above the tile faces), and the perimeter angle
    for xv in xs[1:-1]:
        geo.box(R('ceiling.grid', 'CeilingGrid'), xv - g, ch - 0.002, z0, xv + g, ch + 0.012, z1, drop=('up',))
    for zv in zs[1:-1]:
        geo.box(R('ceiling.grid', 'CeilingGrid'), x0, ch - 0.0021, zv - g, x1, ch + 0.012, zv + g, drop=('up',))
    for (ax0, az0, ax1, az1) in ((x0, z0, x1, z0 + g), (x0, z1 - g, x1, z1), (x0, z0, x0 + g, z1), (x1 - g, z0, x1, z1)):
        geo.box(R('ceiling.grid', 'CeilingGrid'), ax0, ch - 0.002, az0, ax1, ch + 0.012, az1, drop=('up',))
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            if (i, j) in panels:
                continue
            ax0, ax1, az0, az1 = xs[i], xs[i + 1], zs[j], zs[j + 1]
            if ax1 - ax0 < 0.05 or az1 - az0 < 0.05:
                continue
            geo.box(R('ceiling.tile', 'CeilingTile'), ax0 + g, ch - 0.008, az0 + g, ax1 - g, ch + 0.012, az1 - g, drop=('up',))


def ceilings(geo, pl):
    for a in pl.areas():
        if a['id'] in pl.own_ceilings or a['ceiling'] is None:
            continue
        grid_ceiling(geo, a, a['ceiling'])


def paving(geo, x0, x1, z0, z1):
    """Outside: stone paving (the lobby's forecourt in front of the west façade)."""
    geo.box('Paving', x0, -0.06, z0, x1, -0.01, z1, drop=('down',))


# --- context (renders and bakes only, never exported) -------------------------------------------------------------------------------------------
def stand_ins(geo, plan, level, exclude):
    """Plain stand-ins for the walls, lintels, floors and ceilings of every zone NOT in `exclude` on `level` (y relative to that level), so
    no daylight leaks in where the rest of the building stands."""
    H = plan['wall']['height']
    T = plan['wall']['thickness']
    DOOR_H = plan['wall']['doorHeight']
    for w in plan['walls']:
        if w['level'] != level or w['cls'] == 'skip':
            continue
        a = w['a'] - (0 if w['cutA'] else T / 2)
        b = w['b'] + (0 if w['cutB'] else T / 2)
        if w['cls'] == 'solid':
            if w['zone'] not in exclude:
                line_box(geo, 'WallClinical', w, a, b, 0.0, H, T)
            continue
        if w['cls'] == 'glassCut':
            runs = [(s['a'], s['b']) for s in w['spans'] if s['zone'] not in exclude]
            for s0, s1 in runs:
                line_box(geo, 'WallClinical', w, s0, s1, 0.0, 0.9, T)
                line_box(geo, 'Glass', w, s0, s1, 0.9, H, 0.012)
        elif w['zone'] not in exclude:
            line_box(geo, 'Glass', w, a, b, 0.0, H, 0.012)
    for d in plan['doors']:
        if d['level'] != level or d['zone'] in exclude or d['kind'] in ('opening', 'counter'):
            continue
        h = d['width'] / 2
        along_x = d['wallAxis'] == 'x'
        w = {'alongX': along_x, 'c': d['z'] if along_x else d['x']}
        mid = d['x'] if along_x else d['z']
        line_box(geo, 'WallClinical', w, mid - h, mid + h, DOOR_H, H, T)
    for a in plan['areas']:
        if a['level'] != level or a['zone'] in exclude:
            continue
        r = a['rect']
        geo.box('Vinyl', r['x0'], -0.05, r['z0'], r['x1'], 0.0, r['z1'])
        if a['ceiling'] is not None:
            geo.box('CeilingTile', r['x0'], a['ceiling'], r['z0'], r['x1'], a['ceiling'] + 0.05, r['z1'])


def roof(geo, plan, level):
    """The level's roof slab over every area with a ceiling, and a fascia on every wall line from the wall head up to the slab, so the
    building reads as closed above the ceilings (the atrium, which has none, stays open to the sky)."""
    H = plan['wall']['height']
    T = plan['wall']['thickness']
    top = ROOF_TOP[level]
    for a in plan['areas']:
        if a['level'] != level or a['ceiling'] is None:
            continue
        r = a['rect']
        geo.box('ctxRoof', r['x0'] - T / 2, top - ROOF_D, r['z0'] - T / 2, r['x1'] + T / 2, top, r['z1'] + T / 2)
    for w in plan['walls']:
        if w['level'] != level or w['cls'] == 'skip':
            continue
        line_box(geo, 'ctxRoof', w, w['a'] - T / 2, w['b'] + T / 2, H + 0.06, top - ROOF_D, T)
    for d in plan['doors']:
        if d['level'] != level:
            continue
        h = d['width'] / 2
        along_x = d['wallAxis'] == 'x'
        w = {'alongX': along_x, 'c': d['z'] if along_x else d['x']}
        mid = d['x'] if along_x else d['z']
        line_box(geo, 'ctxRoof', w, mid - h, mid + h, H + 0.06, top - ROOF_D, T)


def landscape(geo):
    """Around the building, for renders and bakes only (never exported; the game has its own grounds): a lawn and, in front of the lobby's
    forecourt, a low clipped hedge, so the glazing looks out on a place; the HDRI gives the distant landscape."""
    geo.box('ctxGrass', -220.0, -0.08, -200.0, 200.0, -0.02, 200.0, drop=('down',))
    x_edge = -76.5
    geo.box('ctxHedge', x_edge - 1.2, -0.02, -24.5, x_edge - 0.2, 0.75, -4.0)
    geo.box('ctxHedge', x_edge - 1.2, -0.02, 4.0, x_edge - 0.2, 0.75, 24.5)
