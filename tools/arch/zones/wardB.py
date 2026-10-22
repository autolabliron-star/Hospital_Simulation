"""
Zone 'wardB' (Ward B, corridor B, lab and clean supply): ward A's design (zones/wardA.py) mirrored in z, in the ward's sage tint and green
wayfinding colour. Areas: corridorB, room:B1..B8, hubB, quietB (the quiet room), supplyB (clean supply); the lab stays procedural (its
robots and benches are the runtime's), it only gets the shell.
"""
from zones import wardA as _w

OWN_CEILINGS = _w.own_ceilings('B')
REPLACES = ['footprint:B*', 'footprint:hubB:*', 'footprint:quiet:*', 'footprint:supply:*']
VISIBLE_FROM = ['lobby', 'imaging', 'core', 'atrium']
PROBE = (0.0, 1.6, 14.0)
# review stills: room B3 from just inside its door, room B3 from the visitor corner back to the bed head, the corridor, the nurse hub
POSES = [((-13.9, 16.4), (-12.0, 21.5)), ((-13.7, 20.6), (-11.2, 16.6)), ((-37.5, 14.35), (36.0, 14.0)), ((-0.6, 13.3), (1.2, 21.6))]

skip_glazing = _w.skip_glazing
door_accent = _w.accent_of('B')


def build(ctx):
    _w.build_ward(ctx, 'B')
