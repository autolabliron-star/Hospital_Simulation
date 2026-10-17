import { MealBotsLayer } from './MealBotsLayer'
import { TraysLayer } from './TraysLayer'
import { WardLayer } from './ward/WardLayer'

/**
 * The living-day look of the ward (L1): MealBots, meal trays, and the live parts of the 16 patient rooms (bed backrests that tilt
 * with the recline, door tiles, bedside screens). Mount once inside the <Canvas>. Reads `sim.life`, and draws the default look
 * (no bots, flat backrests, white door tiles) when it is absent. About 9 draw calls (see ./budget.ts).
 *
 * The static patient room (src/scene/rooms/patientRoom.ts) no longer draws the bed's head section or the bedside picture, so this
 * layer must be mounted for the beds and screens to be complete.
 */
export function Meals() {
  return (
    <>
      <MealBotsLayer />
      <TraysLayer />
      <WardLayer />
    </>
  )
}
