"""
Wave 3 "The architectural model": the Blender generator (pilot).

Builds realistic architecture TO the sim's floor plan (assets-src/arch/plan.json from `npm run arch:plan`): floors with material zones,
walls with real thickness and lintels over the doors, full-height glass partitions with mullions, skirting, a suspended ceiling of 600 mm
tiles with light panels, then (pilot) renders an eye-level Cycles view so the look can be judged before the bake/glTF export exists.

Run headless:
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/arch/generate.py -- \
      --plan assets-src/arch/plan.json --region pilot --render out.png [--blend out.blend]

Frame: the plan's metres, x east, z south, y up. Blender is z up, so a plan point (x, y, z) goes to Blender (x, -z, y).
Bake / export (see docs in the report and tools/arch/optimize.mjs):
  --bake <dir>      joins every material into ONE mesh node (arch_<Material>), adds the second UV set 'Lightmap' (glTF TEXCOORD_1), bakes
                    Cycles DIFFUSE direct+indirect (no colour) into <dir>/lm_<Material>.png, sRGB 8 bit; linear radiance = decoded * lightmapScale.
  --export f.glb    glTF binary: UVMap = TEXCOORD_0 (unused), Lightmap = TEXCOORD_1, base colour materials, node extras
                    { lightmap: 'lm_<Material>.png', lightmapScale: <number>, lightmapUv: 1 } on every baked mesh; panel and glass are not baked.
Materials are procedural for the pilot (no downloads yet); the CC0 texture sets come through the asset gate next.
"""
import argparse
import json
import math
import sys

import bpy

# --- arguments ------------------------------------------------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--plan', required=True)
ap.add_argument('--region', default='pilot')
ap.add_argument('--render', default='')
ap.add_argument('--blend', default='')
ap.add_argument('--samples', type=int, default=96)
ap.add_argument('--res', type=int, default=1280)
ap.add_argument('--bake', default='', help='directory: join the static architecture by material, add the Lightmap UV set, bake Cycles lightmaps (PNG) there')
ap.add_argument('--export', default='', help='path of the .glb to write (needs --bake for lightmaps; both UV sets, node extras)')
ap.add_argument('--bake-samples', type=int, default=64)
ap.add_argument('--density', type=float, default=400.0, help='lightmap texels per square metre of surface')
ap.add_argument('--no-denoise', action='store_true')
ap.add_argument('--max-lightmap', type=int, default=2048)
args = ap.parse_args(argv)

plan = json.load(open(args.plan))
WALL = plan['wall']
H = WALL['height']
T = WALL['thickness']
DOOR_H = WALL['doorHeight']

# the pilot: the entrance lobby and what is round it on level 1 (spine, triage/ER fronts, the start of the corridors)
REGIONS = {'pilot': (-62.5, -30.0, -16.5, 16.5, 1), 'all1': (-63, 41, -23, 23, 1)}
RX0, RX1, RZ0, RZ1, LEVEL = REGIONS[args.region]


def in_region(x0, z0, x1, z1):
    return not (max(x0, x1) < RX0 or min(x0, x1) > RX1 or max(z0, z1) < RZ0 or min(z0, z1) > RZ1)


def P(x, y, z):
    """Plan (x east, y up, z south) -> Blender (x, y north, z up)."""
    return (x, -z, y)


# --- scene ------------------------------------------------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('Hospital')
scene.collection.children.link(col)


def material(name, color, rough=0.6, metal=0.0, alpha=1.0, transmission=0.0, noise=None, emission=None, strength=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if transmission > 0:
        bsdf.inputs['Transmission Weight'].default_value = transmission
        bsdf.inputs['IOR'].default_value = 1.5
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    if noise:
        # a speckle (terrazzo, vinyl) from two noise scales mixed over the base colour, in object space so it does not stretch
        scale, dark, light = noise
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = scale
        tex.inputs['Detail'].default_value = 2.0
        coord = nt.nodes.new('ShaderNodeTexCoord')
        nt.links.new(coord.outputs['Object'], tex.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.45
        ramp.color_ramp.elements[0].color = (*dark, 1)
        ramp.color_ramp.elements[1].position = 0.62
        ramp.color_ramp.elements[1].color = (*light, 1)
        nt.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.04
        nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


MAT = {
    'terrazzo': material('Terrazzo', srgb('#d9d6cf'), 0.35, noise=(90.0, srgb('#bdb8ae'), srgb('#ece9e2'))),
    'vinyl': material('Vinyl', srgb('#c9d3cf'), 0.45, noise=(160.0, srgb('#b8c3bf'), srgb('#d6dfdb'))),
    'vinylWard': material('VinylWard', srgb('#cbbfa8'), 0.5, noise=(140.0, srgb('#b9ad96'), srgb('#d8ccb6'))),
    'wall': material('WallPaint', srgb('#f2f1ec'), 0.85),
    'wallAccent': material('WallAccent', srgb('#7fb9b0'), 0.8),
    'skirting': material('Skirting', srgb('#5d6a6b'), 0.5),
    'glass': material('Glass', srgb('#e8f2f2'), 0.03, transmission=1.0),
    'mullion': material('Mullion', srgb('#b9bfc2'), 0.3, metal=1.0),
    'ceiling': material('CeilingTile', srgb('#f4f4f1'), 0.9, noise=(400.0, srgb('#e6e6e2'), srgb('#f7f7f4'))),
    'grid': material('CeilingGrid', srgb('#e2e3e0'), 0.4, metal=0.6),
    'panel': material('LightPanel', srgb('#ffffff'), 0.5, emission=srgb('#fff6ea'), strength=18.0),
    'frame': material('DoorFrame', srgb('#c7ccce'), 0.35, metal=0.8),
    'outside': material('Paving', srgb('#a9a69f'), 0.8, noise=(30.0, srgb('#96938c'), srgb('#b8b5ae'))),
}


def box(name, x0, y0, z0, x1, y1, z1, mat):
    """An axis-aligned box in PLAN coordinates (x, y up, z)."""
    if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
        return None
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = name
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    o.location = P(cx, cy, cz)
    o.scale = (x1 - x0, z1 - z0, y1 - y0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(MAT[mat])
    for c in o.users_collection:
        c.objects.unlink(o)
    col.objects.link(o)
    return o


FLOOR_OF_KIND = {'public': 'terrazzo', 'clinical': 'vinyl', 'staff': 'vinyl', 'service': 'vinyl', 'ward': 'vinylWard'}

# --- floors and ceilings, per area ------------------------------------------------------------------------------------------------------------
for a in plan['areas']:
    if a['level'] != LEVEL:
        continue
    r = a['rect']
    if not in_region(r['x0'], r['z0'], r['x1'], r['z1']):
        continue
    x0, x1 = max(r['x0'], RX0), min(r['x1'], RX1)
    z0, z1 = max(r['z0'], RZ0), min(r['z1'], RZ1)
    kind = a['kind']
    fm = 'terrazzo' if a['id'] in ('lobby', 'spine', 'cafe') else FLOOR_OF_KIND.get(kind, 'vinyl')
    box(f"floor_{a['id']}", x0, -0.05, z0, x1, 0.0, z1, fm)
    ch = a['ceiling']
    if ch is None:
        continue
    # the suspended ceiling: a thin slab at the ceiling height, a T-grid every 600 mm, a 600x1200 light panel every 2.4 m
    box(f"ceiling_{a['id']}", x0, ch, z0, x1, ch + 0.02, z1, 'ceiling')
    gx = math.floor(x0 / 0.6) * 0.6
    while gx < x1:
        if gx > x0:
            box('grid', gx - 0.012, ch - 0.012, z0, gx + 0.012, ch, z1, 'grid')
        gx += 0.6
    gz = math.floor(z0 / 0.6) * 0.6
    while gz < z1:
        if gz > z0:
            box('grid', x0, ch - 0.012, gz - 0.012, x1, ch, gz + 0.012, 'grid')
        gz += 0.6
    px = math.floor(x0 / 2.4) * 2.4 + 1.2
    while px < x1 - 0.6:
        pz = math.floor(z0 / 2.4) * 2.4 + 1.2
        while pz < z1 - 0.3:
            if px > x0 + 0.6 and pz > z0 + 0.6:
                box('lightPanel', px - 0.3, ch - 0.01, pz - 0.6, px + 0.3, ch - 0.002, pz + 0.6, 'panel')
            pz += 2.4
        px += 2.4

# outside paving in front of the entrance
box('paving', RX0 - 12, -0.06, RZ0 - 6, -62.0 - T / 2, -0.01, RZ1 + 6, 'outside')

# --- walls -------------------------------------------------------------------------------------------------------------------------------------
for i, w in enumerate(plan['walls']):
    if w['level'] != LEVEL or w['cls'] == 'skip':
        continue
    if w['alongX']:
        x0, x1, z0, z1 = w['a'], w['b'], w['c'] - T / 2, w['c'] + T / 2
    else:
        x0, x1, z0, z1 = w['c'] - T / 2, w['c'] + T / 2, w['a'], w['b']
    if not in_region(x0, z0, x1, z1):
        continue
    name = f"wall{i}_{w['cls']}"
    if w['cls'] == 'solid':
        box(name, x0, 0, z0, x1, H, z1, 'wall')
        # skirting both sides, 100 mm tall, 12 mm proud
        if w['alongX']:
            box(name + '_skirtN', x0, 0, z0 - 0.012, x1, 0.1, z0, 'skirting')
            box(name + '_skirtS', x0, 0, z1, x1, 0.1, z1 + 0.012, 'skirting')
        else:
            box(name + '_skirtW', x0 - 0.012, 0, z0, x0, 0.1, z1, 'skirting')
            box(name + '_skirtE', x1, 0, z0, x1 + 0.012, 0.1, z1, 'skirting')
    else:
        # glazing: a sill to 0.0 (full) or 0.9 m (outer shell glazing), glass, and aluminium mullions every 1.2 m with a head transom
        sill = 0.0 if w['cls'] == 'glassFull' else 0.9
        if sill > 0:
            box(name + '_sill', x0, 0, z0, x1, sill, z1, 'wall')
        if w['alongX']:
            box(name + '_glass', x0, sill, w['c'] - 0.006, x1, H, w['c'] + 0.006, 'glass')
            n = max(1, round((x1 - x0) / 1.2))
            for k in range(n + 1):
                mx = x0 + (x1 - x0) * k / n
                box(name + '_mull', mx - 0.025, sill, w['c'] - 0.04, mx + 0.025, H, w['c'] + 0.04, 'mullion')
            box(name + '_head', x0, H - 0.06, w['c'] - 0.04, x1, H, w['c'] + 0.04, 'mullion')
        else:
            box(name + '_glass', w['c'] - 0.006, sill, z0, w['c'] + 0.006, H, z1, 'glass')
            n = max(1, round((z1 - z0) / 1.2))
            for k in range(n + 1):
                mz = z0 + (z1 - z0) * k / n
                box(name + '_mull', w['c'] - 0.04, sill, mz - 0.025, w['c'] + 0.04, H, mz + 0.025, 'mullion')
            box(name + '_head', w['c'] - 0.04, H - 0.06, z0, w['c'] + 0.04, H, z1, 'mullion')

# lintels and frames over the doors (the wall pieces stop at a door: fill above the door head, frame the opening)
for d in plan['doors']:
    if d['level'] != LEVEL:
        continue
    half = d['width'] / 2
    if d['wallAxis'] == 'x':
        x0, x1, z0, z1 = d['x'] - half, d['x'] + half, d['z'] - T / 2, d['z'] + T / 2
    else:
        x0, x1, z0, z1 = d['x'] - T / 2, d['x'] + T / 2, d['z'] - half, d['z'] + half
    if not in_region(x0, z0, x1, z1):
        continue
    if d['kind'] != 'opening':
        box(f"lintel_{d['id']}", x0, DOOR_H, z0, x1, H, z1, 'wall')
        f = 0.05
        if d['wallAxis'] == 'x':
            box('frame', x0 - f, 0, z0 - 0.01, x0, DOOR_H + f, z1 + 0.01, 'frame')
            box('frame', x1, 0, z0 - 0.01, x1 + f, DOOR_H + f, z1 + 0.01, 'frame')
            box('frame', x0 - f, DOOR_H, z0 - 0.01, x1 + f, DOOR_H + f, z1 + 0.01, 'frame')
        else:
            box('frame', x0 - 0.01, 0, z0 - f, x1 + 0.01, DOOR_H + f, z0, 'frame')
            box('frame', x0 - 0.01, 0, z1, x1 + 0.01, DOOR_H + f, z1 + f, 'frame')
            box('frame', x0 - 0.01, DOOR_H, z0 - f, x1 + 0.01, DOOR_H + f, z1 + f, 'frame')

# --- light, camera, render -----------------------------------------------------------------------------------------------------------------------
world = bpy.data.worlds.new('Sky')
scene.world = world
world.use_nodes = True
sky = world.node_tree.nodes.new('ShaderNodeTexSky')
sky.sky_type = 'NISHITA'
sky.sun_elevation = math.radians(38)
sky.sun_rotation = math.radians(200)
bg = world.node_tree.nodes['Background']
bg.inputs['Strength'].default_value = 0.35
world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])

sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 3.0
sun.angle = math.radians(1.0)
so = bpy.data.objects.new('Sun', sun)
so.rotation_euler = (math.radians(52), 0, math.radians(200))
col.objects.link(so)

cam = bpy.data.cameras.new('Eye')
cam.lens = 20
co = bpy.data.objects.new('Eye', cam)
col.objects.link(co)
scene.camera = co
# standing just inside the entrance, at eye height, looking east across the lobby
co.location = P(-60.6, 1.65, 1.4)
co.rotation_euler = (math.radians(88), 0, math.radians(-90 + 4))

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
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Base Contrast'
scene.render.resolution_x = args.res
scene.render.resolution_y = int(args.res * 9 / 16)
scene.render.image_settings.file_format = 'PNG'

print(f'generated {len(col.objects)} objects in region {args.region}')

# --- bake and export -----------------------------------------------------------------------------------------------------------------------------
NO_LIGHTMAP = ('LightPanel', 'Glass')          # emissive / see-through: drawn flat, no lightmap
DROP_DOWN_FACES = ('Terrazzo', 'Vinyl', 'VinylWard', 'Paving')   # floor slabs: the underside is never seen
baked = {}


def join_by_material():
    import bmesh
    groups = {}
    for o in list(col.objects):
        if o.type == 'MESH' and o.data.materials:
            groups.setdefault(o.data.materials[0].name, []).append(o)
    out = {}
    for mname, objs in sorted(groups.items()):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = 'arch_' + mname
        j.data.name = 'arch_' + mname
        j.data.transform(j.matrix_world)          # vertices in world (plan) coordinates, the node sits at the origin
        j.matrix_world = j.matrix_world.Identity(4)
        if mname in DROP_DOWN_FACES:
            bm = bmesh.new()
            bm.from_mesh(j.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.5], context='FACES')
            bm.to_mesh(j.data)
            bm.free()
        out[mname] = j
    return out


def surface_area(o):
    return sum(p.area for p in o.data.polygons)


def lightmap_size(area):
    texels = area * args.density / 0.55           # 55 % packing efficiency of the unwrap
    size = 256
    while size * size < texels and size < args.max_lightmap:
        size *= 2
    return size


def unwrap(o, size):
    me = o.data
    uv = me.uv_layers.new(name='Lightmap')
    me.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=6.0 / size, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def srgb_encode(v):
    import numpy as np
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(np.maximum(v, 1e-9), 1 / 2.4) - 0.055)


def denoise(img, size):
    """OpenImageDenoise over a float image through the compositor (Cycles bakes are not denoised); returns the denoised image."""
    import tempfile
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


def bake_object(o, name, size, outdir):
    import numpy as np
    mat = o.data.materials[0]
    nt = mat.node_tree
    img = bpy.data.images.new('bake_' + name, size, size, alpha=False, float_buffer=True)
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bsdf = nt.nodes['Principled BSDF']
    metal = bsdf.inputs['Metallic'].default_value
    bsdf.inputs['Metallic'].default_value = 0.0      # a metal has no diffuse term: bake the irradiance as if it were matt
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=10, margin_type='EXTEND', use_clear=True)
    nt.nodes.remove(node)
    bsdf.inputs['Metallic'].default_value = metal
    if not args.no_denoise:
        dn = denoise(img, size)
        bpy.data.images.remove(img)
        img = dn
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = np.clip(np.nan_to_num(px.reshape(-1, 4)[:, :3], nan=0.0, posinf=0.0, neginf=0.0), 0.0, 200.0)   # fireflies and holes out
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lit = luma[luma > 1e-4]
    p = float(np.percentile(lit, 97)) if lit.size else 1.0
    scale = max(0.5, math.ceil(p * 4) / 4)       # linear radiance of a white diffuse surface; the PNG holds value / scale
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
    print(f'baked {name}: {size}px, median {float(np.median(lit)) if lit.size else 0:.2f}, scale {scale}, area {surface_area(o):.0f} m2 -> {fn}')


if args.bake or args.export:
    import os
    joined = join_by_material()
    if args.bake:
        os.makedirs(args.bake, exist_ok=True)
        scene.cycles.samples = args.bake_samples
        scene.render.bake.use_clear = True
        for mname, o in joined.items():
            if mname in NO_LIGHTMAP:
                continue
            size = lightmap_size(surface_area(o))
            unwrap(o, size)
            bake_object(o, mname, size, args.bake)
        scene.cycles.samples = args.samples
    print('joined meshes', len(joined), 'triangles', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in joined.values()))


if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=args.blend)
if args.render:
    scene.render.filepath = args.render
    bpy.ops.render.render(write_still=True)
    print('rendered', args.render)

if args.export:
    # glass as plain alpha blending (transmission is too heavy for a headset); everything else keeps its base colour / emission
    g = bpy.data.materials.get('Glass')
    if g:
        b = g.node_tree.nodes['Principled BSDF']
        b.inputs['Transmission Weight'].default_value = 0.0
        b.inputs['Alpha'].default_value = 0.18
        for attr in ('blend_method', 'surface_render_method'):
            try:
                setattr(g, attr, 'BLEND' if attr == 'blend_method' else 'BLENDED')
            except Exception:
                pass
    bpy.ops.object.select_all(action='DESELECT')
    for o in joined.values():
        o.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(joined.values()))
    bpy.ops.export_scene.gltf(filepath=args.export, export_format='GLB', use_selection=True, export_extras=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_apply=False,
                              export_cameras=False, export_lights=False, export_image_format='AUTO')
    print('exported', args.export)
