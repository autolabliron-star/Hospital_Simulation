"""
Theatres (and the resus bay's pendant): ceiling supply pendants, the twin-dome surgical light, the laminar-flow canopy, the operating table,
the anaesthesia machine shell, instrument (back) table, Mayo stand, the scrub sink. Conventions: kit/base.py.
"""
import math

from . import parts as pt
from .base import anchor, fillet, root
from .parts import sw

PW = 'PowderWhite'
SS = 'Stainless'


def supply_pendant(geo, f, node=None, ceiling=3.0, kind='anaesthesia', swing1=0.0, swing2=-120.0, l1=0.9, l2=0.7, bottom=0.95, top=1.95):
    """A ceiling supply pendant: a ceiling canopy, a drop tube, one or two rotating arms (beams with joint hubs), and a service head (a
    vertical column with medical gas outlets, sockets, equipment rails and shelves). kind: 'anaesthesia' (two arms, monitor + drawer on the
    shelves), 'surgeon' (one arm, the electrosurgical unit), 'resus' (two arms, monitor, suction, oxygen flowmeter). Origin: the ceiling
    mount's point on the floor. Moving parts: <node>/arm1, <node>/arm1/arm2, .../head."""
    k = root(geo, f, node)
    k.vcyl(PW, 0, ceiling - 0.05, 0, 0.24, 0.05, seg=28)
    k.vcyl(sw(pt.LGREY), 0, ceiling - 0.06, 0, 0.2, 0.012, seg=28)
    ay = ceiling - 0.34
    k.vcyl(PW, 0, ay + 0.07, 0, 0.075, ceiling - 0.06 - ay - 0.07, seg=16)
    a1 = k.part('arm1', 0, ay, 0, ry=math.radians(swing1))
    a1.vcyl(PW, 0, -0.07, 0, 0.11, 0.14, seg=20)
    a1.rbox(PW, 0, -0.06, l1 / 2, 0.16, 0.12, l1, 0.045, axis='z', seg=4)
    a1.vcyl(PW, 0, -0.07, l1, 0.1, 0.14, seg=20)
    end, dy = a1, 0.0
    if kind != 'surgeon':
        end = a1.part('arm2', 0, -0.16, l1, ry=math.radians(swing2))
        end.vcyl(PW, 0, -0.06, 0, 0.09, 0.12, seg=20)
        end.rbox(PW, 0, -0.05, l2 / 2, 0.14, 0.1, l2, 0.04, axis='z', seg=4)
        end.vcyl(PW, 0, -0.06, l2, 0.085, 0.12, seg=20)
        dy = -0.16
        reach = l2
    else:
        reach = l1
    hy = ay + dy                                                   # the arm end's height
    hd = end.part('head', 0, 0.0, reach, ry=-math.radians(swing1 + (swing2 if kind != 'surgeon' else 0.0)))
    t, b = top - hy, bottom - hy
    hd.vcyl(PW, 0, t, 0, 0.05, -0.06 - t, seg=14)
    hd.rbox(PW, 0, b, 0, 0.3, t - b, 0.3, 0.05, axis='y', seg=4)
    hd.rbox(sw(pt.LGREY), 0, t - 0.03, 0, 0.31, 0.03, 0.31, 0.052, axis='y', seg=4)
    hd.rbox(sw(pt.LGREY), 0, b, 0, 0.31, 0.03, 0.31, 0.052, axis='y', seg=4)
    for i, c in enumerate((pt.GREEN, pt.YELLOW, pt.WHITE, pt.WHITE)):
        pt.gas_outlet(hd, -0.09 + (i % 2) * 0.18, t - 0.12 - (i // 2) * 0.1, c, z=0.15)
    for s in (-1, 1):
        side = hd.at(s * 0.15, 0, 0, ry=s * math.pi / 2)
        for i in range(6):
            pt.socket(side, -0.05 + (i % 2) * 0.1, t - 0.15 - (i // 2) * 0.12, pt.RED if i >= 4 else pt.WHITE, z=0.0)
        hd.box(SS, s * 0.15 - 0.012, b + 0.1, -0.09, s * 0.15 + 0.012, b + 0.13, 0.09)
    shelves = {'anaesthesia': (0.35, 0.68), 'resus': (0.3, 0.62), 'surgeon': (0.42,)}[kind]
    for i, sy in enumerate(shelves):
        y = b + sy
        hd.rbox(sw(pt.LGREY), 0, y, 0.33, 0.56, 0.03, 0.36, 0.03, axis='y', seg=3)
        hd.box(SS, -0.28, y + 0.03, 0.5, 0.28, y + 0.05, 0.51)
        hd.box(PW, -0.04, y - 0.06, 0.15, 0.04, y + 0.0, 0.2)
    if kind in ('anaesthesia', 'resus'):
        y = b + shelves[-1] + 0.03
        pt.monitor(hd.at(0, y + 0.17, 0.33, rx=math.radians(-8)), w=0.42, h=0.32, d=0.09, name=f'screen')
        y0 = b + shelves[0] + 0.03
        if kind == 'anaesthesia':
            hd.rbox(sw(pt.WHITE), 0, y0, 0.33, 0.5, 0.16, 0.32, 0.02, axis='y', seg=2)
            for j in range(2):
                hd.box(sw(pt.LGREY), -0.22, y0 + 0.02 + j * 0.07, 0.49, 0.22, y0 + 0.07 + j * 0.07, 0.495)
        else:
            hd.vcyl(sw(pt.CLEAR), -0.15, y0, 0.35, 0.06, 0.2, seg=14)
            hd.vcyl(sw(pt.WHITE), -0.15, y0 + 0.2, 0.35, 0.065, 0.025, seg=14)
            hd.rbox(sw(pt.WHITE), 0.12, y0, 0.35, 0.18, 0.12, 0.16, 0.02, axis='y', seg=2)
            hd.box('Screen', 0.06, y0 + 0.05, 0.43, 0.18, y0 + 0.1, 0.432)
    else:
        y = b + shelves[0] + 0.03
        hd.rbox(sw(pt.WHITE), 0, y, 0.33, 0.4, 0.14, 0.32, 0.02, axis='y', seg=2)
        hd.box('Screen', -0.15, y + 0.05, 0.49, 0.05, y + 0.12, 0.492)
        for i, c in enumerate((pt.YELLOW, pt.BLUE, pt.GREEN)):
            hd.cyl(sw(c), (0.1 + i * 0.04, y + 0.08, 0.49), (0.1 + i * 0.04, y + 0.08, 0.5), 0.012, seg=10)
    return k


def surgical_light(geo, f, node=None, ceiling=3.0, angles=(30.0, 150.0), reach=0.85, tilt=(18.0, -14.0)):
    """A twin-dome LED surgical light: a ceiling canopy and central axle, per head a horizontal arm (rotating), an inclined spring arm, a
    yoke and the dome (white housing, dark face with LED lenses, a sterile handle in the centre). Origin: the ceiling mount over the table, on
    the floor. Moving parts: <node>/arm<i>, .../spring<i>, .../dome<i>."""
    k = root(geo, f, node)
    k.vcyl(PW, 0, ceiling - 0.05, 0, 0.17, 0.05, seg=28)
    k.vcyl(PW, 0, ceiling - 0.62, 0, 0.045, 0.58, seg=14)
    for i, ang in enumerate(angles):
        y = ceiling - 0.4 - i * 0.14
        a = k.part(f'arm{i}', 0, y, 0, ry=math.radians(ang))
        a.vcyl(PW, 0, -0.05, 0, 0.07, 0.1, seg=18)
        a.rbox(PW, 0, -0.035, reach / 2, 0.065, 0.06, reach, 0.025, axis='z', seg=3)
        a.vcyl(PW, 0, -0.06, reach, 0.05, 0.1, seg=16)
        sp = a.part(f'spring{i}', 0, -0.06, reach, rx=math.radians(38))
        sp.rbox(PW, 0, -0.035, 0.36, 0.07, 0.07, 0.72, 0.03, axis='z', seg=3)
        sp.cyl(sw(pt.LGREY), (-0.045, 0.0, 0.72), (0.045, 0.0, 0.72), 0.04, seg=14)
        yk = sp.part(f'yoke{i}', 0, 0.0, 0.72, rx=-math.radians(38))
        yk.tube(PW, fillet([(0, 0, 0), (0, -0.12, 0), (0.0, -0.16, 0.0)], 0.04), 0.022, seg=10)
        yk.tube(PW, fillet([(-0.38, -0.2, 0), (-0.38, -0.16, 0), (0.38, -0.16, 0), (0.38, -0.2, 0)], 0.08), 0.02, seg=10)
        dm = yk.part(f'dome{i}', 0, -0.24, 0, rx=math.radians(tilt[i % len(tilt)]))
        R = 0.35
        dm.lathe(PW, [(0.0, 0.11), (0.1, 0.11), (0.24, 0.08), (R - 0.01, 0.03), (R, 0.0), (R, -0.02), (R - 0.02, -0.035)], seg=40)
        dm.lathe(sw(pt.GRAPHITE), [(R - 0.02, -0.035), (0.04, -0.035)], seg=40)
        for ring, n in ((0.1, 6), (0.18, 10), (0.26, 14)):
            for j in range(n):
                t = 2 * math.pi * j / n + ring
                dm.disc('LEDLine', math.cos(t) * ring, -0.037, math.sin(t) * ring, 0.028, seg=10, up=False)
        dm.vcyl(sw(pt.LGREY), 0, -0.17, 0, 0.022, 0.135, seg=12)
        dm.vcyl(sw(pt.LGREY), 0, -0.19, 0, 0.032, 0.03, seg=12)
        anchor(dm, f'light:dome{i}', 0, -0.04, 0)
    return k


def laminar_canopy(geo, f, ceiling=3.0, size=3.2):
    """The ultra-clean ventilation canopy over the table: a white perimeter frame with an LED band inside it, a perforated white diffuser
    face, short clear partial walls (skirts) at the edge. Origin: the canopy centre on the floor."""
    k = root(geo, f, None)
    h = size / 2
    y = ceiling - 0.04
    k.box(PW, -h, y, -h, h, ceiling, h, drop=('up',))
    for s in (-1, 1):
        k.box('LightPanel', -h + 0.12, y - 0.004, s * (h - 0.22) - 0.07, h - 0.12, y, s * (h - 0.22) + 0.07, drop=('up',))
        k.box('LightPanel', s * (h - 0.22) - 0.07, y - 0.004, -h + 0.3, s * (h - 0.22) + 0.07, y, h - 0.3, drop=('up',))
    k.box('AcousticTile', -h + 0.32, y - 0.006, -h + 0.32, h - 0.32, y - 0.002, h - 0.32, drop=('up',))
    for s in (-1, 1):
        k.box('Glass', -h, y - 0.35, s * h - 0.004, h, y, s * h + 0.004)
        k.box('Glass', s * h - 0.004, y - 0.35, -h, s * h + 0.004, y, h)
        k.box(SS, -h, y - 0.37, s * h - 0.01, h, y - 0.35, s * h + 0.01)
        k.box(SS, s * h - 0.01, y - 0.37, -h, s * h + 0.01, y - 0.35, h)
    return k


def operating_table(geo, f, node=None, top=0.9, length=2.05, width=0.52):
    """A general surgical table: a broad rounded base, a column in a bellows, a segmented radiolucent top with dark pads, stainless side rails,
    an arm board. Origin: footprint centre; head toward -z. Anchor: table:patient."""
    k = root(geo, f, node)
    k.rbox(PW, 0, 0, 0.15, 0.62, 0.11, 1.0, 0.18, axis='y', seg=5)
    k.rbox(sw(pt.GRAPHITE), 0, 0.0, 0.15, 0.56, 0.012, 0.94, 0.16, axis='y', seg=4)
    k.rbox(PW, 0, 0.11, 0.1, 0.34, 0.25, 0.26, 0.05, axis='y', seg=4)
    k.rbox(sw(pt.LGREY), 0, 0.36, 0.1, 0.3, top - 0.48, 0.22, 0.045, axis='y', seg=4)
    k.rbox(PW, 0, top - 0.12, 0.1, 0.42, 0.06, 0.6, 0.03, axis='y', seg=3)
    segs = [(-length / 2, -length / 2 + 0.3, 0.3), (-length / 2 + 0.31, -0.1, width), (-0.09, 0.45, width), (0.46, length / 2, width)]
    for (z0, z1, w) in segs:
        k.rbox(sw(pt.GRAPHITE), 0, top - 0.07, (z0 + z1) / 2, w - 0.02, 0.025, z1 - z0, 0.02, axis='y', seg=2)
        k.rbox('VinylGrey', 0, top - 0.045, (z0 + z1) / 2, w, 0.065, z1 - z0 - 0.006, 0.025, axis='x', seg=3)
    for s in (-1, 1):
        k.box(SS, s * (width / 2 + 0.01) - 0.005, top - 0.08, -length / 2 + 0.35, s * (width / 2 + 0.01) + 0.005, top - 0.05, length / 2 - 0.05)
    ab = k.at(width / 2 + 0.02, top - 0.03, -0.35, ry=math.radians(70))
    ab.box(SS, 0, -0.03, -0.04, 0.6, -0.01, 0.04)
    ab.rbox('VinylGrey', 0.33, -0.01, 0, 0.6, 0.045, 0.14, 0.02, axis='x', seg=3)
    anchor(k, 'table:patient', 0, top + 0.02, 0.0)
    return k


def anaesthesia_machine(geo, f, node=None):
    """An anaesthesia workstation shell (generic, no brand): a graphite chassis on castors, a white cabinet with drawers, a pull-out writing
    shelf, the upper body with the flowmeter panel and gas knobs, two vaporisers on the back bar, the absorber and bellows on the left, the
    breathing circuit hoses, a ventilator display on top and a patient monitor on an arm. Origin: footprint centre; the clinician stands at +z.
    Anchors: screen (ventilator), screen.monitor."""
    k = root(geo, f, node)
    W, D = 0.72, 0.68
    for x in (-W / 2 + 0.08, W / 2 - 0.08):
        for z in (-D / 2 + 0.08, D / 2 - 0.08):
            pt.castor(k, x, z, r=0.06, w=0.035, top=0.12)
    k.rbox(sw(pt.GRAPHITE), 0, 0.1, 0, W + 0.04, 0.1, D + 0.02, 0.05, axis='y', seg=3)
    k.rbox(PW, 0, 0.2, 0, W, 0.56, D, 0.03, axis='y', seg=3)
    for j in range(3):
        y0 = 0.24 + j * 0.17
        k.box(sw(pt.LGREY), -W / 2 + 0.03, y0, D / 2, W / 2 - 0.03, y0 + 0.15, D / 2 + 0.012, bev=0.003)
        k.box(sw(pt.MGREY), -0.12, y0 + 0.11, D / 2 + 0.012, 0.12, y0 + 0.13, D / 2 + 0.03)
    k.rbox(sw(pt.LGREY), 0, 0.76, 0.06, W + 0.06, 0.035, D + 0.12, 0.03, axis='y', seg=3)
    k.rbox(PW, 0, 0.795, -0.08, W, 0.62, 0.48, 0.04, axis='y', seg=3)
    fp = k.at(-0.12, 1.0, 0.16)
    fp.box(sw(pt.GRAPHITE), -0.16, 0.0, 0.0, 0.16, 0.34, 0.012)
    for i in range(3):
        fp.box(sw(pt.CLEAR), -0.11 + i * 0.1, 0.06, 0.012, -0.08 + i * 0.1, 0.3, 0.02)
    for i, c in enumerate((pt.WHITE, pt.YELLOW, pt.BLUE)):
        k.cyl(sw(c), (-0.23 + i * 0.1, 0.94, 0.16), (-0.23 + i * 0.1, 0.94, 0.2), 0.022, seg=12)
    k.box(SS, -W / 2, 1.38, -0.33, W / 2, 1.41, -0.3)
    for i, c in enumerate((pt.YELLOW, pt.BLUE)):
        v = k.at(0.14 + i * 0.16, 1.1, 0.12)
        v.rbox(sw(c), 0, 0, 0, 0.12, 0.24, 0.16, 0.02, axis='y', seg=3)
        v.vcyl(sw(pt.WHITE), 0, 0.24, 0, 0.045, 0.03, seg=14)
        v.box(sw(pt.WHITE), -0.03, 0.08, 0.08, 0.03, 0.15, 0.085)
    ab = k.at(-W / 2 - 0.12, 0.85, 0.1)
    ab.vcyl(sw(pt.GRAPHITE), 0, 0, 0, 0.1, 0.05, seg=16)
    ab.vcyl(sw(pt.PURPLE), 0, 0.05, 0, 0.085, 0.22, seg=16)
    ab.vcyl(sw(pt.CLEAR), 0, 0.3, 0, 0.09, 0.26, seg=16)
    ab.vcyl(sw(pt.GRAPHITE), 0, 0.56, 0, 0.095, 0.03, seg=16)
    k.box(sw(pt.GRAPHITE), -W / 2 - 0.04, 0.86, 0.04, -W / 2, 0.92, 0.16)
    for s in (-1, 1):
        hose = [(-W / 2 - 0.12 + s * 0.04, 1.05, 0.2), (-W / 2 - 0.2 + s * 0.04, 1.0, 0.45), (-W / 2 - 0.1, 0.95, 0.75), (-W / 2 + 0.05, 1.0, 0.95)]
        k.tube(sw(pt.PALEBLUE), hose, 0.012, seg=8)
    k.vcyl(sw(pt.PALEBLUE), -W / 2 + 0.05, 0.95, 0.95, 0.018, 0.08, seg=10)
    vd = k.at(-0.05, 1.43, -0.08, rx=math.radians(-12))
    pt.monitor(vd.at(0, 0.2, 0.0), w=0.42, h=0.33, d=0.08, name='screen', handle=False)
    vd.box(sw(pt.GRAPHITE), -0.05, -0.02, -0.05, 0.05, 0.05, 0.03)
    ma = k.at(W / 2 - 0.05, 1.41, -0.25)
    ma.vcyl(PW, 0, 0, 0, 0.025, 0.42, seg=12)
    ma.rbox(PW, 0.1, 0.38, 0.0, 0.22, 0.04, 0.05, 0.015, axis='x', seg=2)
    pt.monitor(ma.at(0.22, 0.52, 0.08, ry=math.radians(-25)), w=0.36, h=0.28, d=0.075, name='screen.monitor')
    return k


def instrument_table(geo, f, node=None, w=1.2, d=0.6, h=0.9, draped=False):
    """A stainless instrument (back) table on four castors: a rimmed top, a lower shelf; draped=True lays a pale blue sterile drape over it
    with instruments on a towel. Origin: footprint centre."""
    k = root(geo, f, node)
    for x in (-w / 2 + 0.05, w / 2 - 0.05):
        for z in (-d / 2 + 0.05, d / 2 - 0.05):
            pt.castor(k, x, z, r=0.04, w=0.03, top=0.1)
            k.vcyl(SS, x, 0.1, z, 0.014, h - 0.12, seg=10)
    k.tray(SS, 0, 0.3, 0, w - 0.02, d - 0.02, 0.025, wall=0.002, r=0.02, seg=2, floor_t=0.002)
    if draped:
        pt.drape(k.at(0, 0, 0, ry=math.pi / 2), 'Curtain', d + 0.01, w + 0.01, h + 0.002, 0.32, thick=0.004, r=0.02)
        k.box('Linen', -0.45, h + 0.006, -0.2, 0.25, h + 0.012, 0.2)
        for i in range(9):
            x = -0.4 + i * 0.07
            k.box(SS, x, h + 0.012, -0.14 + (i % 3) * 0.01, x + 0.012, h + 0.02, 0.12 - (i % 2) * 0.03)
        k.tray(SS, 0.42, h + 0.006, 0.0, 0.25, 0.18, 0.04, wall=0.004, r=0.03, seg=3)
    else:
        k.tray(SS, 0, h - 0.03, 0, w, d, 0.03, wall=0.002, r=0.02, seg=2, floor_t=0.002)
    return k


def mayo_stand(geo, f, node=None, h=1.05):
    """A Mayo stand: a U base on castors, a column, a cantilevered instrument tray (the patient side at local +z). Origin: the column."""
    k = root(geo, f, node)
    k.tube(SS, fillet([(0.25, 0.05, -0.25), (0.0, 0.05, -0.25), (0.0, 0.05, 0.25), (0.25, 0.05, 0.25)], 0.05), 0.014, seg=10)
    for z in (-0.25, 0.25):
        pt.castor(k, 0.25, z, r=0.03, w=0.022, top=0.04)
        pt.castor(k, 0.0, z, r=0.03, w=0.022, top=0.04)
    k.vcyl(SS, 0, 0.05, 0, 0.018, h - 0.1, seg=12)
    k.vcyl(sw(pt.GRAPHITE), 0, 0.7, 0, 0.026, 0.06, seg=12)
    k.box(SS, -0.02, h - 0.06, -0.02, 0.02, h - 0.03, 0.3)
    k.tray(SS, 0.0, h - 0.03, 0.42, 0.5, 0.34, 0.025, wall=0.002, r=0.02, seg=2, floor_t=0.002)
    return k


def scrub_sink(geo, f, bays=2, rim=0.95):
    """A stainless scrub trough (wall item): a deep trough on a full-height apron, a splashback, a sensor gooseneck spout, an elbow-operated
    soap dispenser and a brush box per bay, a scrub timer above. Origin: the trough's centre on the wall face, on the floor."""
    k = root(geo, f, None)
    w = 0.6 * bays + 0.15
    k.box(SS, -w / 2, rim - 0.02, 0.0, w / 2, rim + 0.55, 0.012)
    k.tray(SS, 0, rim - 0.3, 0.29, w, 0.56, 0.3, wall=0.012, r=0.04, seg=3, floor_t=0.04)
    k.box(SS, -w / 2 + 0.02, 0.1, 0.05, w / 2 - 0.02, rim - 0.3, 0.52, drop=('down',))
    k.box('Rubber', -w / 2 + 0.025, 0.0, 0.06, w / 2 - 0.025, 0.1, 0.5, drop=('down',))
    for i in range(bays):
        x = -w / 2 + 0.075 + 0.3 + i * 0.6
        sp = [(x, rim + 0.38, 0.012), (x, rim + 0.38, 0.12), (x, rim + 0.4, 0.2), (x, rim + 0.3, 0.27), (x, rim + 0.22, 0.27)]
        k.tube(SS, fillet(sp, 0.06, 4), 0.013, seg=10)
        k.box(sw(pt.BLACK), x - 0.015, rim + 0.25, 0.012, x + 0.015, rim + 0.28, 0.02)
        pt.dispenser(k, x - 0.2, rim + 0.62, body=pt.WHITE, w=0.11, h=0.26, d=0.11)
        k.rbox(SS, x + 0.18, rim + 0.62, 0.06, 0.12, 0.2, 0.12, 0.02, axis='y', seg=2)
    tm = k.at(0, rim + 1.15, 0.0)
    tm.rbox(sw(pt.BLACK), 0, 0, 0.02, 0.3, 0.1, 0.04, 0.01, axis='y', seg=2)
    tm.box(sw(pt.RED), -0.11, 0.025, 0.04, 0.11, 0.075, 0.042)
    return k
