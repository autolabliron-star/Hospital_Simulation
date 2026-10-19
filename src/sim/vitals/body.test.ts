/**
 * The kiosk's copies of the crowd's height and gender functions must agree with the real ones to the last bit: the number on the screen is the body on the
 * platform. (The sim cannot import the scene's crowd modules, so a change there has to fail here.)
 */
import { describe, expect, it } from 'vitest'
import { FIRST_NAMES } from '@/content/roster'
import { drawnFemale } from '@/scene/actors/crowd/avatars'
import { STAND_CROWN } from '@/scene/actors/crowd/constants'
import { heightFor, seedFor as crowdSeedFor } from '@/scene/actors/crowd/outfit'
import { newEntity } from '../person'
import { presentationOf } from '@/content/roster'
import { STAND_CROWN_M, avatarCrownM, avatarIsFemale, hash32, seedFor, variantOf } from './body'

const ids = Array.from({ length: 1500 }, (_, i) => (i % 3 === 0 ? `er-${i}` : i % 3 === 1 ? `hk-${i}` : `vis-${i}`))

describe('the kiosk sees the body the crowd draws', () => {
  it('the nominal crown height is the crowd constant', () => {
    expect(STAND_CROWN_M).toBeCloseTo(STAND_CROWN, 12)
  })

  it('an entity gets variant hash(id) % 1000, which is how the copy derives it', () => {
    for (const id of ids.slice(0, 300)) expect(newEntity(id, 'visitor', 'Test', { x: 0, z: 0 }, 0).variant).toBe(variantOf(id))
  })

  it('the seed and the crown height match the crowd exactly', () => {
    for (const id of ids) {
      const v = variantOf(id)
      expect(seedFor(id, v)).toBe(crowdSeedFor(id, v))
      expect(avatarCrownM(id, v)).toBeCloseTo(heightFor(id, v), 12)
    }
    expect(hash32('player') % 1000).toBe(variantOf('player'))
  })

  it('the height stays within 1.64 to 1.85 m (the nominal body plus or minus 6 %)', () => {
    for (const id of ids) {
      const h = avatarCrownM(id)
      expect(h).toBeGreaterThanOrEqual(STAND_CROWN_M * 0.94 - 1e-9)
      expect(h).toBeLessThanOrEqual(STAND_CROWN_M * 1.06 + 1e-9)
    }
  })

  it('the woman-or-man draw matches the crowd for every kind of name', () => {
    const names = ['Maya Cohen', ...FIRST_NAMES.slice(0, 40).map((n) => `${n} Ortiz`), 'Alex Stone', 'Zzyzx Qwerty']
    for (const id of ids.slice(0, 600)) {
      const name = names[hash32(id) % names.length]
      const v = variantOf(id)
      const real = drawnFemale({ seed: crowdSeedFor(id, v), height: heightFor(id, v), presentation: presentationOf(name) })
      expect(avatarIsFemale(id, name, v), `${id} ${name}`).toBe(real)
    }
  })

  it('you wear a man', () => {
    expect(avatarIsFemale('player', 'You')).toBe(false)
  })
})
