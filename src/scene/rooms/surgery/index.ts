/**
 * R2: the level-2 robotic surgery suite's static rooms (docs/R2-SURGERY.md), authored in sim coordinates (places.ts `l2`): the shell
 * and the rooms around the OR (agent B, shell.ts: pre-op bays, PACU, lounge, staff room, sterile supply, the hall's scrub sinks, the
 * corridor, lift lobbies) and the OR itself (agent O, or.ts: table, consoles, vision cart, anaesthesia, back table, booms and lights).
 * The moving robot is not here: it is the rig in src/scene/surgery. R4: the cryoablation suite's rooms (cryoRoom.ts; its CT and arm are live in
 * src/scene/cryoSuite).
 */
import type { LayoutBuilder } from '../../building/layout/builder'
import { buildCryoSuite } from './cryoRoom'
import { buildOperatingRoom } from './or'
import { buildSurgeryShell } from './shell'

export function buildSurgerySuite(b: LayoutBuilder): void {
  buildSurgeryShell(b)
  buildOperatingRoom(b)
  buildCryoSuite(b)
}
