import { SimKeyed } from '@/app/SimKeyed'
import { People } from './actors'
import { Building } from './building'
import { Daylight } from './daylight'
import { Drawers } from './drawers'
import { Effects } from './Effects'
import { EmoteLayer, SpeechBubbles } from './fx'
import { ImagingMachines } from './imaging'
import { DrawCentreLayer } from './drawCentre/DrawCentreLayer'
import { KioskLayer } from './kiosks/KioskLayer'
import { LabLayer } from './lab/LabLayer'
import { StatusScreens } from './w4kit/StatusScreens'
import { LevelGroup, LevelsFrame } from './levels'
import { Lighting } from './Lighting'
import { Meals } from './meals'
import { PharmacyCore } from './pharmacy'
import { Robots } from './robots'
import { SurgeryLayer } from './surgery/SurgeryLayer'

/**
 * Everything inside the canvas. Each layer is one entry point owned by one builder:
 *   Building (floors, walls, rooms, furniture, landscape, and R2's level 2) · LevelsFrame + LevelGroup (R2: which level is shown, and the level-1 rigs below)
 *   · PharmacyCore (MedVend, gantry, docks, rank, robot doors)
 *   · Daylight (L1: sun, sky and night lights from the clock; never the sun direction) · Robots (ceiling rail, MedPods)
 *   · Meals (L1: MealBots, trays, bed backrests, bedside screens, door tiles) · Drawers (MedDrawers) · ImagingMachines (MRI, CT, X-ray, ultrasound and their live
 *   scan images) · People (the instanced crowd) · fx (emote icons,
 *   speech bubbles).
 */
export function World() {
  return (
    <>
      <color attach="background" args={['#e9eeed']} />
      <Lighting />
      <Daylight />
      <Building />
      {/* R2 levels: writes `levelView` (your level while walking, the overview switch in the overview) before anything draws by level */}
      <LevelsFrame />
      {/* the ground floor's rigs hide while you walk on level 2 (both overviews keep them: level 2 sits only over the west block) */}
      <LevelGroup level={1}>
        <PharmacyCore />
        <Robots />
        <Meals />
        <Drawers />
        <ImagingMachines />
        {/* W4 smart diagnostics: health kiosks, the robot draw centre, the lab and pneumatic tube, their status screens */}
        <KioskLayer />
        <DrawCentreLayer />
        <LabLayer />
        <StatusScreens />
      </LevelGroup>
      {/* R2 level 2: the da Vinci 5 cart, the OR's screens and your teaching-console session (hidden unless level 2 is shown) */}
      <SurgeryLayer />
      <People />
      {/* these capture the running hospital's entity map when they mount: rebuilt on a Jump (L1) */}
      <SimKeyed>
        <EmoteLayer />
        <SpeechBubbles />
      </SimKeyed>
      <Effects />
    </>
  )
}
