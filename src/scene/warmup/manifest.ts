/**
 * Every place in src/ that builds a material, and how the warm-up reaches it. materialCoverage.test.ts scans the source and fails when this list
 * and the code disagree, so a NEW material cannot slip in without somebody deciding how it gets warmed.
 *
 *   palette   the shared palette (materials.ts): `ALL_MATERIALS` is registered as a warm-up source, and the meshes of the building use it
 *   mounted   the module puts a mesh with this material into the scene when it mounts (hidden or not: the warm-up walks the whole tree,
 *             hidden walk-only and overview-only groups included), so the traversal finds it. This is the rule for everything new.
 *
 *   offline   (W3) the material is only ever drawn once, at mount, into an offscreen target (a procedural environment rendered into a PMREM):
 *             it never appears in a frame, so it needs no warming. What it produces (the texture) is registered with `registerWarmSource`.
 *
 * A material that is created LATER (on an event, a Jump, the first emote) is not reachable at warm-up time. Create it at mount and keep it on a
 * hidden mesh, or register it with `registerWarmSource` (registry.ts).
 *
 * Counts are the occurrences of `new XxxMaterial(`, a lowercase R3F `<meshXxxMaterial`, and `.clone()` of a material, comments excluded.
 */
export type WarmPath = 'palette' | 'mounted' | 'offline'

export interface MaterialSite {
  /** How many construction sites the file has. */
  count: number
  via: WarmPath
  /** What holds the material in the scene (for the next reader). */
  where: string
}

/** Keys are paths from the repository root. */
export const MATERIAL_SITES: Readonly<Record<string, MaterialSite>> = {
  'src/scene/materials.ts': { count: 1, via: 'palette', where: 'MAT: building meshes, pods, props; every key also registered through ALL_MATERIALS' },
  'src/scene/actors/crowd/shaders.ts': {
    count: 6,
    via: 'mounted',
    where:
      'crowdRig objects: three bodies, props, vehicles, blob shadows, selection ring (hidden until used); W3 wave B: the realistic people\'s avatar bodies (one program), added to the crowd-people group by attachPeople while the warm gate "people" holds the warm-up (hidden until used)',
  },
  'src/scene/building/render/commandWall.ts': { count: 1, via: 'mounted', where: 'BuildingMeshes: the command-wall mesh' },
  'src/scene/building/render/labels.ts': { count: 1, via: 'mounted', where: 'BuildingMeshes: floor labels, in the overview-only group (hidden while walking)' },
  'src/scene/building/render/screens.ts': { count: 1, via: 'mounted', where: 'BuildingMeshes: the screen-atlas mesh' },
  'src/scene/building/render/walk/walkMaterials.ts': { count: 2, via: 'mounted', where: 'WalkBuilding: ceilings and signs, in the walk-only group (hidden in the overview)' },
  'src/scene/camera/RoomPicker.tsx': { count: 1, via: 'mounted', where: 'the hover tint plane, visible only while a room is hovered' },
  'src/scene/daylight/index.tsx': { count: 1, via: 'mounted', where: 'the corridor night-light strips (always drawn, writing no pixels by day)' },
  'src/scene/fx/EmoteLayer.tsx': { count: 1, via: 'mounted', where: 'the emote icon mesh, hidden while nobody emotes (re-created on a Jump; the program is shared by its cache key)' },
  'src/scene/imaging/machines/machineMaterials.ts': { count: 3, via: 'mounted', where: 'imaging rig: MACHINE_BODY, MACHINE_GLOW and the four monitors (made at mount by createRig)' },
  'src/scene/lighting/env/hospitalEnvironment.ts': { count: 1, via: 'offline', where: 'the hospital environment: unlit room faces, light panels and a daylight strip, rendered once into a PMREM at mount (never in a frame)' },
  'src/scene/meals/blob.ts': { count: 1, via: 'mounted', where: 'MealBot shadow mesh' },
  'src/scene/meals/botsRig.ts': { count: 2, via: 'mounted', where: 'MealBot body and light ring (kept on hidden zero-size instances while no bot is out)' },
  'src/scene/meals/traysRig.ts': { count: 1, via: 'mounted', where: 'tray and cloche meshes (hidden instances)' },
  'src/scene/meals/ward/wardParts.ts': { count: 2, via: 'mounted', where: 'ward rig: bedside screens and door tiles' },
  'src/scene/robots/faceMaterial.ts': { count: 1, via: 'mounted', where: 'PodsLayer: the pod face screens' },
}

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT = /(^|[^:'"`])\/\/.*$/gm

/** Source with its comments blanked out (crude, and enough: it is only used to find constructor calls). */
export function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '$1')
}

/** `new BasicMaterial(`, `new ShaderMaterial(`, a lowercase R3F element `<meshBasicMaterial`, and `MAT.x.clone()` / `fooMaterial.clone()`. */
const SITE = /new \w*Material\(|<(?:mesh|line|points|sprite|shader|rawShader)\w*Material\b|(?:\bMAT\.\w+|\b\w*[mM]aterial\w*|\bmat)\.clone\(\)/g

/** How many material construction sites a source file has. */
export function materialSitesIn(source: string): number {
  return stripComments(source).match(SITE)?.length ?? 0
}
