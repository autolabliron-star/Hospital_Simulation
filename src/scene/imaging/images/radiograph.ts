/**
 * Plain radiographs as shape models: bones are a marrow fill with a bright cortical rim (both add to the film, so overlapping bones get
 * brighter), soft tissue is a faint silhouette, the lungs are dark. Joint spaces show as dark gaps between bone ends.
 * `seed` varies the size and a few small details; there is no slice position: a radiograph is one projection.
 * Orientation: x right, y down. Ankle and wrist have the limb running vertically; the lateral views face left.
 */
import { addXrayBone as bone, curve, ell, line, poly, rrect, variation, wobble, type Prim, type SliceModel } from './shapes'

const scale = (pts: number[], k: number, ox = 0, oy = 0): number[] => pts.map((q, i) => (i % 2 === 0 ? ox + q * k : oy + q * k))
const mirror = (pts: number[]): number[] => pts.map((q, i) => (i % 2 === 0 ? -q : q))

/** Soft-tissue silhouette: a faint skin-fat edge round a muscle-density body. */
function silhouette(prims: Prim[], pts: number[], edge = 0.035): void {
  prims.push(poly('fat', scale(pts, 1 + edge)))
  prims.push(poly('muscle', pts))
}

export function ankleAP(seed: number): SliceModel {
  const v = variation(seed)
  const k = v.size
  const prims: Prim[] = []
  silhouette(prims, scale([-0.5, -1, 0.52, -1, 0.5, -0.4, 0.46, 0.1, 0.56, 0.4, 0.64, 0.8, 0.6, 1, -0.6, 1, -0.64, 0.7, -0.56, 0.3, -0.46, 0.1, -0.48, -0.4], k))
  // tibia with the medial malleolus, fibula with the lateral malleolus
  bone(prims, scale([-0.04, -1, 0.34, -1, 0.37, -0.4, 0.42, -0.1, 0.46, 0.02, 0.5, 0.1, 0.44, 0.14, 0.38, 0.08, 0.3, 0.03, -0.08, 0.03, -0.14, 0.0, -0.12, -0.2, -0.07, -0.5], k))
  bone(prims, scale([-0.4, -1, -0.26, -1, -0.24, -0.4, -0.2, -0.1, -0.18, 0.05, -0.2, 0.2, -0.3, 0.26, -0.36, 0.17, -0.38, 0.0, -0.4, -0.3], k))
  // talus (with the joint space above it), calcaneus under it, navicular and cuboid
  bone(prims, scale([-0.2, 0.11, -0.1, 0.08, 0.3, 0.08, 0.4, 0.15, 0.42, 0.25, 0.3, 0.35, 0.1, 0.4, -0.1, 0.37, -0.2, 0.29, -0.22, 0.19], k))
  bone(prims, scale([-0.3, 0.43, -0.12, 0.4, 0.2, 0.44, 0.34, 0.42, 0.38, 0.6, 0.28, 0.8, 0.0, 0.86, -0.26, 0.78, -0.34, 0.58], k))
  bone(prims, scale(wobble(0.22, 0.93, 0.15, 0.08, [], 12), k))
  bone(prims, scale(wobble(-0.14, 0.95, 0.16, 0.07, [], 12), k))
  // a faint gap between the fibula and the tibia
  prims.push(line('air', scale([-0.17, -0.5, -0.14, -0.1], k), 0.01, 0.0))
  return { prims, marker: { text: 'R', x: -0.9, y: -0.9 } }
}

export function ankleLateral(seed: number): SliceModel {
  const v = variation(seed)
  const k = v.size
  const prims: Prim[] = []
  silhouette(prims, scale([-0.45, -1, 0.56, -1, 0.58, -0.2, 0.66, 0.2, 0.78, 0.55, 0.74, 0.86, -0.4, 0.86, -0.95, 0.76, -1.0, 0.5, -0.8, 0.3, -0.5, 0.1], k))
  prims.push(ell('muscle', 0.5, -0.2, 0.1, 0.55, -0.05, 0.5)) // the Achilles tendon's shadow
  bone(prims, scale([-0.22, -1, 0.14, -1, 0.16, -0.4, 0.18, -0.1, 0.22, 0.02, 0.12, 0.05, -0.2, 0.05, -0.28, 0.0, -0.24, -0.2, -0.22, -0.6], k)) // tibia
  bone(prims, scale([0.08, -1, 0.22, -1, 0.24, -0.3, 0.26, 0.1, 0.22, 0.2, 0.14, 0.15, 0.1, -0.2], k)) // fibula, behind it
  bone(prims, scale([-0.28, 0.1, 0.0, 0.08, 0.22, 0.12, 0.3, 0.22, 0.26, 0.34, 0.06, 0.4, -0.2, 0.36, -0.34, 0.28], k)) // talus
  bone(prims, scale([-0.02, 0.43, 0.22, 0.4, 0.42, 0.42, 0.6, 0.52, 0.66, 0.66, 0.55, 0.8, 0.1, 0.8, -0.1, 0.7, -0.18, 0.54], k)) // calcaneus
  bone(prims, scale(wobble(-0.44, 0.3, 0.07, 0.1, [], 10), k)) // navicular
  bone(prims, scale(wobble(-0.3, 0.64, 0.12, 0.09, [], 10), k)) // cuboid
  bone(prims, scale(wobble(-0.58, 0.44, 0.08, 0.1, [], 10), k)) // cuneiform
  bone(prims, scale([-0.62, 0.34, -0.95, 0.36, -0.97, 0.46, -0.64, 0.5], k)) // metatarsal bases
  bone(prims, scale([-0.5, 0.58, -0.92, 0.6, -0.94, 0.7, -0.52, 0.7], k))
  return { prims, marker: { text: 'F', x: -0.9, y: -0.9 } }
}

export function wristPA(seed: number): SliceModel {
  const v = variation(seed)
  const k = v.size
  const prims: Prim[] = []
  silhouette(prims, scale([-0.6, 1, -0.6, 0.4, -0.78, 0.05, -0.8, -0.4, -0.78, -1, 0.7, -1, 0.72, -0.4, 0.62, 0.05, 0.5, 0.4, 0.5, 1], k))
  // radius and ulna
  bone(prims, scale([-0.45, 1, -0.12, 1, -0.1, 0.5, -0.08, 0.26, 0.0, 0.17, -0.3, 0.16, -0.56, 0.2, -0.64, 0.12, -0.66, 0.26, -0.52, 0.5], k))
  bone(prims, scale([0.14, 1, 0.34, 1, 0.32, 0.5, 0.36, 0.32, 0.38, 0.2, 0.3, 0.17, 0.14, 0.17, 0.08, 0.26, 0.1, 0.5], k))
  // proximal carpal row: scaphoid, lunate, triquetrum, pisiform
  bone(prims, scale([-0.54, -0.06, -0.4, -0.12, -0.26, -0.04, -0.28, 0.08, -0.42, 0.1, -0.56, 0.04], k))
  bone(prims, scale(wobble(-0.1, -0.01, 0.12, 0.1, [], 12), k))
  bone(prims, scale(wobble(0.15, -0.0, 0.1, 0.1, [], 12), k))
  bone(prims, scale(wobble(0.3, 0.1, 0.05, 0.05, [], 8), k))
  // distal row: trapezium, trapezoid, capitate, hamate
  bone(prims, scale(wobble(-0.5, -0.26, 0.09, 0.09, [], 10), k))
  bone(prims, scale(wobble(-0.32, -0.3, 0.07, 0.08, [], 10), k))
  bone(prims, scale(wobble(-0.1, -0.28, 0.1, 0.13, [], 12), k))
  bone(prims, scale([0.04, -0.4, 0.28, -0.4, 0.3, -0.16, 0.2, -0.12, 0.08, -0.17], k))
  // metacarpals fanning up to the edge of the film
  const xs = [-0.66, -0.38, -0.12, 0.14, 0.4]
  xs.forEach((x, i) => {
    const w = i === 0 ? 0.09 : 0.065
    const lean = (i - 2) * 0.05
    bone(prims, scale([x - w, -0.4, x + w, -0.4, x + w * 0.7 + lean, -1, x - w * 0.7 + lean, -1], k))
  })
  return { prims, marker: { text: 'R', x: -0.9, y: 0.9 } }
}

export function wristLateral(seed: number): SliceModel {
  const v = variation(seed)
  const k = v.size
  const prims: Prim[] = []
  silhouette(prims, scale([0.0, 1, 0.0, 0.4, -0.5, 0.1, -0.6, -0.5, -0.5, -1, 0.5, -1, 0.5, -0.4, 0.62, 0.2, 0.7, 1], k))
  bone(prims, scale([0.14, 1, 0.56, 1, 0.52, 0.5, 0.48, 0.2, 0.36, 0.1, 0.12, 0.14, 0.08, 0.4], k)) // radius and ulna overlapped
  bone(prims, scale(wobble(0.18, -0.02, 0.17, 0.12, [], 12), k)) // lunate
  bone(prims, scale(wobble(0.16, -0.24, 0.14, 0.13, [], 12), k)) // capitate
  bone(prims, scale(wobble(-0.14, 0.03, 0.1, 0.09, [], 10), k)) // scaphoid
  bone(prims, scale(wobble(-0.3, -0.18, 0.08, 0.08, [], 10), k)) // trapezium
  bone(prims, scale(wobble(0.34, 0.0, 0.07, 0.08, [], 10), k)) // triquetrum / pisiform
  bone(prims, scale([0.06, -0.36, 0.3, -0.36, 0.24, -1, 0.02, -1], k)) // third metacarpal
  bone(prims, scale([-0.4, -0.3, -0.2, -0.3, -0.3, -0.85, -0.5, -0.85], k)) // first metacarpal
  return { prims, marker: { text: 'F', x: -0.9, y: -0.9 } }
}

/** The ribs as paired curved strokes (posterior ones horizontal-ish, anterior ones sloping down toward the middle). */
function ribs(prims: Prim[], top: number, bottom: number, n: number, a: number): void {
  for (const sg of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const y = top + ((bottom - top) * i) / (n - 1)
      const lat = 0.7 + 0.12 * Math.sin((i / (n - 1)) * Math.PI)
      prims.push(line('bone', curve((t) => [sg * (0.1 + (lat - 0.1) * t), y - 0.1 * t + 0.34 * t * t * t], 8), 0.03, a)) // posterior
      if (i % 2 === 0) prims.push(line('bone', curve((t) => [sg * (lat - (lat - 0.12) * t), y + 0.24 + 0.2 * t + 0.18 * Math.sin(t * 1.4)], 8), 0.022, a * 0.7)) // anterior (every other one is enough to read as ribs)
    }
  }
}

export function chestPA(seed: number): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const k = v.size
  const prims: Prim[] = []
  // the thorax and shoulders, then the lungs with the heart and diaphragm
  silhouette(prims, scale([-0.16, -1, 0.16, -1, 0.5, -0.94, 0.86, -0.82, 1.0, -0.6, 0.97, 0.1, 0.9, 0.6, 0.88, 1, -0.88, 1, -0.9, 0.6, -0.97, 0.1, -1.0, -0.6, -0.86, -0.82, -0.5, -0.94], k), 0.0)
  prims.push(poly('lung', scale(wobble(-0.42, -0.05, 0.36, 0.7, [[0.03, 5, p[0]]], 40, 0.06), k)))
  prims.push(poly('lung', scale(wobble(0.42, -0.05, 0.34, 0.7, [[0.03, 5, p[1]]], 40, -0.06), k)))
  prims.push(poly('muscle', [0.0, 0.62, -0.5, 0.52, -0.7, 0.4, -0.7, 0.8, 0.7, 0.8, 0.72, 0.42, 0.5, 0.5], 0.9)) // upper abdomen under the diaphragm
  prims.push(ell('liver', -0.42, 0.6, 0.34, 0.14, 0.0, 0.8))
  prims.push(ell('air', 0.42, 0.52, 0.18, 0.07, 0.0, 1)) // gastric bubble
  // mediastinum: spine, trachea, heart, aortic knob
  prims.push(poly('muscle', rrect(0, -0.05, 0.24, 1.5, 0.08), 0.9))
  prims.push(line('air', [0, -0.95, 0, -0.35], 0.07, 1)) // trachea
  prims.push(ell('heart', 0.18, 0.28, 0.34, 0.3, 0.2, 1))
  prims.push(ell('heart', 0.3, -0.34, 0.1, 0.08, 0.0, 1)) // aortic knob
  for (let i = 0; i < 12; i++) prims.push(poly('marrow', rrect(0, -0.88 + i * 0.12, 0.14, 0.085, 0.015), 0.55)) // vertebrae through the mediastinum
  // hila, then bones over everything
  for (const sg of [-1, 1]) {
    prims.push(line('vessel', [sg * 0.16, -0.12, sg * 0.3, 0.0, sg * 0.4, 0.2], 0.05, 0.9))
    prims.push(line('vessel', [sg * 0.2, -0.14, sg * 0.32, -0.3, sg * 0.4, -0.55], 0.032, 0.8))
    prims.push(line('vessel', [sg * 0.24, 0.02, sg * 0.45, 0.14, sg * 0.56, 0.42], 0.028, 0.8))
    prims.push(line('bone', curve((t) => [sg * (0.12 + 0.62 * t), -0.78 - 0.0 * t + 0.1 * t * t], 6), 0.035, 0.85)) // clavicle
    prims.push(line('bone', [sg * 0.9, -0.68, sg * 0.82, -0.3, sg * 0.62, -0.18], 0.04, 0.4)) // scapula edge
  }
  ribs(prims, -0.6, 0.35, 9, 0.34)
  return { prims, marker: { text: 'R', x: -0.9, y: -0.85 } }
}

export function chestLateral(seed: number): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const k = v.size
  const prims: Prim[] = []
  silhouette(prims, scale([-0.7, -1, 0.5, -1, 0.7, -0.4, 0.74, 0.3, 0.7, 1, -0.7, 1, -0.66, 0.2, -0.7, -0.4], k), 0.0)
  prims.push(poly('lung', scale(wobble(0.0, -0.1, 0.62, 0.7, [[0.03, 4, p[0]]], 40), k)))
  prims.push(poly('muscle', [-0.62, 0.62, -0.3, 0.48, 0.1, 0.52, 0.6, 0.45, 0.66, 0.9, -0.62, 0.9], 0.95)) // below the diaphragm
  prims.push(ell('air', -0.1, 0.52, 0.16, 0.05, 0.0, 1))
  prims.push(ell('heart', -0.28, 0.1, 0.26, 0.32, -0.3, 1)) // the heart sits in front
  prims.push(ell('muscle', -0.5, -0.5, 0.14, 0.2, 0.2, 0.9)) // the great vessels
  // spine along the back with discs, sternum in front
  for (let i = 0; i < 12; i++) prims.push(poly('marrow', rrect(0.5 - 0.0 * i, -0.9 + i * 0.15, 0.16, 0.12, 0.02), 1))
  for (let i = 0; i < 12; i++) prims.push(line('bone', [0.42, -0.96 + i * 0.15, 0.58, -0.96 + i * 0.15], 0.012, 0.4))
  prims.push(line('bone', [-0.66, -0.7, -0.62, -0.1, -0.56, 0.3], 0.05, 0.9)) // sternum
  prims.push(line('bone', curve((t) => [0.66 - 1.1 * t, -0.8 + 0.4 * Math.sin(t * 2.2) + 0.9 * t], 8), 0.03, 0.4)) // ribs
  prims.push(line('bone', curve((t) => [0.66 - 1.1 * t, -0.6 + 0.4 * Math.sin(t * 2.2) + 0.9 * t], 8), 0.03, 0.4))
  prims.push(line('bone', curve((t) => [0.66 - 1.1 * t, -0.4 + 0.4 * Math.sin(t * 2.2) + 0.9 * t], 8), 0.03, 0.4))
  prims.push(line('bone', [0.3, -0.7, 0.55, -0.3], 0.07, 0.3)) // scapulae and humeri overlap the top
  return { prims, marker: { text: 'F', x: -0.9, y: -0.9 } }
}

export function pelvisAP(seed: number): SliceModel {
  const v = variation(seed)
  const k = v.size
  const prims: Prim[] = []
  silhouette(prims, scale([-0.3, -1, 0.3, -1, 0.9, -0.85, 1.02, -0.3, 0.98, 0.5, 0.88, 1, -0.88, 1, -0.98, 0.5, -1.02, -0.3, -0.9, -0.85], k), 0.02)
  for (const sg of [-1, 1]) {
    const m = sg < 0 ? mirror : (q: number[]) => q
    // the iliac wing, from the crest round to the acetabular roof and back along the pelvic brim
    bone(prims, scale(m([0.12, -0.6, 0.35, -0.78, 0.65, -0.82, 0.88, -0.62, 0.92, -0.35, 0.86, -0.1, 0.7, 0.0, 0.5, -0.04, 0.35, -0.14, 0.2, -0.3, 0.12, -0.45]), k))
    // the femoral head in its socket, the neck, the greater and lesser trochanters, the shaft
    bone(prims, scale(wobble(sg * 0.5, 0.14, 0.15, 0.15, [], 20), k))
    bone(prims, scale(m([0.58, 0.24, 0.7, 0.3, 0.9, 0.3, 0.97, 0.4, 0.88, 0.58, 0.74, 0.5, 0.6, 0.38]), k))
    bone(prims, scale(m([0.76, 0.52, 0.93, 0.54, 0.91, 1.0, 0.7, 1.0, 0.72, 0.72]), k))
    bone(prims, scale(m([0.62, 0.52, 0.7, 0.54, 0.7, 0.66, 0.62, 0.62]), k))
    // the acetabular rim, and the pubic and ischial rami round the obturator foramen
    prims.push(line('bone', scale(curve((t) => [sg * (0.5 + 0.19 * Math.cos(-2.5 + 2.9 * t)), 0.14 + 0.19 * Math.sin(-2.5 + 2.9 * t)], 8), k), 0.022, 0.8))
    for (const [pts, w] of [
      [[0.42, 0.26, 0.06, 0.36], 0.075],
      [[0.06, 0.36, 0.2, 0.68], 0.065],
      [[0.46, 0.3, 0.34, 0.68], 0.085],
    ] as const) {
      prims.push(line('marrow', scale(m([...pts]), k), w))
      prims.push(line('bone', scale(m([...pts]), k), w * 0.4, 0.6))
    }
    prims.push(line('air', scale(m([0.07, 0.04, 0.12, 0.1]), k), 0.012, 0.6)) // sacroiliac joint space (upper part)
  }
  bone(prims, scale([-0.18, -0.62, 0.18, -0.62, 0.17, -0.3, 0.1, 0.05, 0.0, 0.22, -0.1, 0.05, -0.17, -0.3], k)) // sacrum and coccyx
  bone(prims, scale(rrect(0, -0.84, 0.36, 0.2, 0.05), k)) // L5
  prims.push(line('air', scale([-0.18, -0.62, -0.11, -0.2], k), 0.012, 0.7))
  prims.push(line('air', scale([0.18, -0.62, 0.11, -0.2], k), 0.012, 0.7))
  return { prims, marker: { text: 'R', x: -0.9, y: -0.9 } }
}

export function hipLateral(seed: number): SliceModel {
  const v = variation(seed)
  const k = v.size
  const prims: Prim[] = []
  silhouette(prims, scale([-0.6, -1, 0.7, -1, 0.85, -0.3, 0.8, 0.5, 0.6, 1, -0.45, 1, -0.75, 0.4, -0.8, -0.4], k), 0.03)
  bone(prims, scale([-0.55, -0.9, 0.1, -0.92, 0.25, -0.6, 0.14, -0.32, -0.06, -0.26, -0.3, -0.34, -0.5, -0.5], k)) // the ilium and the roof of the socket
  bone(prims, scale([0.14, -0.14, 0.46, -0.08, 0.56, 0.28, 0.42, 0.5, 0.26, 0.3], k)) // the ischium
  bone(prims, scale([-0.52, -0.12, -0.32, -0.26, -0.2, -0.12, -0.32, 0.26, -0.56, 0.2], k)) // the pubis
  prims.push(line('bone', scale(curve((t) => [-0.05 + 0.22 * Math.cos(-2.8 + 3.4 * t), -0.1 + 0.22 * Math.sin(-2.8 + 3.4 * t)], 8), k), 0.022, 0.8)) // the socket's rim
  bone(prims, scale(wobble(-0.04, -0.1, 0.17, 0.17, [], 20), k)) // the femoral head
  bone(prims, scale([-0.1, 0.04, 0.1, 0.02, 0.26, 0.22, 0.4, 0.34, 0.38, 0.55, 0.34, 1.0, -0.02, 1.0, 0.0, 0.62, -0.1, 0.34, -0.14, 0.2], k)) // neck and shaft
  bone(prims, scale([0.2, 0.08, 0.38, 0.14, 0.46, 0.36, 0.3, 0.36], k)) // greater trochanter
  bone(prims, scale([-0.06, 0.46, 0.04, 0.46, 0.06, 0.6, -0.08, 0.6], k)) // lesser trochanter
  return { prims, marker: { text: 'F', x: -0.9, y: -0.9 } }
}
