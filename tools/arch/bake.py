"""
Light for the look pass: the world (the CC0 HDRI, its sun clamped out and replaced by a matching sun lamp so the bake gets crisp sun patches
without fireflies; the Nishita sky when no HDRI is there), the downlights' spot lamps, Cycles settings, the lightmap bake, and the lobby's
reflection probe (an equirectangular Radiance .hdr).

Lightmaps (unchanged contract with src/scene/building/model/lightmaps.ts): Cycles DIFFUSE direct+indirect, no colour = the outgoing radiance of a
white diffuse surface, OIDN denoised, written as lm_<Material>.png in sRGB 8 bit holding value / lightmapScale; the node extras carry
{ lightmap, lightmapScale, lightmapUv: 1 }. Lightmap UVs: the second UV set 'Lightmap' (TEXCOORD_1), Smart UV project.
"""
import math
import os
import tempfile

import bpy
import numpy as np
from mathutils import Vector

from common import P

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
HDRI_DIR = os.path.join(ROOT, 'assets-src', 'hdri')

# where the sun should come from (plan): west-south-west, so it falls through the lobby's curtain wall in the late afternoon
SUN_FROM_PLAN_DEG = 22.0     # degrees from due west toward the south


def setup_cycles(scene, samples):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
    except Exception:
        scene.cycles.device = 'CPU'
    c = scene.cycles
    c.samples = samples
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 8
    c.diffuse_bounces = 5
    c.glossy_bounces = 4
    c.transmission_bounces = 4
    c.transparent_max_bounces = 12
    c.sample_clamp_indirect = 8.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.use_adaptive_sampling = True
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Base Contrast'


def _hdri_path():
    if not os.path.isdir(HDRI_DIR):
        return None
    for f in sorted(os.listdir(HDRI_DIR)):
        if f.lower().endswith(('.hdr', '.exr')):
            return os.path.join(HDRI_DIR, f)
    return None


def _sun_of(img, clamp):
    """Direction (Blender azimuth, elevation, radians) of the HDRI's sun, and the irradiance and colour above `clamp`."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(h, w, 4)[:, :, :3]
    lum = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    row, col = np.unravel_index(int(np.argmax(lum)), lum.shape)
    u, v = (col + 0.5) / w, (row + 0.5) / h          # Blender rows run bottom-up: v = 0 at the bottom
    az = (0.5 - u) * 2 * math.pi                      # Blender's equirectangular: u = -atan2(y, x) / 2pi + 0.5
    el = (v - 0.5) * math.pi
    lat = (np.arange(h) + 0.5) / h * math.pi - math.pi / 2
    domega = (2 * math.pi / w) * (math.pi / h) * np.cos(lat)
    hot = np.maximum(rgb - clamp, 0.0)
    # irradiance on a surface facing the sun: the hot pixels sit within a degree of it, so cos ~ 1
    e_rgb = (hot * domega[:, None, None]).sum(axis=(0, 1))
    return az, el, e_rgb


def setup_world(scene, strength=1.0, clamp=24.0):
    """The HDRI world (sun clamped out, turned so its sun comes from SUN_FROM_PLAN_DEG) plus a matching sun lamp; else a Nishita sky + sun."""
    world = bpy.data.worlds.new('Sky')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    bg.inputs['Strength'].default_value = strength
    want_az = math.atan2(-math.sin(math.radians(SUN_FROM_PLAN_DEG)), -math.cos(math.radians(SUN_FROM_PLAN_DEG)))  # plan WSW in Blender
    path = _hdri_path()
    info = {}
    if path:
        img = bpy.data.images.load(path)
        az, el, e_rgb = _sun_of(img, clamp)
        env = nt.nodes.new('ShaderNodeTexEnvironment')
        env.image = img
        coord = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Rotation'].default_value = (0, 0, az - want_az)
        nt.links.new(coord.outputs['Generated'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
        mn = nt.nodes.new('ShaderNodeVectorMath')
        mn.operation = 'MINIMUM'
        mn.inputs[1].default_value = (clamp, clamp, clamp)
        nt.links.new(env.outputs['Color'], mn.inputs[0])
        nt.links.new(mn.outputs['Vector'], bg.inputs['Color'])
        e = float(e_rgb[0] * 0.2126 + e_rgb[1] * 0.7152 + e_rgb[2] * 0.0722)
        col = tuple(float(c) / max(e, 1e-6) for c in e_rgb)
        sun_strength = e * strength
        info = {'hdri': os.path.basename(path), 'sunElevationDeg': math.degrees(el), 'sunIrradiance': e, 'hdriAzimuthDeg': math.degrees(az)}
    else:
        el = math.radians(36)
        sky = nt.nodes.new('ShaderNodeTexSky')
        sky.sky_type = 'NISHITA'
        sky.sun_elevation = el
        sky.sun_rotation = want_az
        sky.sun_disc = False
        bg.inputs['Strength'].default_value = 0.35 * strength
        nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
        col = (1.0, 0.96, 0.9)
        sun_strength = 3.0 * strength
        info = {'hdri': None}
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = sun_strength
    sun.color = tuple(min(1.0, c / max(col)) for c in col)
    sun.angle = math.radians(0.6)
    so = bpy.data.objects.new('Sun', sun)
    d = Vector((math.cos(el) * math.cos(want_az), math.cos(el) * math.sin(want_az), math.sin(el)))
    so.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    scene.collection.objects.link(so)
    info['sunStrength'] = sun_strength
    return info


def add_downlights(scene, points, ch, power=14.0):
    """A spot lamp under every downlight (invisible to the camera; the lens is the emissive disc): wall-washing scallops in renders and bakes."""
    for i, (x, z) in enumerate(points):
        lt = bpy.data.lights.new(f'down{i}', 'SPOT')
        lt.energy = power
        lt.color = (1.0, 0.92, 0.82)
        lt.spot_size = math.radians(105)
        lt.spot_blend = 0.55
        lt.shadow_soft_size = 0.04
        o = bpy.data.objects.new(f'down{i}', lt)
        o.location = P(x, ch - 0.01, z)
        o.rotation_euler = (0, 0, 0)          # a spot points down its local -Z: straight down
        scene.collection.objects.link(o)


# --- lightmaps ---------------------------------------------------------------------------------------------------------------------------------------
def surface_area(o):
    return sum(p.area for p in o.data.polygons)


def lightmap_size(area, density, max_size, forced=None):
    if forced:
        return min(int(forced), max_size)
    texels = area * density / 0.55
    size = 256
    while size * size < texels and size < max_size:
        size *= 2
    return size


# meshes made of thousands of small coplanar pieces (lay-in ceiling tiles, T-bar strips): one top-down projection over the whole mesh instead of
# an island per piece (thousands of islands of a few texels each would come out black or blotchy)
PLANAR = ('CeilingTile', 'CeilingGrid', 'AcousticTile')


def unwrap_planar(o, size):
    """One top-down projection over the whole mesh. A long, thin mesh (a ward corridor's ceiling) is folded: cut across its long axis into k
    bands (k ~ sqrt of its aspect) stacked side by side, a face going to the band of its centre, so the square lightmap is used, not a strip."""
    me = o.data
    uv = me.uv_layers.new(name='Lightmap')
    uv0 = me.uv_layers.get('UVMap')
    if uv0:
        uv0.active_render = True
    co = [v.co for v in me.vertices]
    xs = [c.x for c in co]
    ys = [c.y for c in co]
    x0, y0 = min(xs), min(ys)
    sx, sy = max(xs) - x0, max(ys) - y0
    along_x = sx >= sy
    L, W = (sx, sy) if along_x else (sy, sx)
    k = max(1, int(round(math.sqrt(L / max(W, 1e-3)))))
    gap = 0.8 if k > 1 else 0.0          # metres between bands: room for faces that straddle a cut
    Lb = L / k
    span = max(Lb + gap, k * W + (k - 1) * gap)
    pad = 8.0 / size
    s = (1.0 - 2 * pad) / max(span, 1e-6)
    for p in me.polygons:
        t = (p.center.x - x0) if along_x else (p.center.y - y0)
        band = min(k - 1, max(0, int(t / Lb))) if k > 1 else 0
        for li in p.loop_indices:
            c = co[me.loops[li].vertex_index]
            a = (c.x - x0) if along_x else (c.y - y0)
            w = (c.y - y0) if along_x else (c.x - x0)
            u = a - band * Lb + gap / 2
            v = w + band * (W + gap)
            uv.data[li].uv = (pad + u * s, pad + v * s)
    me.uv_layers.active = uv


#: texels between lightmap islands when there is room (mips and bilinear filtering stay inside an island), and the least it may shrink to
PACK_MARGIN_PX = 5.0
PACK_MARGIN_MIN_PX = 1.0


def pack_margin_px(islands, size):
    """Texels of margin between islands for a map of `size` holding `islands` islands. A fixed 5-texel margin is right for walls and furniture
    (tens to hundreds of islands), but a material made of thousands of small parts (KitPlastic's switch plates and boxes, the accents' strips,
    leaves: 1 000-50 000 islands) then spends the WHOLE square on margins and the packer scales every island to nothing: the lightmap came out
    black (KitPlastic 0-6 % of its texels covered, Foliage 1.5 %, every face on one texel). So the margin shrinks with the island count until an
    island and its margin ring are about twice the island alone (margin ~ 0.29 x the side an island gets when half the map is islands)."""
    if islands <= 0:
        return PACK_MARGIN_PX
    m = 0.29 * size / math.sqrt(islands)
    return max(PACK_MARGIN_MIN_PX, min(PACK_MARGIN_PX, m))


#: islands are cut / shortened to at most this share of the map's side (estimated before packing, at PACK_FILL)
ISLAND_MAX_SIDE = 0.25
#: the share of the map the islands are expected to fill once packed (for that estimate)
PACK_FILL = 0.6


def _uv_arrays(me):
    uvl = me.uv_layers.active.data
    raw = np.empty(len(uvl) * 2, dtype=np.float32)          # foreach_get/set want the property's own type (float32, int32)
    uvl.foreach_get('uv', raw)
    starts = np.empty(len(me.polygons), dtype=np.int32)
    totals = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get('loop_start', starts)
    me.polygons.foreach_get('loop_total', totals)
    return uvl, raw.astype(np.float64).reshape(-1, 2), starts, totals


def _axes(pts):
    """Centre, long axis, short axis, the points along each, and the extents (L >= W) of a point set."""
    c = pts.mean(axis=0)
    d = pts - c
    _w, vec = np.linalg.eigh(d.T @ d)          # ascending: vec[:, 1] the long axis
    major, minor = vec[:, 1], vec[:, 0]
    a, b = d @ major, d @ minor
    return c, major, minor, a, b, float(a.max() - a.min()), float(b.max() - b.min())


def shape_islands(me, size):
    """Make the islands packable (object mode, the ACTIVE uv layer, after average_islands_scale). The packer scales every island alike until
    the largest fits, so ONE island as long as the room (an 18 m x 1 cm trim strip, a 40 m bulkhead, a corridor's floor) set the scale of all
    the others: the zones' KitPlastic got 0.1 % of its map (one texel for 10 000 parts: black), the ceilings and floors 3-14 %.
      1. every island longer than ISLAND_MAX_SIDE of the map's side (estimated from the islands' total area at PACK_FILL) is CUT across its
         long axis into pieces of about that length, between faces (nothing is resampled: each piece is its own island, the bake's margin
         fills the seam);
      2. a piece that is still too long (one long face: a trim strip, a cable) is SHORTENED along its long axis to that length: a strip's
         light changes slowly along it and it is a few millimetres tall.
    Returns (islands, cut, squeezed)."""
    from bpy_extras import mesh_utils
    uvl, uv, starts, totals = _uv_arrays(me)
    islands = mesh_utils.mesh_linked_uv_islands(me)
    loops_of = [np.concatenate([np.arange(starts[f], starts[f] + totals[f]) for f in isl]) for isl in islands]
    # the islands' area (uv units), and so the side of the square they will fill and the texel size in uv units
    area = 0.0
    for p in me.polygons:
        li = range(p.loop_start, p.loop_start + p.loop_total)
        q = uv[list(li)]
        x, y = q[:, 0], q[:, 1]
        area += abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))) / 2
    side = math.sqrt(max(area, 1e-12) / PACK_FILL)
    lmax = ISLAND_MAX_SIDE * side
    pieces = []       # (loops) of every island after cutting
    cut = 0
    shift = 0.0
    for isl, loops in zip(islands, loops_of):
        c, major, minor, a, b, L, W = _axes(uv[loops])
        if L <= lmax or len(isl) < 2:
            pieces.append(loops)
            continue
        # cut: each face goes to the piece of its centre along the long axis, and each piece moves off on its own (the packer places it)
        k = int(math.ceil(L / lmax))
        a0 = float(a.min())
        groups = {}
        for f in isl:
            fl = np.arange(starts[f], starts[f] + totals[f])
            t = float((uv[fl].mean(axis=0) - c) @ major) - a0
            groups.setdefault(min(k - 1, int(t / (L / k))), []).append(fl)
        if len(groups) > 1:
            cut += 1
        for g in groups.values():
            fl = np.concatenate(g)
            shift += 4.0 * side
            uv[fl] += (shift, 0.0)
            pieces.append(fl)
    squeezed = 0
    for loops in pieces:
        c, major, minor, a, b, L, W = _axes(uv[loops])
        if L > lmax:
            uv[loops] = c + np.outer(a * (lmax / L), major) + np.outer(b, minor)
            squeezed += 1
    uvl.foreach_set('uv', uv.astype(np.float32).reshape(-1))
    return len(mesh_utils.mesh_linked_uv_islands(me)) if cut else len(islands), cut, squeezed


def pack_shelves(me, size, margin_px):
    """Pack the ACTIVE uv layer's islands into the unit square (object mode): each island turned onto its own long axis (horizontal), the
    tallest first, left to right on shelves, every island in a whole-texel cell with `margin_px` texels to the next, at the largest common
    scale that fits (bisected). Blender's packer, given thousands of small islands next to long ones, stacked them into one column a tenth
    of the map wide (the foliage, the ceilings) and could not be told otherwise; this one is plain, deterministic and fills 60-80 %.
    Returns the texels a uv unit got."""
    from bpy_extras import mesh_utils
    uvl, uv, starts, totals = _uv_arrays(me)
    islands = mesh_utils.mesh_linked_uv_islands(me)
    items = []
    for isl in islands:
        loops = np.concatenate([np.arange(starts[f], starts[f] + totals[f]) for f in isl])
        c, major, minor, a, b, L, W = _axes(uv[loops])
        items.append((loops, a - a.min(), b - b.min(), L, W))
    order = sorted(range(len(items)), key=lambda i: -items[i][4])
    m = float(margin_px)

    def layout(S):
        """Texel positions of every island at S texels per uv unit, or None when they do not fit."""
        pos = [None] * len(items)
        x = y = shelf = 0.0
        for i in order:
            _l, _a, _b, L, W = items[i]
            w = math.ceil(L * S + m)
            h = math.ceil(W * S + m)
            if w > size or h > size:
                return None
            if x + w > size:
                y += shelf
                x = shelf = 0.0
            if y + h > size:
                return None
            pos[i] = (x, y)
            x += w
            shelf = max(shelf, h)
        return pos

    longest = max((max(it[3], it[4]) for it in items), default=0.0)
    lo, hi = 0.0, (size - m) / max(longest, 1e-12)
    best = layout(lo)
    for _ in range(40):
        mid = (lo + hi) / 2
        p = layout(mid)
        if p is None:
            hi = mid
        else:
            lo, best = mid, p
    if best is None:
        return 0.0
    S = lo
    for (loops, a, b, _L, _W), (x, y) in zip(items, best):
        uv[loops, 0] = (x + m / 2 + a * S) / size
        uv[loops, 1] = (y + m / 2 + b * S) / size
    uvl.foreach_set('uv', uv.astype(np.float32).reshape(-1))
    return S


def unwrap(o, size, name='', method='smart'):
    """The lightmap UVs ('Lightmap', TEXCOORD_1) of one material's mesh. `method` (materials.json `lightmapUnwrap`): 'smart' (Smart UV
    project), or 'sheet' for thin pleated sheets (the curtains): seams on the sharp edges only (front / back / hem / top), the rest unfolded
    angle-based, so each side of a curtain is ONE island the length of its fabric instead of a hundred 3.5 cm facets (smart project split
    the deep pleats at every fold: sub-texel slivers, 4-6x stripes, noise)."""
    if name in PLANAR:
        return unwrap_planar(o, size)
    me = o.data
    uv = me.uv_layers.new(name='Lightmap')
    me.uv_layers.active = uv
    uv0 = me.uv_layers.get('UVMap')
    if uv0:
        uv0.active_render = True
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # correct_aspect off: it stretches the islands by the aspect of the MATERIAL's image (a palette strip is 128 x 16: every KitPlastic island
    # came out 8x too thin, the packer then scaled them all to nothing); the lightmap is its own square image
    if method == 'sheet':
        # A curtain (kit ribbon: a closed 8 mm sheet, every face a vertical rectangle) gets seams only on its HORIZONTAL sharp edges (its faces
        # against the hem and top strips) and round its two end caps: the vertical edges between pleat faces are never cut however deep the
        # fold (a gathered curtain turns > 80 degrees there: cutting at every sharp edge, as before, left 25 cm x 2.4 m islands packed 6
        # texels tall, which mip and bleed into horizontal bands), so each side of a curtain unfolds as ONE developable strip. Everything
        # else on the material (blankets, drapes, covers: boxes and prisms) keeps the plain rule: a seam on every edge sharper than 80 degrees.
        import bmesh
        bm = bmesh.from_edit_mesh(me)
        bm.faces.ensure_lookup_table()
        seen = set()
        sharp = math.radians(80)
        for f0 in bm.faces:
            if f0.index in seen:
                continue
            comp, stack = [], [f0]
            seen.add(f0.index)
            while stack:
                f = stack.pop()
                comp.append(f)
                for e in f.edges:
                    for g in e.link_faces:
                        if g.index not in seen:
                            seen.add(g.index)
                            stack.append(g)
            zs = [v.co.z for f in comp for v in f.verts]
            area = sum(f.calc_area() for f in comp) or 1.0
            upright = sum(f.calc_area() for f in comp if abs(f.normal.z) < 0.2) / area
            ribbon = len(comp) >= 8 and max(zs) - min(zs) > 0.8 and upright > 0.95
            edges = {e for f in comp for e in f.edges}
            for e in edges:
                e.seam = False
                if len(e.link_faces) != 2:
                    continue
                ang = e.calc_face_angle(0.0)
                if not ribbon:
                    e.seam = ang > sharp
                    continue
                d = e.verts[1].co - e.verts[0].co
                if d.length < 1e-9:
                    continue
                if abs(d.z) < 0.3 * d.length:
                    e.seam = ang > math.radians(60)
                else:
                    # a vertical edge of an end cap (a face as narrow as the sheet is thick) is cut, so the sheet is not a closed tube
                    for g in e.link_faces:
                        xs = [(v.co.x, v.co.y) for v in g.verts]
                        wmax = max(math.hypot(a[0] - b[0], a[1] - b[1]) for a in xs for b in xs)
                        if wmax < 0.015:
                            e.seam = True
        bmesh.update_edit_mesh(me)
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.unwrap(method='ANGLE_BASED', fill_holes=False, correct_aspect=False, margin=1.0 / size)
        bpy.ops.mesh.mark_seam(clear=True)
    else:
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=1.0 / size, area_weight=0.0, correct_aspect=False,
                                 scale_to_bounds=False)
    # smart project leaves long thin islands (slots, skirtings) in a corner: re-pack them, rotated, at one texel density, filling the square
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    islands, cut, squeezed = shape_islands(me, size)
    margin = pack_margin_px(islands, size)
    pack_shelves(me, size, margin)
    print(f'unwrap {name}: {islands} islands ({cut} cut, {squeezed} shortened), margin {margin:.2f} px of {size}, '
          f'lightmap coverage {uv_coverage(me):.1%}', flush=True)


def uv_coverage(me):
    """Share of the unit square the active uv layer's faces cover (overlaps counted twice): a packed lightmap's fill."""
    uv = me.uv_layers.active.data
    a = 0.0
    for p in me.polygons:
        li = list(p.loop_indices)
        u0, v0 = uv[li[0]].uv
        for k in range(1, len(li) - 1):
            u1, v1 = uv[li[k]].uv
            u2, v2 = uv[li[k + 1]].uv
            a += abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2
    return a


def srgb_encode(v):
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(np.maximum(v, 1e-9), 1 / 2.4) - 0.055)


def denoise(img, size):
    """OpenImageDenoise over a float image through the compositor (Cycles bakes are not denoised); returns the denoised image."""
    d = tempfile.mkdtemp(prefix='lmdn')
    sc = bpy.data.scenes.new('dn')
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    src = nt.nodes.new('CompositorNodeImage')
    src.image = img
    dn = nt.nodes.new('CompositorNodeDenoise')
    dn.use_hdr = True
    dn.prefilter = 'ACCURATE'
    out = nt.nodes.new('CompositorNodeOutputFile')
    out.base_path = d
    out.format.file_format = 'OPEN_EXR'
    out.format.color_depth = '32'
    out.file_slots[0].path = 'dn_'
    nt.links.new(src.outputs['Image'], dn.inputs['Image'])
    nt.links.new(dn.outputs['Image'], out.inputs[0])
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.frame_current = 1
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    bpy.ops.render.render(scene='dn')
    files = [f for f in os.listdir(d) if f.endswith('.exr')]
    res = bpy.data.images.load(os.path.join(d, files[0]))
    res.colorspace_settings.name = 'Linear Rec.709'
    res.reload()
    res.pack()
    bpy.data.scenes.remove(sc)
    return res


def smooth_lightmap(rgb, size, sigma):
    """A gaussian blur of `sigma` texels over a baked lightmap (rgb: size*size x 3, linear), inside the baked texels only (normalized
    convolution: the empty background between the islands, black after the bake's clear, neither darkens the islands' edges nor is filled).
    For surfaces whose light really changes slowly but whose bake stays grainy at affordable samples: the pleated cubicle curtains
    (materials.json `lightmapBlur`), where the leftover noise of thin unfolded islands read as blotches and horizontal streaks."""
    img = rgb.reshape(size, size, 3)
    luma = img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722
    mask = (luma > 1e-6).astype(np.float32)
    r = max(1, int(math.ceil(3.0 * sigma)))
    w = np.exp(-0.5 * (np.arange(-r, r + 1, dtype=np.float32) / sigma) ** 2)
    w /= w.sum()

    def blur(a):
        for axis in (0, 1):
            pad = [(0, 0)] * a.ndim
            pad[axis] = (r, r)
            p = np.pad(a, pad, mode='constant')
            out = np.zeros_like(a)
            for i, wi in enumerate(w):
                sl = [slice(None)] * a.ndim
                sl[axis] = slice(i, i + a.shape[axis])
                out += wi * p[tuple(sl)]
            a = out
        return a

    num = blur(img * mask[..., None])
    den = blur(mask)[..., None]
    out = np.where(mask[..., None] > 0, num / np.maximum(den, 1e-6), 0.0)
    return out.reshape(-1, 3).astype(np.float32)


def bake_object(o, name, size, outdir, use_denoise=True, self_shadow=True, blur=0.0):
    """Bake one material's lightmap. `self_shadow` False (materials.json `bakeSelfShadow: false`: the pleated cubicle curtains) bakes the
    surface as if it did not occlude itself: for the length of its own bake the object is hidden from diffuse, glossy, transmission and
    shadow rays, so a pleat's valley is not darkened by its neighbouring folds (a thin, translucent fabric in diffuse light reads almost
    evenly lit; the bake had 4-6x stripes between neighbouring 3.5 cm facets, aliased and noisy at 3-7 cm a texel, which the game showed as
    dark smudges on a grey, 'metallic' curtain). It still occludes every OTHER material's bake as before. `blur` > 0 (materials.json
    `lightmapBlur`, texels): smooth_lightmap after the denoiser."""
    mat = o.data.materials[0]
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    # bake the irradiance of the smooth surface: the normal map's micro detail does not belong in a 2-5 cm lightmap texel
    unlinked = []
    for l in list(nt.links):
        if l.to_node == bsdf and l.to_socket.name == 'Normal':
            unlinked.append((l.from_socket, l.to_socket))
            nt.links.remove(l)
    img = bpy.data.images.new('bake_' + name, size, size, alpha=False, float_buffer=True)
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    metal_in = bsdf.inputs['Metallic']
    metal_links = [(l.from_socket, l.to_socket) for l in nt.links if l.to_socket == metal_in]
    for l in [l for l in nt.links if l.to_socket == metal_in]:
        nt.links.remove(l)
    metal = metal_in.default_value
    metal_in.default_value = 0.0
    vis = ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_shadow')
    was = {k: getattr(o, k) for k in vis}
    if not self_shadow:
        for k in vis:
            setattr(o, k, False)
    try:
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=12, margin_type='EXTEND', use_clear=True)
    finally:
        for k, v in was.items():
            setattr(o, k, v)
    nt.nodes.remove(node)
    metal_in.default_value = metal
    for a, b in metal_links + unlinked:
        nt.links.new(a, b)
    if use_denoise:
        dn = denoise(img, size)
        bpy.data.images.remove(img)
        img = dn
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = np.clip(np.nan_to_num(px.reshape(-1, 4)[:, :3], nan=0.0, posinf=0.0, neginf=0.0), 0.0, 400.0)
    if blur > 0:
        rgb = smooth_lightmap(rgb, size, blur)
    luma = rgb[:, 0] * 0.2126 + rgb[:, 1] * 0.7152 + rgb[:, 2] * 0.0722
    lit = luma[luma > 1e-4]
    # 99.5th percentile: sun patches keep most of their punch; only the very hottest texels clip
    p = float(np.percentile(lit, 99.5)) if lit.size else 1.0
    med = float(np.median(lit)) if lit.size else 1.0
    # the encoding range: up to 14x the median (so the bulk of the surface keeps its 8-bit precision); only tiny hot spots clip (the walls of
    # an LED slot, the lens of a downlight), sun patches stay inside it
    p = min(p, 14.0 * med)
    scale = max(0.25, math.ceil(p * 8) / 8)
    enc = np.clip(srgb_encode(np.clip(rgb / scale, 0, 1)), 0, 1)
    out = np.ones((size * size, 4), dtype=np.float32)
    out[:, :3] = enc
    fn = f'lm_{name}.png'
    res = bpy.data.images.new('lm_' + name, size, size, alpha=False)
    res.colorspace_settings.name = 'sRGB'
    res.pixels.foreach_set(out.reshape(-1))
    res.filepath_raw = os.path.join(outdir, fn)
    res.file_format = 'PNG'
    res.save()
    bpy.data.images.remove(img)
    bpy.data.images.remove(res)
    o['lightmap'] = fn
    o['lightmapScale'] = scale
    o['lightmapUv'] = 1
    print(f'baked {name}: {size}px, median {float(np.median(lit)) if lit.size else 0:.2f}, scale {scale}, area {surface_area(o):.0f} m2 -> {fn}', flush=True)


# --- the reflection probe ----------------------------------------------------------------------------------------------------------------------------
def render_probe(scene, path, at, samples=256, w=1024):
    """An equirectangular HDR panorama from plan point `at` (x, y, z), oriented for three.js: the image centre looks east (+x), the right
    quarter south (+z), up at the top (three's equirectUv: u = atan2(dir.z, dir.x) / 2pi + 0.5). Linear radiance, Radiance .hdr."""
    cam = bpy.data.cameras.new('Probe')
    cam.type = 'PANO'
    try:
        cam.panorama_type = 'EQUIRECTANGULAR'
    except Exception:
        cam.cycles.panorama_type = 'EQUIRECTANGULAR'
    o = bpy.data.objects.new('Probe', cam)
    scene.collection.objects.link(o)
    o.location = P(*at)
    # Cycles' equirectangular camera looks along its local -Z at the image centre; local +X is the image's right
    o.rotation_euler = (math.radians(90), 0, math.radians(-90))
    old = (scene.camera, scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.view_settings.view_transform,
           scene.view_settings.look, scene.view_settings.exposure, scene.render.image_settings.file_format, scene.render.filepath)
    scene.camera = o
    scene.render.resolution_x, scene.render.resolution_y = w, w // 2
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = 'HDR'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    (scene.camera, scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.view_settings.view_transform,
     scene.view_settings.look, scene.view_settings.exposure, scene.render.image_settings.file_format, scene.render.filepath) = old
    print('probe', path, flush=True)
