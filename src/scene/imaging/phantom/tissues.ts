/**
 * R3 "Real screens": the tissues of the synthetic body and their physical numbers, one record per tissue, so every modality images the
 * same patient from the same physics:
 *
 *   CT        Hounsfield units without contrast, in the arterial phase and in the portal-venous phase, and how much fine texture the tissue has
 *   MRI       proton density, T1 and T2 at 3 T (ms), apparent diffusion (10^-3 mm^2/s), whether it is fat (fat-sat, chemical shift) and
 *             whether it flows (a flow void on spin echo)
 *   US        backscatter amplitude (liver = 1), how coarse its echo texture is (0 smooth .. 1 coarse), attenuation (dB/cm/MHz) and acoustic
 *             impedance (MRayl), which decides the bright interfaces and the shadows
 *   X-ray     linear attenuation (1/cm) at an effective 60 keV
 *
 * Values are textbook-typical for an adult; they are synthetic (no patient data) and only shape the pictures. Pure data, no three.js.
 */

export interface TissueProps {
  name: string
  /** CT: plain, arterial and portal-venous phase HU, and the amplitude of the tissue's own texture (HU). */
  hu: number
  huArt: number
  huPort: number
  huTex: number
  /** MRI (3 T). */
  pd: number
  t1: number
  t2: number
  adc: number
  fat: boolean
  flow: boolean
  /** Ultrasound. */
  echo: number
  structure: number
  att: number
  z: number
  /** X-ray, 1/cm at about 60 keV. */
  mu: number
}

type Row = [name: string, hu: number, huArt: number, huPort: number, huTex: number, pd: number, t1: number, t2: number, adc: number, fat: 0 | 1, flow: 0 | 1, echo: number, structure: number, att: number, z: number, mu: number]

// prettier-ignore
const ROWS: Row[] = [
  // name             HU    art   port  tex   PD    T1    T2   ADC  fat flow  echo  struct att   Z      mu
  ['air',           -1000, -1000, -1000,  0,  0.0,  1e4,   1,  0,   0, 0,    0.0,  0.0,  1.2, 0.0004, 0.0],
  ['fat',            -100,  -100,  -100,  12, 0.9,  380,  70,  0.0, 1, 0,    1.05, 0.55, 0.6, 1.38, 0.180],
  ['muscle',           50,    55,    60,  8,  0.7, 1420,  32,  1.5, 0, 0,    0.55, 0.45, 0.9, 1.65, 0.212],
  ['visceralFat',     -95,   -95,   -95,  15, 0.9,  380,  70,  0.0, 1, 0,    1.35, 0.7,  0.6, 1.38, 0.181],
  ['liver',            58,    75,   112,  6,  0.75, 810,  34,  1.1, 0, 0,    1.0,  0.25, 0.5, 1.65, 0.214],
  ['bile',             8,     8,     8,   2,  1.0, 3000, 300,  3.0, 0, 0,    0.015, 0.0, 0.005, 1.52, 0.207],
  ['gbWall',           40,    60,    70,  4,  0.7, 1100,  45,  1.2, 0, 0,    1.6,  0.3,  0.8, 1.66, 0.212],
  ['kidneyCortex',     35,   170,   150,  6,  0.85,1190,  85,  2.2, 0, 0,    0.5,  0.2,  0.7, 1.62, 0.210],
  ['kidneyMedulla',    30,    70,   145,  5,  0.9, 1550, 120,  2.5, 0, 0,    0.05, 0.1,  0.6, 1.60, 0.209],
  ['sinusFat',        -80,   -80,   -80,  25, 0.9,  380,  70,  0.0, 1, 0,    3.2,  0.8,  0.7, 1.40, 0.182],
  ['urine',            5,     5,     5,   2,  1.0, 3500, 600,  3.0, 0, 0,    0.012, 0.0, 0.004, 1.52, 0.206],
  ['perirenalFat',    -95,   -95,   -95,  10, 0.9,  380,  70,  0.0, 1, 0,    1.55, 0.6,  0.6, 1.38, 0.180],
  ['spleen',           48,   120,   120,  5,  0.8, 1330,  60,  1.0, 0, 0,    0.95, 0.15, 0.5, 1.65, 0.213],
  ['pancreas',         42,   110,    95,  10, 0.75, 720,  45,  1.4, 0, 0,    1.25, 0.5,  0.6, 1.64, 0.212],
  ['gutWall',          40,    80,    85,  6,  0.7, 1100,  50,  1.3, 0, 0,    0.9,  0.4,  0.8, 1.64, 0.212],
  ['gutFluid',         12,    12,    12,  4,  1.0, 2800, 250,  2.8, 0, 0,    0.08, 0.3,  0.05, 1.53, 0.207],
  ['gas',            -950,  -950,  -950,  20, 0.0,  1e4,   1,  0,   0, 0,    0.0,  0.0,  20,  0.0004, 0.002],
  ['blood',            42,   320,   180,  3,  0.9, 1930, 275,  2.0, 0, 1,    0.03, 0.0,  0.18, 1.61, 0.212],
  ['vesselWall',       45,    60,    70,  3,  0.6, 1200,  40,  1.2, 0, 0,    1.7,  0.2,  1.0, 1.68, 0.214],
  ['cortical',       1400,  1400,  1400,  60, 0.05, 900,   1,  0,   0, 0,    3.0,  0.2,  20,  7.8,  0.57],
  ['marrow',          260,   265,   270, 110, 0.7,  550,  50,  0.4, 1, 0,    2.2,  0.6,  15,  5.0,  0.30],
  ['disc',             85,    85,    90,  6,  0.85,1200, 110,  1.6, 0, 0,    0.5,  0.3,  1.0, 1.66, 0.216],
  ['csf',               5,     5,     5,  2,  1.0, 4300,2000,  3.2, 0, 0,    0.01, 0.0,  0.004, 1.51, 0.206],
  ['nerve',            35,    35,    38,  4,  0.75,1000,  80,  1.1, 0, 0,    0.7,  0.3,  0.9, 1.63, 0.210],
  ['bladderWall',      40,    60,    70,  4,  0.7, 1100,  50,  1.2, 0, 0,    1.4,  0.3,  0.8, 1.66, 0.212],
  ['lung',           -850,  -840,  -840,  60, 0.15,1300,  30,  1.0, 0, 0,    0.0,  0.0,  25,  0.0004, 0.040],
  ['cartilage',       120,   120,   120,  5,  0.75,1240,  37,  1.5, 0, 0,    0.15, 0.1,  1.0, 1.75, 0.220],
  ['stone',          900,   900,   900,  40, 0.0, 1000,   1,  0,   0, 0,    4.0,  0.1,  30,  6.0,  0.45],
  ['psoas',            52,    56,    62,  9,  0.7, 1420,  32,  1.5, 0, 0,    0.5,  0.6,  1.1, 1.65, 0.212],
  ['adrenal',          30,    60,    60,  5,  0.75,1000,  60,  1.3, 0, 0,    0.9,  0.3,  0.7, 1.63, 0.211],
  ['pelvicOrgan',      45,    90,    85,  6,  0.75,1400,  70,  1.6, 0, 0,    0.75, 0.25, 0.8, 1.63, 0.211],
  ['stool',           -40,   -40,   -40,  80, 0.5,  800,  40,  0.8, 0, 0,    1.8,  0.9,  4.0, 1.5,  0.17],
  ['skin',             40,    45,    45,  5,  0.7, 1000,  40,  1.0, 0, 0,    1.8,  0.3,  1.5, 1.7,  0.214],
  ['greyMatter',       38,    40,    40,  3,  0.85,1820, 100,  0.8, 0, 0,    0.5,  0.2,  0.6, 1.62, 0.210],
  ['whiteMatter',      27,    28,    28,  2,  0.7, 1080,  70,  0.7, 0, 0,    0.5,  0.2,  0.6, 1.62, 0.209],
  ['deepGrey',         36,    38,    38,  2,  0.8, 1400,  80,  0.75,0, 0,    0.5,  0.2,  0.6, 1.62, 0.210],
  ['dura',             50,    60,    60,  3,  0.5, 1000,  40,  1.0, 0, 0,    1.5,  0.2,  1.0, 1.66, 0.214],
  ['eye',              10,    10,    10,  2,  1.0, 4000,1500,  3.0, 0, 0,    0.01, 0.0,  0.1, 1.53, 0.207],
  ['lens',             90,    90,    90,  2,  0.6, 1000,  20,  0.5, 0, 0,    0.1,  0.0,  1.0, 1.65, 0.215],
  ['calcification',   600,   600,   600,  30, 0.0, 1000,   1,  0,   0, 0,    3.5,  0.1,  25,  6.5,  0.40],
  ['tendon',           90,    90,    95,  6,  0.3, 1500,  10,  0.8, 0, 0,    1.6,  0.8,  1.5, 1.75, 0.218],
  ['ligament',         85,    85,    90,  6,  0.3, 1400,  12,  0.8, 0, 0,    1.5,  0.7,  1.5, 1.75, 0.218],
  ['meniscus',        100,   100,   100,  4,  0.2, 1100,   8,  0.6, 0, 0,    1.3,  0.3,  1.8, 1.8,  0.220],
  ['jointFluid',        8,     8,     8,  2,  1.0, 3600, 900,  3.0, 0, 0,    0.02, 0.0,  0.01, 1.52, 0.206],
  ['myocardium',       45,   110,    95,  4,  0.75,1470,  47,  1.4, 0, 0,    0.8,  0.4,  1.0, 1.65, 0.212],
  ['thyroid',          90,   140,   130,  6,  0.8, 1100,  70,  1.3, 0, 0,    1.3,  0.3,  0.8, 1.64, 0.213],
  ['airway',         -980,  -980,  -980,   5, 0.0,  1e4,   1,  0,   0, 0,    0.0,  0.0,  20,  0.0004, 0.001],
  ['diaphragm',        50,    55,    60,   6, 0.7, 1420,  32,  1.5, 0, 0,    1.8,  0.4,  1.1, 1.66, 0.212],
  ['scalp',            30,    35,    35,   6, 0.8,  600,  60,  1.0, 0, 0,    1.2,  0.5,  0.8, 1.6,  0.205],
  ['sinusAir',       -950,  -950,  -950,  15, 0.0,  1e4,   1,  0,   0, 0,    0.0,  0.0,  20,  0.0004, 0.002],
  ['yellowMarrow',    -40,   -38,   -36,  30, 0.9,  400,  80,  0.1, 1, 0,    2.0,  0.6,  12,  4.0,  0.19],
  ['cancellous',      240,   245,   250, 110, 0.85, 450,  70,  0.3, 1, 0,    2.2,  0.6,  15,  5.0,  0.29],
]

export const TISSUES: readonly TissueProps[] = ROWS.map(([name, hu, huArt, huPort, huTex, pd, t1, t2, adc, fat, flow, echo, structure, att, z, mu]) =>
  Object.freeze({ name, hu, huArt, huPort, huTex, pd, t1, t2, adc, fat: fat === 1, flow: flow === 1, echo, structure, att, z, mu }),
)

export type TissueName = (typeof ROWS)[number][0]

const INDEX = new Map<string, number>(TISSUES.map((t, i) => [t.name, i]))

/** The index of a tissue by name (throws on a typo, so a region builder fails its test instead of drawing air). */
export function tissue(name: string): number {
  const i = INDEX.get(name)
  if (i === undefined) throw new Error(`phantom: no tissue "${name}"`)
  return i
}

export const T_AIR = 0

/** Flat typed tables for the renderers' inner loops (indexed by tissue id). */
export const TABLE = {
  echo: Float64Array.from(TISSUES, (t) => t.echo),
  structure: Float64Array.from(TISSUES, (t) => t.structure),
  att: Float64Array.from(TISSUES, (t) => t.att),
  z: Float64Array.from(TISSUES, (t) => t.z),
  hu: Float64Array.from(TISSUES, (t) => t.hu),
  huArt: Float64Array.from(TISSUES, (t) => t.huArt),
  huPort: Float64Array.from(TISSUES, (t) => t.huPort),
  huTex: Float64Array.from(TISSUES, (t) => t.huTex),
  pd: Float64Array.from(TISSUES, (t) => t.pd),
  t1: Float64Array.from(TISSUES, (t) => t.t1),
  t2: Float64Array.from(TISSUES, (t) => t.t2),
  adc: Float64Array.from(TISSUES, (t) => t.adc),
  fat: Uint8Array.from(TISSUES, (t) => (t.fat ? 1 : 0)),
  flow: Uint8Array.from(TISSUES, (t) => (t.flow ? 1 : 0)),
  mu: Float64Array.from(TISSUES, (t) => t.mu),
} as const
