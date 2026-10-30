"""
The Gaussian-splat pilot's training views (docs/research/real-simulation-engines.md, option A): from the zone's own Cycles scene (the one the bake
lights, neighbours and context included), render a seeded set of eye-level views, write their exact cameras as a Nerfstudio transforms.json
(OpenGL camera-to-world, Blender's own camera convention) and a starting point cloud sampled on the surfaces the views can see. A splat trainer
(Brush) learns the scene from these with no camera solving: the cameras are known.

Frame: everything stays in Blender's world (z up; a plan point (x, y, z) is Blender (x, -z, y)); tools/arch/splat-pack.mjs turns the trained splat
by -90 deg about x into the game's frame.

Called by generate.py --views <dir>. Seeded: the same zone gives the same views.
"""
import json
import math
import os
import random
import struct
import time

import bpy
from mathutils import Vector

from common import P


def _free(scene, depsgraph, origin, clearance):
    """No surface within `clearance` around `origin` (horizontally and up), and a floor under it."""
    for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0.7, 0.7, 0), (-0.7, 0.7, 0), (0.7, -0.7, 0), (-0.7, -0.7, 0), (0, 0, 1)):
        hit, *_ = scene.ray_cast(depsgraph, origin, Vector(d), distance=clearance)
        if hit:
            return False
    return True


def _floor_below(scene, depsgraph, origin, height):
    hit, loc, *_ = scene.ray_cast(depsgraph, origin, Vector((0, 0, -1)), distance=height + 0.3)
    return hit and abs((origin.z - loc.z) - height) < 0.2


def camera_set(scene, rects, ly, count, seed=7, spacing=1.3, inset=0.45):
    """Seeded eye-level views in `rects` (plan x0, x1, z0, z1): a grid of free positions, several headings each, heights and pitches varied."""
    rng = random.Random(seed)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    heights = (1.6, 1.25, 1.95, 1.6)
    views = []
    k = 0
    for (x0, x1, z0, z1) in rects:
        nx = max(1, int((x1 - x0 - 2 * inset) / spacing) + 1)
        nz = max(1, int((z1 - z0 - 2 * inset) / spacing) + 1)
        for i in range(nx):
            for j in range(nz):
                x = x0 + inset + (x1 - x0 - 2 * inset) * (i / max(1, nx - 1) if nx > 1 else 0.5) + rng.uniform(-0.2, 0.2)
                z = z0 + inset + (z1 - z0 - 2 * inset) * (j / max(1, nz - 1) if nz > 1 else 0.5) + rng.uniform(-0.2, 0.2)
                h = heights[k % len(heights)]
                k += 1
                o = Vector(P(x, ly + h, z))
                if not _floor_below(scene, depsgraph, o, h) or not _free(scene, depsgraph, o, 0.4):
                    continue
                base = rng.uniform(0, 2 * math.pi)
                for a in range(6):
                    yaw = base + a * math.pi / 3
                    pitch = rng.choice((-8, -8, -4, 6, -22))
                    views.append((x, h, z, yaw, pitch))
    rng.shuffle(views)
    views = views[:count]
    views.sort(key=lambda v: (round(v[0]), round(v[2]), v[3]))
    return views


def _camera(scene, lens):
    cam = bpy.data.cameras.new('SplatView')
    cam.lens = lens
    cam.sensor_width = 36.0
    cam.sensor_fit = 'HORIZONTAL'
    cam.clip_start = 0.05
    o = bpy.data.objects.new('SplatView', cam)
    scene.collection.objects.link(o)
    scene.camera = o
    return o


def _sample_points(objs, box, density, cap, rng):
    """Points on the surfaces inside `box` (Blender x0, x1, y0, y1, z0, z1), about `density` per m2, at most `cap`, grey (the trainer learns colour)."""
    tris = []
    total = 0.0
    for o in objs:
        if o.type != 'MESH':
            continue
        me = o.data
        me.calc_loop_triangles()
        mw = o.matrix_world
        vs = [mw @ v.co for v in me.vertices]
        for t in me.loop_triangles:
            a, b, c = (vs[i] for i in t.vertices)
            cx, cy, cz = (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3
            if not (box[0] <= cx <= box[1] and box[2] <= cy <= box[3] and box[4] <= cz <= box[5]):
                continue
            area = (b - a).cross(c - a).length / 2
            if area <= 1e-6:
                continue
            tris.append((a, b, c, area))
            total += area
    n = min(cap, int(total * density))
    pts = []
    if not tris or n <= 0:
        return pts
    # stratified by area: each triangle gets its share, the remainder drawn at random
    carry = 0.0
    for (a, b, c, area) in tris:
        carry += n * area / total
        m = int(carry)
        carry -= m
        for _ in range(m):
            r1, r2 = rng.random(), rng.random()
            if r1 + r2 > 1:
                r1, r2 = 1 - r1, 1 - r2
            p = a + (b - a) * r1 + (c - a) * r2
            pts.append((p.x, p.y, p.z))
    return pts


def _write_ply(path, pts):
    with open(path, 'wb') as fh:
        fh.write(('ply\nformat binary_little_endian 1.0\n'
                  f'element vertex {len(pts)}\n'
                  'property float x\nproperty float y\nproperty float z\n'
                  'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n').encode())
        for (x, y, z) in pts:
            fh.write(struct.pack('<fffBBB', x, y, z, 150, 150, 150))


def render_views(scene, rects, ly, out_dir, count=240, res=960, samples=64, lens=18.0, points_box=None, points_density=60.0,
                 points_cap=400_000, objs=()):
    """Render the views into out_dir/images, write out_dir/transforms.json and out_dir/points.ply. Returns a summary dict."""
    t0 = time.time()
    img_dir = os.path.join(out_dir, 'images')
    os.makedirs(img_dir, exist_ok=True)
    views = camera_set(scene, rects, ly, count)
    # the views hold the scene's own light, not a picture of it: Standard (sRGB-encoded linear radiance) at exposure 0, like the lightmaps;
    # the runtime decodes it to linear (Spark encodeLinear) and the game's one AgX pass tone-maps it with everything else. Above 1 clips.
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    w, h = res, int(res * 9 / 16)
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    # opaque RGBA, not RGB: Brush trains over black, where a faint splat with an over-bright colour looks the same as a solid one, so without an
    # alpha target the walls come out half transparent and the game shows what is behind them (the pilot's first run: sky through the ceiling).
    # With alpha 1 everywhere Brush's alpha loss (--match-alpha-weight) makes every pixel fully covered.
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.compression = 15
    scene.cycles.samples = samples
    # sharp views are 1920 px at few samples, so the per-view cost is the scene sync and the denoiser: keep Cycles' scene between views (only the
    # camera moves) and denoise on the GPU (OIDN, setup_cycles already turns it on with the albedo and normal guides)
    scene.render.use_persistent_data = True
    if hasattr(scene.cycles, 'denoising_use_gpu'):
        scene.cycles.denoising_use_gpu = True
    cam = _camera(scene, lens)
    fov_x = 2 * math.atan(18.0 / lens)
    frames = []
    for i, (x, hh, z, yaw, pitch) in enumerate(views):
        cam.location = P(x, ly + hh, z)
        # Blender camera: looks down its -z; (90 deg about x) looks along +y, then yaw about z. Plan heading `yaw` (atan2(dx, dz), 0 = +z south)
        # is Blender direction (sin yaw, -cos yaw): rotation z = yaw + pi (a camera at z-rot 0 looks along +y = plan north).
        cam.rotation_euler = (math.radians(90 + pitch), 0, yaw + math.pi)
        bpy.context.view_layer.update()
        name = f'{i:04d}.png'
        scene.render.filepath = os.path.join(img_dir, name)
        ts = time.time()
        bpy.ops.render.render(write_still=True)
        m = cam.matrix_world
        frames.append({'file_path': f'images/{name}', 'transform_matrix': [[m[r][c] for c in range(4)] for r in range(4)]})
        print(f'view {i + 1}/{len(views)} in {time.time() - ts:.1f}s', flush=True)
    doc = {'camera_model': 'OPENCV', 'camera_angle_x': fov_x, 'w': w, 'h': h, 'frames': frames,
           'frame': 'Blender world, z up (plan (x, y, z) = Blender (x, -z, y))'}
    pts = []
    if points_box is not None:
        pts = _sample_points(objs, points_box, points_density, points_cap, random.Random(11))
        _write_ply(os.path.join(out_dir, 'points.ply'), pts)
        doc['ply_file_path'] = 'points.ply'
    with open(os.path.join(out_dir, 'transforms.json'), 'w') as fh:
        json.dump(doc, fh)
    summary = {'views': len(frames), 'res': [w, h], 'samples': samples, 'lens': lens, 'colour': 'Standard, exposure 0 (linear radiance, sRGB-encoded)',
               'points': len(pts), 'seconds': round(time.time() - t0)}
    with open(os.path.join(out_dir, 'views.meta.json'), 'w') as fh:
        json.dump(summary, fh, indent=1)
    print(f'splat views: {json.dumps(summary)}', flush=True)
    return summary
