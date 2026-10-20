import { describe, expect, it } from 'vitest'
import { STAFF } from '@/content/staff'
import {
  type ErTest,
  ErTestSchema,
  OUTPATIENTS,
  OutpatientSchema,
  PROTOCOLS,
  ProtocolSchema,
  outpatientTimeSeconds,
  protocolById,
  testForReason,
} from './imaging'
import imagingJson from './imaging.json'
import patientsJson from './patients.json'
import peopleJson from './people.json'
import { AMBULANCE_REASONS, ER_REASONS, FIRST_NAMES, LAST_NAMES, normaliseName } from './roster'

/** Every word of a name, lower-cased and accent-free, so "Tomás" matches "Tomas". */
const tokens = (name: string): string[] =>
  name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map(normaliseName)

/** Minutes after midnight for an HH:MM string. */
const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

type Seq = [name: string, plane: string, contrast: string, seconds: number, images: number]

/** The protocols exactly as the brief lists them. */
const EXPECTED: Array<[id: string, modality: string, bodyPart: string, sequences: Seq[]]> = [
  [
    'mri-brain',
    'mri',
    'brain',
    [
      ['Localiser', 'scout', 'none', 20, 3],
      ['T1 sagittal', 'sagittal', 'T1', 150, 20],
      ['T2 axial', 'axial', 'T2', 180, 24],
      ['FLAIR axial', 'axial', 'FLAIR', 200, 24],
      ['Diffusion axial', 'axial', 'DWI', 90, 24],
    ],
  ],
  [
    'mri-lumbar',
    'mri',
    'lumbarSpine',
    [
      ['Localiser', 'scout', 'none', 20, 3],
      ['T2 sagittal', 'sagittal', 'T2', 210, 15],
      ['T1 sagittal', 'sagittal', 'T1', 180, 15],
      ['T2 axial', 'axial', 'T2', 240, 20],
    ],
  ],
  [
    'mri-knee',
    'mri',
    'knee',
    [
      ['Localiser', 'scout', 'none', 20, 3],
      ['PD fat-sat coronal', 'coronal', 'PD', 180, 22],
      ['PD fat-sat sagittal', 'sagittal', 'PD', 180, 22],
      ['T1 coronal', 'coronal', 'T1', 150, 22],
    ],
  ],
  [
    'ct-head',
    'ct',
    'head',
    [
      ['Topogram', 'scout', 'none', 8, 1],
      ['Axial head', 'axial', 'plain', 12, 40],
    ],
  ],
  [
    'ct-cspine',
    'ct',
    'cervicalSpine',
    [
      ['Topogram', 'scout', 'none', 8, 1],
      ['Axial cervical spine', 'axial', 'plain', 10, 50],
    ],
  ],
  [
    'ct-chest',
    'ct',
    'chest',
    [
      ['Topogram', 'scout', 'none', 8, 1],
      ['Arterial phase', 'axial', 'arterial', 8, 60],
    ],
  ],
  [
    'ct-abdo',
    'ct',
    'abdomen',
    [
      ['Topogram', 'scout', 'none', 8, 1],
      ['Arterial phase', 'axial', 'arterial', 10, 60],
      ['Portal venous phase', 'axial', 'portal', 12, 70],
    ],
  ],
  [
    'xr-ankle',
    'xray',
    'ankle',
    [
      ['AP view', 'projection', 'none', 1, 1],
      ['Lateral view', 'projection', 'none', 1, 1],
    ],
  ],
  [
    'xr-wrist',
    'xray',
    'wrist',
    [
      ['PA view', 'projection', 'none', 1, 1],
      ['Lateral view', 'projection', 'none', 1, 1],
    ],
  ],
  [
    'xr-knee',
    'xray',
    'knee',
    [
      ['AP view', 'projection', 'none', 1, 1],
      ['Lateral view', 'projection', 'none', 1, 1],
    ],
  ],
  ['xr-chest', 'xray', 'chest', [['PA view', 'projection', 'none', 1, 1]]],
  [
    'xr-hip',
    'xray',
    'pelvis',
    [
      ['AP pelvis', 'projection', 'none', 1, 1],
      ['Lateral hip', 'projection', 'none', 1, 1],
    ],
  ],
  [
    'us-abdo',
    'us',
    'abdomen',
    [
      ['Liver', 'sweep', 'none', 120, 6],
      ['Gallbladder', 'sweep', 'none', 90, 4],
      ['Right kidney', 'sweep', 'none', 90, 3],
      ['Left kidney', 'sweep', 'none', 90, 3],
      ['Spleen', 'sweep', 'none', 60, 2],
    ],
  ],
  [
    'us-renal',
    'us',
    'kidneys',
    [
      ['Right kidney', 'sweep', 'none', 90, 3],
      ['Left kidney', 'sweep', 'none', 90, 3],
      ['Bladder', 'sweep', 'none', 60, 2],
    ],
  ],
]

/** The brief's clinical rules, one reason each. */
const RULES: Array<[reason: string, expected: ErTest]> = [
  ['Ankle swollen after a fall', { test: 'imaging', protocol: 'xr-ankle' }],
  ['Twisted ankle playing football', { test: 'imaging', protocol: 'xr-ankle' }],
  ['Sprained wrist from a bike fall', { test: 'imaging', protocol: 'xr-wrist' }],
  ['Fall at home, hip pain', { test: 'imaging', protocol: 'xr-hip' }],
  ['Cough and fever for a week', { test: 'imaging', protocol: 'xr-chest' }],
  ['Severe headache, feels unwell', { test: 'imaging', protocol: 'ct-head' }],
  ['Confused after a fall', { test: 'imaging', protocol: 'ct-head' }],
  ['Collapsed, not fully conscious', { test: 'imaging', protocol: 'ct-head' }],
  ['Sudden weakness down one side', { test: 'imaging', protocol: 'ct-head' }],
  ['Fit that has now stopped', { test: 'imaging', protocol: 'ct-head' }],
  ['Minor car bump, neck sore', { test: 'imaging', protocol: 'ct-cspine' }],
  ['Severe abdominal pain, vomiting', { test: 'imaging', protocol: 'ct-abdo' }],
  // clinical review: urine/lab tests come first for urinary symptoms; an asthma flare is treated, not X-rayed
  ['Burning feeling when passing urine', { test: 'blood' }],
  ['Asthma getting worse, wheezing', { test: 'none' }],
  ['High fever since yesterday', { test: 'blood' }],
  ['Chest pain spreading to arm', { test: 'blood' }],
  ['Fainted at work this morning', { test: 'blood' }],
  ['Confused and very drowsy today', { test: 'blood' }],
  ['Rash and itchy eyes', { test: 'none' }],
  ['Cut finger needing stitches', { test: 'none' }],
  ['Allergic reaction, face swollen', { test: 'none' }],
  ['Sunburn, feels sore and hot', { test: 'none' }],
]

/** Modality spacing in minutes, from the brief. */
const SPACING_MINUTES: Record<string, number> = { mri: 20, ct: 10, xray: 8, us: 15 }

const modalityOf = (o: { protocol: string }): string => protocolById(o.protocol).modality

describe('protocols', () => {
  it('defines exactly the protocols in the brief (thirteen, and the R3 knee radiograph)', () => {
    expect(Object.keys(PROTOCOLS).sort()).toEqual(EXPECTED.map(([id]) => id).sort())
  })

  it.each(EXPECTED)('%s matches the brief: modality, body part, sequences, times and image counts', (id, modality, bodyPart, seqs) => {
    const p = PROTOCOLS[id]
    expect(p.id).toBe(id)
    expect(p.modality).toBe(modality)
    expect(p.bodyPart).toBe(bodyPart)
    expect(p.sequences.map((s) => [s.name, s.plane, s.contrast, s.seconds, s.images])).toEqual(seqs)
  })

  it('every protocol parses against ProtocolSchema', () => {
    for (const p of Object.values(PROTOCOLS)) {
      expect(ProtocolSchema.safeParse(p).success, p.id).toBe(true)
    }
  })

  it('protocolById returns the protocol and throws on an unknown id', () => {
    expect(protocolById('mri-knee').name).toBe('MRI knee')
    expect(() => protocolById('mri-spine-typo')).toThrow(/Unknown imaging protocol id/)
  })
})

describe('ER and ambulance reasons map to tests', () => {
  const reasons = [...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text)
  const mapped = Object.keys(imagingJson.erTests)

  it('every reason in people.json has a mapping', () => {
    for (const text of reasons) {
      expect(() => testForReason(text), text).not.toThrow()
    }
    expect(new Set(reasons).size).toBe(reasons.length)
  })

  it('the mapping has no entries beyond the reasons in people.json', () => {
    const fromPeopleJson = [...peopleJson.erReasons, ...peopleJson.ambulanceReasons].map((r) => r.text)
    expect([...mapped].sort()).toEqual([...fromPeopleJson].sort())
  })

  it('every mapping parses against ErTestSchema', () => {
    for (const [text, test] of Object.entries(imagingJson.erTests)) {
      expect(ErTestSchema.safeParse(test).success, text).toBe(true)
    }
  })

  it('no MRI for any ER or ambulance reason', () => {
    for (const text of reasons) {
      const test = testForReason(text)
      if (test.test === 'imaging') expect(protocolById(test.protocol).modality, text).not.toBe('mri')
    }
  })

  it('every mapped protocol exists', () => {
    for (const text of reasons) {
      const test = testForReason(text)
      if (test.test === 'imaging') expect(PROTOCOLS[test.protocol], text).toBeDefined()
    }
  })

  it('throws on a reason that is not in people.json', () => {
    expect(() => testForReason('Not a reason in the data')).toThrow(/No imaging test is mapped/)
  })

  it.each(RULES)('"%s" gets the brief\'s test', (reason, expected) => {
    expect(testForReason(reason)).toEqual(expected)
  })
})

describe('outpatients', () => {
  it('has 40 synthetic outpatients, each parsing against OutpatientSchema', () => {
    expect(OUTPATIENTS).toHaveLength(40)
    for (const o of OUTPATIENTS) expect(OutpatientSchema.safeParse(o).success, o.id).toBe(true)
  })

  it('has the modality mix in the brief: 12 MRI, 10 CT, 8 X-ray, 10 ultrasound', () => {
    const counts = new Map<string, number>()
    for (const o of OUTPATIENTS) counts.set(modalityOf(o), (counts.get(modalityOf(o)) ?? 0) + 1)
    expect(counts.get('mri')).toBe(12)
    expect(counts.get('ct')).toBe(10)
    expect(counts.get('xray')).toBe(8)
    expect(counts.get('us')).toBe(10)
  })

  it('has unique ids, numbered in time order', () => {
    expect(new Set(OUTPATIENTS.map((o) => o.id)).size).toBe(OUTPATIENTS.length)
    OUTPATIENTS.forEach((o, i) => expect(o.id).toBe(`op-${String(i + 1).padStart(2, '0')}`))
  })

  it('has times inside 07:45 to 13:30 and sorted by time', () => {
    for (const o of OUTPATIENTS) {
      expect(minutesOf(o.time), o.id).toBeGreaterThanOrEqual(minutesOf('07:45'))
      expect(minutesOf(o.time), o.id).toBeLessThanOrEqual(minutesOf('13:30'))
    }
    const times = OUTPATIENTS.map((o) => o.time)
    expect(times).toEqual([...times].sort())
  })

  it('keeps each modality spaced: MRI 20 min, CT 10, X-ray 8, ultrasound 15', () => {
    for (const modality of Object.keys(SPACING_MINUTES)) {
      const times = OUTPATIENTS.filter((o) => modalityOf(o) === modality).map((o) => minutesOf(o.time))
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1], `${modality} gap before ${times[i]}`).toBeGreaterThanOrEqual(SPACING_MINUTES[modality])
      }
    }
  })

  it('gives each outpatient a protocol that exists', () => {
    for (const o of OUTPATIENTS) expect(PROTOCOLS[o.protocol], o.id).toBeDefined()
  })

  it('computes sim seconds since 07:30', () => {
    const at = (time: string) => outpatientTimeSeconds({ ...OUTPATIENTS[0], time })
    expect(at('07:30')).toBe(0)
    expect(at('07:45')).toBe(900)
    expect(at('13:30')).toBe(6 * 3600)
  })

  it('uses full fictional names that reuse no patient, roster or staff name', () => {
    const taken = new Set<string>([
      ...patientsJson.flatMap((p) => tokens(p.name)),
      ...STAFF.flatMap((s) => tokens(s.name)),
      ...FIRST_NAMES.map(normaliseName),
      ...LAST_NAMES.map(normaliseName),
    ])
    const seen = new Set<string>()
    for (const o of OUTPATIENTS) {
      expect(o.name.trim().split(/\s+/).length, o.id).toBeGreaterThanOrEqual(2)
      const clashes = tokens(o.name).filter((t) => taken.has(t))
      expect(clashes, `${o.id} ${o.name}`).toEqual([])
      expect(seen.has(o.name), o.name).toBe(false)
      seen.add(o.name)
    }
  })
})

describe('imaging staff', () => {
  it.each([
    ['rad-MRI', 'radiographer', 'Radiographer Tariq'],
    ['rad-CT', 'radiographer', 'Radiographer Ilse'],
    ['rad-XR', 'radiographer', 'Radiographer Rohan'],
    ['sono-1', 'sonographer', 'Sonographer Elin'],
  ])('%s exists as %s in the imaging post, with no ward', (id, role, name) => {
    const member = STAFF.find((s) => s.id === id)
    expect(member, id).toBeDefined()
    expect(member?.role, id).toBe(role)
    expect(member?.post, id).toBe('imaging')
    expect(member?.name, id).toBe(name)
    expect(member?.ward, id).toBeUndefined()
  })
})
