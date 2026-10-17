import { SimKeyed } from '@/app/SimKeyed'
import { People } from './actors'
import { Building } from './building'
import { Daylight } from './daylight'
import { Drawers } from './drawers'
import { Effects } from './Effects'
import { EmoteLayer, SpeechBubbles } from './fx'
import { ImagingMachines } from './imaging'
import { Lighting } from './Lighting'
import { Meals } from './meals'
import { PharmacyCore } from './pharmacy'
import { Robots } from './robots'

/**
 * Everything inside the canvas. Each layer is one entry point owned by one builder:
 *   Building (floors, walls, rooms, furniture, landscape) · PharmacyCore (MedVend, gantry, docks, rank, robot doors)
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
      <PharmacyCore />
      <Robots />
      <Meals />
      <Drawers />
      <ImagingMachines />
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
