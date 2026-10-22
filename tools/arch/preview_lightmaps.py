"""
The runtime look, previewed in Blender: every baked mesh of the saved .blend shaded as the game shades it (src/scene/building/model/lightmaps.ts:
diffuse = albedo x lightmap x lightmapScale, no live lights), so leaks, seams and blotchy texels show before a browser ever loads the model.

  ~/Applications/Blender.app/Contents/MacOS/Blender -b assets-src/arch/out/pilot-lobby.blend -P tools/arch/preview_lightmaps.py -- \
      --lightmaps assets-src/arch/out --out <dir> [--exposure 1.5] [--samples 32] [--res 960]

Writes <dir>/lightmap-preview-{1..4}.jpg from the four review poses. Specular is left out (the game adds the environment's), so floors read flatter.
"""
import argparse
import math
import os
import sys

import bpy

sys.dont_write_bytecode = True        # no __pycache__ in tools/arch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import P  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--lightmaps', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--exposure', type=float, default=1.5)
ap.add_argument('--samples', type=int, default=32)
ap.add_argument('--res', type=int, default=960)
args = ap.parse_args(argv)

scene = bpy.context.scene
for o in list(bpy.data.objects):
    if not o.name.startswith('arch_') or 'lightmap' not in o:
        continue
    src = o.data.materials[0]
    m = src.copy()
    m.name = 'lm_preview_' + src.name
    o.data.materials[0] = m
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    out = nt.nodes['Material Output']
    link = next((l for l in nt.links if l.to_socket == bsdf.inputs['Base Color']), None)
    img = bpy.data.images.load(os.path.join(os.path.abspath(args.lightmaps), o['lightmap']))
    img.colorspace_settings.name = 'sRGB'
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'Lightmap'
    lm = nt.nodes.new('ShaderNodeTexImage')
    lm.image = img
    nt.links.new(uv.outputs['UV'], lm.inputs['Vector'])
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    if link:
        nt.links.new(link.from_socket, mul.inputs['A'])
    else:
        mul.inputs['A'].default_value = bsdf.inputs['Base Color'].default_value
    nt.links.new(lm.outputs['Color'], mul.inputs['B'])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = float(o['lightmapScale'])
    nt.links.new(mul.outputs['Result'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])

POSES = [((-61.0, 0.0), (-44.0, 0.0)), ((-48.5, 1.5), (-51.5, -3.0)), ((-46.5, 0.0), (-62.0, 0.0)), ((-55.5, 0.5), (-59.6, 5.3))]
os.makedirs(args.out, exist_ok=True)
scene.cycles.samples = args.samples
scene.view_settings.exposure = args.exposure
scene.render.resolution_x = args.res
scene.render.resolution_y = int(args.res * 9 / 16)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'JPEG'
for i, ((x, z), (tx, tz)) in enumerate(POSES, 1):
    cam = bpy.data.cameras.new('Eye')
    cam.lens = 24.0
    cam.sensor_width = 36.0
    o = bpy.data.objects.new('Eye', cam)
    scene.collection.objects.link(o)
    o.location = P(x, 1.6, z)
    o.rotation_euler = (math.radians(90), 0, math.atan2(-(tz - z), tx - x) - math.pi / 2)
    scene.camera = o
    scene.render.filepath = os.path.join(os.path.abspath(args.out), f'lightmap-preview-{i}.jpg')
    bpy.ops.render.render(write_still=True)
    print('preview', scene.render.filepath, flush=True)
