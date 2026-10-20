/**
 * R3 "Real screens": the contract between the anatomy regions of the synthetic body and the renderers that plan slices and views on them.
 *
 * Every region builder adds its parts to a body.ts BodyBuilder in ONE shared patient frame (DICOM LPS millimetres: +x the patient's LEFT,
 * +y POSTERIOR, +z SUPERIOR; origin midway between the hip-joint centres; an average adult, then scaled by the patient's build as in
 * params.ts: L by `width`, P by `depth`, S by `height`) and returns its LANDMARKS: named points (and unit directions) the slice planner needs,
 * e.g. the head's vertex and foramen magnum, the knee's joint centre and femoral axis.
 *
 * Where things are in that frame (average adult, before scaling):
 *   trunk outline     S -140 (upper thighs) .. 680 (base of the neck); half-width about 150-180, half-depth 105-128 (abdomen.ts OUTLINE)
 *   hips              femoral heads at L +-96, P 2, S 0
 *   lumbar spine      S1 S 70 .. L1 S 245, vertebral bodies P 45-62 (abdomen.ts VERTEBRAE, up to T8 at S 388)
 *   thorax            diaphragm domes S ~400-420, lung apices S ~660, carina S ~560, shoulders S ~620 at L +-190
 *   neck and head     C7 S ~690 .. C1 S ~800; skull base (foramen magnum) S ~810; vertex S ~985 (head centre S ~900, P ~10)
 *   arms by the sides elbows S ~330 at L +-230, wrists S ~80, palms facing forward (the anatomical position)
 *   legs              knees S ~-440 at L +-95, ankles S ~-860
 *
 * Layers (body.ts: the higher wins where parts overlap): 1 the outline, 2 wall muscle, 3 cavity fat, 4-6 gut, 6 lungs, 7 solid organs, 8-15
 * organ detail, 16-17 vessels, 18 muscles, 19-21 bone (discs, cortex, marrow), 22-23 canal and cord, 24-25 bladder. Regions use the same
 * scheme (a head: scalp 1, skull cortex 20, diploe 21, dura 21, CSF 22, brain 23+, ventricles above the brain).
 */
import type { V3 } from '../body'

export type RegionId = 'abdomen' | 'thorax' | 'head' | 'knee' | 'ankle' | 'wrist' | 'forearm'

/** Named landmark points and directions (LPS mm, unit vectors for directions). */
export type Landmarks = Record<string, V3>
