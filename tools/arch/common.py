"""
Shared geometry for the Blender generator (tools/arch/*.py): plan frame, per-material mesh accumulation, boxes, oriented boxes, cylinders.

Frame: the plan's metres, x east, z south, y up. Blender is z up, so a plan point (x, y, z) goes to Blender (x, -z, y) (a proper rotation, so a
face wound counter-clockwise from outside in plan coordinates stays outward in Blender).

Everything is written straight into ONE bmesh per material (`Geo`), so the export has one node / one draw call per material without joining
thousands of objects. `Geo.finalize()` turns each bmesh into an object `arch_<Material>` at the origin (vertices in world coordinates).
"""
import math

import bmesh
import bpy


def P(x, y, z):
    """Plan (x east, y up, z south) -> Blender (x, y north, z up)."""
    return (x, -z, y)


class Frame:
    """A local frame on the plan: origin (cx, cz) on the floor, heading h (atan2(dx, dz): local +z points (sin h, cos h)), local +x = (cos h, -sin h).
    The same convention as the layout builder's Frame (src/scene/building/layout/builder.ts)."""

    def __init__(self, cx, cz, h=0.0, y=0.0):
        self.cx, self.cz, self.h, self.y = cx, cz, h, y
        self.c, self.s = math.cos(h), math.sin(h)

    def pt(self, lx, ly, lz):
        return (self.cx + lx * self.c + lz * self.s, self.y + ly, self.cz - lx * self.s + lz * self.c)


WORLD = Frame(0.0, 0.0, 0.0)

# box corner order (i, j, k) over x, y, z, and the six faces wound outward
_CORNERS = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
_FACES = {
    'x0': [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
    'x1': [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    'down': [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    'up': [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
    'z0': [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
    'z1': [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
}


def _rot_x(p, a, pivot):
    """Rotate a local point about the local x axis through `pivot` (ly, lz) by angle a (positive tips +y toward -z: a backrest leaning back)."""
    if not a:
        return p
    x, y, z = p
    py, pz = pivot
    y, z = y - py, z - pz
    c, s = math.cos(a), math.sin(a)
    return (x, py + y * c + z * s, pz - y * s + z * c)


class Geo:
    def __init__(self):
        self.bms = {}
        self.smooth = {}

    def bm(self, mat):
        """The bmesh of a material. 'Accent:<i>' is the Accent material's swatch i (a face int layer 'swatch', see materials.palette_uv)."""
        swatch = None
        if ':' in mat:
            mat, swatch = mat.split(':')
        b = self.bms.get(mat)
        if b is None:
            b = bmesh.new()
            b.faces.layers.int.new('swatch')
            self.bms[mat] = b
        self._swatch = int(swatch) if swatch is not None else 0
        return b

    def _tag(self, b, faces):
        lay = b.faces.layers.int.get('swatch')
        for f in faces:
            f[lay] = self._swatch

    def poly(self, mat, pts, smooth=False):
        """A polygon from plan points, wound counter-clockwise seen from the side it faces."""
        b = self.bm(mat)
        vs = [b.verts.new(P(*p)) for p in pts]
        f = b.faces.new(vs)
        f.smooth = smooth
        self._tag(b, [f])
        return f

    # --- boxes ------------------------------------------------------------------------------------------------------------------------------
    def fbox(self, f, mat, lx0, ly0, lz0, lx1, ly1, lz1, drop=(), tilt=0.0, pivot=None):
        """A box given by its local min/max corners in frame f (optionally tilted about local x through pivot (ly, lz))."""
        if lx1 - lx0 < 1e-5 or ly1 - ly0 < 1e-5 or lz1 - lz0 < 1e-5:
            return
        b = self.bm(mat)
        lo, hi = (lx0, ly0, lz0), (lx1, ly1, lz1)
        piv = pivot if pivot is not None else (ly0, (lz0 + lz1) / 2)
        verts = {}
        for c in _CORNERS:
            lp = tuple(hi[a] if c[a] else lo[a] for a in range(3))
            lp = _rot_x(lp, tilt, piv)
            verts[c] = b.verts.new(P(*f.pt(*lp)))
        made = []
        for name, quad in _FACES.items():
            if name in drop:
                continue
            made.append(b.faces.new([verts[c] for c in quad]))
        self._tag(b, made)

    def box(self, mat, x0, y0, z0, x1, y1, z1, drop=()):
        """An axis-aligned box in plan coordinates."""
        self.fbox(WORLD, mat, min(x0, x1), min(y0, y1), min(z0, z1), max(x0, x1), max(y0, y1), max(z0, z1), drop)

    def cbox(self, f, mat, lx, ly0, lz, w, h, d, drop=(), tilt=0.0, pivot=None):
        """A box centred at local (lx, lz), standing on ly0, w along local x, h up, d along local z."""
        self.fbox(f, mat, lx - w / 2, ly0, lz - d / 2, lx + w / 2, ly0 + h, lz + d / 2, drop, tilt, pivot)

    # --- round things -----------------------------------------------------------------------------------------------------------------------
    def cyl(self, f, mat, lx, ly0, lz, r, h, seg=24, top=True, bottom=True, r_top=None, smooth=True, inward=False):
        """A vertical cylinder (or a cone frustum with r_top) in frame f."""
        b = self.bm(mat)
        rt = r if r_top is None else r_top
        lo, hi = [], []
        for i in range(seg):
            t = 2 * math.pi * i / seg
            lo.append(b.verts.new(P(*f.pt(lx + r * math.cos(t), ly0, lz + r * math.sin(t)))))
            hi.append(b.verts.new(P(*f.pt(lx + rt * math.cos(t), ly0 + h, lz + rt * math.sin(t)))))
        for i in range(seg):
            j = (i + 1) % seg
            q = [lo[i], hi[i], hi[j], lo[j]]
            fc = b.faces.new(list(reversed(q)) if inward else q)
            fc.smooth = smooth
        if top:
            b.faces.new(list(reversed(hi)))
        if bottom:
            b.faces.new(lo)

    def disc(self, f, mat, lx, ly, lz, r, seg=24, down=True):
        """A flat disc facing down (a ceiling light) or up."""
        b = self.bm(mat)
        vs = [b.verts.new(P(*f.pt(lx + r * math.cos(2 * math.pi * i / seg), ly, lz + r * math.sin(2 * math.pi * i / seg)))) for i in range(seg)]
        b.faces.new(vs if down else list(reversed(vs)))

    def ring(self, f, mat, lx, ly, lz, r0, r1, seg=24, down=True):
        """A flat annulus facing down (a downlight trim)."""
        b = self.bm(mat)
        a = [b.verts.new(P(*f.pt(lx + r0 * math.cos(2 * math.pi * i / seg), ly, lz + r0 * math.sin(2 * math.pi * i / seg)))) for i in range(seg)]
        c = [b.verts.new(P(*f.pt(lx + r1 * math.cos(2 * math.pi * i / seg), ly, lz + r1 * math.sin(2 * math.pi * i / seg)))) for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg
            q = [a[i], a[j], c[j], c[i]]          # wound upward (inner -> outer, counter-clockwise from above)
            self._tag(b, [b.faces.new(list(reversed(q)) if down else q)])

    # --- out --------------------------------------------------------------------------------------------------------------------------------
    def finalize(self, col, materials):
        """One object per material (name arch_<Material>), vertices in world coordinates, the node at the origin."""
        out = {}
        for mat, b in sorted(self.bms.items()):
            if not b.faces:
                continue
            me = bpy.data.meshes.new('arch_' + mat)
            b.to_mesh(me)
            b.free()
            me.materials.append(materials[mat])
            o = bpy.data.objects.new('arch_' + mat, me)
            col.objects.link(o)
            out[mat] = o
        self.bms = {}
        return out


def srgb_to_linear(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def in_rect(x, z, r, pad=0.0):
    x0, x1, z0, z1 = r
    return x0 - pad <= x <= x1 + pad and z0 - pad <= z <= z1 + pad
