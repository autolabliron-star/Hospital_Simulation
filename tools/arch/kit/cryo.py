"""
Cryoablation (docs/research/cryoablation.md, option A: the imaging zone's ultrasound room): a brand-free, synthetic liquid-nitrogen
cryoablation console. Conventions: kit/base.py (local +z = the front, where the user stands; real metres).
"""
import math

from . import parts as pt
from .base import arc_pts, fillet, root, rounded_rect
from .parts import sw

SS = 'Stainless'
BODY = 'SolidSurface'


def console(geo, f, node=None, tyre=None):
    """A slim mobile cryoablation console, about 0.45 W x 0.60 D x 1.10 H, on four castors.

    - body: white solid surface with rounded corners on a graphite bumper band; a status light strip across the top of the front;
    - an open bay in the local -x side holds the liquid-nitrogen dewar: a stainless flask with a frost-white cap and an icy collar, a
      stainless floor plate, a restraint bar across the opening, an insulated transfer line from the cap into the body;
    - a touchscreen on a neck, tilted 40 degrees toward the user: a graphite bezel, dark glass (Screen) with a faint glowing UI (a header
      line, the freeze-thaw-freeze timeline with its progress, an ice-ball gauge, readouts, start / stop keys);
    - the probe: an insulated hose from a port low on the front, coiled and hung on a hook under the status strip, then up and over to a
      pen-like cryoprobe standing in a holder cup on the -x side, near the front;
    - a stainless push handle at the back.
    Origin: the body's footprint centre. The body is 0.45 x 0.60; the coil adds 0.09 at the front, the handle 0.07 at the back and the
    probe holder 0.06 on the -x side (overall about 0.50 x 0.75). `tyre`: the castor tyres' material (default black KitPlastic: no
    Rubber draw call in a zone that has none). Materials: SolidSurface, Stainless, KitPlastic, Screen, LightPanel."""
    k = root(geo, f, node)
    tyre = tyre or sw(pt.BLACK)
    hw, hd, r = 0.215, 0.28, 0.05             # body half width / half depth, corner radius
    y_band, y0, y_mid, y_top = 0.10, 0.15, 0.74, 0.92
    nx, bz, rj = 0.06, 0.19, 0.02             # the dewar bay: from the -x side in to x = nx, z within +-bz; jamb radius

    # --- castors and the bumper band -----------------------------------------------------------------------------------------------------
    for x in (-0.16, 0.16):
        for z in (-0.22, 0.22):
            pt.castor(k, x, z, r=0.05, w=0.03, top=0.1, tyre=tyre)
    k.rbox(sw(pt.GRAPHITE), 0, y_band, 0, 2 * hw + 0.02, y0 - y_band, 2 * hd + 0.02, r + 0.01, axis='y', seg=4)

    # --- the body: a C-shaped lower part round the dewar bay, a full upper part, a top deck --------------------------------------------
    lower = (arc_pts(hw - r, -hd + r, r, -math.pi / 2, 0, 4) + arc_pts(hw - r, hd - r, r, 0, math.pi / 2, 4)
             + arc_pts(-hw + r, hd - r, r, math.pi / 2, math.pi, 4)
             + arc_pts(-hw + rj, bz + rj, rj, math.pi, 1.5 * math.pi, 3) + [(nx, bz), (nx, -bz)]
             + arc_pts(-hw + rj, -bz - rj, rj, 0.5 * math.pi, math.pi, 3)
             + arc_pts(-hw + r, -hd + r, r, math.pi, 1.5 * math.pi, 4))
    k.prism(BODY, lower, 'xz', y0, y_mid, caps=False, smooth=True)
    outline = rounded_rect(0, 0, 2 * hw, 2 * hd, r, 4)
    k.prism(BODY, outline, 'xz', y_mid, y_top, caps=False, smooth=True)
    k.qface(BODY, [(u, y_top, v) for u, v in outline], (0, 1, 0))
    k.qface(BODY, [(-hw, y_mid, -bz), (nx, y_mid, -bz), (nx, y_mid, bz), (-hw, y_mid, bz)], (0, -1, 0))     # the bay's ceiling
    # the status light strip and a power key on the front
    k.box('LightPanel', -0.15, 0.893, hd - 0.001, 0.15, 0.899, hd + 0.003)
    k.cyl(sw(pt.GREEN), (0.13, 0.83, hd - 0.001), (0.13, 0.83, hd + 0.004), 0.014, seg=12)
    k.cyl(sw(pt.GRAPHITE), (0.13, 0.83, hd + 0.004), (0.13, 0.83, hd + 0.009), 0.01, seg=12)

    # --- the dewar bay ---------------------------------------------------------------------------------------------------------------------
    dx = -0.08
    k.box(SS, -hw, y0, -bz, nx, y0 + 0.006, bz)                                                            # floor plate
    k.lathe(SS, [(0.0, y0 + 0.006), (0.105, y0 + 0.006), (0.115, y0 + 0.02), (0.115, 0.53), (0.108, 0.562), (0.088, 0.585),
                 (0.055, 0.598), (0.0, 0.598)], seg=20, cx=dx)
    k.lathe(sw(pt.CLEAR), [(0.115, 0.505), (0.1175, 0.505), (0.1175, 0.53), (0.1105, 0.564), (0.09, 0.5875), (0.057, 0.6005)],
            seg=20, cx=dx)                                                                                  # frost on the shoulder
    k.lathe(sw(pt.WHITE), [(0.0, 0.6), (0.062, 0.6), (0.065, 0.612), (0.065, 0.638), (0.058, 0.652), (0.03, 0.66), (0.0, 0.66)],
            seg=20, cx=dx)                                                                                  # the frost-white cap
    k.vcyl(sw(pt.GRAPHITE), dx + 0.035, 0.655, 0.02, 0.009, 0.03, seg=8)                                # relief valve
    k.tube(sw(pt.GRAPHITE), fillet([(dx, 0.655, 0.0), (dx, 0.705, 0.0), (nx, 0.712, 0.0)], 0.03), 0.011, seg=8)   # transfer line
    k.cyl(SS, (-hw + 0.008, 0.42, -bz - 0.005), (-hw + 0.008, 0.42, bz + 0.005), 0.008, seg=8)       # restraint bar

    # --- the touchscreen: a neck on the top deck, a slab tilted 40 degrees toward the user, a faint glowing UI ---------------------------
    th = math.radians(40)
    py, pz = 1.01, 0.06                                       # the slab's pivot (its underside, centre)
    k.prism(sw(pt.LGREY), [(-0.02, y_top), (0.14, y_top), (0.14, py - (0.14 - pz) * math.tan(th) - 0.003),
                           (-0.02, py + (pz + 0.02) * math.tan(th) - 0.003)], 'zy', -0.12, 0.12)
    s = k.at(0, py, pz, rx=th)
    s.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.4, 0.03, 0.26, 0.02, axis='y', seg=3)
    g = 0.0315                                                # the glass face; the UI floats 0.5 mm over it (the top of the image is -z)
    s.box('Screen', -0.18, 0.03, -0.11, 0.18, g, 0.115)
    s.box('LightPanel', -0.165, g, -0.1, 0.165, g + 0.0005, -0.096)                                     # header line
    for i, (a, b_, c) in enumerate(((-0.15, -0.05, pt.PALEBLUE), (-0.05, 0.03, pt.ORANGE), (0.03, 0.15, pt.PALEBLUE))):
        s.box(sw(c), a + 0.002, g, 0.062, b_ - 0.002, g + 0.0005, 0.07)                                  # freeze / thaw / freeze
    s.box('LightPanel', -0.148, g + 0.0005, 0.063, -0.08, g + 0.001, 0.069)                             # progress
    s.disc(sw(pt.PALEBLUE), -0.085, g + 0.0005, -0.015, 0.048, seg=24)                                   # ice-ball gauge
    s.disc(sw(pt.BLACK), -0.085, g + 0.001, -0.015, 0.04, seg=24)
    s.disc(sw(pt.CLEAR), -0.085, g + 0.0015, -0.015, 0.024, seg=20)
    s.disc(sw(pt.GRAPHITE), -0.085, g + 0.002, -0.015, 0.009, seg=12)
    for j, (mat, w) in enumerate((('LightPanel', 0.1), (sw(pt.LGREY), 0.08), (sw(pt.LGREY), 0.11))):
        z = -0.055 + j * 0.03
        s.box(mat, 0.02, g, z, 0.02 + w, g + 0.0005, z + 0.008)                                          # readouts
    for x, c in ((0.06, pt.GREEN), (0.13, pt.RED)):
        s.rbox(sw(c), x, g, 0.093, 0.05, 0.001, 0.016, 0.004, axis='y', seg=2)                            # start / stop

    # --- the probe: port, coiled hose on a hook, the pen-like cryoprobe in its holder ------------------------------------------------------
    k.cyl(SS, (-0.1, 0.42, hd - 0.002), (-0.1, 0.42, hd + 0.03), 0.022, seg=12)                           # port
    cx, cy, R, turns, n = 0.03, 0.70, 0.14, 2.5, 56
    hook_y = cy + R + 0.015
    k.tube(SS, [(cx, hook_y, hd - 0.002), (cx, hook_y, hd + 0.09), (cx, hook_y + 0.025, hd + 0.097)], 0.007, seg=8)
    z0, z1 = hd + 0.03, hd + 0.085
    coil = [(cx + R * math.cos(-math.pi / 2 + 2 * math.pi * turns * i / n), cy + R * math.sin(-math.pi / 2 + 2 * math.pi * turns * i / n),
             z0 + (z1 - z0) * i / n) for i in range(n + 1)]
    lead = fillet([(-0.1, 0.42, hd + 0.03), (-0.1, 0.5, z0), (cx - 0.05, cy - R, z0)], 0.04)
    px, pz_ = -hw - 0.047, 0.215                                                                         # the probe holder's axis
    tail = fillet([(cx - 0.05, cy + R + 0.003, z1), (-0.16, cy + R + 0.04, z1 - 0.005), (-0.24, 1.0, 0.31), (px, 1.1, 0.25),
                   (px, 1.09, pz_), (px, 1.03, pz_)], 0.035)
    k.tube(sw(pt.MGREY), lead + coil + tail, 0.009, seg=6)
    k.lathe(sw(pt.LGREY), [(0.0, 0.68), (0.022, 0.68), (0.022, 0.9), (0.016, 0.9), (0.016, 0.7), (0.0, 0.7)], seg=14, cx=px, cz=pz_)
    k.box(sw(pt.LGREY), -hw - 0.03, 0.81, pz_ - 0.012, -hw, 0.86, pz_ + 0.012)                           # holder bracket
    k.cyl(sw(pt.WHITE), (px, 0.86, pz_), (px, 1.0, pz_), 0.011, seg=12)                                  # probe handle
    k.cyl(sw(pt.SLATE), (px, 0.91, pz_), (px, 0.945, pz_), 0.0125, seg=12)                              # grip band
    k.cyl(sw(pt.GRAPHITE), (px, 1.0, pz_), (px, 1.032, pz_), 0.011, seg=10, r2=0.0085)                 # strain relief

    # --- push handle at the back ----------------------------------------------------------------------------------------------------------
    k.tube(SS, fillet([(-0.15, 0.8, -hd + 0.002), (-0.15, 0.8, -hd - 0.05), (-0.15, 0.97, -hd - 0.06), (0.15, 0.97, -hd - 0.06),
                       (0.15, 0.8, -hd - 0.05), (0.15, 0.8, -hd + 0.002)], 0.03), 0.013, seg=10)
    k.cyl(sw(pt.GRAPHITE), (-0.09, 0.97, -hd - 0.06), (0.09, 0.97, -hd - 0.06), 0.017, seg=12)
    return k
