import { CoreStatic } from './CoreStatic'
import { Desks } from './Desks'
import { DockGlow } from './DockGlow'
import { MedVend } from './MedVend'
import { PharmacistDoors } from './PharmacistDoors'
import { RailPortals } from './RailPortals'

/**
 * The glass Pharmacy Core: floor, glass walls with the pharmacist doors and the four small rail portals near the top,
 * the MedVend island with its picker gantry and top dock ports (transfer trays), the overhead charging rank's contacts
 * and glow, and the desks. The pods and their rail are drawn by `Robots`.
 */
export function PharmacyCore() {
  return (
    <>
      <CoreStatic />
      <MedVend />
      <DockGlow />
      <PharmacistDoors />
      <RailPortals />
      <Desks />
    </>
  )
}
