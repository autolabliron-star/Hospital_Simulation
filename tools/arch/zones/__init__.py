"""
Zone design modules: one module per zone of tools/arch/zones.json (zones/<id>.py), loaded by generate.py --zone <id>.

generate.py builds a zone in this order:
  1. `shell.Plan(plan, zones, id)`, then the module's SHELL SETTINGS are applied to it (all optional, module-level names):
       HERO          rects (x0, x1, z0, z1) of the hero spaces: the walls bounding them get `WallPaint` (own dense lightmap), the rest `WallClinical`
       OWN_CEILINGS  area ids whose ceiling the design draws itself (no tegular lay-in ceiling from the shell)
       FLOORS        {area id: material} floor materials (default: Terrazzo in public spaces, Vinyl elsewhere)
       SKIP_DOORS    door ids that get no lintel and no frame from the shell (the design draws them)
       skip_glazing(w, a, b) -> bool   True for a span of outer glazing the design draws itself
       door_accent(d) -> material|None the lining material of a door frame (wayfinding colour), None = DoorFrame
  2. the shell: floors, walls and glazing, door lintels and frames, ceilings (shell.py)
  3. `build(ctx)`: the design (required; an empty build = shell only)
  3b. runtime hints (optional): REPLACES ['lobby' | 'footprint:<id|prefix*>', ...] the procedural furniture this design replaces (the runtime
     hides it while the zone is drawn; collision, seats and stations stay), VISIBLE_FROM ['zone id', ...] the zones it can be seen from.
  4. review and bake hints (optional): POSES [((x, z), (look_x, look_z)), ...] eye-level stills (the first one is
     docs/screenshots/zone-<id>-draft.jpg; default: down the long axis of the zone's largest area), PROBE (x, y, z) the reflection probe's
     position (y above the level floor; default: none unless a floor is glossy, then the centre of the largest area at 1.6 m).
     LIGHTMAP_DENSITY texels per m2 for the zone's lightmap sizes (default --density 400; the lobby, the hero, spends its whole budget).

`ctx` (Ctx below) is the whole API a design module needs:
  ctx.geo                  the zone's geometry (common.Geo): ctx.geo.box / fbox / cbox / cyl / disc / ring / poly with a material name
                           ('Accent:<i>' = swatch i). Coordinates: plan metres, x east, z south, y up FROM THIS LEVEL'S FLOOR (level 2 is
                           lifted on finalize). One mesh per material = one draw call: reuse materials, keep the zone <= 40 of them.
  ctx.pl                   shell.Plan of the zone (areas(), walls(), spans(w), doors(), door(id), area(id), H, T, DOOR_H, level, level_y)
  ctx.plan, ctx.zone       plan.json, this zone's zones.json entry
  ctx.fur                  this zone's furniture anchors: {'seats': [...], 'footprints': {id: fp}, 'stations': {id: st}} (plan.json
                           `furniture` filtered by zone; x as drawn)
  ctx.shell, ctx.common, ctx.mt, ctx.fu, ctx.kit
                           the modules: shell helpers (line_box, door_frame, grid_ceiling, paving, ...), common (Frame, P, WORLD),
                           the material library (materials.py), the parametric furniture (furniture.py) and the furniture kit
                           (tools/arch/kit, None until it exists)
  ctx.Frame                common.Frame (a local frame: origin, heading)
  ctx.downlight(x, z, ch, power=14)   a spot lamp under a downlight lens at ceiling height ch (renders and bakes only)
  ctx.light(fn)            any other lamp: fn(scene, level_y) is called once the scene's lights are set up
  movable parts           the kit's named nodes (kit.base.root(geo, f, node='bed:A1')) are exported as named glTF nodes, never lightmapped;
                           kit anchors (kit.base.anchor) are written to <id>.anchors.json beside the glb (y lifted to the level)
  ctx.draft                True for a draft bake (skip what is slow and invisible at draft quality)
  ctx.context              True when the zone is built as a NEIGHBOUR of the zone being baked (light blocker / bounce only, never exported)
"""
import importlib

import common
import furniture
import materials
import shell

try:
    import kit  # tools/arch/kit (the furniture kit), owned by the furniture agent
    import kit.base  # noqa: F401  (finalize_nodes: movable named nodes; anchors)
except Exception:      # noqa: BLE001  (absent or broken: the zones still build)
    kit = None

SETTINGS = ('HERO', 'OWN_CEILINGS', 'FLOORS', 'SKIP_DOORS')


def load(zid):
    return importlib.import_module(f'zones.{zid}')


class Ctx:
    def __init__(self, geo, pl, plan, zone, draft=False, context=False):
        self.geo = geo
        self.pl = pl
        self.plan = plan
        self.zone = zone
        self.id = zone['id']
        self.level = zone['level']
        self.level_y = pl.level_y
        self.draft = draft
        self.context = context
        self.shell, self.common, self.mt, self.fu, self.kit = shell, common, materials, furniture, kit
        self.Frame = common.Frame
        fur = plan.get('furniture', {})
        mine = (lambda e: e.get('zone') == self.id)
        self.fur = {
            'seats': [s for s in fur.get('seats', []) if mine(s)],
            'footprints': {f['id']: f for f in fur.get('footprints', []) if mine(f)},
            'stations': {s['id']: s for s in fur.get('stations', []) if mine(s)},
        }
        self.downlights = []      # (x, z, ch, power), y relative to the level
        self.lights = []          # fn(scene, level_y)

    def downlight(self, x, z, ch, power=14.0):
        self.downlights.append((x, z, ch, power))

    def light(self, fn):
        self.lights.append(fn)


def configure(pl, design):
    """Apply a design module's shell settings to its Plan."""
    pl.hero = list(getattr(design, 'HERO', ()))
    pl.own_ceilings = tuple(getattr(design, 'OWN_CEILINGS', ()))
    pl.floors = dict(getattr(design, 'FLOORS', {}))
    return pl


def largest_area(pl):
    """The rect of the zone's largest area."""
    best = max(pl.areas(), key=lambda a: (a['rect']['x1'] - a['rect']['x0']) * (a['rect']['z1'] - a['rect']['z0']))
    return best['rect']


def poses_of(design, pl):
    """The review poses [((x, z), (look_x, look_z)), ...]: the design's POSES, else down the long axis of the zone's largest area, from 1 m
    inside its near end (eye 1.6 m above the level floor)."""
    poses = getattr(design, 'POSES', None)
    if poses:
        return list(poses)
    r = largest_area(pl)
    xc, zc = (r['x0'] + r['x1']) / 2, (r['z0'] + r['z1']) / 2
    if r['x1'] - r['x0'] >= r['z1'] - r['z0']:
        return [((r['x0'] + 1.0, zc + 0.3), (r['x1'], zc))]
    return [((xc + 0.3, r['z0'] + 1.0), (xc, r['z1']))]


def build_zone(geo, plan, zones, zid, draft=False, context=False):
    """Shell + design of one zone into `geo` (a Geo lifted to the zone's level). Returns (pl, ctx, design)."""
    pl = shell.Plan(plan, zones, zid)
    design = load(zid)
    configure(pl, design)
    shell.floors(geo, pl)
    shell.walls(geo, pl, skip=getattr(design, 'skip_glazing', None))
    shell.doors(geo, pl, frame_mat=getattr(design, 'door_accent', None), skip=tuple(getattr(design, 'SKIP_DOORS', ())))
    shell.ceilings(geo, pl)
    ctx = Ctx(geo, pl, plan, pl.zone, draft=draft, context=context)
    design.build(ctx)
    return pl, ctx, design
