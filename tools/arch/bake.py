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


def unwrap(o, size, name=''):
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
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=4.0 / size, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    # smart project leaves long thin islands (slots, skirtings) in a corner: re-pack them, rotated, at one texel density, filling the square
    bpy.ops.uv.average_islands_scale()
    try:
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', scale=True, margin_method='FRACTION', margin=5.0 / size, shape_method='AABB')
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=5.0 / size)
    bpy.ops.object.mode_set(mode='OBJECT')


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


def bake_object(o, name, size, outdir, use_denoise=True):
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
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=12, margin_type='EXTEND', use_clear=True)
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
