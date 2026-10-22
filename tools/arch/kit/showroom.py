"""
The kit's review renders: small showroom rooms built with the shared material library and furnished with the kit, path traced with the lobby's
settings (Cycles, AgX Base Contrast, the CC0 HDRI with its sun from the west-south-west, 24 mm at eye level 1.6 m).

  /private/tmp/claude-501/hospital-blender.sh ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P tools/arch/kit/showroom.py -- --out docs/screenshots [--only 1,3] [--samples 256] [--res 1280] [--blend /tmp/kit.blend] [--nodes] [--dry]

Stills: kit-1-patient-room, kit-2-patient-room-sink, kit-3-er-bay, kit-4-theatre, kit-5-support, kit-6-cafe.
kit/selftest.py prints every item's triangle count, materials and node names.
"""
import argparse
import math
import os
import sys
import time

import bpy

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import bake as bk  # noqa: E402
import furniture as fu  # noqa: E402
import materials as mt  # noqa: E402
from common import Frame, Geo, P  # noqa: E402
from kit import arch, base, cafe, er, patient, support, theatre  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', default='docs/screenshots')
ap.add_argument('--only', default='')
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--res', type=int, default=1280)
ap.add_argument('--exposure', type=float, default=1.2)
ap.add_argument('--blend', default='')
ap.add_argument('--stats', action='store_true')
ap.add_argument('--dry', action='store_true', help='build only, no render')
ap.add_argument('--nodes', action='store_true', help='build the movable pieces as named nodes (tests finalize_nodes)')
args = ap.parse_args(argv)
T0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('Kit')
scene.collection.children.link(col)
MATS = mt.build_all()
for _k, _c, _r in (('ctxGrass', '#62773f', 0.95), ('ctxHedge', '#3f5a2a', 0.9)):
    MATS[_k] = mt.build_material(_k, {'color': _c, 'roughness': _r})
geo = Geo()
NODE = args.nodes


def nd(name):
    return name if NODE else None


# --- the showroom shell -----------------------------------------------------------------------------------------------------------------------------
T = 0.15


def room(x0, x1, z0, z1, ch, floor='SheetVinyl', walls=None, windows=(), cove=True, ceiling='tegular', panels=(), wall_default='WallClinical',
         rails=(), doors=()):
    """A closed room: floor, walls (per side material: walls={'N': 'WallTintBlue'}), windows [(side, a, b, sill, head)], a tegular or
    plaster ceiling with LED panels, coved skirting, crash rails [(side, a, b)]."""
    walls = walls or {}
    geo.box(floor, x0 - T, -0.05, z0 - T, x1 + T, 0.0, z1 + T, drop=('down',))
    sides = {'N': (True, z0, +1, x0, x1), 'S': (True, z1, -1, x0, x1), 'W': (False, x0, +1, z0, z1), 'E': (False, x1, -1, z0, z1)}
    for side, (along_x, face, into, a, b) in sides.items():
        m = walls.get(side, wall_default)
        outer = face - into * T
        cuts = sorted([w for w in windows if w[0] == side] + [(d[0], d[1], d[2], 0.0, d[3]) for d in doors if d[0] == side], key=lambda w: w[1])
        spans, cur = [], a - T
        for (_s, wa, wb, sill, head) in cuts:
            spans.append((cur, wa, 0, ch + 0.06))
            spans.append((wa, wb, 0, sill))
            spans.append((wa, wb, head, ch + 0.06))
            cur = wb
        spans.append((cur, b + T, 0, ch + 0.06))
        for (sa, sb, ya, yb) in spans:
            if sb - sa < 1e-4 or yb - ya < 1e-4:
                continue
            if along_x:
                geo.box(m, sa, ya, min(face, outer), sb, yb, max(face, outer))
            else:
                geo.box(m, min(face, outer), ya, sa, max(face, outer), yb, sb)
        for (_s, wa, wb, sill, head) in cuts:
            if sill > 0.0:
                window(along_x, face, into, wa, wb, sill, head)
        if cove and floor in ('SheetVinyl', 'TheatreFloor', 'SafetyVinyl'):
            segs = [(a, b)]
            for (_s, wa, wb, sill, head) in cuts:
                if sill < 0.12:
                    segs = [(sa, min(sb, wa)) for sa, sb in segs if sa < wa] + [(max(sa, wb), sb) for sa, sb in segs if sb > wb]
            for sa, sb in segs:
                arch.coved_skirting(geo, along_x, face, into, sa, sb, mat=floor)
    for (side, a, b) in rails:
        along_x, face, into, _a, _b = sides[side]
        arch.crash_rail(geo, along_x, face, into, a, b)
    if ceiling == 'tegular':
        arch.tegular_ceiling(geo, (x0, x1, z0, z1), ch, panels=panels)
    else:
        geo.box('CeilingPlaster', x0, ch, z0, x1, ch + 0.05, z1, drop=('up',))
        for (px, pz, pw, pd) in panels:
            geo.box('LightPanel', px - pw / 2, ch - 0.004, pz - pd / 2, px + pw / 2, ch, pz + pd / 2, drop=('up',))
    geo.box('CeilingPlaster', x0 - T, ch + 0.06, z0 - T, x1 + T, ch + 0.1, z1 + T)


def window(along_x, face, into, a, b, sill, head):
    """Glazing in an opening: slim graphite frame with a mullion every ~1.2 m, a solid-surface internal sill, glass."""
    def bx(t0, t1, u0, u1, ya, yb, m):
        c0, c1 = sorted((face - into * u0, face - into * u1))
        if along_x:
            geo.box(m, t0, ya, c0, t1, yb, c1)
        else:
            geo.box(m, c0, ya, t0, c1, yb, t1)
    mid = T * 0.55
    bx(a, b, mid - 0.03, mid + 0.03, sill, sill + 0.05, 'Mullion')
    bx(a, b, mid - 0.03, mid + 0.03, head - 0.05, head, 'Mullion')
    n = max(1, round((b - a) / 1.2))
    for i in range(n + 1):
        t = a + (b - a) * i / n
        bx(max(a, t - 0.025), min(b, t + 0.025), mid - 0.03, mid + 0.03, sill, head, 'Mullion')
    bx(a, b, mid - 0.004, mid + 0.004, sill + 0.05, head - 0.05, 'Glass')
    bx(a - 0.03, b + 0.03, -0.035, mid - 0.03, sill - 0.02, sill, 'SolidSurface')
    # reveals: the wall's own paint in the opening is the wall boxes' faces


def outside():
    """Ground outside the showroom windows (render only)."""
    g = Geo()
    g.box('ctxGrass', -60, -0.3, -60, 60, -0.06, 160)
    g.box('Paving', -8, -0.06, -40, 0.0, -0.04, 140)
    g.box('ctxHedge', -14, -0.06, -40, -12.5, 1.4, 140)
    for _n, o in g.finalize(col, MATS).items():
        o.name = 'ctx_' + _n


# --- vignettes ------------------------------------------------------------------------------------------------------------------------------------
POSES = {}


def patient_room(ox=0.0, oz=0.0):
    """A single-bed ward room (ward A): window to the west, the bed head on the north wall (blue tint), en-suite door, wardrobe, hand-wash
    station on the east wall."""
    x0, x1, z0, z1, ch = ox, ox + 4.6, oz, oz + 5.6, 2.7
    room(x0, x1, z0, z1, ch, walls={'N': 'WallTintBlue'}, windows=[('W', z0 + 1.0, z0 + 3.6, 0.75, 2.4)],
         panels=[(2, 2, 2, 1), (4, 6, 1, 2)], rails=[('E', z0 + 3.05, z1 - 0.2)], doors=[('E', z0 + 0.75, z0 + 1.71, 2.07)])
    bx, bz = x0 + 2.6, z0 + 1.18
    F = lambda x, z, h=0.0: Frame(x, z, h)
    patient.headwall(geo, F(bx, z0), width=2.1)
    patient.bed(geo, F(bx, bz), node=nd('bed:A1'), backrest=28)
    patient.monitor_arm(geo, F(bx - 1.2, z0), node=nd('monitorArm:A1'), swing1=40, swing2=-80)
    patient.locker(geo, F(bx + 0.88, z0 + 0.4), node=nd('locker:A1'))
    patient.overbed_table(geo, F(bx + 0.05, bz + 0.25, math.pi), node=nd('overbed:A1'))
    patient.iv_pole(geo, F(bx - 0.75, z0 + 0.55), node=nd('iv:A1'))
    patient.recliner(geo, F(x0 + 0.75, z0 + 2.7, math.radians(70)), node=nd('recliner:A1'))
    patient.visitor_chair(geo, F(x0 + 1.15, z0 + 3.9, math.radians(40)), node=nd('chair:A1'))
    patient.cubicle_curtains(geo, F(bx, bz), w=2.5, head_z=-1.18, foot_z=1.55, ceiling=ch, drawn=0.22)
    patient.door_leaf(geo, F(x1 + T / 2, z0 + 1.23, -math.pi / 2), node=nd('door:A1ensuite'), width=0.9, open_deg=0, hinge='left', wall=T)
    patient.wardrobe(geo, F(x1 - 0.31, z0 + 0.31, 0.0), w=0.6)
    patient.handwash(geo, F(x1, z0 + 2.55, -math.pi / 2), bins=True)
    patient.sharps_and_gloves(geo, F(x1, z0 + 4.1, -math.pi / 2))
    patient.wall_clock(geo, F(x1, z0 + 4.6, -math.pi / 2), y=2.05)
    # eye-level views
    POSES[1] = ((x1 - 0.5, 1.6, z1 - 0.35), (x0 + 1.5, 1.0, z0 + 0.9), 'kit-1-patient-room')
    POSES[2] = ((x0 + 1.25, 1.6, z1 - 0.4), (x1, 1.15, z0 + 1.9), 'kit-2-patient-room-sink')


def er_bay(ox=0.0, oz=0.0):
    """Two ER bays on a back wall with crash rail, bay curtains, a resus pendant, a crash cart; the nurse station opposite."""
    x0, x1, z0, z1, ch = ox, ox + 7.4, oz, oz + 7.0, 3.0
    room(x0, x1, z0, z1, ch, windows=[('W', z0 + 2.2, z0 + 4.8, 0.9, 2.5)], panels=[(2, 2, 2, 1), (8, 2, 2, 1), (5, 7, 2, 1)],
         rails=[('N', x0 + 0.2, x1 - 0.2)], walls={'N': 'WallClinical'})
    for i, cx in enumerate((x0 + 2.0, x0 + 5.3)):
        er.stretcher(geo, Frame(cx, z0 + 1.45), node=nd(f'trolley:ER{i + 1}'), backrest=20 + i * 15)
        patient.headwall(geo, Frame(cx, z0), width=1.9)
        er.bay_curtains(geo, Frame(cx, z0), w=3.0, depth=3.1, ceiling=ch, drawn=(0.25 if i == 0 else 0.2), start=(0.0 if i == 0 else 0.8))
        patient.monitor_arm(geo, Frame(cx - 1.1, z0), node=nd(f'monitorArm:ER{i + 1}'), swing1=35, swing2=-75)
    er.resus_pendant(geo, Frame(x0 + 5.3, z0 + 1.0), node=nd('pendant:resus'), ceiling=ch)
    er.crash_cart(geo, Frame(x0 + 3.65, z0 + 0.45), node=nd('crashCart:ER'))
    patient.iv_pole(geo, Frame(x0 + 1.2, z0 + 0.6), node=nd('iv:ER1'))
    er.nurse_station(geo, Frame(x0 + 4.4, z1 - 1.4, math.pi), length=3.2)
    support.office_chair(geo, Frame(x0 + 3.9, z1 - 0.7, math.pi), node=nd('chair:NS1'))
    support.office_chair(geo, Frame(x0 + 5.0, z1 - 0.65, math.pi + 0.3), node=nd('chair:NS2'))
    support.med_cart(geo, Frame(x0 + 6.6, z1 - 2.6, -math.pi / 2), node=nd('medCart:ER'))
    patient.wall_clock(geo, Frame(x0 + 4.4, z0, 0.0), y=2.55)
    POSES[3] = ((x0 + 0.75, 1.65, z1 - 0.35), (x0 + 4.4, 1.0, z0 + 1.0), 'kit-3-er-bay')


def theatre_room(ox=0.0, oz=0.0):
    """An operating theatre: anti-static floor, white walls with a blue tint band, a laminar-flow ceiling, the table, twin surgical lights,
    surgeon and anaesthesia pendants, the anaesthesia machine, instrument tables, a Mayo stand; the scrub sink on the wall by the door."""
    x0, x1, z0, z1, ch = ox, ox + 7.2, oz, oz + 7.2, 3.0
    room(x0, x1, z0, z1, ch, floor='TheatreFloor', walls={'N': 'WallTintBlue'}, ceiling='plaster',
         panels=[(ox + 1.2, oz + 1.2, 0.6, 1.2), (ox + 6.0, oz + 1.2, 0.6, 1.2), (ox + 1.2, oz + 6.0, 0.6, 1.2),
                 (ox + 6.0, oz + 6.0, 0.6, 1.2)])
    cx, cz = x0 + 3.6, z0 + 3.6
    theatre.laminar_canopy(geo, Frame(cx, cz), ceiling=ch)
    theatre.operating_table(geo, Frame(cx, cz), node=nd('table:OR'))
    theatre.surgical_light(geo, Frame(cx, cz - 0.2), node=nd('light:OR'), ceiling=ch, angles=(35, 160))
    theatre.supply_pendant(geo, Frame(cx - 1.9, cz - 1.6), node=nd('pendant:anaesthesia'), ceiling=ch, kind='anaesthesia', swing1=20)
    theatre.supply_pendant(geo, Frame(cx + 1.9, cz - 1.2), node=nd('pendant:surgeon'), ceiling=ch, kind='surgeon', swing1=200)
    theatre.anaesthesia_machine(geo, Frame(cx - 1.0, cz - 1.75, math.radians(10)), node=nd('anaesthesia:OR'))
    theatre.instrument_table(geo, Frame(cx + 1.4, cz + 1.0, math.pi / 2), node=nd('backTable:OR'), draped=True)
    theatre.mayo_stand(geo, Frame(cx + 0.65, cz + 1.4, -math.pi / 2), node=nd('mayo:OR'))
    theatre.scrub_sink(geo, Frame(x1, z1 - 1.6, -math.pi / 2), bays=2)
    patient.wall_clock(geo, Frame(cx, z0, 0.0), y=2.5)
    POSES[4] = ((x0 + 0.8, 1.65, z1 - 0.7), (cx + 0.3, 1.0, cz - 0.6), 'kit-4-theatre')


def support_room(ox=0.0, oz=0.0):
    """A clinical support / staff base line-up: workstation and office chair, storage cabinets and shelving, medication and linen carts, a
    wheelchair, beam seating."""
    x0, x1, z0, z1, ch = ox, ox + 8.0, oz, oz + 6.0, 2.7
    room(x0, x1, z0, z1, ch, windows=[('W', z0 + 1.5, z0 + 4.5, 0.8, 2.4)], panels=[(3, 3, 2, 1), (8, 3, 2, 1), (5, 7, 1, 2)],
         walls={'N': 'WallTintSage'}, rails=[('E', z0 + 0.3, z1 - 0.3)])
    support.workstation(geo, Frame(x0 + 1.4, z0 + 0.45, math.pi))
    support.office_chair(geo, Frame(x0 + 1.3, z0 + 1.15, math.pi + 0.25), node=nd('chair:S1'))
    support.cabinet(geo, Frame(x0 + 3.0, z0 + 0.25, 0.0), w=0.9, kind='doors')
    support.cabinet(geo, Frame(x0 + 3.92, z0 + 0.25, 0.0), w=0.9, kind='glass')
    support.shelving(geo, Frame(x0 + 5.2, z0 + 0.3, 0.0), w=1.2)
    support.med_cart(geo, Frame(x0 + 6.6, z0 + 0.6, 0.2), node=nd('medCart:S'))
    support.linen_cart(geo, Frame(x1 - 0.55, z0 + 2.2, -math.pi / 2), node=nd('linenCart:S'))
    support.wheelchair(geo, Frame(x0 + 4.6, z0 + 2.6, math.radians(-150)), node=nd('wheelchair:S'))
    support.beam_seating(geo, Frame(x0 + 3.2, z1 - 0.38, math.pi), n=3, fabric='VinylTeal')
    support.beam_seating(geo, Frame(x0 + 5.6, z1 - 0.38, math.pi), n=3, fabric='VinylGrey')
    POSES[5] = ((x0 + 4.9, 1.6, z1 - 0.3), (x0 + 2.7, 0.95, z0 + 0.8), 'kit-5-support')


def cafe_room(ox=0.0, oz=0.0):
    """The atrium cafe: terrazzo, sand-tinted wall, the oak-slatted counter, round and square tables with chairs, a bench, planters."""
    x0, x1, z0, z1, ch = ox, ox + 9.0, oz, oz + 7.0, 3.2
    room(x0, x1, z0, z1, ch, floor='Terrazzo', walls={'N': 'WallTintSand'}, windows=[('W', z0 + 0.6, z1 - 0.6, 0.02, 3.0)], cove=False,
         ceiling='plaster', panels=[(x0 + 3.0, z0 + 3.5, 0.06, 5.5), (x0 + 6.0, z0 + 3.5, 0.06, 5.5)])
    cafe.counter(geo, Frame(x0 + 5.6, z0 + 1.0, 0.0), length=3.4)
    for i, (x, z) in enumerate(((x0 + 2.2, z0 + 2.4), (x0 + 2.4, z0 + 4.6), (x0 + 4.4, z0 + 4.0))):
        cafe.table(geo, Frame(x, z), node=nd(f'cafeTable{i}'), kind='round' if i != 1 else 'square')
        for j in range(3 if i != 1 else 4):
            a = 2 * math.pi * j / (3 if i != 1 else 4) + i * 0.4
            cafe.chair(geo, Frame(x + math.sin(a) * 0.58, z + math.cos(a) * 0.58, a + math.pi), node=nd(f'cafeChair{i}{j}'))
    cafe.bench(geo, Frame(x0 + 0.55, z0 + 5.4, math.pi / 2), length=1.8)
    cafe.planter(geo, Frame(x0 + 0.6, z0 + 0.6), seed=5)
    cafe.planter(geo, Frame(x0 + 3.5, z0 + 0.55), seed=9, r=0.25)
    POSES[6] = ((x1 - 0.6, 1.6, z1 - 0.6), (x0 + 3.0, 1.0, z0 + 1.6), 'kit-6-cafe')


SCENES = {1: patient_room, 2: patient_room, 3: er_bay, 4: theatre_room, 5: support_room, 6: cafe_room}
OFFSETS = {patient_room: (0.0, 0.0), er_bay: (0.0, 20.0), theatre_room: (0.0, 40.0), support_room: (0.0, 60.0), cafe_room: (0.0, 80.0)}
only = [int(x) for x in args.only.split(',') if x] or sorted(SCENES)
for fn in dict.fromkeys(SCENES[i] for i in only):
    fn(*OFFSETS[fn])
outside()
OBJS = geo.finalize(col, MATS)
for name, o in OBJS.items():
    base.prepare_object(o, name, mt)
NODES = base.finalize_nodes(geo, col, MATS, mt)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in list(OBJS.values()) + [n for n in NODES.values() if n.type == 'MESH'])
print(f'built {len(OBJS)} material meshes + {len(NODES)} nodes, {tris} triangles in {time.time() - T0:.0f}s', flush=True)
if NODES:
    print('nodes:', ', '.join(sorted(NODES)[:40]), flush=True)

bk.setup_cycles(scene, args.samples)
info = bk.setup_world(scene)
scene.view_settings.exposure = args.exposure
print('world', info, flush=True)


def camera(eye, target, lens=24.0):
    cam = bpy.data.cameras.new('Eye')
    cam.lens = lens
    cam.sensor_width = 36.0
    cam.clip_start = 0.05
    o = bpy.data.objects.new('Eye', cam)
    scene.collection.objects.link(o)
    o.location = P(*eye)
    dx, dy, dz = target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]
    bxv, byv = dx, -dz
    pitch = math.atan2(dy, math.hypot(dx, dz))
    o.rotation_euler = (math.radians(90) + pitch, 0, math.atan2(byv, bxv) - math.pi / 2)
    return o


if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
os.makedirs(args.out, exist_ok=True)
for i in ([] if args.dry else only):
    if i not in POSES:
        continue
    eye, target, name = POSES[i]
    scene.camera = camera(eye, target)
    scene.cycles.samples = args.samples
    scene.render.resolution_x = args.res
    scene.render.resolution_y = int(args.res * 9 / 16)
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 92
    scene.render.filepath = os.path.abspath(os.path.join(args.out, f'{name}.jpg'))
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'rendered {name} in {time.time() - t:.0f}s', flush=True)
print(f'showroom done in {time.time() - T0:.0f}s', flush=True)
