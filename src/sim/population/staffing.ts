/**
 * The ER and support staff on shift from the start of the day (from content/staff.ts, by `post`), and the radiographers
 * and the sonographer of the imaging suite. Paramedics are not here: they exist only while an ambulance is being handed
 * over (see Director.spawnAmbulance).
 *
 * This is the staff of the default 07:30 start. L1: the day rhythm (src/sim/day) takes it from there: it registers who is
 * here (`staffRegistry`), brings the shift on duty at another start hour to its posts, and runs every later shift change.
 */
import { STAFF } from '@/content/staff'
import { staffRegistry } from '../day/staffRegistry'
import { Cleaner } from '../er/cleaner'
import { ErDoctor, ErNurse, Receptionist, TriageNurse } from '../er/staff'
import { Porter } from '../er/porter'
import { ImagingOperator, OPERATOR_MODALITY } from '../imaging/operator'
import type { World } from '../er/world'
import type { Person } from '../people'
import type { Rng } from '../rng'
import type { Walker } from '../walker'

export function createErStaff(world: World, rng: Rng, walkerFor: (id: string) => Walker): Person[] {
  const people: Person[] = []
  let triage = 0
  let erDoctor = 0
  let erNurse = 0
  let porter = 0
  let cleaner = 0
  for (const s of STAFF) {
    const w = walkerFor(s.id)
    const r = rng.fork(s.id)
    switch (s.post) {
      case 'reception':
        people.push(new Receptionist(world, s, w, r))
        break
      case 'triage':
        people.push(new TriageNurse(world, s, triage++, w, r))
        break
      case 'er':
        if (s.role === 'doctor') people.push(new ErDoctor(world, s, erDoctor++, w, r))
        else if (s.role === 'nurse') people.push(new ErNurse(world, s, erNurse++, w, r))
        break
      case 'transport':
        people.push(new Porter(world, s, porter++, w, r))
        break
      case 'housekeeping':
        people.push(new Cleaner(world, s, cleaner++, w, r))
        break
      case 'imaging': {
        const modality = OPERATOR_MODALITY[s.id]
        const imaging = world.imaging
        if (modality && imaging) {
          const op = new ImagingOperator(world, s, modality, imaging.sites.scanners[modality], w, r)
          imaging.attachOperator(op)
          people.push(op)
        }
        break
      }
      default:
        break
    }
  }
  // the day rhythm (src/sim/day) swaps these for their relief when a shift ends: it finds them here
  const registry = staffRegistry(world)
  for (const p of people) registry.set(p.entity.id, p)
  return people
}
