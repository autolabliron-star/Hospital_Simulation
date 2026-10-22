"""
The patient room: bed, bedside locker, overbed table, visitor chair, recliner, IV pole, bed headwall, patient monitor on an articulated arm,
cubicle curtain track and curtain, clinical hand-wash station, sharps and glove boxes, wall clock, wardrobe, en-suite door.

Every function: item(geo, f, ..., node=None) with f a common.Frame (see kit/base.py for the frames: free-standing items centred on their
footprint with their front toward local +z; wall items with their back on the wall face at local z = 0). Dimensions are real (metres).
"""
import math

from . import parts as pt
from .base import anchor, arc_pts, fillet, root
from .parts import sw

PW = 'PowderWhite'
SS = 'Stainless'


# --- the bed --------------------------------------------------------------------------------------------------------------------------------------
def bed(geo, f, node=None, width=1.0, length=2.2, deck=0.47, backrest=30.0, knee=0.0, rails='up', linen=True, mattress='VinylTeal',
        blanket='Curtain', board='Oak'):
    """A modern electric ward bed (LINET / Hill-Rom class): 1.0 x 2.2 m overall, 0.86 x 2.0 m mattress, 150 mm castors under a rounded base
    cover, twin lift columns, a four-section deck (the backrest hinged `backrest` degrees up), split side rails (head rails ride on the
    backrest, `rails` 'up' | 'down' | 'head'), head and foot boards (an oak panel on the foot board, the staff control panel on top), corner
    bumpers. Made up with a fitted sheet, a pillow and a blanket with the top sheet turned down (linen=True), else the bare vinyl mattress.
    Origin: the footprint centre on the floor; the head is at local -z, the foot at +z. Moving parts (node mode): <node>/backrest,
    <node>/backrest/rail_hl|rail_hr, <node>/rail_fl|rail_fr. Anchors: bed:pillow, bed:patient, bed:foot."""
    k = root(geo, f, node)
    hw, hl = width / 2, length / 2
    mw, ml = 0.86, 2.0
    mt = 0.16
    top = deck + mt
    # castors and base
    for x in (-0.33, 0.33):
        for z in (-0.82, 0.82):
            pt.castor(k, x, z, r=0.075, w=0.05, top=0.22, swivel=(0.4 if z > 0 else -0.25) * (1 if x > 0 else -1))
    k.rbox(PW, 0, 0.2, 0, 0.74, 0.1, 1.82, 0.12, axis='y', seg=4)                        # base cover
    k.rbox(sw(pt.GRAPHITE), 0, 0.185, 0, 0.7, 0.016, 1.76, 0.1, axis='y', seg=3, caps=(True))   # shadow line under it
    for z in (-0.58, 0.58):                                                                # lift columns: outer and inner sections
        k.rbox(PW, 0, 0.3, z, 0.22, 0.12, 0.14, 0.035, axis='y', seg=3)
        k.rbox(sw(pt.LGREY), 0, 0.42, z, 0.19, deck - 0.1 - 0.42, 0.115, 0.03, axis='y', seg=3)
    # deck frame (the frame stays level; the backrest section hinges at z = -0.2)
    fy = deck - 0.08
    for s in (-1, 1):
        k.rbox(PW, s * 0.44, fy, 0.0, 0.05, 0.06, 2.0, 0.018, axis='z', seg=3)
    for z in (-0.975, 0.975):
        k.rbox(PW, 0, fy, z, 0.84, 0.06, 0.05, 0.018, axis='x', seg=3)
    k.box(sw(pt.LGREY), -0.42, deck - 0.03, -0.2, 0.42, deck, 0.98, drop=('down',))       # seat, thigh and leg panels
    for x in (-0.47, 0.47):                                                                 # corner bumpers
        for z in (-0.99, 0.99):
            k.vcyl('Rubber', x, fy - 0.01, z, 0.035, 0.08, seg=12)
    # mattress / made bed: the seat-and-legs part
    cover = 'Linen' if linen else mattress
    k.rbox(cover, 0, deck, 0.39, mw, mt, 1.18, 0.04, axis='z', seg=3)
    if linen:
        pt.drape(k, blanket, mw + 0.01, 1.0, top + 0.004, 0.12, thick=0.012, cz=0.47, r=0.045)          # blanket over the lower body
        pt.drape(k, 'Linen', mw + 0.034, 0.22, top + 0.017, 0.07, thick=0.006, cz=0.06, r=0.055)        # the top sheet turned down over it
    # backrest: the deck panel, its mattress, the pillow and the head rails turn about the hinge
    b = k.part('backrest', 0, deck, -0.2, rx=math.radians(backrest))
    b.box(sw(pt.LGREY), -0.42, -0.03, -0.78, 0.42, 0.0, 0.0, drop=('down',))
    b.rbox(PW, 0, -0.07, -0.4, 0.8, 0.04, 0.7, 0.02, axis='y', seg=2)
    b.rbox(cover, 0, 0, -0.39, mw, mt, 0.78, 0.04, axis='z', seg=3)
    if linen:
        b.rbox('Linen', 0, mt - 0.02, -0.56, 0.62, 0.14, 0.38, 0.06, axis='x', seg=4)       # pillow
    anchor(b, 'bed:pillow', 0, mt + 0.1, -0.5)
    anchor(k, 'bed:patient', 0, top + 0.12, 0.15)
    anchor(k, 'bed:foot', 0, top, hl + 0.35)
    # head board: a rounded panel on two posts, a grip slot along its top
    k.rbox(PW, 0, deck - 0.1, -1.04, 0.96, 0.52, 0.04, 0.07, axis='z', seg=4)
    k.box(sw(pt.GRAPHITE), -0.28, deck + 0.36, -1.062, 0.28, deck + 0.385, -1.018)
    # foot board: white frame, an oak panel on its outer face, the staff panel on top
    k.rbox(PW, 0, deck - 0.06, 1.04, 0.96, 0.4, 0.04, 0.06, axis='z', seg=4)
    k.rbox(board, 0, deck - 0.0, 1.06, 0.8, 0.27, 0.008, 0.035, axis='z', seg=3)
    st = k.at(0, deck + 0.34, 1.04, rx=math.radians(-25))
    st.rbox(sw(pt.GRAPHITE), 0, -0.02, 0.0, 0.34, 0.05, 0.06, 0.012, axis='x', seg=2)
    st.box('Screen', -0.07, 0.03, -0.012, 0.07, 0.032, 0.02)
    for i, c in enumerate((pt.GREEN, pt.LGREY, pt.LGREY, pt.ORANGE)):
        st.box(sw(c), -0.15 + i * 0.022, 0.03, -0.022, -0.137 + i * 0.022, 0.033, -0.01)
    # side rails: head rails on the backrest, foot rails on the frame
    drop_ = {'up': 0.0, 'down': -0.27, 'head': None}[rails]
    for s, nm in ((-1, 'l'), (1, 'r')):
        hr = b.part(f'rail_h{nm}', s * (hw - 0.025), 0.0, -0.42)
        _rail(hr, s, 0.66, 0.0 if drop_ is None else drop_, mt, head=True)
        fr = k.part(f'rail_f{nm}', s * (hw - 0.025), deck, 0.48)
        _rail(fr, s, 0.66, -0.27 if drop_ is None else drop_, mt, head=False)
    return k


def _rail(k, s, L, dy, mt, head):
    """One split side rail: a white top bar, a light grey lower panel with a grip opening between them, end posts; a keypad on the head
    rails' outer and inner faces. k's origin: the rail's middle at deck level on the bed's side."""
    y0 = dy + 0.03
    y1 = dy + mt + 0.25
    k.rbox(PW, 0, y1 - 0.05, 0, 0.034, 0.05, L, 0.016, axis='z', seg=3)
    k.rbox(sw(pt.LGREY), 0, y0, 0, 0.026, 0.15, L - 0.04, 0.03, axis='z', seg=3)
    for z in (-L / 2 + 0.04, L / 2 - 0.04):
        k.rbox(PW, 0, y0, z, 0.03, y1 - y0 - 0.02, 0.05, 0.012, axis='y', seg=2)
    if head:
        kp = k.at(s * 0.016, y0 + 0.11, 0.05, ry=(math.pi / 2 if s > 0 else -math.pi / 2))
        pt.keypad(kp, 0, 0, 0.0, w=0.13, h=0.08)


# --- bedside locker ------------------------------------------------------------------------------------------------------------------------------
def locker(geo, f, node=None, w=0.5, d=0.48, h=0.86, front='Oak', body='SolidSurface'):
    """A mobile bedside locker: white carcass on hidden castors, a drawer and a door in light oak with bar pulls, a top with a raised lip,
    a towel rail on the side. Origin: footprint centre; front +z."""
    k = root(geo, f, node)
    for x in (-w / 2 + 0.06, w / 2 - 0.06):
        for z in (-d / 2 + 0.06, d / 2 - 0.08):
            pt.castor(k, x, z, r=0.03, w=0.025, top=0.07)
    k.box(sw(pt.GRAPHITE), -w / 2 + 0.03, 0.06, -d / 2 + 0.03, w / 2 - 0.03, 0.09, d / 2 - 0.04, drop=('down',))
    k.box(body, -w / 2, 0.09, -d / 2, w / 2, h - 0.03, d / 2 - 0.018)
    g = 0.003
    k.box(front, -w / 2 + g, h - 0.23, d / 2 - 0.018, w / 2 - g, h - 0.035, d / 2, bev=0.002)
    k.box(front, -w / 2 + g, 0.095, d / 2 - 0.018, w / 2 - g, h - 0.23 - 2 * g, d / 2, bev=0.002)
    pt.bar_handle(k, -0.07, 0.07, h - 0.13, d / 2, mat=sw(pt.MGREY), r=0.006, stand=0.025)
    pt.bar_handle(k, h - 0.33, h - 0.48, w / 2 - 0.05, d / 2, mat=sw(pt.MGREY), r=0.006, stand=0.025, axis='y')
    k.box(body, -w / 2 - 0.01, h - 0.03, -d / 2 - 0.01, w / 2 + 0.01, h, d / 2 + 0.01)
    for (x0, x1, z0, z1) in ((-w / 2 - 0.01, w / 2 + 0.01, -d / 2 - 0.01, -d / 2 + 0.008), (-w / 2 - 0.01, -w / 2 + 0.008, -d / 2, d / 2 + 0.01),
                             (w / 2 - 0.008, w / 2 + 0.01, -d / 2, d / 2 + 0.01)):
        k.box(body, x0, h, z0, x1, h + 0.012, z1)
    k.tube(SS, fillet([(w / 2, 0.55, -0.15), (w / 2 + 0.05, 0.55, -0.15), (w / 2 + 0.05, 0.55, 0.15), (w / 2, 0.55, 0.15)], 0.02), 0.007, seg=8)
    return k


# --- overbed table ---------------------------------------------------------------------------------------------------------------------------------
def overbed_table(geo, f, node=None, h=0.85, w=0.82, d=0.42, top='Oak'):
    """An overbed table: a U base on four castors slides under the bed, a telescopic column at the right-hand end (local +x), the top
    cantilevered across the bed. Origin: the top's centre on the floor; the patient sits at local -z or +z (symmetric)."""
    k = root(geo, f, node)
    cx = w / 2 - 0.02
    for z in (-0.2, 0.2):
        k.rbox(PW, -0.02, 0.045, z, w + 0.04, 0.03, 0.05, 0.012, axis='x', seg=2)
        for x in (-w / 2 + 0.02, cx):
            pt.castor(k, x, z, r=0.03, w=0.022, top=0.05)
    k.rbox(PW, cx, 0.045, 0, 0.06, 0.03, 0.45, 0.012, axis='z', seg=2)
    k.rbox(PW, cx, 0.075, 0, 0.075, 0.5, 0.055, 0.015, axis='y', seg=3)
    t = k.part('top', cx, 0.575, 0)
    t.rbox(SS, 0, 0, 0, 0.055, h - 0.575 - 0.06, 0.038, 0.012, axis='y', seg=2)
    t.box(PW, -w + 0.04, h - 0.575 - 0.05, -0.12, 0.04, h - 0.575 - 0.025, 0.12)
    t.rbox(top, -w / 2 + 0.02, h - 0.575 - 0.025, 0, w, 0.024, d, 0.03, axis='y', seg=4)
    t.rbox(sw(pt.GRAPHITE), -0.12, h - 0.575 - 0.07, 0.1, 0.07, 0.02, 0.03, 0.008, axis='x')
    anchor(t, 'table:top', -w / 2 + 0.02, h - 0.575, 0)
    return k


# --- seating ---------------------------------------------------------------------------------------------------------------------------------------
def visitor_chair(geo, f, node=None, vinyl='VinylTeal', wood='Oak', seat_h=0.46):
    """A healthcare visitor armchair: solid oak frame and arms, wipe-clean vinyl seat and back. Origin: footprint centre (0.58 x 0.6);
    front +z. Anchor: seat (hip point)."""
    k = root(geo, f, node)
    W, D = 0.56, 0.56
    for s in (-1, 1):
        x = s * (W / 2 - 0.03)
        k.cyl(wood, (x, 0, D / 2 - 0.05), (x, 0.62, D / 2 - 0.07), 0.021, seg=10, r2=0.018)          # front leg, up to the arm
        k.cyl(wood, (x, 0, -D / 2 + 0.03), (x, 0.62, -D / 2 + 0.13), 0.021, seg=10, r2=0.018)       # rear leg, raked
        k.cyl(wood, (x, 0.88, -D / 2 + 0.02), (x, 0.36, -D / 2 + 0.11), 0.019, seg=10)             # back stile
        k.rbox(wood, x, 0.62, 0.0, 0.052, 0.028, D - 0.02, 0.012, axis='z', seg=3)                   # arm
        k.box(wood, x - 0.012, 0.33, -D / 2 + 0.08, x + 0.012, 0.37, D / 2 - 0.08)                   # seat rail
    k.box(wood, -W / 2 + 0.03, 0.33, D / 2 - 0.09, W / 2 - 0.03, 0.37, D / 2 - 0.065)
    k.rbox(vinyl, 0, 0.37, 0.02, W - 0.1, seat_h + 0.015 - 0.37, D - 0.08, 0.03, axis='x', seg=3)
    bk = k.at(0, 0.5, -D / 2 + 0.07, rx=math.radians(-11))
    bk.rbox(vinyl, 0, 0, 0, W - 0.1, 0.36, 0.06, 0.03, axis='z', seg=3)
    anchor(k, 'seat', 0, seat_h, 0.04)
    return k


def recliner(geo, f, node=None, vinyl='VinylTeal', recline=0.0, footrest=0.0):
    """A high-back patient recliner on castors: upholstered sides with padded arms, seat, back with a head cushion, a hinged footrest, a
    push handle. Origin: footprint centre (0.74 x 0.86); front +z. Moving parts: <node>/back (recline degrees), <node>/footrest."""
    k = root(geo, f, node)
    W, D = 0.74, 0.84
    for x in (-0.28, 0.28):
        for z in (-0.32, 0.32):
            pt.castor(k, x, z, r=0.045, w=0.032, top=0.1)
    k.rbox(PW, 0, 0.1, 0, W - 0.08, 0.08, D - 0.12, 0.04, axis='y', seg=3)
    for s in (-1, 1):
        k.rbox(vinyl, s * (W / 2 - 0.06), 0.18, 0.0, 0.12, 0.47, D - 0.1, 0.05, axis='x', seg=4)       # side + arm
        k.rbox(sw(pt.GRAPHITE), s * (W / 2 - 0.06), 0.645, 0.08, 0.1, 0.012, 0.42, 0.02, axis='y', seg=2)
    k.rbox(vinyl, 0, 0.3, 0.04, W - 0.24, 0.15, D - 0.18, 0.05, axis='x', seg=4)                       # seat cushion
    bk = k.part('back', 0, 0.38, -D / 2 + 0.1, rx=-math.radians(12 + recline))
    bk.rbox(vinyl, 0, 0, 0.0, W - 0.2, 0.7, 0.16, 0.06, axis='z', seg=4)
    bk.rbox(vinyl, 0, 0.66, 0.05, W - 0.32, 0.2, 0.1, 0.05, axis='z', seg=4)
    bk.rbox(PW, 0, 0.05, -0.1, W - 0.26, 0.6, 0.04, 0.03, axis='z', seg=3)
    bk.tube(SS, fillet([(-0.18, 0.6, -0.1), (-0.18, 0.66, -0.16), (0.18, 0.66, -0.16), (0.18, 0.6, -0.1)], 0.03), 0.011, seg=10)
    fr = k.part('footrest', 0, 0.36, D / 2 - 0.08, rx=math.radians(footrest))
    fr.rbox(vinyl, 0, -0.3, 0.02, W - 0.26, 0.3, 0.07, 0.03, axis='z', seg=3)
    anchor(k, 'seat', 0, 0.47, 0.06)
    return k


# --- IV pole ---------------------------------------------------------------------------------------------------------------------------------------
def iv_pole(geo, f, node=None, height=2.0, hooks=4, bags=1, pump=True):
    """A five-leg IV stand on castors, a chrome pole with a height clamp, a four-hook top, saline bags, an infusion pump clamped to the pole.
    Origin: the pole's foot. Anchors: iv:hook0..3 (top of each hook), iv:pump (the pump's screen)."""
    k = root(geo, f, node)
    k.vcyl(PW, 0, 0.06, 0, 0.055, 0.06, seg=16)
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        ca, sa = math.cos(a), math.sin(a)
        k.tube(PW, [(ca * 0.04, 0.09, sa * 0.04), (ca * 0.29, 0.065, sa * 0.29)], 0.014, seg=8)
        pt.castor(k, ca * 0.3, sa * 0.3, r=0.028, w=0.022, top=0.065, swivel=a)
    k.vcyl(SS, 0, 0.1, 0, 0.016, 1.15, seg=12)
    k.vcyl(sw(pt.GRAPHITE), 0, 1.22, 0, 0.022, 0.06, seg=12)
    k.cyl(sw(pt.GRAPHITE), (0.02, 1.25, 0), (0.06, 1.25, 0), 0.008, seg=8)
    k.vcyl(SS, 0, 1.25, 0, 0.0125, height - 1.25, seg=12)
    k.vcyl(sw(pt.GRAPHITE), 0, height - 0.02, 0, 0.02, 0.035, seg=12)
    for i in range(hooks):
        a = 2 * math.pi * i / hooks + math.pi / 4
        ca, sa = math.cos(a), math.sin(a)
        hp = [(ca * 0.015, height, sa * 0.015), (ca * 0.1, height, sa * 0.1), (ca * 0.12, height + 0.02, sa * 0.12),
              (ca * 0.13, height + 0.045, sa * 0.13)]
        k.tube(SS, fillet(hp, 0.012, 3), 0.004, seg=6)
        anchor(k, f'iv:hook{i}', ca * 0.1, height, sa * 0.1)
        if i < bags:
            bx, bz = ca * 0.1, sa * 0.1
            bg = k.at(bx, height - 0.02, bz, ry=-a + math.pi / 2)
            bg.rbox(sw(pt.CLEAR), 0, -0.24, 0, 0.11, 0.2, 0.025, 0.012, axis='z', seg=2)
            bg.box(sw(pt.WHITE), -0.035, -0.17, 0.0125, 0.035, -0.09, 0.0135)
            bg.vcyl(sw(pt.CLEAR), 0, -0.32, 0, 0.008, 0.08, seg=8)
            bg.tube(sw(pt.CLEAR), [(0, -0.32, 0), (0.02, -0.5, 0.02), (0.05, -0.75, 0.03)], 0.0025, seg=5, caps=False)
    if pump:
        p = k.at(0, 1.1, 0.0)
        p.box(sw(pt.GRAPHITE), -0.02, 0.02, -0.02, 0.02, 0.07, 0.04)
        pu = p.at(0, 0.045, 0.12)
        pu.rbox(sw(pt.WHITE), 0, -0.11, 0, 0.13, 0.22, 0.15, 0.025, axis='y', seg=3)
        pu.box('Screen', -0.045, 0.01, 0.075, 0.045, 0.08, 0.077)
        pu.box(sw(pt.LGREY), -0.05, -0.09, 0.075, 0.05, -0.01, 0.077)
        pu.box(sw(pt.GREEN), 0.03, -0.035, 0.077, 0.045, -0.02, 0.079)
        anchor(pu, 'iv:pump', 0, 0.045, 0.077, w=0.09, h=0.07)
    return k


# --- bed headwall ----------------------------------------------------------------------------------------------------------------------------------
def headwall(geo, f, width=2.0, y=1.42, panel='CrashRail', panel_mat=None):
    """A horizontal bedhead services unit (wall item): an extruded white trunking at y..y+0.22 across `width` with end caps, up- and
    down-light (LED strips), medical gas outlets (O2 green, air yellow, vacuum white; colours synthetic), electrical sockets (one red on
    the essential supply), data, the nurse-call socket with its handset, a reading-light switch; below it a bed-head protection panel
    (wall.protection). Anchors: headwall:monitorMount (left of the bed head), headwall:o2."""
    k = root(geo, f, None)
    hw = width / 2
    H, D = 0.22, 0.075
    k.rbox(PW, 0, y, D / 2, width, H, D, 0.02, axis='x', seg=3)
    for s in (-1, 1):
        k.rbox(sw(pt.LGREY), s * (hw + 0.006), y - 0.004, D / 2 + 0.002, 0.012, H + 0.008, D + 0.008, 0.02, axis='x', seg=3)
    k.box('LightPanel', -hw + 0.06, y + H - 0.002, 0.018, hw - 0.06, y + H + 0.002, 0.045)            # uplight onto the wall
    k.box('LightPanel', -0.45, y - 0.003, 0.03, 0.45, y + 0.001, 0.06)                                # reading light (down)
    z = D
    for i, c in enumerate((pt.GREEN, pt.YELLOW, pt.WHITE)):
        pt.gas_outlet(k, 0.42 + i * 0.1, y + H / 2, c, z=z)
    for i in range(4):
        pt.socket(k, -0.42 - i * 0.1, y + H / 2, pt.RED if i == 3 else pt.WHITE, z=z)
    pt.socket(k, 0.78, y + H / 2, pt.BLUE, z=z, size=0.06)
    pt.socket(k, -0.86, y + H / 2, pt.ORANGE, z=z, size=0.07)
    k.box(sw(pt.GRAPHITE), -0.03, y + H / 2 - 0.02, z, 0.03, y + H / 2 + 0.02, z + 0.008, bev=0.002)
    # nurse call handset hanging on its cable
    hx = -0.86
    k.tube(sw(pt.LGREY), [(hx, y + 0.08, z + 0.01), (hx + 0.02, y - 0.1, z + 0.03), (hx + 0.04, y - 0.3, z + 0.04)], 0.003, seg=5, caps=False)
    hs = k.at(hx + 0.04, y - 0.3, z + 0.05, rz=0.12)
    hs.rbox(sw(pt.WHITE), 0, -0.17, 0, 0.055, 0.17, 0.03, 0.02, axis='z', seg=3)
    hs.box(sw(pt.RED), -0.012, -0.05, 0.015, 0.012, -0.026, 0.017)
    # bed-head protection panel
    pm = panel_mat or panel
    if pm:
        k.rbox(pm, 0, 0.32, 0.007, width + 0.2, 0.62, 0.014, 0.006, axis='x', seg=2)
    anchor(k, 'headwall:monitorMount', -hw - 0.1, 1.95, 0.0)
    anchor(k, 'headwall:o2', 0.42, y + H / 2, z + 0.03)
    return k


# --- monitor arm --------------------------------------------------------------------------------------------------------------------------------
def monitor_arm(geo, f, node=None, swing1=35.0, swing2=-70.0, tilt=-8.0, y=1.75, l1=0.32, l2=0.28):
    """A patient monitor on an articulated wall arm (wall item): a wall channel, two arm links (swing1/swing2 degrees about vertical), a
    tilting head with the monitor. Moving parts: <node>/arm1, <node>/arm1/arm2, <node>/arm1/arm2/head. Anchor: screen."""
    k = root(geo, f, node)
    k.rbox(PW, 0, y - 0.35, 0.015, 0.07, 0.6, 0.03, 0.01, axis='y', seg=2)
    k.rbox(sw(pt.LGREY), 0, y - 0.03, 0.05, 0.06, 0.08, 0.06, 0.012, axis='y', seg=2)
    a1 = k.part('arm1', 0, y, 0.06, ry=math.radians(swing1))
    a1.vcyl(PW, 0, -0.04, 0, 0.03, 0.07, seg=14)
    a1.rbox(PW, 0, -0.025, l1 / 2, 0.045, 0.045, l1, 0.018, axis='z', seg=3)
    a2 = a1.part('arm2', 0, 0.0, l1, ry=math.radians(swing2))
    a2.vcyl(PW, 0, -0.04, 0, 0.03, 0.07, seg=14)
    a2.rbox(PW, 0, -0.025, l2 / 2, 0.045, 0.045, l2, 0.018, axis='z', seg=3)
    a2.vcyl(PW, 0, -0.06, l2, 0.026, 0.08, seg=14)
    hd = a2.part('head', 0, -0.06, l2, ry=math.radians(-swing1 - swing2), rx=math.radians(tilt))
    hd.box(sw(pt.LGREY), -0.03, -0.1, -0.02, 0.03, 0.0, 0.03)
    pt.monitor(hd.at(0, -0.17, 0.07), w=0.38, h=0.3, d=0.075)
    return k


# --- curtains --------------------------------------------------------------------------------------------------------------------------------------
def _resample(path, step):
    """A polyline resampled every `step` metres along its length: [(x, z, s)]."""
    out = []
    acc = 0.0
    for i in range(len(path) - 1):
        (x0, z0), (x1, z1) = path[i], path[i + 1]
        L = math.hypot(x1 - x0, z1 - z0)
        n = max(1, int(math.ceil(L / step)))
        for j in range(n):
            t = j / n
            out.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, acc + L * t))
        acc += L
    out.append((path[-1][0], path[-1][1], acc))
    return out


def _flat_fillet(path, r, n=4):
    pts = fillet([(x, 0.0, z) for x, z in path], r, n)
    return [(p[0], p[2]) for p in pts]


def curtain_track(geo, f, path, ceiling=2.7, r=0.3):
    """A ceiling-fixed cubicle curtain track along a plan path [(x, z), ...] (local), bends filleted at r, with fixing blocks about every
    metre. Returns the filleted path (pass it to curtain())."""
    k = root(geo, f, None)
    fp = _flat_fillet(path, r, 5)
    y = ceiling - 0.03
    k.tube(PW, [(x, y, z) for x, z in fp], 0.011, seg=8)
    for x, z, _s in _resample(fp, 1.0):
        k.vcyl(sw(pt.WHITE), x, y, z, 0.016, ceiling - y, seg=8)
    return fp


def curtain(geo, f, path, ceiling=2.7, drawn=1.0, bottom=0.3, mat='Curtain', start=0.0):
    """A pleated cubicle / bay curtain hanging from the track along a (filleted) local path: it covers the fraction `drawn` of the track from
    `start` (0..1 of the length); the less is drawn the deeper the pleats (gathered fabric). A thin closed sheet (both faces bake)."""
    k = root(geo, f, None)
    pts = _resample(path, 0.035)
    total = pts[-1][2]
    s0, s1 = start * total, min(total, (start + drawn) * total)
    sel = [p for p in pts if s0 - 1e-6 <= p[2] <= s1 + 1e-6]
    if len(sel) < 2:
        return k
    gather = 1.0 / max(drawn, 0.18)
    amp = 0.022 + 0.018 * min(gather, 4.0)
    wl = 0.16 / min(gather, 2.5) + 0.06
    n = len(sel)

    def off(i):
        a = sel[max(0, i - 1)]
        b = sel[min(n - 1, i + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1.0
        w = amp * math.sin(2 * math.pi * (sel[i][2] - s0) / wl)
        return (dz / L * w, -dx / L * w)

    k.ribbon(mat, [(p[0], p[1]) for p in sel], bottom, ceiling - 0.07, thick=0.008, offset=off)
    # the gliders under the track
    for i in range(0, n, 4):
        x, z, _ = sel[i]
        k.vcyl(sw(pt.WHITE), x, ceiling - 0.075, z, 0.008, 0.045, seg=6)
    return k


def cubicle_curtains(geo, f, w=2.6, head_z=-1.15, foot_z=1.5, ceiling=2.7, drawn=0.35, start=0.0):
    """Track + curtain round a bed space: frame at the bed's centre (head toward -z), the headwall at local z = head_z. A U path from the wall
    on the bed's left round the foot (foot_z) to the wall on its right; drawn = the fraction of the track the curtain covers, from `start`
    (0.35 from 0: pulled back toward the head on the left). Returns the track path."""
    path = [(-w / 2, head_z + 0.12), (-w / 2, foot_z), (w / 2, foot_z), (w / 2, head_z + 0.12)]
    fp = curtain_track(geo, f, path, ceiling)
    curtain(geo, f, fp, ceiling, drawn=drawn, start=start)
    return fp


# --- hand-wash station ---------------------------------------------------------------------------------------------------------------------------
def handwash(geo, f, basin_h=0.86, towel=True, bins=True):
    """A clinical hand-wash station (wall item, HTM 64 style): a wall-hung solid-surface basin (no overflow, no plug) on a splashback panel,
    a sensor gooseneck spout, soap (left) and alcohol gel (right) dispensers, a paper towel dispenser, a pedal bin for clinical waste
    (orange lid) and one for domestic waste (black lid). Origin: the basin's centre on the wall face, on the floor."""
    k = root(geo, f, None)
    k.rbox('SolidSurface', 0, basin_h - 0.06, 0.006, 0.66, 0.66, 0.012, 0.01, axis='x', seg=2)
    k.tray('SolidSurface', 0, basin_h - 0.17, 0.215, 0.56, 0.4, 0.17, wall=0.025, r=0.06, seg=5, floor_t=0.05)
    k.vcyl(sw(pt.MGREY), 0, basin_h - 0.115, 0.27, 0.018, 0.002, seg=12)
    sp = [(0, basin_h + 0.3, 0.012), (0, basin_h + 0.3, 0.09), (0, basin_h + 0.33, 0.16), (0, basin_h + 0.27, 0.22), (0, basin_h + 0.2, 0.22)]
    k.tube(SS, fillet(sp, 0.05, 4), 0.012, seg=10)
    k.cyl(SS, (0, basin_h + 0.3, 0.012), (0, basin_h + 0.3, 0.045), 0.03, seg=14)
    k.box(sw(pt.BLACK), -0.012, basin_h + 0.255, 0.032, 0.012, basin_h + 0.27, 0.046)
    pt.dispenser(k, -0.45, basin_h + 0.33)
    pt.dispenser(k, 0.45, basin_h + 0.33, window=pt.PALEBLUE)
    if towel:
        tx = 0.85
        k.rbox(sw(pt.WHITE), tx, basin_h + 0.36, 0.065, 0.29, 0.38, 0.13, 0.03, axis='z', seg=3)
        k.box(sw(pt.CLEAR), tx - 0.1, basin_h + 0.55, 0.13, tx + 0.1, basin_h + 0.66, 0.132)
        k.box('Linen', tx - 0.09, basin_h + 0.3, 0.06, tx + 0.09, basin_h + 0.37, 0.064)
    if bins:
        for i, (x, lid) in enumerate(((0.72, pt.ORANGE), (1.08, pt.GRAPHITE))):
            k.rbox(sw(pt.WHITE), x, 0.0, 0.2, 0.3, 0.5, 0.32, 0.05, axis='y', seg=3)
            k.rbox(sw(lid), x, 0.5, 0.2, 0.31, 0.03, 0.33, 0.055, axis='y', seg=3)
            k.rbox(sw(pt.GRAPHITE), x, 0.0, 0.38, 0.14, 0.03, 0.06, 0.01, axis='y', seg=2)
    return k


def sharps_and_gloves(geo, f, y=1.2, gloves=(pt.BLUE, pt.PURPLE, pt.WHITE)):
    """A wall rail with a sharps container (yellow body, orange lid) and a three-box glove dispenser beside it (wall item; origin at the
    rail's centre on the wall, on the floor)."""
    k = root(geo, f, None)
    k.rbox(SS, 0, y + 0.3, 0.01, 0.75, 0.03, 0.02, 0.006, axis='x', seg=2)
    # sharps: a tapered body and a lid with the aperture
    sx = -0.22
    k.box(sw(pt.LGREY), sx - 0.1, y - 0.02, 0, sx + 0.1, y + 0.32, 0.012)
    prof = [(0.02, 0.0), (0.17, 0.0), (0.17, 0.2), (0.02, 0.22)]
    k.prism(sw(pt.YELLOW), [(z, yy + y) for z, yy in prof], 'zy', sx - 0.1, sx + 0.1)
    k.box(sw(pt.ORANGE), sx - 0.105, y + 0.2, 0.015, sx + 0.105, y + 0.25, 0.18, bev=0.006)
    k.box(sw(pt.BLACK), sx - 0.05, y + 0.25, 0.08, sx + 0.05, y + 0.252, 0.14)
    # gloves: wire frame, three boxes standing on end, a dark oval opening each
    gx = 0.16
    for i, c in enumerate(gloves):
        x = gx + (i - 1) * 0.135
        k.box(sw(c), x - 0.062, y - 0.05, 0.012, x + 0.062, y + 0.2, 0.1, bev=0.003)
        k.box(sw(pt.WHITE), x - 0.035, y + 0.04, 0.1, x + 0.035, y + 0.13, 0.102)
        k.box(sw(pt.BLACK), x - 0.022, y + 0.06, 0.102, x + 0.022, y + 0.11, 0.103)
    k.tube(SS, [(gx - 0.21, y - 0.05, 0.012), (gx - 0.21, y - 0.05, 0.105), (gx + 0.21, y - 0.05, 0.105), (gx + 0.21, y - 0.05, 0.012)], 0.004,
           seg=6)
    k.tube(SS, [(gx - 0.21, y + 0.12, 0.012), (gx - 0.21, y + 0.12, 0.105), (gx + 0.21, y + 0.12, 0.105), (gx + 0.21, y + 0.12, 0.012)], 0.004,
           seg=6)
    return k


# --- wall clock, wardrobe, door ---------------------------------------------------------------------------------------------------------------
def wall_clock(geo, f, y=2.1, r=0.15, hour=10, minute=9):
    """A round wall clock (wall item): graphite rim, white face, hour marks, hands at hour:minute and a red second hand."""
    k = root(geo, f, None)
    c = k.at(0, y, 0, rx=math.pi / 2)              # the clock's axis (local y of c) points out of the wall
    c.lathe(sw(pt.GRAPHITE), [(0.0, 0.0), (r, 0.0), (r + 0.006, 0.01), (r + 0.006, 0.035), (r - 0.004, 0.042), (r - 0.012, 0.038)], seg=40)
    c.disc(sw(pt.WHITE), 0, 0.03, 0, r - 0.01, seg=40)
    # in c, local x = wall x and local -z = up the wall (rx +90 turns +y to +z and +z to -y)
    for i in range(12):
        a = 2 * math.pi * i / 12
        ux, uz = math.sin(a), -math.cos(a)
        L = 0.025 if i % 3 == 0 else 0.014
        rr = r - 0.03
        c.box(sw(pt.BLACK), ux * rr - 0.003, 0.03, uz * rr - 0.003, ux * rr + 0.003, 0.032, uz * rr + 0.003)
        c.box(sw(pt.BLACK), ux * (rr - L) - 0.003, 0.03, uz * (rr - L) - 0.003, ux * (rr - L) + 0.003, 0.032, uz * (rr - L) + 0.003)
    for (ang, L, wd, col, yy) in ((2 * math.pi * ((hour % 12) + minute / 60) / 12, r * 0.5, 0.008, pt.BLACK, 0.033),
                                  (2 * math.pi * minute / 60, r * 0.78, 0.006, pt.BLACK, 0.035), (2 * math.pi * 0.62, r * 0.85, 0.002, pt.RED, 0.037)):
        h = c.at(0, yy, 0, ry=-ang)
        h.box(sw(col), -wd / 2, 0, -L, wd / 2, 0.002, 0.02)
    c.vcyl(sw(pt.RED), 0, 0.03, 0, 0.006, 0.009, seg=8)
    return k


def wardrobe(geo, f, w=0.6, h=2.0, d=0.58, doors=1, front='Oak', body='SolidSurface'):
    """A full-height patient wardrobe (free-standing against a wall; origin: footprint centre, front +z): white carcass, light oak doors with
    3 mm gaps and full-height bar pulls, a recessed plinth."""
    k = root(geo, f, None)
    k.box(sw(pt.GRAPHITE), -w / 2 + 0.03, 0, -d / 2 + 0.02, w / 2 - 0.03, 0.08, d / 2 - 0.05, drop=('down',))
    k.box(body, -w / 2, 0.08, -d / 2, w / 2, h, d / 2 - 0.02, drop=())
    g = 0.003
    dw = (w - 2 * g - (doors - 1) * g) / doors
    for i in range(doors):
        x0 = -w / 2 + g + i * (dw + g)
        k.box(front, x0, 0.083, d / 2 - 0.02, x0 + dw, h - g, d / 2, bev=0.002)
        hx = x0 + dw - 0.05 if (i == doors - 1 or doors == 1) else x0 + 0.05
        pt.bar_handle(k, 0.85, 1.25, hx, d / 2, mat=sw(pt.MGREY), r=0.007, stand=0.03, axis='y')
    return k


def door_leaf(geo, f, node=None, width=0.9, height=2.04, thick=0.044, open_deg=0.0, hinge='left', finish='Oak', lining=True, wall=0.15,
              indicator=True, vision=False):
    """A hinged door (en-suite, clinical rooms): the leaf (light oak by default) with a stainless lever handle and kick plate, an en-suite
    vacant/engaged indicator; optionally a lining (DoorFrame) on the opening. Origin: the opening's centre on the floor, on the wall's centre
    line; the leaf swings into local +z. Moving part: <node>/leaf (pivot on the hinge)."""
    k = root(geo, f, node)
    if lining:
        t, aw, at_ = 0.03, 0.07, 0.012
        for sd in (-1, 1):
            k.box('DoorFrame', sd * width / 2, 0, -wall / 2 - 0.005, sd * (width / 2 + t), height + t, wall / 2 + 0.005)
            for z in (-wall / 2 - at_, wall / 2):
                k.box('DoorFrame', sd * (width / 2 + 0.004), 0, z, sd * (width / 2 + t + aw), height + t + aw, z + at_, bev=0.002)
        k.box('DoorFrame', -width / 2, height, -wall / 2 - 0.005, width / 2, height + t, wall / 2 + 0.005)
        for z in (-wall / 2 - at_, wall / 2):
            k.box('DoorFrame', -width / 2 - 0.004, height + 0.004, z, width / 2 + 0.004, height + t + aw, z + at_, bev=0.002)
    sgn = -1 if hinge == 'left' else 1
    hx = sgn * width / 2
    lf = k.part('leaf', hx, 0, 0, ry=sgn * -math.radians(open_deg))
    # leaf geometry in the hinge frame: it spans from the hinge toward -sgn x
    x0, x1 = sorted((0.0, -sgn * (width - 0.006)))
    lf.box(finish, x0, 0.008, -thick / 2, x1, height - 0.004, thick / 2, bev=0.002)
    lx = -sgn * (width - 0.07)
    for zz in (thick / 2, -thick / 2):
        sg = 1 if zz > 0 else -1
        lf.cyl(SS, (lx, 1.02, zz), (lx, 1.02, zz + sg * 0.055), 0.009, seg=10)
        lf.tube(SS, [(lx, 1.02, zz + sg * 0.055), (lx + sgn * 0.13, 1.02, zz + sg * 0.055)], 0.009, seg=10)
        lf.cyl(SS, (lx, 1.02, zz), (lx, 1.02, zz + sg * 0.006), 0.026, seg=14)
        lf.box(SS, min(x0, x1) + 0.02, 0.01, zz if sg > 0 else zz - 0.0015, max(x0, x1) - 0.02, 0.2, zz + 0.0015 if sg > 0 else zz)
    if indicator:
        lf.box(sw(pt.GREEN), lx - 0.012, 1.12, thick / 2, lx + 0.012, 1.14, thick / 2 + 0.006)
    if vision:
        lf.box('Glass', -sgn * width * 0.3 - 0.08, 1.2, -thick / 2 - 0.001, -sgn * width * 0.3 + 0.08, 1.75, thick / 2 + 0.001)
    return k
