"""
Wave 3 "The architectural model": the Blender generator (entry point). Look pass: the lobby as a real architectural space.

Builds realistic architecture TO the sim's floor plan (assets-src/arch/plan.json from `npm run arch:plan`) and, for the hero space, a designed
interior (lobby.py) on the sim's own furniture anchors; PBR materials with CC0 textures at real scale (materials.py, materials.json); bevels with
hardened normals; the light baked in Cycles (bake.py).

Run headless (Blender 4.5):
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/arch/generate.py -- \
      --plan assets-src/arch/plan.json --region pilot [--stills docs/screenshots] [--render out.png] [--blend out.blend] \
      [--bake <dir>] [--export f.glb] [--probe public/assets/building/env_lobby.hdr]

  --bake <dir>      one mesh per material (arch_<Material>, built that way, vertices in world coordinates), UV set 'Lightmap' (TEXCOORD_1), Cycles
                    DIFFUSE direct+indirect (no colour) into <dir>/lm_<Material>.png, sRGB 8 bit; linear radiance = decoded * lightmapScale.
  --export f.glb    glTF binary: UVMap = TEXCOORD_0 (world box projection at the material's real tile size), Lightmap = TEXCOORD_1, PBR materials
                    with image textures, node extras { lightmap, lightmapScale, lightmapUv: 1 } on every baked mesh (not the emitters, not the glass).
  --stills <dir>    four eye-level review stills lobby-blender-{1..4}.jpg (1280x720, 24 mm, AgX Base Contrast).
  --probe f.hdr     the lobby's reflection probe: a 1024x512 equirectangular Radiance HDR from the lobby centre at 1.6 m (centre = east, three.js frame).
  --bake-samples N  Cycles samples for every lightmap (default 0 = per material from materials.json, 512 unless set; ~25 min in all). Use 64-128
                    for a quick look (~4 min); --bake-only A,B bakes just those materials.
Modules: common.py (frame, geometry), materials.py + materials.json (PBR library), shell.py (architecture to the plan), lobby.py (the hero
design), furniture.py (parametric pieces), bake.py (world, sun, lamps, lightmaps, probe); preview_lightmaps.py renders the runtime look.

Frame: the plan's metres, x east, z south, y up; Blender is z up, so a plan point (x, y, z) goes to Blender (x, -z, y).
"""
import argparse
import json
import math
import os
import sys
import time

import bpy

sys.dont_write_bytecode = True        # no __pycache__ in tools/arch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bake as bk  # noqa: E402
import lobby  # noqa: E402
import materials as mt  # noqa: E402
import shell  # noqa: E402
from common import P, Geo  # noqa: E402

T0 = time.time()

# --- arguments ------------------------------------------------------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--plan', required=True)
ap.add_argument('--region', default='pilot')
ap.add_argument('--render', default='', help='one still from pose 1 (legacy)')
ap.add_argument('--stills', default='', help='directory for lobby-blender-{1..4}.jpg')
ap.add_argument('--still-samples', type=int, default=384)
ap.add_argument('--only-still', type=int, default=0, help='render just this pose (1..4)')
ap.add_argument('--blend', default='')
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--res', type=int, default=1280)
ap.add_argument('--exposure', type=float, default=1.2)
ap.add_argument('--bake', default='', help='directory: bake Cycles lightmaps (PNG) for every mesh there')
ap.add_argument('--export', default='', help='path of the .glb to write (needs --bake for lightmaps; both UV sets, node extras)')
ap.add_argument('--bake-samples', type=int, default=0, help='Cycles samples for every lightmap (0 = per material, materials.json bakeSamples, default 512)')
ap.add_argument('--bake-only', default='', help='comma-separated material names: bake just these (testing)')
ap.add_argument('--density', type=float, default=400.0, help='lightmap texels per square metre of surface (when a material forces none)')
ap.add_argument('--no-denoise', action='store_true')
ap.add_argument('--max-lightmap', type=int, default=2048)
ap.add_argument('--probe', default='', help='path of the equirectangular .hdr reflection probe of the lobby')
ap.add_argument('--probe-samples', type=int, default=512)
args = ap.parse_args(argv)

plan = json.load(open(args.plan))

# region bounds (x0, x1, z0, z1, level); 'pilot' mirrors src/scene/building/model/region.ts PILOT_REGION
REGIONS = {'pilot': (-62.5, -30.0, -16.5, 16.5, 1), 'all1': (-63, 41, -23, 23, 1)}
pl = shell.Plan(plan, REGIONS[args.region])
pl.hero = [lobby.LOBBY, lobby.SPINE]

# --- scene ----------------------------------------------------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('Hospital')
scene.collection.children.link(col)

MATS = mt.build_all()
geo = Geo()
shell.floors(geo, pl)
shell.walls(geo, pl, skip=lobby.in_lobby_facade)
shell.doors(geo, pl, frame_mat=lobby.door_accent, skip=('entrance',))
shell.ceilings(geo, pl)
shell.paving(geo, pl)
lobby.build(geo, pl, plan)
OBJS = geo.finalize(col, MATS)
# the neighbours (never exported): closes the region for renders and bakes
ctx_col = bpy.data.collections.new('Context')
scene.collection.children.link(ctx_col)
ctx = Geo()
shell.context(ctx, pl)
shell.landscape(ctx, pl)
for _k, _c, _r in (('ctxGrass', '#62773f', 0.95), ('ctxHedge', '#3f5a2a', 0.9), ('ctxTrunk', '#5a4a3c', 0.9), ('ctxCanopy', '#557033', 0.85)):
    MATS[_k] = mt.build_material(_k, {'color': _c, 'roughness': _r})
for _n, _o in ctx.finalize(ctx_col, MATS).items():
    _o.name = 'ctx_' + _n


def bevel(o, width, segments):
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


for name, o in OBJS.items():
    w, s = mt.bevel_of(name)
    bevel(o, w, s)
    sw = o.data.attributes.get('swatch')
    mt.project_uvs(o, (lambda p, sw=sw: sw.data[p.index].value) if sw else None)

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in OBJS.values())
print(f'built {len(OBJS)} meshes ({", ".join(sorted(OBJS))}), {tris} triangles in {time.time() - T0:.0f}s', flush=True)

# --- light --------------------------------------------------------------------------------------------------------------------------------------
bk.setup_cycles(scene, args.samples)
world_info = bk.setup_world(scene)
bk.add_downlights(scene, lobby.DOWNLIGHTS, lobby.CH)
scene.view_settings.exposure = args.exposure
print('world', world_info, flush=True)

# --- bake ---------------------------------------------------------------------------------------------------------------------------------------
bake_info = {}
if args.bake:
    tb = time.time()
    os.makedirs(args.bake, exist_ok=True)
    scene.render.bake.use_clear = True
    only = set(filter(None, args.bake_only.split(',')))
    for name, o in OBJS.items():
        if not MATS[name].get('bake', True) or (only and name not in only):
            continue
        scene.cycles.samples = args.bake_samples or mt.bake_samples_of(name)
        size = bk.lightmap_size(bk.surface_area(o), args.density, args.max_lightmap, mt.lightmap_of(name))
        bk.unwrap(o, size, name)
        bk.bake_object(o, name, size, args.bake, not args.no_denoise)
    scene.cycles.samples = args.samples
    bake_info = {'seconds': round(time.time() - tb), 'samples': args.bake_samples or 'per material'}
    print(f'bake done in {bake_info["seconds"]}s', flush=True)

# --- stills -------------------------------------------------------------------------------------------------------------------------------------
# eye-level review poses (plan x, z) -> look at (x, z); eye 1.6 m, level camera, 24 mm
POSES = [((-61.0, 0.0), (-44.0, 0.0)), ((-48.5, 1.5), (-51.5, -3.0)), ((-46.5, 0.0), (-62.0, 0.0)), ((-55.5, 0.5), (-59.6, 5.3))]


def eye_camera(pose, lens=24.0):
    (x, z), (tx, tz) = pose
    cam = bpy.data.cameras.new('Eye')
    cam.lens = lens
    cam.sensor_width = 36.0
    cam.clip_start = 0.05
    o = bpy.data.objects.new('Eye', cam)
    scene.collection.objects.link(o)
    o.location = P(x, 1.6, z)
    bx, by = tx - x, -(tz - z)
    o.rotation_euler = (math.radians(90), 0, math.atan2(by, bx) - math.pi / 2)
    return o


def render_still(pose, path, samples):
    o = eye_camera(pose)
    scene.camera = o
    scene.cycles.samples = samples
    scene.render.resolution_x = args.res
    scene.render.resolution_y = int(args.res * 9 / 16)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'JPEG' if path.lower().endswith('.jpg') else 'PNG'
    scene.render.image_settings.quality = 92
    scene.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'rendered {path} in {time.time() - t:.0f}s', flush=True)


if args.stills:
    os.makedirs(args.stills, exist_ok=True)
    for i, pose in enumerate(POSES, 1):
        if args.only_still and i != args.only_still:
            continue
        render_still(pose, os.path.join(args.stills, f'lobby-blender-{i}.jpg'), args.still_samples)
if args.render:
    render_still(POSES[0], args.render, args.samples)

if args.probe:
    os.makedirs(os.path.dirname(os.path.abspath(args.probe)), exist_ok=True)
    bk.render_probe(scene, os.path.abspath(args.probe), (-53.0, 1.6, 0.0), samples=args.probe_samples)

if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))

# --- export -------------------------------------------------------------------------------------------------------------------------------------
if args.export:
    for m in MATS.values():
        if m.get('cyclesGlass'):
            mt.glass_for_export(m)
        for k in list(m.keys()):
            del m[k]
    for o in OBJS.values():
        if 'swatch' in o.data.attributes:
            o.data.attributes.remove(o.data.attributes['swatch'])
    bpy.ops.object.select_all(action='DESELECT')
    for o in OBJS.values():
        o.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(OBJS.values()))
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.export), export_format='GLB', use_selection=True, export_extras=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_apply=False,
                              export_cameras=False, export_lights=False, export_image_format='AUTO', export_tangents=False)
    meta = {'world': world_info, 'bake': bake_info, 'triangles': tris, 'meshes': sorted(OBJS)}
    with open(os.path.splitext(os.path.abspath(args.export))[0] + '.meta.json', 'w') as fh:
        json.dump(meta, fh, indent=1)
    print('exported', args.export, flush=True)

print(f'generate.py done in {time.time() - T0:.0f}s', flush=True)
