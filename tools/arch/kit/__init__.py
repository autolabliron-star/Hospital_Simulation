"""
The shared clinical furniture kit (docs/handover/rollout-kit.md): parametric Blender Python on the generator's per-material scene (common.Geo).

  from kit import arch, base, cafe, cryo, ctcryo, er, parts, patient, support, theatre
  patient.bed(geo, Frame(x, z, heading), node='bed:A1', backrest=30)

base: the emitter K, primitives, movable nodes (finalize_nodes), anchors; parts: shared sub-assemblies; arch: skirting, rails, guards, ceilings.
"""
