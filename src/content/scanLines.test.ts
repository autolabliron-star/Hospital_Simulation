import { describe, expect, it } from 'vitest'
import json from './scanLines.json'
import { MODALITY_NAME, PLACEHOLDERS, STEP_PLACEHOLDERS, ScanLinesSchema, scanLine, scanLineTemplate, stepLine, stepLineTemplate, type ScanLineKey, type StepLineKey } from './scanLines'

const KEYS = Object.keys(PLACEHOLDERS) as ScanLineKey[]

describe('scan lines (R5 wave 3: the copy moved out of scanner.ts)', () => {
  it('has a line for every key and nothing else, and names the four scanners', () => {
    expect(Object.keys(json.lines).sort()).toEqual([...KEYS].sort())
    expect(MODALITY_NAME).toEqual({ mri: 'MRI', ct: 'CT', xray: 'X-ray', us: 'ultrasound' })
  })

  it('only uses the placeholders each line allows, and fills them', () => {
    for (const k of KEYS) {
      for (const [, name] of scanLineTemplate(k).matchAll(/\{(\w+)\}/g)) expect(PLACEHOLDERS[k] as readonly string[], `${k} {${name}}`).toContain(name)
    }
    expect(scanLine('cryoThaw', { who: 'Dr. X', patient: 'Ann' })).toBe('Dr. X started the thaw for Ann: the ice ball softens before the second freeze.')
    // a missing value stays visible
    expect(scanLine('cryoThaw', { patient: 'Ann' })).toContain('{who}')
  })

  it('produces the exact strings the scanner logged before the move', () => {
    const v = { who: 'Sonographer Elin', patient: 'Ann Thistlewood', protocol: 'MRI knee', modality: 'ultrasound', name: 'Freeze 1' }
    expect(scanLine('gettingReady', v)).toBe('Sonographer Elin is getting ready for Ann Thistlewood: MRI knee.')
    expect(scanLine('gettingReadyEr', v)).toBe('Sonographer Elin is getting the ultrasound ready for Ann Thistlewood: MRI knee.')
    expect(scanLine('explainCryoDemo', v)).toBe("Sonographer Elin is numbing the skin with a local anaesthetic for Ann Thistlewood's cryoablation.")
    expect(scanLine('explainCryo', v)).toBe('Sonographer Elin is going through the consent with Ann Thistlewood and numbing the skin with a local anaesthetic.')
    expect(scanLine('positioningCryo', v)).toBe("Sonographer Elin is cleaning the skin, putting on the gel and a sterile drape for Ann Thistlewood's cryoablation.")
    expect(scanLine('positioning', v)).toBe('Sonographer Elin is positioning Ann Thistlewood for the MRI knee.')
    expect(scanLine('tableIn', v)).toBe('The ultrasound table is moving Ann Thistlewood in.')
    expect(scanLine('tableOut', v)).toBe('The ultrasound table is bringing Ann Thistlewood out.')
    expect(scanLine('cleanupCryo', v)).toBe('Sonographer Elin is putting a small dressing on Ann Thistlewood, helping her off the couch and wiping down the ultrasound room.')
    expect(scanLine('cleanup', v)).toBe('Sonographer Elin is helping Ann Thistlewood off the table and wiping down the ultrasound room.')
    expect(scanLine('sequence', v)).toBe('Sonographer Elin started the MRI knee for Ann Thistlewood: Freeze 1.')
    expect(scanLine('cryoPlace', v)).toBe('Sonographer Elin is guiding the cryoprobe into the tumour under ultrasound for Ann Thistlewood: Freeze 1.')
    expect(scanLine('cryoFreeze', v)).toBe('Sonographer Elin started Freeze 1 for Ann Thistlewood: liquid nitrogen is flowing and the ice ball is growing.')
    expect(scanLine('finishedCryo', v)).toBe('The cryoablation for Ann Thistlewood is finished: the probe is out, the images are sent.')
    expect(scanLine('finished', v)).toBe('MRI knee for Ann Thistlewood finished: images sent.')
    expect(scanLine('screening', v)).toBe('Sonographer Elin is running the MRI safety check with Ann Thistlewood: metal, implants, pacemaker.')
    expect(scanLine('screeningCleared', v)).toBe('Ann Thistlewood is cleared for the MRI.')
    expect(scanLine('changing', v)).toBe('Ann Thistlewood is changing into a gown for the MRI knee.')
  })

  it('rejects an unknown placeholder, a missing line, a graphic word, a US spelling and a line without a full stop', () => {
    const lines = json.lines as Record<string, string>
    const bad = (patch: Record<string, string>) => ScanLinesSchema.safeParse({ ...json, lines: { ...lines, ...patch } }).success
    expect(bad({})).toBe(true)
    expect(bad({ cryoThaw: '{who} started the thaw for {oops}.' })).toBe(false)
    expect(bad({ cryoThaw: '{who} started the thaw for {patient}' })).toBe(false)
    expect(bad({ cryoThaw: '{who} saw blood while thawing {patient}.' })).toBe(false)
    expect(bad({ cryoThaw: '{who} used anesthetic for {patient}.' })).toBe(false)
    const { cryoThaw: _drop, ...rest } = lines
    expect(ScanLinesSchema.safeParse({ ...json, lines: rest }).success).toBe(false)
  })
})

describe('R5 fix K7: the lines a script step says when it begins', () => {
  const STEP_KEYS = Object.keys(STEP_PLACEHOLDERS) as StepLineKey[]

  it('has a line for every step key and nothing else, using only the placeholders each allows', () => {
    expect(Object.keys(json.stepLines).sort()).toEqual([...STEP_KEYS].sort())
    for (const k of STEP_KEYS) {
      for (const [, name] of stepLineTemplate(k).matchAll(/\{(\w+)\}/g)) expect(STEP_PLACEHOLDERS[k] as readonly string[], `${k} {${name}}`).toContain(name)
    }
  })

  it('fills the probe-in, the thaws, the probe out and the walk out, and says nothing for a step without a line', () => {
    const v = { who: 'Dr. Okafor', patient: 'Ann Thistlewood', lump: 'lump' }
    expect(stepLine('probeIn', v)).toBe('Dr. Okafor is guiding the cryoprobe into the lump under ultrasound for Ann Thistlewood.')
    expect(stepLine('thawFree', v)).toBe('Dr. Okafor is waiting for the ice to melt so the probe comes free for Ann Thistlewood.')
    expect(stepLine('thawMove', v)).toBe('Dr. Okafor is waiting for the ice to melt so the probe can be moved for Ann Thistlewood.')
    expect(stepLine('probeOut', v)).toBe('Dr. Okafor is drawing the cryoprobe out for Ann Thistlewood.')
    // the finished line is the old one, now said at the walk out (the probe is out by then), word for word
    expect(stepLine('walkOut', v)).toBe(scanLine('finishedCryo', v))
    expect(stepLine('freeze1', v)).toBeNull()
    expect(stepLine('toString', v)).toBeNull()
    // the end of the last freeze says only that the freezing is over
    expect(scanLine('finishedFreezing', v)).toBe('The last freeze for Ann Thistlewood is over: the images are sent.')
    expect(scanLine('finishedFreezing', v)).not.toMatch(/probe is out/)
    expect(stepLine('probeIn', { who: 'Dr. X', patient: 'Ann' })).toContain('{lump}')
  })

  it('rejects an unknown placeholder, a missing step line, a graphic word and a line without a full stop', () => {
    const lines = json.stepLines as Record<string, string>
    const bad = (patch: Record<string, string>) => ScanLinesSchema.safeParse({ ...json, stepLines: { ...lines, ...patch } }).success
    expect(bad({})).toBe(true)
    expect(bad({ probeOut: '{who} draws the probe out of {oops}.' })).toBe(false)
    expect(bad({ probeOut: '{who} is drawing the probe out for {patient}' })).toBe(false)
    expect(bad({ probeOut: '{who} saw blood on the probe for {patient}.' })).toBe(false)
    expect(bad({ probeOut: '{who} used anesthetic for {patient}.' })).toBe(false)
    const { probeOut: _drop, ...rest } = lines
    expect(ScanLinesSchema.safeParse({ ...json, stepLines: rest }).success).toBe(false)
  })
})

