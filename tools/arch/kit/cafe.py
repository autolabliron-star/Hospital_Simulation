"""
The atrium and cafe: counter (oak slats on the front, the lobby's feature-wall language), round and square tables, chairs, an oak slatted bench,
planters (furniture.planter, the lobby's fiddle-leaf figs). Conventions: kit/base.py.
"""
import math

import furniture as fu

from . import parts as pt
from .base import fillet, root
from .parts import sw

SS = 'Stainless'


def counter(geo, f, length=3.2, depth=0.72, h=1.05, back=True):
    """A cafe counter: light-oak vertical slats on a dark felt over the customer face (local +z), a white solid-surface top overhanging 50 mm
    with an LED line under its lip, a recessed plinth, a glass display case at the left end, a till and a stainless coffee machine on the
    back counter (local -z) with white cupboards under it. Origin: footprint centre of the front counter."""
    k = root(geo, f, None)
    L = length / 2
    z1 = depth / 2
    k.box('ShadowGap', -L + 0.04, 0, -z1 + 0.04, L - 0.04, 0.1, z1 - 0.06, drop=('down', 'up'))
    k.box('SolidSurface', -L, 0.1, -z1, L, h - 0.04, z1 - 0.04)
    k.box('ShadowGap', -L + 0.02, 0.1, z1 - 0.04, L - 0.02, h - 0.05, z1 - 0.03)
    n = int((length - 0.08) / 0.07)
    for i in range(n):
        x = -L + 0.04 + i * 0.07
        k.box('Oak', x, 0.12, z1 - 0.03, x + 0.042, h - 0.06, z1)
    k.box('SolidSurface', -L - 0.03, h - 0.04, -z1, L + 0.03, h, z1 + 0.05)
    k.box('LightPanel', -L + 0.05, h - 0.052, z1 + 0.01, L - 0.05, h - 0.044, z1 + 0.03)
    # display case at the left end
    dx = -L + 0.55
    k.box('SolidSurface', dx - 0.45, h, -z1 + 0.05, dx + 0.45, h + 0.05, z1 - 0.02)
    k.box('Glass', dx - 0.45, h + 0.05, z1 - 0.03, dx + 0.45, h + 0.42, z1 - 0.02)
    k.box('Glass', dx - 0.45, h + 0.42, -z1 + 0.05, dx + 0.45, h + 0.43, z1 - 0.02)
    for s in (-1, 1):
        k.box('Glass', dx + s * 0.45 - 0.005, h + 0.05, -z1 + 0.05, dx + s * 0.45 + 0.005, h + 0.42, z1 - 0.02)
    k.box('LEDLine', dx - 0.42, h + 0.415, -0.1, dx + 0.42, h + 0.42, 0.0)
    for i in range(4):
        x = dx - 0.33 + i * 0.22
        k.vcyl(sw(pt.WHITE), x, h + 0.05, 0.0, 0.08, 0.01, seg=16)
        k.vcyl(sw(pt.ORANGE if i % 2 else pt.WARMWHITE), x, h + 0.06, 0.0, 0.05, 0.05, seg=12, r2=0.045)
    # till
    t = k.at(0.5, h, -0.05, ry=math.pi)
    t.box(sw(pt.GRAPHITE), -0.1, 0, -0.08, 0.1, 0.02, 0.08)
    t.box(sw(pt.GRAPHITE), -0.02, 0.02, -0.02, 0.02, 0.18, 0.02)
    pt.flat_monitor(t.at(0, 0.28, 0, rx=math.radians(-15)), w=0.3, h=0.22, name='screen.till')
    if back:
        bz = -z1 - 0.95
        k.box(sw(pt.GRAPHITE), -L + 0.04, 0, bz - 0.3 + 0.04, L - 0.04, 0.1, bz + 0.3 - 0.04, drop=('down', 'up'))
        k.box('SolidSurface', -L, 0.1, bz - 0.3, L, 0.88, bz + 0.3)
        k.box('SolidSurface', -L - 0.02, 0.88, bz - 0.3, L + 0.02, 0.92, bz + 0.32)
        for i in range(int(length / 0.6)):
            x0 = -L + i * 0.6
            k.box('Oak', x0 + 0.003, 0.103, bz + 0.3, x0 + 0.597, 0.877, bz + 0.318, bev=0.002)
        cm = k.at(-0.4, 0.92, bz - 0.05)
        cm.rbox(SS, 0, 0, 0, 0.75, 0.48, 0.52, 0.04, axis='y', seg=3)
        cm.box(sw(pt.BLACK), -0.36, 0.12, 0.26, 0.36, 0.42, 0.262)
        for s in (-1, 1):
            cm.vcyl(SS, s * 0.2, 0.18, 0.3, 0.035, 0.06, seg=12)
            cm.vcyl(sw(pt.BLACK), s * 0.2, 0.15, 0.32, 0.012, 0.04, seg=8)
        cm.box(SS, -0.32, 0.02, 0.22, 0.32, 0.03, 0.36)
        cm.box('Screen', -0.08, 0.36, 0.262, 0.08, 0.42, 0.264)
        for i in range(6):
            cm.vcyl(sw(pt.WHITE), -0.3 + i * 0.11, 0.48, 0.0, 0.04, 0.08, seg=10, r2=0.045)
    return k


def table(geo, f, node=None, kind='round', size=0.7, h=0.74, top='Oak'):
    """A cafe table: an oak (or white) top on a graphite pedestal with a disc foot. kind 'round' (size = diameter) or 'square'."""
    k = root(geo, f, node)
    k.lathe('Steel', [(0.0, 0.0), (0.24, 0.0), (0.25, 0.008), (0.2, 0.025), (0.03, 0.04), (0.0, 0.04)], seg=32)
    k.vcyl('Steel', 0, 0.04, 0, 0.032, h - 0.08, seg=14)
    k.box('Steel', -0.2, h - 0.05, -0.025, 0.2, h - 0.03, 0.025)
    k.box('Steel', -0.025, h - 0.05, -0.2, 0.025, h - 0.03, 0.2)
    if kind == 'round':
        k.vcyl(top, 0, h - 0.03, 0, size / 2, 0.03, seg=48)
    else:
        k.rbox(top, 0, h - 0.03, 0, size, 0.03, size, 0.02, axis='y', seg=3)
    return k


def chair(geo, f, node=None, wood='Oak', frame='Steel', seat_h=0.45):
    """A cafe chair: a slim graphite steel four-leg frame, a moulded oak seat and a curved oak back band. Origin: footprint centre; the sitter
    faces local +z. Anchor: seat."""
    k = root(geo, f, node)
    W = 0.42
    for s in (-1, 1):
        x = s * (W / 2 - 0.02)
        k.cyl(frame, (x * 1.04, 0, 0.2), (x, seat_h - 0.03, 0.17), 0.011, seg=8)
        k.tube(frame, fillet([(x * 1.04, 0, -0.22), (x, seat_h - 0.03, -0.18), (x * 0.97, 0.8, -0.24)], 0.03), 0.011, seg=8)
        k.cyl(frame, (x, seat_h - 0.035, -0.18), (x, seat_h - 0.035, 0.17), 0.009, seg=6)
    k.cyl(frame, (-W / 2 + 0.02, seat_h - 0.035, 0.17), (W / 2 - 0.02, seat_h - 0.035, 0.17), 0.009, seg=6)
    k.rbox(wood, 0, seat_h - 0.025, 0.0, W, 0.025, 0.42, 0.04, axis='y', seg=4)
    from .base import arc_pts, anchor
    arc = arc_pts(0, 0.35, 0.58, math.radians(-110), math.radians(-70), 8)
    outer = [(x, z) for x, z in arc]
    inner = [(x * (0.565 / 0.58), 0.35 + (z - 0.35) * (0.565 / 0.58)) for x, z in reversed(arc)]
    k.prism(wood, outer + inner, 'xz', 0.64, 0.8, smooth=True)
    anchor(k, 'seat', 0, seat_h, 0.03)
    return k


def bench(geo, f, length=1.8, h=0.45, d=0.45):
    """An atrium bench: oak slats on two graphite flat-bar loop frames. Origin: footprint centre; seats face local +z."""
    k = root(geo, f, None)
    for x in (-length / 2 + 0.2, length / 2 - 0.2):
        k.box('Steel', x - 0.012, 0, -d / 2 + 0.04, x + 0.012, 0.02, d / 2 - 0.04)
        k.box('Steel', x - 0.012, h - 0.06, -d / 2 + 0.04, x + 0.012, h - 0.04, d / 2 - 0.04)
        for z in (-d / 2 + 0.04, d / 2 - 0.06):
            k.box('Steel', x - 0.012, 0, z, x + 0.012, h - 0.04, z + 0.02)
    n = 6
    sw_ = (d - (n - 1) * 0.008) / n
    for i in range(n):
        z = -d / 2 + i * (sw_ + 0.008)
        k.box('Oak', -length / 2, h - 0.04, z, length / 2, h, z + sw_, bev=0.003)
    return k


def planter(geo, f, r=0.3, seed=1, height=0.55, plant_h=1.85):
    """The lobby's concrete planter with a fiddle-leaf fig (furniture.planter) at a Frame."""
    fu.planter(geo, f.cx, f.cz, r=r, seed=seed, height=height, plant_h=plant_h)
