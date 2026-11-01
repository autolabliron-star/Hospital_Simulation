/**
 * R5 wave 2 (agent H): the stage's cloth. The shared `MACHINE_BODY` (lit, per-vertex colour) is a little glossy for sterile drapes and skin (roughness 0.42, metalness 0.12);
 * this is the same material, matte: roughness 0.9, metalness 0. It is the SAME SHADER PROGRAM: roughness and metalness are uniforms, the type, `vertexColors` and every
 * other parameter three keys a program on are the same, and it takes the same light-volume patch (`patchMaterialLook(.., 'plain')`: program key `std+lv0`, as MACHINE_BODY's
 * and the whole palette's), so the warm-up compiles nothing new for it (stage.test.ts compares the program keys and the patched sources). It is mounted with the stage's mesh
 * at load (runtime.ts), hidden while the stage is empty.
 */
import { MeshStandardMaterial } from 'three'
import { patchMaterialLook } from '@/scene/lighting/palettePatch'

export const STAGE_MATERIAL = new MeshStandardMaterial({ vertexColors: true, color: '#ffffff', roughness: 0.9, metalness: 0 })
STAGE_MATERIAL.name = 'surgery-stage-cloth'
patchMaterialLook(STAGE_MATERIAL, 'plain')
