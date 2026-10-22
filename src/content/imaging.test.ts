import { describe, expect, it } from 'vitest'
import { STAFF } from '@/content/staff'
import { PROTOCOLS, ProtocolSchema, protocolById } from './imaging'

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
