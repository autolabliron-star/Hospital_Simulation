"""
The emergency department: ER trolley (stretcher), bay curtains, the resus bay's supply pendant, crash cart, nurse station with monitors, triage
desk. Conventions: kit/base.py (item(geo, f, ..., node=None); free-standing items centred, front +z; wall items back on the wall at z = 0).
"""
import math

from . import parts as pt
from .base import anchor, fillet, root
from .parts import sw
from .patient import curtain, curtain_track

PW = 'PowderWhite'
SS = 'Stainless'


def stretcher(geo, f, node=None, deck=0.66, backrest=20.0, rails='up', linen=True, mattress='VinylTeal'):
    """An ER / transfer trolley (0.72 x 2.05 m): a big rounded base cover on four 200 mm castors, twin hydraulic columns in ribbed bellows, a
    platform with corner bumpers, an 80 mm mattress (the backrest hinged `backrest` degrees), tubular stainless side rails, push handles
    at both ends, a folding IV pole and an oxygen cylinder in its holder. Origin: footprint centre; head toward -z. Moving parts:
    <node>/backrest, <node>/rail_l, <node>/rail_r."""
    k = root(geo, f, node)
    for x in (-0.25, 0.25):
        for z in (-0.74, 0.74):
            pt.castor(k, x, z, r=0.1, w=0.05, top=0.24, swivel=0.3 * (1 if x > 0 else -1), housing=pt.GRAPHITE)
    k.rbox(PW, 0, 0.22, 0, 0.62, 0.15, 1.66, 0.14, axis='y', seg=4)
    k.rbox('Rubber', 0, 0.2, 0, 0.66, 0.03, 1.72, 0.15, axis='y', seg=4)
    # columns with ribbed bellows
    for z in (-0.42, 0.42):
        prof = []
        y = 0.37
        top = deck - 0.08
        n = 9
        for i in range(n + 1):
            yy = y + (top - y) * i / n
            prof.append((0.075 if i % 2 == 0 else 0.062, yy))
        k.at(0, 0, z).lathe(sw(pt.GRAPHITE), [(0.0, y)] + prof + [(0.0, top)], seg=16)
    # platform
    k.rbox(PW, 0, deck - 0.08, 0, 0.7, 0.06, 2.0, 0.05, axis='y', seg=4)
    for x in (-0.36, 0.36):
        for z in (-1.0, 1.0):
            k.vcyl('Rubber', x, deck - 0.1, z, 0.035, 0.09, seg=12)
    mt_ = 0.08
    cover = 'Linen' if linen else mattress
    k.rbox(mattress, 0, deck - 0.02, 0.33, 0.66, mt_, 1.3, 0.03, axis='z', seg=3)
    if linen:
        k.rbox('Linen', 0, deck - 0.02 + mt_ - 0.005, 0.33, 0.67, 0.012, 1.3, 0.004, axis='z', seg=2)
        for i in range(3):
            k.rbox('Curtain', 0.02 * (i % 2), deck - 0.02 + mt_ + 0.005 + i * 0.03, 0.82, 0.5, 0.028, 0.34, 0.012, axis='x', seg=2)
    b = k.part('backrest', 0, deck - 0.02, -0.32, rx=math.radians(backrest))
    b.rbox(mattress, 0, 0, -0.35, 0.66, mt_, 0.7, 0.03, axis='z', seg=3)
    b.rbox(PW, 0, -0.03, -0.35, 0.6, 0.03, 0.66, 0.02, axis='y', seg=2)
    if linen:
        b.rbox('Linen', 0, mt_ - 0.005, -0.35, 0.67, 0.012, 0.7, 0.004, axis='z', seg=2)
        b.rbox('Linen', 0, mt_ - 0.01, -0.5, 0.5, 0.11, 0.32, 0.05, axis='x', seg=4)
    # side rails: a stainless frame of tubes standing on the platform edge
    up = rails == 'up'
    for s, nm in ((-1, 'l'), (1, 'r')):
        r = k.part(f'rail_{nm}', s * 0.355, deck - 0.03, 0.1)
        y0 = 0.02 if up else -0.2
        y1 = y0 + 0.36
        L = 1.25
        r.tube(SS, fillet([(0, y0, -L / 2), (0, y1, -L / 2), (0, y1, L / 2), (0, y0, L / 2)], 0.06), 0.012, seg=10)
        for i in range(1, 4):
            z = -L / 2 + L * i / 4
            r.tube(SS, [(0, y0 + 0.02, z), (0, y1, z)], 0.008, seg=8)
        r.tube(SS, [(0, y0 + 0.12, -L / 2), (0, y0 + 0.12, L / 2)], 0.008, seg=8)
    for zz, sg in ((-1.0, -1), (1.0, 1)):
        k.tube(SS, fillet([(-0.26, deck - 0.05, zz), (-0.26, deck + 0.12, zz + sg * 0.08), (0.26, deck + 0.12, zz + sg * 0.08),
                           (0.26, deck - 0.05, zz)], 0.05), 0.014, seg=10)
    k.vcyl(SS, -0.33, deck - 0.12, -0.98, 0.011, 1.15, seg=10)
    k.tube(SS, [(-0.33, deck + 1.03, -0.98), (-0.25, deck + 1.03, -0.98), (-0.23, deck + 1.05, -0.98)], 0.004, seg=6)
    pt.cylinder(k, 0.12, 0.42, 0.25, r=0.05, h=0.55, axis='z')
    k.box(SS, 0.04, 0.37, 0.2, 0.2, 0.39, 0.95)
    anchor(k, 'trolley:patient', 0, deck + 0.1, 0.2)
    return k


def bay_curtains(geo, f, w=3.0, depth=3.0, ceiling=3.0, drawn=0.3, start=0.0):
    """ER bay curtains: a U track from the back wall (frame at the bay's centre on the wall face, +z into the bay) down one side, across the
    front and back up the other side; the curtain covers `drawn` of it from `start`."""
    path = [(-w / 2, 0.15), (-w / 2, depth), (w / 2, depth), (w / 2, 0.15)]
    fp = curtain_track(geo, f, path, ceiling, r=0.25)
    curtain(geo, f, fp, ceiling, drawn=drawn, start=start)
    return fp


def resus_pendant(geo, f, node=None, ceiling=3.0, swing1=-20.0):
    """The resus bay's ceiling supply pendant (see theatre.supply_pendant)."""
    from .theatre import supply_pendant
    return supply_pendant(geo, f, node=node, ceiling=ceiling, kind='resus', swing1=swing1)


def crash_cart(geo, f, node=None, w=0.76, d=0.52, h=1.0):
    """A red emergency (crash) cart: graphite base on castors, red drawers with grey grips and a breakaway lock, a grey top tray with the
    defibrillator, an oxygen cylinder and a CPR board on the side, a sharps bin, a push handle. Origin: footprint centre; drawers face +z."""
    k = root(geo, f, node)
    for x in (-w / 2 + 0.08, w / 2 - 0.08):
        for z in (-d / 2 + 0.08, d / 2 - 0.08):
            pt.castor(k, x, z, r=0.06, w=0.035, top=0.12)
    k.rbox(sw(pt.GRAPHITE), 0, 0.11, 0, w, 0.05, d, 0.03, axis='y', seg=3)
    k.rbox(sw(pt.CARTRED), 0, 0.16, -0.01, w - 0.04, h - 0.22, d - 0.06, 0.025, axis='y', seg=3)
    rows = [(0.8, 0.9, 3), (0.66, 0.79, 1), (0.5, 0.65, 1), (0.34, 0.49, 1), (0.17, 0.33, 1)]
    fz = d / 2 - 0.03
    for (y0, y1, n) in rows:
        dw = (w - 0.08) / n
        for i in range(n):
            x0 = -w / 2 + 0.04 + i * dw
            k.box(sw(pt.CARTRED), x0 + 0.004, y0, fz, x0 + dw - 0.004, y1, fz + 0.016, bev=0.004)
            k.box(sw(pt.LGREY), x0 + 0.03, y1 - 0.03, fz + 0.016, x0 + dw - 0.03, y1 - 0.012, fz + 0.022)
    k.box(sw(pt.YELLOW), w / 2 - 0.04, 0.6, fz, w / 2 - 0.02, 0.86, fz + 0.03)
    k.tray(sw(pt.LGREY), 0, h - 0.06, 0, w + 0.04, d + 0.04, 0.06, wall=0.015, r=0.04, seg=3)
    df = k.at(-0.12, h - 0.045, 0.02)
    df.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.32, 0.2, 0.26, 0.03, axis='y', seg=3)
    df.box('Screen', -0.08, 0.06, 0.13, 0.06, 0.17, 0.132)
    for i, c in enumerate((pt.GREEN, pt.YELLOW, pt.RED)):
        df.vcyl(sw(c), 0.1, 0.2, -0.06 + i * 0.05, 0.014, 0.006, seg=10)
    df.tube(sw(pt.LGREY), [(-0.12, 0.2, 0.0), (-0.12, 0.25, 0.0), (0.12, 0.25, 0.0), (0.12, 0.2, 0.0)], 0.01, seg=8)
    k.tube(SS, fillet([(w / 2 - 0.02, 0.85, -0.18), (w / 2 + 0.06, 0.85, -0.18), (w / 2 + 0.06, 0.85, 0.18), (w / 2 - 0.02, 0.85, 0.18)], 0.03),
           0.013, seg=10)
    pt.cylinder(k, -w / 2 - 0.05, 0.3, 0.05, r=0.05, h=0.6)
    k.box(SS, -w / 2 - 0.1, 0.3, -0.0, -w / 2 - 0.0, 0.32, 0.1)
    k.box(sw(pt.ORANGE), -0.3, 0.25, -d / 2 - 0.03, 0.3, 0.95, -d / 2 - 0.01, bev=0.006)
    k.box(sw(pt.YELLOW), w / 2, 0.55, -0.12, w / 2 + 0.1, 0.75, 0.04, bev=0.005)
    k.box(sw(pt.ORANGE), w / 2, 0.75, -0.12, w / 2 + 0.1, 0.78, 0.04)
    return k


def nurse_station(geo, f, length=3.6, depth=1.2, high=1.06, desk=0.74, monitors=3, low_end=True):
    """A nurse station in the lobby's language: a white solid-surface counter with a light-oak transaction top (an LED line under its lip)
    toward the visitors (local +z), a desk-height work surface behind it with flat monitors, keyboards and a phone, a lowered accessible
    section at the right-hand end. Origin: footprint centre; staff sit at local -z. Anchors: screen0..n."""
    k = root(geo, f, None)
    L = length / 2
    z1 = depth / 2
    zc = z1 - 0.3                                # the counter's back face
    lo = L - 0.9 if low_end else L
    k.box(sw(pt.GRAPHITE), -L + 0.04, 0, zc + 0.03, L - 0.04, 0.1, z1 - 0.04, drop=('down', 'up'))
    k.box('SolidSurface', -L, 0.1, zc, lo, high, z1)
    if low_end:
        k.box('SolidSurface', lo, 0.1, zc, L, desk + 0.02, z1)
        k.box('Oak', lo, desk + 0.02, zc - 0.02, L + 0.02, desk + 0.06, z1 + 0.05)
        k.box('LightPanel', lo + 0.05, desk + 0.008, z1 + 0.012, L - 0.05, desk + 0.016, z1 + 0.032)
    k.box('Oak', -L - 0.02, high, zc - 0.02, lo, high + 0.04, z1 + 0.05)
    k.box('LightPanel', -L + 0.05, high - 0.012, z1 + 0.012, lo - 0.05, high - 0.004, z1 + 0.032)
    # the work surface behind, on the counter's back and two end panels
    k.box('SolidSurface', -L, desk, -z1, lo, desk + 0.03, zc)
    for x in (-L, lo - 0.03):
        k.box('SolidSurface', x, 0, -z1 + 0.04, x + 0.03, desk, zc, drop=('down',))
    k.box(sw(pt.LGREY), -L + 0.03, 0.12, zc - 0.012, lo - 0.03, desk, zc)
    span = lo - (-L)
    for i in range(monitors):
        x = -L + span * (i + 0.5) / monitors
        m = k.at(x, desk + 0.03, zc - 0.22, ry=math.pi)
        m.box(sw(pt.GRAPHITE), -0.1, 0, -0.08, 0.1, 0.01, 0.08)
        m.box(sw(pt.GRAPHITE), -0.025, 0.01, -0.05, 0.025, 0.2, -0.03)
        pt.flat_monitor(m.at(0, 0.32, -0.02, rx=math.radians(-5)), w=0.54, h=0.33, name=f'screen{i}')
        kb = k.at(x, desk + 0.03, zc - 0.48, ry=math.pi)
        kb.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.44, 0.018, 0.14, 0.008, axis='y', seg=2)
        kb.box(sw(pt.MGREY), -0.2, 0.018, -0.05, 0.2, 0.02, 0.05)
        kb.rbox(sw(pt.GRAPHITE), 0.3, 0, 0.0, 0.06, 0.02, 0.1, 0.03, axis='y', seg=3)
    ph = k.at(-L + 0.25, desk + 0.03, zc - 0.15, ry=math.pi)
    ph.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.18, 0.05, 0.2, 0.02, axis='y', seg=2)
    ph.rbox(sw(pt.GRAPHITE), -0.03, 0.05, 0.0, 0.05, 0.03, 0.2, 0.015, axis='z', seg=2)
    return k


def triage_desk(geo, f, w=1.4, d=0.7, h=0.74):
    """A triage desk: a white top on a powder-coated frame with an oak modesty panel, a monitor and keyboard for the nurse (local -z side),
    a vital-signs monitor on a roll stand beside it. Origin: footprint centre; the patient sits at local +z."""
    k = root(geo, f, None)
    k.rbox('SolidSurface', 0, h - 0.03, 0, w, 0.03, d, 0.01, axis='y', seg=2)
    for s in (-1, 1):
        k.box(PW, s * (w / 2 - 0.05) - 0.025, 0, -d / 2 + 0.05, s * (w / 2 - 0.05) + 0.025, h - 0.03, d / 2 - 0.05)
    k.box('Oak', -w / 2 + 0.08, 0.3, d / 2 - 0.08, w / 2 - 0.08, h - 0.05, d / 2 - 0.06)
    m = k.at(-0.2, h, 0.0, ry=math.pi)
    m.box(sw(pt.GRAPHITE), -0.1, 0, -0.08, 0.1, 0.01, 0.08)
    m.box(sw(pt.GRAPHITE), -0.025, 0.01, -0.05, 0.025, 0.2, -0.03)
    pt.flat_monitor(m.at(0, 0.32, -0.02), w=0.54, h=0.33)
    kb = k.at(-0.2, h, -0.2, ry=math.pi)
    kb.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.44, 0.018, 0.14, 0.008, axis='y', seg=2)
    vitals_stand(geo, k, w / 2 + 0.35, 0.0)
    return k


def vitals_stand(geo, k, x, z):
    """A vital-signs monitor on a five-castor roll stand, with a basket and the cuff."""
    v = k.at(x, 0, z)
    for i in range(5):
        a = 2 * math.pi * i / 5
        v.tube(sw(pt.GRAPHITE), [(0, 0.07, 0), (math.cos(a) * 0.25, 0.05, math.sin(a) * 0.25)], 0.012, seg=6)
        pt.castor(v, math.cos(a) * 0.26, math.sin(a) * 0.26, r=0.025, w=0.02, top=0.05)
    v.vcyl(sw(pt.LGREY), 0, 0.07, 0, 0.015, 0.95, seg=10)
    v.tray(sw(pt.LGREY), 0, 0.82, 0.09, 0.2, 0.12, 0.06, wall=0.006, r=0.02, seg=2)
    pt.monitor(v.at(0, 1.18, 0.0), w=0.26, h=0.22, d=0.12)
    v.tube(sw(pt.GRAPHITE), [(0.13, 1.1, 0.04), (0.18, 0.95, 0.08), (0.12, 0.88, 0.1)], 0.004, seg=5, caps=False)
