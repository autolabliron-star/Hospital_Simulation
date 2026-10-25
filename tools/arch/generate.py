"""
The Blender generator (entry point): the hospital, zone by zone, in the approved lobby look ("clean clinical modern").

Builds a zone of tools/arch/zones.json TO the sim's floor plan (assets-src/arch/plan.json from `npm run arch:plan`, which carries every piece's
owning zone): the shell (shell.py: floors, walls, glazing, door frames, ceilings) and the zone's design (zones/<id>.py `build(ctx)`, see
zones/__init__.py for the ctx API); PBR materials with CC0 textures at real scale (materials.py, materials.json); bevels with hardened normals;
the light baked in Cycles (bake.py) with the neighbouring zones and the rest of the building present as light blockers and bounce (never
exported); one glb per zone with lightmaps on TEXCOORD_1; then tools/arch/optimize.mjs ships it.

Run headless (Blender 4.5; other agents use Blender too, so go through the single-slot lock /private/tmp/claude-501/hospital-blender.sh):
  ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/arch/generate.py -- \
      --zone <id>|all|<id,id,...> [--draft] [--out assets-src/arch/out/zones] [--stills docs/screenshots] [--all-poses] [--blend] [--no-bake]

  --zone          the zone(s) to build; `all` builds every zone of zones.json in turn (one scene each)
  --draft         iteration quality: 64 bake samples, half-size lightmaps, probe and stills at 128 samples (~3-5 min a zone). Without it:
                  final quality, per-material samples from materials.json (512, 1024 on the hero surfaces), full-size lightmaps.
  --out <dir>     <dir>/<id>/: <id>.glb (both UV sets, node extras { lightmap, lightmapScale, lightmapUv: 1 }), lm_<Material>.png,
                  env_<id>.hdr (the probe, zones with a glossy floor or a PROBE), <id>.meta.json (numbers, bounds, timings), <id>.blend (--blend)
  --stills <dir>  the zone's review still zone-<id>-<draft|final>.jpg (1280x720, eye level, 24 mm, AgX Base Contrast) from the first pose;
                  --all-poses renders every pose of the design as zone-<id>-<quality>-<i>.jpg
  --no-bake       build (and render stills / save the .blend) without baking or exporting
  --bake-samples N, --bake-only A,B, --density, --max-lightmap, --lightmap-budget-mb, --no-denoise, --probe-samples, --exposure: see below.

Lightmap sizes: a material's forced size (materials.json `lightmap`) or one by its area (--density texels per m2); then, while the zone's lightmaps
are over its budget (zones.json budgets.perZone.lightmapMB, GPU MB with mips at 1 byte a texel), the most over-resolved map (texels per m2) is
halved. --draft halves every map after that (never below 128).

Frame: the plan's metres, x east, z south, y up (level 2 at its level y from plan.json); Blender is z up, so a plan point (x, y, z) goes to
Blender (x, -z, y).
"""
import argparse
import json
import math
import os
import sys
import time
import traceback

import bpy

sys.dont_write_bytecode = True        # no __pycache__ in tools/arch
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bake as bk  # noqa: E402
import materials as mt  # noqa: E402
import shell  # noqa: E402
import zones as zn  # noqa: E402
from common import P, Geo  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

# --- arguments ------------------------------------------------------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--plan', default=os.path.join(ROOT, 'assets-src', 'arch', 'plan.json'))
ap.add_argument('--zones', default=os.path.join(HERE, 'zones.json'))
ap.add_argument('--zone', required=True, help='zone id, comma-separated ids, or all')
ap.add_argument('--out', default=os.path.join(ROOT, 'assets-src', 'arch', 'out', 'zones'))
ap.add_argument('--draft', action='store_true')
ap.add_argument('--no-bake', action='store_true')
ap.add_argument('--no-context', action='store_true', help='debug: no neighbours, stand-ins or roofs')
ap.add_argument('--stills', default='', help='directory for zone-<id>-<quality>.jpg')
ap.add_argument('--all-poses', action='store_true')
ap.add_argument('--still-samples', type=int, default=0, help='0 = 128 draft, 384 final')
ap.add_argument('--blend', action='store_true', help='save <out>/<id>/<id>.blend')
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--res', type=int, default=1280)
ap.add_argument('--exposure', type=float, default=1.2)
ap.add_argument('--bake-samples', type=int, default=0, help='Cycles samples for every lightmap (0 = per material; 64 with --draft)')
ap.add_argument('--bake-only', default='', help='comma-separated material names: bake just these (testing; no export)')
ap.add_argument('--density', type=float, default=400.0, help='lightmap texels per square metre when a material forces no size')
ap.add_argument('--max-lightmap', type=int, default=2048)
ap.add_argument('--lightmap-budget-mb', type=float, default=0.0, help='0 = zones.json budgets.perZone.lightmapMB')
ap.add_argument('--no-denoise', action='store_true')
ap.add_argument('--probe-samples', type=int, default=0, help='0 = 128 draft, 512 final')
args = ap.parse_args(argv)

PLAN = json.load(open(args.plan))
ZDOC = json.load(open(args.zones))
ZONES = ZDOC['zones']
QUALITY = 'draft' if args.draft else 'final'
LM_BUDGET = args.lightmap_budget_mb or float(ZDOC['budgets']['perZone']['lightmapMB'])
if not any('zone' in a for a in PLAN['areas']):
    sys.exit('plan.json has no zone fields: run `npm run arch:plan` first')
CTX_MATS = (('ctxGrass', '#62773f', 0.95), ('ctxHedge', '#3f5a2a', 0.9), ('ctxTrunk', '#5a4a3c', 0.9), ('ctxCanopy', '#557033', 0.85),
            ('ctxRoof', '#9a9893', 0.9))


def level_y(level):
    return next(lv['y'] for lv in PLAN['levels'] if lv['id'] == level)


def rects_of(z):
    return [(r['x0'], r['x1'], r['z0'], r['z1']) for r in z['rects']]


def _gap(r, q):
    dx = max(q[0] - r[1], r[0] - q[1], 0.0)
    dz = max(q[2] - r[3], r[2] - q[3], 0.0)
    return math.hypot(dx, dz)


def neighbours(zid):
    """Zones touching this one on its level (rects within 0.25 m), and zones over or under it (rects overlapping in plan)."""
    me = next(z for z in ZONES if z['id'] == zid)
    out = []
    for z in ZONES:
        if z['id'] == zid:
            continue
        gaps = [_gap(r, q) for r in rects_of(me) for q in rects_of(z)]
        if z['level'] == me['level'] and min(gaps) <= 0.25:
            out.append(z['id'])
        elif z['level'] != me['level']:
            overlap = any(min(r[1], q[1]) - max(r[0], q[0]) > 0.5 and min(r[3], q[3]) - max(r[2], q[2]) > 0.5 for r in rects_of(me) for q in rects_of(z))
            if overlap:
                out.append(z['id'])
    return out


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


def uv_project(o):
    sw = o.data.attributes.get('swatch')
    mt.project_uvs(o, (lambda p, sw=sw: sw.data[p.index].value) if sw else None)


def lm_mb(size):
    return size * size * 4 / 3 / (1024 * 1024)


def hero_fraction(o, hero):
    """The share of a mesh's area inside the hero rects (plan x0, x1, z0, z1)."""
    if not hero:
        return 0.0
    tot = inside = 0.0
    for p in o.data.polygons:
        x, z = p.center.x, -p.center.y
        tot += p.area
        if any(x0 <= x <= x1 and z0 <= z <= z1 for (x0, x1, z0, z1) in hero):
            inside += p.area
    return inside / tot if tot else 0.0


def plan_lightmaps(objs, mats, hero=()):
    """{material: size}: forced or by area, then fitted to the zone budget by halving, one step at a time, the map with the most texels per m2
    weighted down by its share in the hero spaces (so the lift lobby's vinyl goes before the reception desk); --draft then halves all."""
    area = {n: max(bk.surface_area(o), 1e-3) for n, o in objs.items() if mats[n].get('bake', True)}
    weight = {n: 0.25 + hero_fraction(objs[n], hero) for n in area}
    sizes = {}
    for n, a in area.items():
        forced = mt.lightmap_of(n)
        # a forced size is the most a material gets, not a floor: a zone with a few faces of it (the atrium's 10 terrazzo triangles, the
        # ER's accent strips) gets at most 4x the texels its area asks for, which leaves the budget to the maps that need it
        sizes[n] = min(int(forced), args.max_lightmap, bk.lightmap_size(a, args.density * 4, args.max_lightmap)) if forced \
            else bk.lightmap_size(a, args.density, args.max_lightmap)
    cuts = []
    while sum(lm_mb(s) for s in sizes.values()) > LM_BUDGET:
        cand = [n for n, s in sizes.items() if s > 128]
        if not cand:
            break
        n = max(cand, key=lambda k: sizes[k] * sizes[k] / area[k] / weight[k])
        sizes[n] //= 2
        cuts.append(f'{n}->{sizes[n]}')
    final = dict(sizes)
    if args.draft:
        sizes = {n: max(128, s // 2) for n, s in sizes.items()}
    return sizes, final, cuts


def finalize_nodes(geo, col, mats, ly):
    """The kit's movable named nodes (never lightmapped) as Blender objects, root nodes lifted to the level."""
    if not getattr(geo, 'kit_nodes', None) or zn.kit is None:
        return {}
    nodes = zn.kit.base.finalize_nodes(geo, col, mats, mt)
    for o in nodes.values():
        if o.parent is None and ly:
            o.location.z += ly
    return nodes


def bounds_of(objs):
    xs, ys, zs = [], [], []
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            c = mw @ v.co
            xs.append(c.x)
            ys.append(c.y)
            zs.append(c.z)
    r = lambda v: round(v, 3)  # noqa: E731
    # Blender (x, y, z) = plan (x, -z, y)
    return {'x0': r(min(xs)), 'x1': r(max(xs)), 'z0': r(-max(ys)), 'z1': r(-min(ys)), 'y0': r(min(zs)), 'y1': r(max(zs))}


def eye_camera(scene, pose, y0, lens=24.0):
    (x, z), (tx, tz) = pose
    cam = bpy.data.cameras.new('Eye')
    cam.lens = lens
    cam.sensor_width = 36.0
    cam.clip_start = 0.05
    o = bpy.data.objects.new('Eye', cam)
    scene.collection.objects.link(o)
    o.location = P(x, y0 + 1.6, z)
    bx, by = tx - x, -(tz - z)
    o.rotation_euler = (math.radians(90), 0, math.atan2(by, bx) - math.pi / 2)
    return o


def render_still(scene, pose, y0, path, samples):
    scene.camera = eye_camera(scene, pose, y0)
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
    return round(time.time() - t)


# --- one zone -------------------------------------------------------------------------------------------------------------------------------------
def run_zone(zid):
    t0 = time.time()
    timings = {}
    zone = next(z for z in ZONES if z['id'] == zid)
    out_dir = os.path.join(os.path.abspath(args.out), zid)
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.startswith('lm_') and f.endswith('.png') and not args.bake_only and not args.no_bake:
            os.remove(os.path.join(out_dir, f))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    col = bpy.data.collections.new('Zone_' + zid)
    scene.collection.children.link(col)
    MATS = mt.build_all()
    for k, c, r in CTX_MATS:
        MATS[k] = mt.build_material(k, {'color': c, 'roughness': r})

    # the zone (exported)
    ly = level_y(zone['level'])
    geo = Geo(y0=ly)
    pl, ctx, design = zn.build_zone(geo, PLAN, ZONES, zid, draft=args.draft)
    OBJS = geo.finalize(col, MATS)
    for name, o in OBJS.items():
        w, s = mt.bevel_of(name)
        bevel(o, w, s)
        uv_project(o)
    NODES = finalize_nodes(geo, col, MATS, ly)
    anchors = [dict(a, p=[a['p'][0], round(a['p'][1] + ly, 4), a['p'][2]]) for a in getattr(geo, 'kit_anchors', [])]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in list(OBJS.values()) + [n for n in NODES.values() if n.type == 'MESH'])
    timings['build'] = round(time.time() - t0)
    print(f'[{zid}] built {len(OBJS)} meshes ({", ".join(sorted(OBJS))}), {tris} triangles in {timings["build"]}s', flush=True)

    # the context (never exported): neighbours built whole, stand-ins for the rest, roofs, the lawn
    t1 = time.time()
    lit = [ctx]
    nbs = [] if args.no_context else neighbours(zid)
    if not args.no_context:
        ctx_col = bpy.data.collections.new('Context')
        scene.collection.children.link(ctx_col)
        for nid in nbs:
            nz = next(z for z in ZONES if z['id'] == nid)
            g = Geo(y0=level_y(nz['level']))
            try:
                _pl, nctx, _d = zn.build_zone(g, PLAN, ZONES, nid, draft=True, context=True)
                lit.append(nctx)
            except Exception:      # noqa: BLE001  a broken neighbour design must not stop this zone's bake: fall back to its stand-ins
                traceback.print_exc()
                print(f'[{zid}] neighbour {nid}: design failed, using stand-ins', flush=True)
                g = Geo(y0=level_y(nz['level']))
                shell.stand_ins(g, PLAN, nz['level'], {z['id'] for z in ZONES if z['id'] != nid})
            for o in g.finalize(ctx_col, MATS, prefix=f'ctx_{nid}_').values():
                uv_project(o)
            finalize_nodes(g, ctx_col, MATS, level_y(nz['level']))
        exclude = {zid, *nbs}
        for lv in PLAN['levels']:
            g = Geo(y0=lv['y'])
            shell.stand_ins(g, PLAN, lv['id'], exclude)
            shell.roof(g, PLAN, lv['id'])
            if lv['id'] == 1:
                shell.landscape(g)
            for o in g.finalize(ctx_col, MATS, prefix=f'ctx_L{lv["id"]}_').values():
                uv_project(o)
    timings['context'] = round(time.time() - t1)
    print(f'[{zid}] context: neighbours {nbs} in {timings["context"]}s', flush=True)

    # light
    bk.setup_cycles(scene, args.samples)
    world_info = bk.setup_world(scene)
    for c in lit:
        for (x, z, ch, power) in c.downlights:
            bk.add_downlights(scene, [(x, z)], ch + c.level_y, power)
        for fn in c.lights:
            fn(scene, c.level_y)
    scene.view_settings.exposure = args.exposure

    # bake
    bake_info = {}
    lm_sizes, lm_final, cuts = plan_lightmaps(OBJS, MATS, pl.hero)
    if not args.no_bake:
        tb = time.time()
        scene.render.bake.use_clear = True
        only = set(filter(None, args.bake_only.split(',')))
        per = {}
        for name, o in OBJS.items():
            if name not in lm_sizes or (only and name not in only):
                continue
            samples = args.bake_samples or (64 if args.draft else mt.bake_samples_of(name))
            scene.cycles.samples = samples
            ts = time.time()
            bk.unwrap(o, lm_sizes[name], name, mt.unwrap_of(name))
            bk.bake_object(o, name, lm_sizes[name], out_dir, not args.no_denoise, self_shadow=mt.self_shadow_of(name))
            per[name] = {'size': lm_sizes[name], 'samples': samples, 'seconds': round(time.time() - ts, 1)}
        scene.cycles.samples = args.samples
        bake_info = {'seconds': round(time.time() - tb), 'quality': QUALITY, 'lightmaps': per, 'budgetCuts': cuts}
        timings['bake'] = bake_info['seconds']
        print(f'[{zid}] bake done in {bake_info["seconds"]}s ({QUALITY})', flush=True)

    # probe: a design's PROBE, else the largest area's centre when a floor is glossy
    probe_at = getattr(design, 'PROBE', None)
    glossy = [m for m in {pl.floor_mat(a['id']) for a in pl.areas()} if mt.SPEC['materials'].get(m, {}).get('roughness', 1) <= 0.3]
    if probe_at is None and glossy:
        r = zn.largest_area(pl)
        probe_at = ((r['x0'] + r['x1']) / 2, 1.6, (r['z0'] + r['z1']) / 2)
    probe_file = None
    if probe_at is not None and not args.no_bake:
        tp = time.time()
        probe_file = f'env_{zid}.hdr'
        x, y, z = probe_at
        bk.render_probe(scene, os.path.join(out_dir, probe_file), (x, y + ly, z), samples=args.probe_samples or (128 if args.draft else 512))
        timings['probe'] = round(time.time() - tp)

    # stills
    if args.stills:
        os.makedirs(args.stills, exist_ok=True)
        poses = zn.poses_of(design, pl)
        if not args.all_poses:
            poses = poses[:1]
        samples = args.still_samples or (128 if args.draft else 384)
        ts = time.time()
        for i, pose in enumerate(poses, 1):
            name = f'zone-{zid}-{QUALITY}.jpg' if not args.all_poses else f'zone-{zid}-{QUALITY}-{i}.jpg'
            render_still(scene, pose, ly, os.path.join(args.stills, name), samples)
        timings['stills'] = round(time.time() - ts)

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f'{zid}.blend'))

    # export (only the zone's own meshes)
    if not args.no_bake and not args.bake_only:
        glb = os.path.join(out_dir, f'{zid}.glb')
        bpy.context.view_layer.update()
        bounds = bounds_of(list(OBJS.values()) + list(NODES.values()))
        for m in MATS.values():
            if m.get('cyclesGlass'):
                mt.glass_for_export(m)
            for k in list(m.keys()):
                del m[k]
        for o in OBJS.values():
            if 'swatch' in o.data.attributes:
                o.data.attributes.remove(o.data.attributes['swatch'])
        scene['zone'] = zid
        scene['level'] = zone['level']
        bpy.ops.object.select_all(action='DESELECT')
        for o in list(OBJS.values()) + list(NODES.values()):
            o.select_set(True)
        bpy.context.view_layer.objects.active = next(iter(OBJS.values()))
        bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_extras=True, export_yup=True,
                                  export_texcoords=True, export_normals=True, export_materials='EXPORT', export_apply=False,
                                  export_cameras=False, export_lights=False, export_image_format='AUTO', export_tangents=False)
        meta = {
            'zone': zid, 'level': zone['level'], 'levelY': ly, 'quality': QUALITY, 'world': world_info, 'bake': bake_info,
            'triangles': tris, 'meshes': sorted(OBJS), 'bounds': bounds, 'neighbours': nbs,
            'probe': probe_file, 'probeAt': [probe_at[0], probe_at[1] + ly, probe_at[2]] if probe_file else None,
            'lightmapSizes': lm_sizes, 'lightmapSizesFinal': lm_final,
            'lightmapMB': round(sum(lm_mb(s) for s in lm_sizes.values()), 2), 'lightmapMBFinal': round(sum(lm_mb(s) for s in lm_final.values()), 2),
            'timings': timings, 'seconds': round(time.time() - t0),
        }
        meta['nodes'] = sorted(NODES)
        # the design's runtime hints (src/scene/building/model/zones.ts): the procedural furniture it replaces, and the zones it can be seen from
        meta['replaces'] = list(getattr(design, 'REPLACES', []))
        meta['visibleFrom'] = list(getattr(design, 'VISIBLE_FROM', []))
        meta['anchors'] = f'{zid}.anchors.json' if anchors else None
        with open(os.path.join(out_dir, f'{zid}.meta.json'), 'w') as fh:
            json.dump(meta, fh, indent=1)
        if anchors:
            with open(os.path.join(out_dir, f'{zid}.anchors.json'), 'w') as fh:
                json.dump({'zone': zid, 'level': zone['level'], 'levelY': ly, 'frame': 'plan metres as drawn, y absolute', 'anchors': anchors}, fh, indent=1)
        print(f'[{zid}] exported {glb}', flush=True)
    print(f'[{zid}] done in {time.time() - t0:.0f}s {json.dumps(timings)}', flush=True)


ids = [z['id'] for z in ZONES] if args.zone == 'all' else [s for s in args.zone.split(',') if s]
unknown = [i for i in ids if i not in {z['id'] for z in ZONES}]
if unknown:
    sys.exit(f'unknown zone(s) {unknown}; zones.json has {[z["id"] for z in ZONES]}')
failed = []
T0 = time.time()
for zid in ids:
    try:
        run_zone(zid)
    except Exception:      # noqa: BLE001  report and go on with the next zone
        traceback.print_exc()
        failed.append(zid)
print(f'generate.py: {len(ids) - len(failed)}/{len(ids)} zones in {time.time() - T0:.0f}s' + (f'; FAILED {failed}' if failed else ''), flush=True)
if failed:
    sys.exit(1)
