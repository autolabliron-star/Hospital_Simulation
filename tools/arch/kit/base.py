"""
The furniture kit's geometry core: a transform-carrying emitter (`K`) over the generator's per-material accumulation (`common.Geo`), richer
primitives than common.py (chamfered and rounded boxes, cylinders between two points, tubes along paths, lathes, extruded profiles), named
movable nodes, and anchors.

Coordinates: the plan's metres (x east, y up, z south), right-handed; `K.m` maps an item's local coordinates to the plan (or, inside a movable
node, to the node). Every kit item follows the furniture.py pattern `item(geo, f, ..., node=None)` with `f` a `common.Frame` (origin on the floor,
heading h: local +z points (sin h, cos h)); local +z is the item's FRONT (where a user stands or sits, the visitor side), +x its right-hand side
seen from behind it... i.e. the frame's local +x. Free-standing items are centred on their footprint; wall items have their back on the wall face at
local z = 0 and stand out into the room along +z.

Static vs movable: with node=None the item goes into the joined-by-material scene (one draw call per material for the whole zone, baked
lightmaps). With node='bed:A1' it goes into its own named node (and sub-nodes for its moving parts, e.g. 'bed:A1/backrest'), built at the
node's origin, with the node placed at the frame: `finalize_nodes` turns them into Blender objects (one object per node, one material slot per
material) parented as a hierarchy, so the glTF keeps the names and pivots for the runtime to animate. Movable nodes are not lightmapped.

Anchors: `anchor(k, name, x, y, z)` records a named point (a seat, an IV hook, a screen rectangle) in plan coordinates in `geo.kit_anchors`
(and the node it rides on), for the zone exporter to write next to the glb.
"""
import math

import bpy
from mathutils import Matrix, Vector

from common import Geo, P

EPS = 1e-6
# plan (x, y, z) -> Blender (x, -z, y), as a matrix
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()


def frame_matrix(f):
    return Matrix.Translation((f.cx, f.y, f.cz)) @ Matrix.Rotation(f.h, 4, 'Y')


def rot(rx=0.0, ry=0.0, rz=0.0):
    """Rotation about the local axes, applied y (heading) then x (pitch: +rx lifts local -z, i.e. tips +y toward +z) then z (roll)."""
    return Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(rz, 4, 'Z')


class Node:
    """A named movable node: its own Geo, a local matrix relative to its parent (or the plan for a root)."""

    def __init__(self, name, local, parent=None):
        self.name = name
        self.local = local
        self.parent = parent
        self.geo = Geo()
        self.world = (parent.world @ local) if parent else local


def _nodes(geo):
    if not hasattr(geo, 'kit_nodes'):
        geo.kit_nodes = []
    return geo.kit_nodes


def _anchors(geo):
    if not hasattr(geo, 'kit_anchors'):
        geo.kit_anchors = []
    return geo.kit_anchors


class K:
    """An emitter: a target Geo, a local -> plan (or node) matrix, the node it writes into (None = static), the scene's root Geo."""

    def __init__(self, geo, m=None, node=None, root=None):
        self.geo = geo
        self.m = m if m is not None else Matrix.Identity(4)
        self.node = node
        self.root = root if root is not None else geo
        self.flip = self.m.determinant() < 0

    # --- transforms -------------------------------------------------------------------------------------------------------------------------
    def at(self, x=0.0, y=0.0, z=0.0, ry=0.0, rx=0.0, rz=0.0):
        return K(self.geo, self.m @ Matrix.Translation((x, y, z)) @ rot(rx, ry, rz), self.node, self.root)

    def mirror_x(self):
        """The same frame mirrored left/right (build one side, call it again on the mirror). Faces keep their outward winding."""
        return K(self.geo, self.m @ Matrix.Scale(-1, 4, (1, 0, 0)), self.node, self.root)

    def part(self, name, x=0.0, y=0.0, z=0.0, ry=0.0, rx=0.0, rz=0.0):
        """A moving part with its pivot at local (x, y, z), turned by (rx, ry, rz). Static items: just a sub-frame. Movable items: a child node
        '<node>/<name>' whose origin is the pivot (so the runtime rotates it about the hinge)."""
        k = self.at(x, y, z, ry, rx, rz)
        if self.node is None:
            return k
        child = Node(f'{self.node.name}/{name}', k.m, self.node)
        _nodes(self.root).append(child)
        return K(child.geo, Matrix.Identity(4), child, self.root)

    def world(self, p):
        """A local point in plan coordinates (through the node chain)."""
        v = self.m @ Vector(p)
        if self.node is not None:
            v = self.node.world @ v
        return (v.x, v.y, v.z)

    # --- low level --------------------------------------------------------------------------------------------------------------------------
    def _v(self, b, p):
        v = self.m @ Vector(p)
        return b.verts.new(P(v.x, v.y, v.z))

    def _f(self, b, vs, smooth=False):
        if self.flip:
            vs = list(reversed(vs))
        try:
            f = b.faces.new(vs)
        except ValueError:          # a degenerate or duplicate face: skip it
            return None
        f.smooth = smooth
        self.geo._tag(b, [f])
        return f

    def poly(self, mat, pts, smooth=False):
        """A polygon from local points, wound counter-clockwise seen from the side it faces."""
        b = self.geo.bm(mat)
        return self._f(b, [self._v(b, p) for p in pts], smooth)

    # --- boxes ------------------------------------------------------------------------------------------------------------------------------
    def box(self, mat, x0, y0, z0, x1, y1, z1, drop=(), bev=0.0):
        """An axis-aligned box from its local min/max corners. bev > 0 chamfers every edge (a 45 degree flat, catches the light like a real
        rounded edge, 44 triangles). drop: faces left out ('x0','x1','down','up','z0','z1')."""
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        z0, z1 = min(z0, z1), max(z0, z1)
        if x1 - x0 < 1e-5 or y1 - y0 < 1e-5 or z1 - z0 < 1e-5:
            return
        b = self.geo.bm(mat)
        bev = min(bev, (x1 - x0) * 0.45, (y1 - y0) * 0.45, (z1 - z0) * 0.45)
        lo, hi = (x0, y0, z0), (x1, y1, z1)
        names = {(0, 0): 'x0', (0, 1): 'x1', (1, 0): 'down', (1, 1): 'up', (2, 0): 'z0', (2, 1): 'z1'}
        if bev <= 0:
            V = {}
            for c in ((i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)):
                V[c] = self._v(b, tuple(hi[a] if c[a] else lo[a] for a in range(3)))
            quads = {
                'x0': [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)], 'x1': [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
                'down': [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)], 'up': [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
                'z0': [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)], 'z1': [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
            }
            for n, q in quads.items():
                if n not in drop:
                    self._f(b, [V[c] for c in q])
            return
        # chamfered: per corner c and axis a, the vertex on face (a, c[a]) inset by bev along the two other axes
        corners = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
        L, V = {}, {}
        for c in corners:
            for a in range(3):
                p = [hi[t] if c[t] else lo[t] for t in range(3)]
                for t in range(3):
                    if t != a:
                        p[t] += -bev if c[t] else bev
                L[(c, a)] = Vector(p)
                V[(c, a)] = self._v(b, tuple(p))

        def face(keys, normal):
            pts = [L[k] for k in keys]
            n = Vector((0.0, 0.0, 0.0))
            for i in range(len(pts)):
                n += pts[i].cross(pts[(i + 1) % len(pts)])
            if n.dot(Vector(normal)) < 0:
                keys = list(reversed(keys))
            self._f(b, [V[k] for k in keys])

        for a in range(3):
            for s_ in (0, 1):
                if names[(a, s_)] in drop:
                    continue
                o = [t for t in range(3) if t != a]
                cs = [c for c in corners if c[a] == s_]
                cs.sort(key=lambda c: math.atan2(c[o[1]] - 0.5, c[o[0]] - 0.5))
                nrm = [0, 0, 0]
                nrm[a] = 1 if s_ else -1
                face([(c, a) for c in cs], nrm)
        for e in range(3):
            a, bb = [t for t in range(3) if t != e]
            for sa in (0, 1):
                for sb in (0, 1):
                    c0 = [0, 0, 0]
                    c0[a], c0[bb] = sa, sb
                    c1 = list(c0)
                    c1[e] = 1
                    c0, c1 = tuple(c0), tuple(c1)
                    nrm = [0, 0, 0]
                    nrm[a] = 1 if sa else -1
                    nrm[bb] = 1 if sb else -1
                    face([(c0, a), (c1, a), (c1, bb), (c0, bb)], nrm)
        for c in corners:
            face([(c, 0), (c, 1), (c, 2)], [1 if c[t] else -1 for t in range(3)])

    def cbox(self, mat, cx, y0, cz, w, h, d, drop=(), bev=0.0):
        """A box centred at local (cx, cz), standing on y0: w along x, h up, d along z."""
        self.box(mat, cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, drop, bev)

    def rbox(self, mat, cx, y0, cz, w, h, d, r, axis='y', seg=4, caps=True, smooth=True):
        """A box with its four edges parallel to `axis` rounded by r (a rounded rectangle extruded along the axis): axis 'y' rounds the plan
        corners (a table top), 'z' the edges running along z (a mattress, an arm pad), 'x' those along x. Centred at (cx, cz), y0 = bottom."""
        if axis == 'y':
            prof, a, b_ = (w, d), y0, y0 + h
            cu, cv = cx, cz
        elif axis == 'z':
            prof, a, b_ = (w, h), cz - d / 2, cz + d / 2
            cu, cv = cx, y0 + h / 2
        else:
            prof, a, b_ = (d, h), cx - w / 2, cx + w / 2
            cu, cv = cz, y0 + h / 2
        pts = rounded_rect(cu, cv, prof[0], prof[1], r, seg)
        plane = {'y': 'xz', 'z': 'xy', 'x': 'zy'}[axis]
        self.prism(mat, pts, plane, a, b_, caps=caps, smooth=smooth)

    # --- extrusions ---------------------------------------------------------------------------------------------------------------------------
    def prism(self, mat, pts, plane, a, b_, caps=True, smooth=False, hard=None):
        """Extrude a 2D polygon (u, v) along the third axis from a to b_. plane 'xz': u = x, v = z, along y (a plan shape); 'xy': u = x, v = y,
        along z (a front profile); 'zy': u = z, v = y, along x (a side profile). Concave polygons are fine. smooth shades the sides smooth
        (hard: a set of point indices where the side stays sharp)."""
        pts = dedupe(pts)
        n = len(pts)
        if n < 3 or abs(b_ - a) < 1e-6:
            return
        bm = self.geo.bm(mat)

        def to3(u, v, w):
            if plane == 'xz':
                return (u, w, v)
            if plane == 'xy':
                return (u, v, w)
            return (w, v, u)          # 'zy'

        area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n)) / 2
        U, Vv, W = Vector(to3(1, 0, 0)), Vector(to3(0, 1, 0)), Vector(to3(0, 0, 1))
        hand = U.cross(Vv).dot(W)
        s = (1 if area > 0 else -1) * (1 if hand > 0 else -1) * (1 if b_ > a else -1)
        lo = [self._v(bm, to3(u, v, a)) for (u, v) in pts]
        hi = [self._v(bm, to3(u, v, b_)) for (u, v) in pts]
        for i in range(n):
            j = (i + 1) % n
            q = [lo[i], lo[j], hi[j], hi[i]]
            self._f(bm, q if s > 0 else list(reversed(q)), smooth=smooth)
        if caps:
            for top in (False, True):
                ring = hi if top else lo
                ring = [self._v(bm, to3(u, v, b_ if top else a)) for (u, v) in pts] if smooth else ring
                vs = ring if (top == (s > 0)) else list(reversed(ring))
                self._f(bm, vs)

    # --- round things ---------------------------------------------------------------------------------------------------------------------------
    def cyl(self, mat, a, b_, r, seg=16, caps=(True, True), r2=None, smooth=True, phase=0.0):
        """A cylinder (or frustum, r2 at b_) from local point a to b_."""
        A, B = Vector(a), Vector(b_)
        ax = B - A
        if ax.length < 1e-6:
            return
        ax.normalize()
        u = ax.orthogonal().normalized()
        v = ax.cross(u)
        if abs(ax.y) > 0.99:              # vertical: a stable seam (local +x)
            u = Vector((1, 0, 0))
            v = ax.cross(u).normalized()
        rb = r if r2 is None else r2
        bm = self.geo.bm(mat)
        ring_a, ring_b = [], []
        for i in range(seg):
            t = phase + 2 * math.pi * i / seg
            d = u * math.cos(t) + v * math.sin(t)
            ring_a.append(A + d * r)
            ring_b.append(B + d * rb)
        va = [self._v(bm, p) for p in ring_a]
        vb = [self._v(bm, p) for p in ring_b]
        for i in range(seg):
            j = (i + 1) % seg
            self._f(bm, [va[i], va[j], vb[j], vb[i]], smooth=smooth)
        if caps[0] and r > 1e-6:
            self._f(bm, [self._v(bm, p) for p in reversed(ring_a)])
        if caps[1] and rb > 1e-6:
            self._f(bm, [self._v(bm, p) for p in ring_b])

    def vcyl(self, mat, cx, y0, cz, r, h, seg=16, caps=(True, True), r2=None, smooth=True):
        self.cyl(mat, (cx, y0, cz), (cx, y0 + h, cz), r, seg, caps, r2, smooth)

    def tube(self, mat, pts, r, seg=12, caps=True, smooth=True, closed=False):
        """A round tube along a polyline of local points (fillet the corners first with `fillet` for bends)."""
        pts = [Vector(p) for p in dedupe3(pts)]
        n = len(pts)
        if n < 2:
            return
        bm = self.geo.bm(mat)
        tans = []
        for i in range(n):
            if closed:
                t = (pts[(i + 1) % n] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            elif i == 0:
                t = pts[1] - pts[0]
            elif i == n - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            tans.append(t.normalized())
        # parallel-transported frame
        u = tans[0].orthogonal().normalized()
        rings = []
        for i in range(n):
            t = tans[i]
            u = (u - t * u.dot(t))
            if u.length < 1e-6:
                u = t.orthogonal()
            u.normalize()
            v = t.cross(u)
            # mitre: scale the ring across the bend so the tube keeps its radius through the corner
            k = 1.0
            if 0 < i < n - 1 or closed:
                d0 = (pts[i] - pts[i - 1]).normalized()
                cosh = max(0.2, d0.dot(t))
                k = 1.0 / cosh
            ring = []
            for s in range(seg):
                a = 2 * math.pi * s / seg
                dvec = u * math.cos(a) + v * math.sin(a)
                if k != 1.0:
                    d0 = (pts[i] - pts[i - 1]).normalized()
                    bend = (d0 - t * d0.dot(t))
                    if bend.length > 1e-6:
                        bend.normalize()
                        dvec = dvec + bend * dvec.dot(bend) * (k - 1.0)
                ring.append(pts[i] + dvec * r)
            rings.append(ring)
        verts = [[self._v(bm, p) for p in ring] for ring in rings]
        last = n if closed else n - 1
        for i in range(last):
            i2 = (i + 1) % n
            for s in range(seg):
                s2 = (s + 1) % seg
                self._f(bm, [verts[i][s], verts[i][s2], verts[i2][s2], verts[i2][s]], smooth=smooth)
        if caps and not closed:
            self._f(bm, [self._v(bm, p) for p in reversed(rings[0])])
            self._f(bm, [self._v(bm, p) for p in rings[-1]])

    def lathe(self, mat, prof, seg=24, smooth=True, cx=0.0, cz=0.0, arc=None):
        """Revolve a profile [(r, y), ...] about the local vertical axis through (cx, cz). A profile running up the outside faces outward
        (reverse it for an inside face). r = 0 closes a pole. arc=(a0, a1) radians for a partial revolution."""
        prof = dedupe(prof)
        full = arc is None
        a0, a1 = (0.0, 2 * math.pi) if full else arc
        nseg = seg if full else max(1, int(round(seg * (a1 - a0) / (2 * math.pi))))
        cols = nseg if full else nseg + 1
        bm = self.geo.bm(mat)
        rings = []
        for (r, y) in prof:
            if r < 1e-7:
                rings.append([self._v(bm, (cx, y, cz))] * cols)
            else:
                rings.append([self._v(bm, (cx + r * math.cos(a0 + (a1 - a0) * j / nseg), y, cz + r * math.sin(a0 + (a1 - a0) * j / nseg)))
                              for j in range(cols)])
        for i in range(len(prof) - 1):
            for j in range(nseg):
                j2 = (j + 1) % cols
                q = [rings[i][j], rings[i + 1][j], rings[i + 1][j2], rings[i][j2]]
                q2 = []
                for v in q:
                    if v not in q2:
                        q2.append(v)
                if len(q2) >= 3:
                    self._f(bm, q2, smooth=smooth)        # a profile going up the outside faces outward

    def qface(self, mat, pts, want, smooth=False):
        """A planar polygon from local points, wound so its normal points along `want` (a local vector)."""
        b = self.geo.bm(mat)
        V = [Vector(p) for p in pts]
        n = Vector((0.0, 0.0, 0.0))
        for i in range(len(V)):
            n += V[i].cross(V[(i + 1) % len(V)])
        if n.dot(Vector(want)) < 0:
            pts = list(reversed(pts))
        return self._f(b, [self._v(b, p) for p in pts], smooth)

    def tray(self, mat, cx, y0, cz, w, d, h, wall=0.01, r=0.03, seg=4, floor_t=None, bottom=True):
        """An open rounded box (a sink, a trough, a bin, a tray): outer walls, rim, inner walls, inner floor floor_t above y0, outer bottom."""
        ft = wall if floor_t is None else floor_t
        out = rounded_rect(cx, cz, w, d, r, seg)
        inn = rounded_rect(cx, cz, w - 2 * wall, d - 2 * wall, max(r - wall, 0.002), seg)
        if len(out) != len(inn):
            inn = rounded_rect(cx, cz, w - 2 * wall, d - 2 * wall, max(r, 0.004), seg)
        n = len(out)
        y1 = y0 + h
        for i in range(n):
            j = (i + 1) % n
            (ax, az), (bx, bz) = out[i], out[j]
            mx, mz = (ax + bx) / 2 - cx, (az + bz) / 2 - cz
            self.qface(mat, [(ax, y0, az), (bx, y0, bz), (bx, y1, bz), (ax, y1, az)], (mx, 0, mz))
            (cx_, cz_), (dx_, dz_) = inn[i], inn[j]
            self.qface(mat, [(cx_, y0 + ft, cz_), (dx_, y0 + ft, dz_), (dx_, y1, dz_), (cx_, y1, cz_)], (-mx, 0, -mz))
            self.qface(mat, [(ax, y1, az), (bx, y1, bz), (dx_, y1, dz_), (cx_, y1, cz_)], (0, 1, 0))
        self.qface(mat, [(x, y0 + ft, z) for x, z in inn], (0, 1, 0))
        if bottom:
            self.qface(mat, [(x, y0, z) for x, z in out], (0, -1, 0))

    def disc(self, mat, cx, y, cz, r, seg=24, up=True):
        bm = self.geo.bm(mat)
        vs = [self._v(bm, (cx + r * math.cos(2 * math.pi * i / seg), y, cz + r * math.sin(2 * math.pi * i / seg))) for i in range(seg)]
        self._f(bm, list(reversed(vs)) if up else vs)

    def sphere(self, mat, c, r, seg=12, rings=6):
        prof = [(r * math.sin(math.pi * i / rings), c[1] - r * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
        self.lathe(mat, prof, seg, cx=c[0], cz=c[2])

    def torus(self, mat, R, r, seg=24, sides=8, y=0.0):
        """A ring (a tyre, a hand rim) in the local xz plane around the y axis at height y."""
        prof = [(R + r * math.cos(2 * math.pi * i / sides), y + r * math.sin(2 * math.pi * i / sides)) for i in range(sides + 1)]
        self.lathe(mat, prof, seg)

    def ribbon(self, mat, path, y0, y1, thick=0.008, offset=None, smooth=True):
        """A thin closed vertical sheet hanging along a plan path [(x, z), ...] from y0 up to y1 (a curtain): front, back, hem and top faces, so
        both sides get their own lightmap texels. offset(i) -> extra (dx, dz) per point (pleats)."""
        pts = list(path)
        n = len(pts)
        if n < 2:
            return
        bm = self.geo.bm(mat)
        nrm = []
        for i in range(n):
            a = pts[max(0, i - 1)]
            b_ = pts[min(n - 1, i + 1)]
            dx, dz = b_[0] - a[0], b_[1] - a[1]
            L = math.hypot(dx, dz) or 1.0
            nrm.append((dz / L, -dx / L))
        A, B = [], []
        for i, (x, z) in enumerate(pts):
            ox, oz = offset(i) if offset else (0.0, 0.0)
            nx, nz = nrm[i]
            A.append(((x + ox + nx * thick / 2), (z + oz + nz * thick / 2)))
            B.append(((x + ox - nx * thick / 2), (z + oz - nz * thick / 2)))
        a0 = [self._v(bm, (x, y0, z)) for x, z in A]
        a1 = [self._v(bm, (x, y1, z)) for x, z in A]
        b0 = [self._v(bm, (x, y0, z)) for x, z in B]
        b1 = [self._v(bm, (x, y1, z)) for x, z in B]
        for i in range(n - 1):
            self._f(bm, [a0[i], a1[i], a1[i + 1], a0[i + 1]], smooth=smooth)
            self._f(bm, [b0[i + 1], b1[i + 1], b1[i], b0[i]], smooth=smooth)
            self._f(bm, [a0[i + 1], b0[i + 1], b0[i], a0[i]])
            self._f(bm, [a1[i], b1[i], b1[i + 1], a1[i + 1]])
        self._f(bm, [a0[0], b0[0], b1[0], a1[0]])
        self._f(bm, [a1[-1], b1[-1], b0[-1], a0[-1]])


# --- 2D helpers -------------------------------------------------------------------------------------------------------------------------------
def dedupe(pts, eps=1e-7):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 2 and abs(out[0][0] - out[-1][0]) <= eps and abs(out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out


def dedupe3(pts, eps=1e-7):
    out = []
    for p in pts:
        if not out or (Vector(p) - Vector(out[-1])).length > eps:
            out.append(tuple(p))
    return out


def rounded_rect(cu, cv, w, h, r, seg=4):
    """A rounded rectangle (counter-clockwise in (u, v)) centred at (cu, cv)."""
    r = max(0.0, min(r, w / 2 - EPS * 10, h / 2 - EPS * 10)) if r > 0 else 0.0
    pts = []
    corners = [(cu + w / 2 - r, cv - h / 2 + r, -90), (cu + w / 2 - r, cv + h / 2 - r, 0), (cu - w / 2 + r, cv + h / 2 - r, 90),
               (cu - w / 2 + r, cv - h / 2 + r, 180)]
    for (x, y, a0) in corners:
        if r <= 0:
            pts.append((x, y))
            continue
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((x + r * math.cos(a), y + r * math.sin(a)))
    return dedupe(pts)


def fillet(pts, r, n=4):
    """Round the inner corners of a 3D polyline with arcs of radius r (n segments each): bent tubes (rails, frames, handles)."""
    P3 = [Vector(p) for p in pts]
    if len(P3) < 3 or r <= 0:
        return [tuple(p) for p in P3]
    out = [P3[0]]
    for i in range(1, len(P3) - 1):
        a, b, c = P3[i - 1], P3[i], P3[i + 1]
        d0, d1 = (a - b), (c - b)
        l0, l1 = d0.length, d1.length
        if l0 < 1e-6 or l1 < 1e-6:
            continue
        d0.normalize()
        d1.normalize()
        ang = d0.angle(d1)
        if ang > math.pi - 1e-3:
            out.append(b)
            continue
        t = r / math.tan(ang / 2)
        t = min(t, l0 * 0.49, l1 * 0.49)
        p0, p1 = b + d0 * t, b + d1 * t
        # quadratic Bezier through the corner (close to an arc for these angles)
        for k in range(n + 1):
            s = k / n
            out.append(p0 * (1 - s) ** 2 + b * 2 * s * (1 - s) + p1 * s * s)
    out.append(P3[-1])
    return [tuple(p) for p in out]


def arc_pts(cx, cy, r, a0, a1, n=8):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


# --- items: the static / movable switch ---------------------------------------------------------------------------------------------------------
def root(geo, f, node=None):
    """The emitter for an item at frame f: static (into geo, in plan coordinates) or, with a node name, a new movable node placed at f."""
    if node is None:
        return K(geo, frame_matrix(f), None, geo)
    n = Node(node, frame_matrix(f), None)
    _nodes(geo).append(n)
    return K(n.geo, Matrix.Identity(4), n, geo)


def anchor(k, name, x, y, z, **extra):
    """Record a named point of an item (plan coordinates; `node` = the movable node it rides on)."""
    rec = {'name': name, 'p': [round(c, 4) for c in k.world((x, y, z))], 'node': k.node.name if k.node else None}
    rec.update(extra)
    _anchors(k.root).append(rec)
    return rec


# --- Blender objects for the movable nodes ------------------------------------------------------------------------------------------------------
def bevel_object(o, width, segments):
    """The generator's bevel (generate.py): angle-limited, hardened normals."""
    if width <= 0:
        return
    for p in o.data.polygons:
        p.use_smooth = True
    md = o.modifiers.new('bevel', 'BEVEL')
    md.width = width
    md.segments = max(1, segments)
    md.limit_method = 'ANGLE'
    md.angle_limit = math.radians(30)
    md.harden_normals = True
    md.use_clamp_overlap = True
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=md.name)


def prepare_object(o, name, mt):
    """Bevel + UVMap projection of one per-material object, as generate.py does for the static scene (mt = the materials module)."""
    w, s = mt.bevel_of(name)
    bevel_object(o, w, s)
    sw = o.data.attributes.get('swatch')
    mt.project_uvs(o, (lambda p, sw=sw: sw.data[p.index].value) if sw else None)


def finalize_nodes(geo, col, materials, mt):
    """Turn geo.kit_nodes into Blender objects: one object per node (its materials as slots, so one glTF mesh with a primitive per material),
    named after the node, parented as built, origin at the pivot. Returns {node name: object}. Call after geo.finalize; never lightmapped."""
    out = {}
    for n in _nodes(geo):
        objs = n.geo.finalize(col, materials)
        for name, o in objs.items():
            prepare_object(o, name, mt)
            if 'swatch' in o.data.attributes:
                o.data.attributes.remove(o.data.attributes['swatch'])
        if objs:
            bpy.ops.object.select_all(action='DESELECT')
            first = None
            for o in objs.values():
                o.select_set(True)
                first = first or o
            bpy.context.view_layer.objects.active = first
            if len(objs) > 1:
                bpy.ops.object.join()
            o = bpy.context.view_layer.objects.active
            o.data.name = n.name
        else:
            o = bpy.data.objects.new(n.name, None)
            col.objects.link(o)
        o.name = n.name
        o['kitNode'] = True
        if n.parent is not None:
            o.parent = out[n.parent.name]
            o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_basis = C @ n.local @ CI
        out[n.name] = o
    geo.kit_nodes = []
    return out
