"""
Kit self-test (Blender, no render): builds every kit item alone, static and as a movable node, and prints its triangle count, materials (= draw
calls when used alone), node names, and faces whose winding disagrees with Blender's own outward recalculation (should be ~0: single-sided
materials hide back faces at runtime). Exits non-zero on an exception or on a budget overrun.

  /private/tmp/claude-501/hospital-blender.sh ~/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/arch/kit/selftest.py
"""
import math
import os
import sys
import traceback

import bmesh
import bpy

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import materials as mt  # noqa: E402
from common import Frame, Geo  # noqa: E402
from kit import arch, base, cafe, cryo, er, patient, support, theatre  # noqa: E402

# item -> (call, triangle budget)
ITEMS = {
    'patient.bed': (lambda g, n: patient.bed(g, Frame(0, 0), node=n), 6000),
    'patient.locker': (lambda g, n: patient.locker(g, Frame(0, 0), node=n), 1300),
    'patient.overbed_table': (lambda g, n: patient.overbed_table(g, Frame(0, 0), node=n), 1200),
    'patient.visitor_chair': (lambda g, n: patient.visitor_chair(g, Frame(0, 0), node=n), 1000),
    'patient.recliner': (lambda g, n: patient.recliner(g, Frame(0, 0), node=n), 2000),
    'patient.iv_pole': (lambda g, n: patient.iv_pole(g, Frame(0, 0), node=n), 2500),
    'patient.headwall': (lambda g, n: patient.headwall(g, Frame(0, 0)), 2500),
    'patient.monitor_arm': (lambda g, n: patient.monitor_arm(g, Frame(0, 0), node=n), 1500),
    'patient.cubicle_curtains': (lambda g, n: patient.cubicle_curtains(g, Frame(0, 0)), 3000),
    'patient.handwash': (lambda g, n: patient.handwash(g, Frame(0, 0)), 2500),
    'patient.sharps_and_gloves': (lambda g, n: patient.sharps_and_gloves(g, Frame(0, 0)), 1000),
    'patient.wall_clock': (lambda g, n: patient.wall_clock(g, Frame(0, 0)), 800),
    'patient.wardrobe': (lambda g, n: patient.wardrobe(g, Frame(0, 0)), 600),
    'patient.door_leaf': (lambda g, n: patient.door_leaf(g, Frame(0, 0), node=n), 1200),
    'er.stretcher': (lambda g, n: er.stretcher(g, Frame(0, 0), node=n), 6000),
    'er.bay_curtains': (lambda g, n: er.bay_curtains(g, Frame(0, 0)), 3500),
    'er.resus_pendant': (lambda g, n: er.resus_pendant(g, Frame(0, 0), node=n), 3500),
    'er.crash_cart': (lambda g, n: er.crash_cart(g, Frame(0, 0), node=n), 2500),
    'er.nurse_station': (lambda g, n: er.nurse_station(g, Frame(0, 0)), 3000),
    'er.triage_desk': (lambda g, n: er.triage_desk(g, Frame(0, 0)), 2500),
    'support.workstation': (lambda g, n: support.workstation(g, Frame(0, 0)), 2500),
    'support.office_chair': (lambda g, n: support.office_chair(g, Frame(0, 0), node=n), 1600),
    'support.office_chair(0.45)': (lambda g, n: support.office_chair(g, Frame(0, 0), node=n, seat_h=0.45, arms=False), 1600),
    'support.pedestal_chair': (lambda g, n: support.pedestal_chair(g, Frame(0, 0), 0.45, node=n), 1600),
    'support.pedestal_chair(stool)': (lambda g, n: support.pedestal_chair(g, Frame(0, 0), 0.55, back=None, arms=False, node=n), 1000),
    'support.cabinet.doors': (lambda g, n: support.cabinet(g, Frame(0, 0)), 600),
    'support.cabinet.glass': (lambda g, n: support.cabinet(g, Frame(0, 0), kind='glass'), 1300),
    'support.shelving': (lambda g, n: support.shelving(g, Frame(0, 0)), 3000),
    'support.med_cart': (lambda g, n: support.med_cart(g, Frame(0, 0), node=n), 2100),
    'support.linen_cart': (lambda g, n: support.linen_cart(g, Frame(0, 0), node=n), 2500),
    'support.wheelchair': (lambda g, n: support.wheelchair(g, Frame(0, 0), node=n), 3500),
    'support.beam_seating(3)': (lambda g, n: support.beam_seating(g, Frame(0, 0), n=3), 1500),
    'cryo.console': (lambda g, n: cryo.console(g, Frame(0, 0), node=n), 4000),
    'theatre.anaesthesia_pendant': (lambda g, n: theatre.supply_pendant(g, Frame(0, 0), node=n), 3500),
    'theatre.surgeon_pendant': (lambda g, n: theatre.supply_pendant(g, Frame(0, 0), node=n, kind='surgeon'), 3000),
    'theatre.surgical_light': (lambda g, n: theatre.surgical_light(g, Frame(0, 0), node=n), 6000),
    'theatre.laminar_canopy': (lambda g, n: theatre.laminar_canopy(g, Frame(0, 0)), 300),
    'theatre.operating_table': (lambda g, n: theatre.operating_table(g, Frame(0, 0), node=n), 2000),
    'theatre.anaesthesia_machine': (lambda g, n: theatre.anaesthesia_machine(g, Frame(0, 0), node=n), 5000),
    'theatre.instrument_table': (lambda g, n: theatre.instrument_table(g, Frame(0, 0), node=n, draped=True), 2000),
    'theatre.mayo_stand': (lambda g, n: theatre.mayo_stand(g, Frame(0, 0), node=n), 1200),
    'theatre.scrub_sink': (lambda g, n: theatre.scrub_sink(g, Frame(0, 0)), 2500),
    'cafe.counter': (lambda g, n: cafe.counter(g, Frame(0, 0)), 4000),
    'cafe.table': (lambda g, n: cafe.table(g, Frame(0, 0), node=n), 600),
    'cafe.chair': (lambda g, n: cafe.chair(g, Frame(0, 0), node=n), 800),
    'cafe.bench': (lambda g, n: cafe.bench(g, Frame(0, 0)), 400),
    'arch.coved_skirting(4m)': (lambda g, n: arch.coved_skirting(g, True, 0.0, 1, 0.0, 4.0), 100),
    'arch.crash_rail(4m)': (lambda g, n: arch.crash_rail(g, True, 0.0, 1, 0.0, 4.0), 100),
    'arch.handrail(4m)': (lambda g, n: arch.handrail(g, True, 0.0, 1, 0.0, 4.0), 600),
    'arch.corner_guard': (lambda g, n: arch.corner_guard(g, 0.0, 0.0, 1, 1), 50),
    'arch.tegular_ceiling(3x3m)': (lambda g, n: arch.tegular_ceiling(g, (0, 3, 0, 3), 2.7, panels=[(1, 1, 2, 1)]), 2000),
}


def flips(bm):
    """Faces whose normal disagrees with recalc_face_normals (outward by connectivity)."""
    c = bm.copy()
    before = [f.normal.copy() for f in c.faces]
    bmesh.ops.recalc_face_normals(c, faces=c.faces[:])
    n = sum(1 for f, nb in zip(c.faces, before) if f.normal.dot(nb) < 0)
    c.free()
    return n


bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = mt.build_all()
col = bpy.data.collections.new('T')
bpy.context.scene.collection.children.link(col)
bad = 0
print(f'{"item":34s} {"tris":>6s} {"budget":>6s} {"mats":>4s} {"flip":>4s}  nodes')
for name, (fn, budget) in ITEMS.items():
    try:
        g = Geo()
        fn(g, None)
        tris = 0
        fl = 0
        for m, b in g.bms.items():
            tris += sum(len(f.verts) - 2 for f in b.faces)
            fl += flips(b)
        mats = len(g.bms)
        g2 = Geo()
        fn(g2, 'item')
        nodes = [n.name for n in getattr(g2, 'kit_nodes', [])]
        g2.finalize(col, MATS)
        objs = base.finalize_nodes(g2, col, MATS, mt)
        over = tris > budget
        bad += over
        print(f'{name:34s} {tris:6d} {budget:6d} {mats:4d} {fl:4d}  {", ".join(nodes)}{"   OVER BUDGET" if over else ""}', flush=True)
        for o in list(col.objects):
            bpy.data.objects.remove(o)
    except Exception:
        bad += 1
        print(f'{name:34s} FAILED', flush=True)
        traceback.print_exc()
print('selftest', 'FAILED' if bad else 'ok', flush=True)
sys.exit(1 if bad else 0)
