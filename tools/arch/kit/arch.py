"""
Architectural finishes the zones apply along the plan's wall lines: coved vinyl skirting, crash rails and handrails, corner guards, tegular
(lay-in, stepped edge) ceiling tiles. They use the same wall-line convention as furniture.py's slat_wall / dispenser: `along_x` (the wall runs
along x), `face` (the wall face's coordinate: z for a wall along x, x for a wall along z), `into` (+1 / -1, the direction into the room), and the
span a..b along the wall.
"""
import math

from common import Frame

from .base import K, arc_pts, frame_matrix, root


def wall_frame(along_x, face, into, a, b):
    """A Frame on the wall face at the span's start, local +x running along the wall to its end (length = |b - a|), local +z into the room."""
    a, b = min(a, b), max(a, b)
    if along_x:
        return (Frame(a, face, 0.0) if into > 0 else Frame(b, face, math.pi)), b - a
    return (Frame(face, b, math.pi / 2) if into > 0 else Frame(face, a, -math.pi / 2)), b - a


def coved_skirting(geo, along_x, face, into, a, b, h=0.1, r=0.03, mat='SheetVinyl', cap=True):
    """Sheet vinyl turned up the wall: a cove fillet (radius r) in the floor-wall corner and a 2.5 mm upstand to h, finished with a small
    capping strip (the clinical floor's own material, so it adds no draw call)."""
    f, L = wall_frame(along_x, face, into, a, b)
    k = root(geo, f)
    t = 0.0025
    prof = [(0.0, 0.0), (r + t, 0.0)] + arc_pts(r + t, r, r, -math.pi / 2, -math.pi, 6)[1:] + [(t, h), (0.0, h)]
    k.prism(mat, prof, 'zy', 0.0, L, smooth=False)
    if cap:
        k.rbox('KitPlastic:1', L / 2, h - 0.002, 0.005, L, 0.012, 0.01, 0.004, axis='x', seg=2)
    return k


def crash_rail(geo, along_x, face, into, a, b, y=0.82, h=0.2, depth=0.028, mat='CrashRail', ends=True):
    """A vinyl crash rail (bed and trolley protection) on a wall: a rounded profile h high standing `depth` off the wall, its ends returned
    to the wall."""
    f, L = wall_frame(along_x, face, into, a, b)
    k = root(geo, f)
    r = min(depth * 0.8, h / 3)
    prof = [(0.0, y), (depth - r, y)] + arc_pts(depth - r, y + r, r, -math.pi / 2, 0, 4)[1:] + \
        arc_pts(depth - r, y + h - r, r, 0, math.pi / 2, 4)[1:] + [(0.0, y + h)]
    k.prism(mat, prof, 'zy', 0.02 if ends else 0.0, L - (0.02 if ends else 0.0), smooth=True)
    if ends:
        for x0, x1 in ((0.0, 0.02), (L - 0.02, L)):
            k.box(mat, x0, y + 0.01, 0.0, x1, y + h - 0.01, depth * 0.7)
    return k


def handrail(geo, along_x, face, into, a, b, y=0.9, r=0.025, mat='Oak', bracket='Stainless', pitch=1.2):
    """A round handrail on stand-off brackets (corridors, en-suites), its ends returned to the wall."""
    f, L = wall_frame(along_x, face, into, a, b)
    k = root(geo, f)
    off = 0.065
    k.tube(mat, [(0.0, y, 0.0), (0.0, y, off - 0.03), (0.03, y, off), (L - 0.03, y, off), (L, y, off - 0.03), (L, y, 0.0)], r, seg=12)
    n = max(1, int(L / pitch))
    for i in range(n + 1):
        x = 0.15 + (L - 0.3) * i / max(n, 1)
        k.tube(bracket, [(x, y - r - 0.04, 0.0), (x, y - r - 0.04, off), (x, y - r * 0.6, off)], 0.006, seg=6)
    return k


def corner_guard(geo, x, z, sx, sz, h=1.2, y0=0.1, leg=0.05, t=0.004, mat='CrashRail'):
    """An L corner guard on an external wall corner at plan (x, z); (sx, sz) = the signs of the room side (the guard wraps the corner's
    outward diagonal). Two legs `leg` long, a rounded nose."""
    k = K(geo, frame_matrix(Frame(0, 0)))
    pts = [(x - sx * leg, z), (x, z), (x, z - sz * leg), (x + sx * t, z - sz * leg), (x + sx * t, z + sz * t), (x - sx * leg, z + sz * t)]
    k.prism(mat, pts, 'xz', y0, y0 + h)
    return k


def tegular_ceiling(geo, rect, y, module=0.6, tile='AcousticTile', grid='CeilingGrid', panels=(), panel='LightPanel', step=0.008):
    """A lay-in ceiling over rect (x0, x1, z0, z1) at height y: 24 mm T-bars on a `module` grid and tegular tiles (their faces stepped
    `step` below the grid). `panels`: (i, j[, wi, wj]) grid cells (wi x wj modules) that hold LED panels instead of tiles."""
    x0, x1, z0, z1 = rect
    k = K(geo, frame_matrix(Frame(0, 0)))
    nx, nz = max(1, int(round((x1 - x0) / module))), max(1, int(round((z1 - z0) / module)))
    mx, mz = (x1 - x0) / nx, (z1 - z0) / nz
    taken = set()
    for p in panels:
        i, j = p[0], p[1]
        wi, wj = (p[2], p[3]) if len(p) > 2 else (1, 1)
        for a in range(wi):
            for b in range(wj):
                taken.add((i + a, j + b))
        k.box(panel, x0 + i * mx + 0.012, y - 0.004, z0 + j * mz + 0.012, x0 + (i + wi) * mx - 0.012, y, z0 + (j + wj) * mz - 0.012,
              drop=('up',))
    for i in range(nx):
        for j in range(nz):
            if (i, j) in taken:
                continue
            ax, az = x0 + i * mx, z0 + j * mz
            # the tile's visible face (stepped down), its rebate edges, and the back
            k.box(tile, ax + 0.018, y - step, az + 0.018, ax + mx - 0.018, y + 0.012, az + mz - 0.018, drop=('up',))
            k.box(tile, ax + 0.012, y, az + 0.012, ax + mx - 0.012, y + 0.012, az + mz - 0.012, drop=('up', 'down'))
    for i in range(nx + 1):
        x = x0 + i * mx
        k.box(grid, x - 0.012, y - 0.002, z0, x + 0.012, y + 0.002, z1, drop=('up',))
    for j in range(nz + 1):
        z = z0 + j * mz
        k.box(grid, x0, y - 0.0025, z - 0.012, x1, y + 0.0015, z + 0.012, drop=('up',))
    return k
