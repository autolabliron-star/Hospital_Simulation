"""
Clinical support: staff workstation (desk + two monitors), office chair, storage cabinets, modular shelving with bins, medication cart, linen
cart, wheelchair, beam seating (the approved lobby bench). Conventions: kit/base.py.
"""
import math

import furniture as fu

from . import parts as pt
from .base import K, fillet, root
from .parts import sw

PW = 'PowderWhite'
SS = 'Stainless'


def workstation(geo, f, w=1.4, d=0.7, h=0.74, monitors=2):
    """A staff workstation: a white top on a powder-coated C-leg frame with a cable tray and modesty panel, two slim monitors on a dual arm,
    keyboard, mouse and a mobile pedestal. Origin: footprint centre; the user sits at local +z. Anchors: screen0, screen1."""
    k = root(geo, f, None)
    k.rbox('SolidSurface', 0, h - 0.025, 0, w, 0.025, d, 0.006, axis='y', seg=2)
    for s in (-1, 1):
        x = s * (w / 2 - 0.06)
        k.rbox(PW, x, 0.0, 0.0, 0.05, 0.03, d - 0.08, 0.01, axis='z', seg=2)
        k.rbox(PW, x, 0.03, -d / 2 + 0.12, 0.05, h - 0.055, 0.05, 0.01, axis='y', seg=2)
        k.rbox(PW, x, h - 0.06, 0.0, 0.05, 0.035, d - 0.08, 0.01, axis='z', seg=2)
    k.box(sw(pt.LGREY), -w / 2 + 0.1, 0.3, -d / 2 + 0.1, w / 2 - 0.1, h - 0.06, -d / 2 + 0.115)
    k.box(PW, -w / 2 + 0.2, h - 0.16, -d / 2 + 0.12, w / 2 - 0.2, h - 0.15, -d / 2 + 0.3)
    m = k.at(0, h, -d / 2 + 0.1)
    m.box(sw(pt.GRAPHITE), -0.04, -0.03, -0.02, 0.04, 0.0, 0.04)
    m.vcyl(PW, 0, 0, 0.01, 0.018, 0.42, seg=12)
    xs = [(-0.29, 0.25), (0.29, -0.25)] if monitors == 2 else [(0.0, 0.0)]
    for i, (x, yaw) in enumerate(xs):
        m.rbox(PW, x / 2, 0.36, 0.06, abs(x) + 0.04, 0.03, 0.04, 0.012, axis='x', seg=2)
        pt.flat_monitor(m.at(x, 0.38, 0.12, ry=yaw), w=0.55, h=0.33, name=f'screen{i}')
    kb = k.at(0, h, 0.12)
    kb.rbox(sw(pt.GRAPHITE), 0, 0, 0, 0.44, 0.018, 0.14, 0.008, axis='y', seg=2)
    kb.box(sw(pt.MGREY), -0.2, 0.018, -0.05, 0.2, 0.02, 0.05)
    kb.rbox(sw(pt.GRAPHITE), 0.32, 0, 0.0, 0.06, 0.022, 0.1, 0.03, axis='y', seg=3)
    pedestal(k.at(w / 2 - 0.3, 0, -0.05))
    return k


def pedestal(k, w=0.4, d=0.55, h=0.58):
    """A mobile three-drawer pedestal (light grey metal, white top)."""
    for x in (-w / 2 + 0.05, w / 2 - 0.05):
        for z in (-d / 2 + 0.05, d / 2 - 0.05):
            pt.castor(k, x, z, r=0.022, w=0.018, top=0.045)
    k.box(sw(pt.LGREY), -w / 2, 0.045, -d / 2, w / 2, h - 0.02, d / 2 - 0.015)
    k.box('SolidSurface', -w / 2, h - 0.02, -d / 2, w / 2, h, d / 2)
    for j, (y0, y1) in enumerate(((0.06, 0.29), (0.3, 0.42), (0.43, h - 0.03))):
        k.box(sw(pt.LGREY), -w / 2 + 0.003, y0, d / 2 - 0.015, w / 2 - 0.003, y1, d / 2, bev=0.002)
        k.box(sw(pt.MGREY), -0.08, y1 - 0.03, d / 2, 0.08, y1 - 0.015, d / 2 + 0.012)


def office_chair(geo, f, node=None, upholstery='VinylGrey', seat_h=0.5, arms=True):
    """A task chair: a five-star base on twin-wheel castors, gas lift, a moulded seat with a cushion, an upholstered back on a back bar, T
    arms. Origin: the column; the sitter faces local +z. `seat_h`: the cushion's top (0.5: the kit's default; a sim seat's height to put
    the sitter on it: the gas lift is shorter or longer). Anchor: seat."""
    k = root(geo, f, node)
    dy = seat_h - 0.5
    for i in range(5):
        a = 2 * math.pi * i / 5 + math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        k.tube(sw(pt.GRAPHITE), [(ca * 0.03, 0.1, sa * 0.03), (ca * 0.31, 0.075, sa * 0.31)], 0.018, seg=6)
        pt.castor(k, ca * 0.31, sa * 0.31, r=0.028, w=0.04, top=0.075, twin=True, swivel=a)
    k.vcyl(sw(pt.GRAPHITE), 0, 0.08, 0, 0.035, 0.12, seg=12)
    k.vcyl(SS, 0, 0.2, 0, 0.014, max(0.05, 0.2 + dy), seg=10)
    u = k.at(0, dy, 0) if dy else k
    u.rbox(sw(pt.GRAPHITE), 0, 0.38, 0.02, 0.2, 0.05, 0.22, 0.03, axis='y', seg=2)
    u.rbox(sw(pt.GRAPHITE), 0, 0.42, 0.02, 0.48, 0.025, 0.44, 0.06, axis='y', seg=3)
    u.rbox(upholstery, 0, 0.44, 0.03, 0.48, 0.06, 0.45, 0.035, axis='x', seg=3)
    u.tube(sw(pt.GRAPHITE), fillet([(0, 0.4, -0.08), (0, 0.42, -0.26), (0, 0.65, -0.29)], 0.05), 0.022, seg=8)
    bk = u.at(0, 0.6, -0.27, rx=math.radians(-8))
    bk.rbox(upholstery, 0, 0, 0, 0.44, 0.48, 0.07, 0.06, axis='z', seg=4)
    bk.rbox(sw(pt.GRAPHITE), 0, 0.02, -0.04, 0.4, 0.44, 0.02, 0.05, axis='z', seg=3)
    if arms:
        for s in (-1, 1):
            u.tube(sw(pt.GRAPHITE), [(s * 0.2, 0.43, 0.0), (s * 0.24, 0.47, 0.0), (s * 0.24, 0.63, 0.02)], 0.012, seg=6)
            u.rbox(sw(pt.GRAPHITE), s * 0.24, 0.63, 0.03, 0.07, 0.025, 0.24, 0.012, axis='z', seg=2)
    from .base import anchor
    anchor(k, 'seat', 0, 0.48 + dy, 0.05)
    return k


def pedestal_chair(geo, f, seat_h, back=(0.62, 0.95), arms=True, base_r=0.24, mat='VinylTeal', arm_h=0.15, lean=6.0, node=None):
    """A chair on a round weighted base (no castors: theatre operators' chairs and stools, phlebotomy chairs): a graphite base disc with a
    rubber ring, a gas lift, a moulded seat with a wipe-clean cushion whose top is `seat_h` (a sim seat's height), a back pad from back[0] to
    back[1] on a bar, leaning `lean` degrees (None: a stool), padded arm rests `arm_h` above the seat. Origin: the column; the sitter faces +z."""
    k = root(geo, f, node)
    k.lathe(sw(pt.GRAPHITE), [(0.0, 0.0), (base_r, 0.0), (base_r, 0.012), (base_r - 0.03, 0.03), (0.0, 0.035)], seg=28)
    k.lathe(sw(pt.BLACK), [(base_r - 0.004, 0.0), (base_r + 0.006, 0.006), (base_r - 0.004, 0.012)], seg=28)
    k.vcyl(sw(pt.GRAPHITE), 0, 0.035, 0, 0.034, 0.16, seg=14)
    k.vcyl(SS, 0, 0.195, 0, 0.016, seat_h - 0.08 - 0.195, seg=12)
    k.rbox(sw(pt.GRAPHITE), 0, seat_h - 0.09, 0.0, 0.2, 0.03, 0.2, 0.02, axis='y', seg=2)
    k.rbox(sw(pt.GRAPHITE), 0, seat_h - 0.07, 0.01, 0.44, 0.02, 0.42, 0.05, axis='y', seg=3)
    k.rbox(mat, 0, seat_h - 0.055, 0.015, 0.44, 0.055, 0.43, 0.03, axis='x', seg=3)
    if back:
        b0, b1 = back
        k.tube(sw(pt.GRAPHITE), fillet([(0, seat_h - 0.08, -0.06), (0, seat_h - 0.07, -0.23), (0, b0 + 0.05, -0.25)], 0.04), 0.018, seg=8)
        bk = k.at(0, b0, -0.25, rx=math.radians(-lean))
        bk.rbox(mat, 0, 0, 0, 0.42, b1 - b0, 0.06, 0.05, axis='z', seg=4)
        bk.rbox(sw(pt.GRAPHITE), 0, 0.02, -0.035, 0.38, b1 - b0 - 0.04, 0.015, 0.04, axis='z', seg=3)
    if arms:
        for sd in (-1, 1):
            k.tube(sw(pt.GRAPHITE), [(sd * 0.2, seat_h - 0.07, 0.0), (sd * 0.25, seat_h - 0.03, 0.0), (sd * 0.25, seat_h + arm_h, 0.02)], 0.011, seg=6)
            k.rbox(mat, sd * 0.25, seat_h + arm_h, 0.03, 0.06, 0.03, 0.26, 0.012, axis='z', seg=2)
    return k


def cabinet(geo, f, w=0.9, h=2.0, d=0.45, kind='doors', front='SolidSurface', body='SolidSurface'):
    """A tall storage cabinet (free-standing against a wall; origin: footprint centre, front +z): white carcass on a recessed plinth.
    kind 'doors' (two white doors with bar pulls), 'glass' (glazed doors in slim white frames, shelves with boxes inside), 'open' (shelves)."""
    k = root(geo, f, None)
    k.box(sw(pt.GRAPHITE), -w / 2 + 0.03, 0, -d / 2 + 0.02, w / 2 - 0.03, 0.08, d / 2 - 0.05, drop=('down',))
    t = 0.018
    k.box(body, -w / 2, 0.08, -d / 2, w / 2, h, -d / 2 + t)
    for x0 in (-w / 2, w / 2 - t):
        k.box(body, x0, 0.08, -d / 2, x0 + t, h, d / 2 - 0.02)
    k.box(body, -w / 2, h - t, -d / 2, w / 2, h, d / 2 - 0.02)
    k.box(body, -w / 2 + t, 0.08, -d / 2, w / 2 - t, 0.1, d / 2 - 0.02)
    shelves = [0.1 + (h - 0.2) * i / 5 for i in range(1, 5)]
    if kind in ('glass', 'open'):
        for y in shelves:
            k.box(sw(pt.WHITE), -w / 2 + t, y, -d / 2 + t, w / 2 - t, y + 0.018, d / 2 - 0.04)
        for j, y in enumerate([0.1] + shelves):
            for i in range(3):
                x = -w / 2 + 0.07 + i * 0.27
                k.box(sw((pt.WHITE, pt.PALEBLUE, pt.WARMWHITE)[(i + j) % 3]), x, y + 0.018, -d / 2 + 0.05, x + 0.22, y + 0.2 - (i % 2) * 0.05,
                      d / 2 - 0.1, bev=0.003)
    if kind == 'open':
        return k
    g = 0.003
    dw = (w - 3 * g) / 2
    for i in range(2):
        x0 = -w / 2 + g + i * (dw + g)
        if kind == 'doors':
            k.box(front, x0, 0.083, d / 2 - 0.02, x0 + dw, h - g, d / 2, bev=0.002)
        else:
            fw = 0.045
            for (a0, b0, a1, b1) in ((x0, 0.083, x0 + fw, h - g), (x0 + dw - fw, 0.083, x0 + dw, h - g), (x0, 0.083, x0 + dw, 0.083 + fw),
                                     (x0, h - g - fw, x0 + dw, h - g)):
                k.box(front, a0, b0, d / 2 - 0.02, a1, b1, d / 2, bev=0.002)
            k.box('Glass', x0 + fw, 0.083 + fw, d / 2 - 0.012, x0 + dw - fw, h - g - fw, d / 2 - 0.008)
        hx = x0 + dw - 0.04 if i == 0 else x0 + 0.04
        pt.bar_handle(k, 0.95, 1.25, hx, d / 2, mat=sw(pt.MGREY), r=0.007, stand=0.03, axis='y')
    return k


def shelving(geo, f, w=1.2, h=1.8, d=0.5, shelves=5, bins=True):
    """Modular clinical storage: white powder-coated uprights, light grey shelves, rows of clear-blue bins with white labels. Origin:
    footprint centre; front +z."""
    k = root(geo, f, None)
    for x in (-w / 2 + 0.015, w / 2 - 0.015):
        for z in (-d / 2 + 0.015, d / 2 - 0.015):
            k.box(PW, x - 0.015, 0, z - 0.015, x + 0.015, h, z + 0.015, bev=0.003)
        k.box(PW, x - 0.012, 0.04, -d / 2 + 0.02, x + 0.012, 0.07, d / 2 - 0.02)
        k.box(PW, x - 0.012, h - 0.05, -d / 2 + 0.02, x + 0.012, h - 0.02, d / 2 - 0.02)
    for i in range(shelves):
        y = 0.12 + (h - 0.25) * i / (shelves - 1)
        k.box(sw(pt.LGREY), -w / 2 + 0.03, y, -d / 2 + 0.01, w / 2 - 0.03, y + 0.02, d / 2 - 0.01)
        if bins and i < shelves - 1:
            nb = 4
            bw = (w - 0.08) / nb
            for j in range(nb):
                x = -w / 2 + 0.04 + bw * (j + 0.5)
                k.tray(sw(pt.CLEAR), x, y + 0.02, 0.0, bw - 0.012, d - 0.06, 0.2, wall=0.004, r=0.012, seg=2, floor_t=0.004)
                k.box(sw(pt.WHITE), x - 0.05, y + 0.12, d / 2 - 0.03, x + 0.05, y + 0.16, d / 2 - 0.027)
                k.box(sw((pt.WHITE, pt.PALEBLUE, pt.WARMWHITE)[(i + j) % 3]), x - bw / 2 + 0.02, y + 0.024, -d / 2 + 0.06, x + bw / 2 - 0.02,
                      y + 0.1 + 0.03 * ((i + j) % 2), d / 2 - 0.08)
    return k


def med_cart(geo, f, node=None, w=0.68, d=0.52, h=1.02):
    """A medication cart: a white body on castors, a light grey worksurface with side rails, three columns of pale blue drawers and two deep
    ones, a keypad lock with a small screen, a push handle and a side bin. Origin: footprint centre; drawers face +z."""
    k = root(geo, f, node)
    for x in (-w / 2 + 0.07, w / 2 - 0.07):
        for z in (-d / 2 + 0.07, d / 2 - 0.07):
            pt.castor(k, x, z, r=0.05, w=0.03, top=0.1)
    k.rbox(sw(pt.GRAPHITE), 0, 0.1, 0, w + 0.02, 0.04, d + 0.02, 0.03, axis='y', seg=3)
    k.rbox(PW, 0, 0.14, -0.01, w, h - 0.2, d - 0.04, 0.025, axis='y', seg=3)
    fz = d / 2 - 0.03
    for c in range(3):
        cw = (w - 0.06) / 3
        x0 = -w / 2 + 0.03 + c * cw
        for r in range(4):
            y0 = h - 0.12 - (r + 1) * 0.085
            k.box(sw(pt.PALEBLUE), x0 + 0.004, y0, fz, x0 + cw - 0.004, y0 + 0.081, fz + 0.014, bev=0.003)
            k.box(sw(pt.WHITE), x0 + 0.05, y0 + 0.055, fz + 0.014, x0 + cw - 0.05, y0 + 0.068, fz + 0.018)
    for r in range(2):
        y0 = 0.17 + r * 0.19
        k.box(sw(pt.PALEBLUE), -w / 2 + 0.034, y0, fz, w / 2 - 0.034, y0 + 0.18, fz + 0.014, bev=0.003)
        k.box(sw(pt.WHITE), -0.12, y0 + 0.14, fz + 0.014, 0.12, y0 + 0.155, fz + 0.018)
    k.tray(sw(pt.LGREY), 0, h - 0.06, 0, w + 0.06, d + 0.04, 0.05, wall=0.012, r=0.03, seg=3)
    kp = k.at(w / 2 - 0.12, h - 0.11, fz + 0.012)
    kp.box(sw(pt.GRAPHITE), -0.07, -0.0, 0.0, 0.07, 0.06, 0.01)
    kp.box('Screen', -0.06, 0.02, 0.01, -0.01, 0.05, 0.012)
    k.tube(SS, fillet([(w / 2 + 0.01, 0.9, -0.16), (w / 2 + 0.07, 0.9, -0.16), (w / 2 + 0.07, 0.9, 0.16), (w / 2 + 0.01, 0.9, 0.16)], 0.03),
           0.013, seg=10)
    k.tray(sw(pt.WHITE), -w / 2 - 0.08, 0.62, 0.0, 0.14, 0.3, 0.2, wall=0.004, r=0.02, seg=2)
    return k


def linen_cart(geo, f, node=None, w=0.95, d=0.5, h=1.35):
    """A stainless linen cart: four shelves of folded linen, a pale blue cover rolled half down the front. Origin: footprint centre; front +z."""
    k = root(geo, f, node)
    for x in (-w / 2 + 0.03, w / 2 - 0.03):
        for z in (-d / 2 + 0.03, d / 2 - 0.03):
            pt.castor(k, x, z, r=0.05, w=0.03, top=0.1)
            k.vcyl(SS, x, 0.1, z, 0.013, h - 0.1, seg=10)
    for i in range(4):
        y = 0.18 + i * 0.36
        k.box(SS, -w / 2 + 0.02, y, -d / 2 + 0.02, w / 2 - 0.02, y + 0.012, d / 2 - 0.02)
        if i < 3:
            for j in range(3):
                pt.towel_stack(k, -w / 2 + 0.17 + j * 0.3, 0.0, y + 0.012, n=4 - (j + i) % 2, w=0.26, d=d - 0.1)
    k.box(SS, -w / 2 + 0.02, h - 0.02, -d / 2 + 0.02, w / 2 - 0.02, h, d / 2 - 0.02)
    k.box('Curtain', -w / 2 - 0.005, h * 0.5, d / 2 + 0.002, w / 2 + 0.005, h + 0.005, d / 2 + 0.008)
    k.box('Curtain', -w / 2 - 0.005, h, -d / 2 - 0.005, w / 2 + 0.005, h + 0.008, d / 2 + 0.008)
    k.rbox('Curtain', 0, h * 0.5 - 0.04, d / 2 + 0.03, w + 0.01, 0.08, 0.08, 0.04, axis='x', seg=4)
    return k


def wheelchair(geo, f, node=None, seat='VinylTeal', frame='Stainless'):
    """A transit/self-propel wheelchair: rear wheels with tyres, five-spoke hubs and push rims, front castors in forks, a tube frame with
    a cross brace, seat and back slings, padded arms, footplates, push handles with grips. Origin: footprint centre; facing +z. Anchor: seat."""
    k = root(geo, f, node)
    sh = 0.5
    for s in (-1, 1):
        wk = k.at(s * 0.3, 0.3, -0.2, rz=math.pi / 2)
        wk.torus('Rubber', 0.285, 0.018, seg=24, sides=6)
        wk.torus(frame, 0.255, 0.008, seg=24, sides=4, y=-s * 0.03)
        wk.vcyl(sw(pt.GRAPHITE), 0, -0.03, 0, 0.04, 0.06, seg=12)
        wk.lathe(sw(pt.GRAPHITE), [(0.27, 0.012), (0.255, 0.014), (0.255, -0.014), (0.27, -0.012), (0.27, 0.012)], seg=24)
        for j in range(5):
            a = 2 * math.pi * j / 5
            wk.tube(sw(pt.GRAPHITE), [(math.cos(a) * 0.04, 0, math.sin(a) * 0.04), (math.cos(a) * 0.255, 0, math.sin(a) * 0.255)], 0.009, seg=5,
                    caps=False)
        cz = 0.32
        k.cyl(frame, (s * 0.23, 0.2, cz), (s * 0.23, 0.42, cz), 0.014, seg=8)
        fk = k.at(s * 0.23, 0, cz)
        fk.cyl('Rubber', (-0.015, 0.075, -0.04), (0.015, 0.075, -0.04), 0.075, seg=14)
        fk.box(frame, -0.025, 0.07, -0.05, -0.02, 0.2, -0.03)
        fk.box(frame, 0.02, 0.07, -0.05, 0.025, 0.2, -0.03)
    side = [(0.0, 0.42, 0.32), (0.0, sh - 0.02, 0.28), (0.0, sh - 0.02, -0.22), (0.0, 0.92, -0.3), (0.0, 0.95, -0.42)]
    for kk in (k.at(-0.25, 0, 0), k.at(0.25, 0, 0)):
        kk.tube(frame, fillet(side, 0.05), 0.013, seg=10)
        kk.tube(frame, fillet([(0, 0.42, 0.32), (0, 0.3, 0.32), (0, 0.3, -0.12), (0, sh - 0.02, -0.2)], 0.04), 0.012, seg=8)
        kk.tube(frame, fillet([(0, sh - 0.02, 0.28), (0, 0.2, 0.44), (0.0, 0.12, 0.47)], 0.04), 0.011, seg=8)
        kk.tube('Rubber', [(0.0, 0.95, -0.42), (0.0, 0.96, -0.52)], 0.016, seg=10)
        kk.tube(frame, fillet([(0, sh - 0.02, 0.25), (0, 0.7, 0.24), (0, 0.7, -0.15), (0, sh, -0.17)], 0.04), 0.011, seg=8)
        kk.rbox(sw(pt.GRAPHITE), 0, 0.7, 0.05, 0.05, 0.035, 0.32, 0.015, axis='z', seg=2)
    for s in (-1, 1):
        k.box(sw(pt.GRAPHITE), s * 0.1 - 0.07, 0.11, 0.41, s * 0.1 + 0.08, 0.125, 0.55, bev=0.004)
    k.tube(frame, [(-0.25, 0.3, 0.02), (0.25, sh - 0.03, 0.02)], 0.011, seg=8)
    k.tube(frame, [(0.25, 0.3, 0.02), (-0.25, sh - 0.03, 0.02)], 0.011, seg=8)
    k.rbox(seat, 0, sh - 0.025, 0.03, 0.47, 0.035, 0.46, 0.015, axis='x', seg=2)
    bk = k.at(0, sh + 0.02, -0.21, rx=math.radians(-8))
    bk.rbox(seat, 0, 0, 0, 0.47, 0.4, 0.025, 0.012, axis='z', seg=2)
    from .base import anchor
    anchor(k, 'seat', 0, sh + 0.02, 0.04)
    return k


def beam_seating(geo, f, n=3, pitch=0.6, fabric='FabricAccent', seat_h=0.45):
    """Waiting beam seating, the approved lobby bench (furniture.bench_row) on a frame: fabric 'Fabric' | 'FabricAccent' for public areas,
    'VinylTeal' | 'VinylGrey' | 'VinylSage' (wipe-clean) for clinical waiting. Origin: the row's centre; seats face local +z. Seat hip
    points: local ((i - (n-1)/2) * pitch, seat_h, 0.02)."""
    fu.bench_row(geo, f, n, pitch, fabric, seat_h=seat_h)
