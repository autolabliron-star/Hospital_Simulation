/**
 * The glowing and animated parts of both health kiosks, as ONE unlit mesh of independently dimmable regions (the imaging machines' glow kit, in world
 * coordinates, drawn with MACHINE_GLOW): status LED, ultrasonic ping rings and beam, the platform's LED digits, the body-fat grip sleeves, the SpO2
 * LEDs, the cuff ring in the tunnel mouth, the camera's face frame and IR dot, the QR window and the five segments of the printed slip.
 *
 * Pure geometry (no DOM, no WebGL): node tests count the triangles. Every region is named `<part><kiosk>` (`cuff0`, `digit1_2_g`, `slip0_3`).
 */
import { GlowBuilder, bx, cyl, torus, triangles, type GlowGeometry } from '@/scene/imaging/machines/geometry'
import { PLATFORM, TOWER, DEVICE, KIOSKS, type KioskAnchors } from './layout'

/** The colours of the lights. Linear values come from the hex; the rig blends them by level. */
export const LIGHT = {
  green: '#35e07a',
  blue: '#3aa0ff',
  teal: '#1fb5ad',
  amber: '#ffb23a',
  red: '#ff3b30',
  ledRed: '#ff4a2a',
  paper: '#f2f5f4',
  cyan: '#7fe3ff',
} as const

/** Seven-segment digits: which segments (a, b, c, d, e, f, g) light for 0..9. */
export const SEGMENTS = 'abcdefg'
export const DIGIT_MASK: readonly number[] = [
  0b0111111, // 0: a b c d e f
  0b0000110, // 1: b c
  0b1011011, // 2: a b d e g
  0b1001111, // 3: a b c d g
  0b1100110, // 4: b c f g
  0b1101101, // 5: a c d f g
  0b1111101, // 6: a c d e f g
  0b0000111, // 7: a b c
  0b1111111, // 8
  0b1101111, // 9: a b c d f g
]

/** How many digits the platform shows (tens, ones, tenths of a kilogram) and the slip's segments. */
export const DIGITS = 3
export const SLIP_SEGMENTS = 5
export const PING_RINGS = 3

/** The region names of kiosk `i`, so the rig and the tests never spell them twice. */
export const region = {
  led: (i: number) => `led${i}`,
  beam: (i: number) => `beam${i}`,
  ping: (i: number, r: number) => `ping${i}_${r}`,
  digit: (i: number, d: number, s: number) => `digit${i}_${d}_${SEGMENTS[s]}`,
  dot: (i: number) => `dot${i}`,
  grip: (i: number, side: number) => `grip${i}_${side}`,
  clip: (i: number) => `clip${i}`,
  bpClip: (i: number) => `bpclip${i}`,
  cuff: (i: number) => `cuff${i}`,
  face: (i: number) => `face${i}`,
  ir: (i: number) => `ir${i}`,
  qr: (i: number) => `qr${i}`,
  slip: (i: number, n: number) => `slip${i}_${n}`,
  bpLed: (i: number) => `bpled${i}`,
}

/** The geometry of one 7-segment digit centred at (cx, cz) on the platform, lying flat, read from the lobby (north): up is +z, the next digit is at -x. */
function digitParts(cx: number, y: number, cz: number, w: number, h: number, color: string): Record<string, ReturnType<typeof bx>> {
  const t = 0.006
  const hw = w / 2
  const hh = h / 2
  const run = w - t * 1.2
  const half = (h - 3 * t) / 2
  const y1 = y + 0.0008
  // horizontal: a (top), g (middle), d (bottom); vertical: f, b (top left and right), e, c (bottom left and right). Seen from the north, the right is -x.
  const hseg = (zc: number) => bx(cx - run / 2, cx + run / 2, y, y1, zc - t / 2, zc + t / 2, color)
  const vseg = (xc: number, zc: number) => bx(xc - t / 2, xc + t / 2, y, y1, zc - half / 2, zc + half / 2, color)
  const zTop = cz + hh - t / 2
  const zBot = cz - hh + t / 2
  const zUp = cz + (half + t) / 2
  const zLow = cz - (half + t) / 2
  const xr = cx - hw + t / 2 // the viewer's right is -x
  const xl = cx + hw - t / 2
  return { a: hseg(zTop), b: vseg(xr, zUp), c: vseg(xr, zLow), d: hseg(zBot), e: vseg(xl, zLow), f: vseg(xl, zUp), g: hseg(cz) }
}

function addKiosk(g: GlowBuilder, k: KioskAnchors): void {
  const i = k.index
  const front = k.frontZ // the tower's front face (z); things on it are 1-2 mm in front, towards -z
  // --- status LED strip above the screen (on its dark housing)
  g.region(region.led(i), LIGHT.green, [bx(k.led.x - 0.1, k.led.x + 0.1, k.led.y - 0.007, k.led.y + 0.007, front - 0.0075, front - 0.0062, LIGHT.green)])

  // --- ultrasonic height: the faint beam cone under the puck and three rings that travel down it
  const beamH = TOWER.puck.bottom - 1.7
  g.region(region.beam(i), LIGHT.cyan, [cyl('y', 0.17, beamH, LIGHT.cyan, { x: k.puck.x, y: TOWER.puck.bottom - beamH / 2, z: k.puck.z }, 20, 0.035)])
  for (let r = 0; r < PING_RINGS; r++) {
    g.region(region.ping(i, r), LIGHT.cyan, [torus('y', 0.07 + r * 0.045, 0.004, LIGHT.cyan, { x: k.puck.x, y: TOWER.puck.bottom - 0.04 - r * 0.075, z: k.puck.z }, 24)])
  }

  // --- the platform's LED digits (and the decimal point between the second and the third)
  const d = k.digits
  for (let n = 0; n < DIGITS; n++) {
    const parts = digitParts(d.x - n * d.pitch, d.y, d.z, d.w, d.h, LIGHT.ledRed)
    for (let s = 0; s < 7; s++) g.region(region.digit(i, n, s), LIGHT.ledRed, [parts[SEGMENTS[s]]])
  }
  const dotX = d.x - 1.5 * d.pitch
  g.region(region.dot(i), LIGHT.ledRed, [bx(dotX - 0.003, dotX + 0.003, d.y, d.y + 0.0008, d.z - d.h / 2, d.z - d.h / 2 + 0.006, LIGHT.ledRed)])

  // --- the grip sleeves: a soft blue ring of light on each steel bar
  for (let side = 0; side < 2; side++) {
    const gp = k.grips[side]
    g.region(region.grip(i, side), LIGHT.blue, [cyl('y', 0.0195, 0.12, LIGHT.blue, { x: gp.x, y: gp.y, z: gp.z }, 12)])
  }

  // --- SpO2: the tower cradle's LED and the BP unit's indicator, both red
  g.region(region.clip(i), LIGHT.red, [bx(k.clip.x - 0.012, k.clip.x + 0.012, DEVICE.clipY + 0.0225, DEVICE.clipY + 0.0245, k.clip.z - 0.012, k.clip.z + 0.012, LIGHT.red)])
  g.region(region.bpClip(i), LIGHT.red, [bx(k.bpClip.x - 0.018, k.bpClip.x + 0.018, k.bpClip.y - 0.006, k.bpClip.y + 0.006, k.bpClip.z - 0.0016, k.bpClip.z - 0.0006, LIGHT.red)])

  // --- the cuff ring in the tunnel's mouth (a ring just proud of the rim, axis along z)
  g.region(region.cuff(i), LIGHT.teal, [torus('z', k.axis.radius + 0.0065, 0.0055, LIGHT.teal, { x: k.axis.x, y: k.axis.y, z: k.axis.mouthZ - 0.002 }, 28)])

  // --- the camera: the green face frame around the lens and the red infrared dot in it
  g.region(region.face(i), LIGHT.green, [torus('z', 0.027, 0.003, LIGHT.green, { x: k.lens.x, y: k.lens.y, z: front - 0.0115 }, 28)])
  g.region(region.ir(i), LIGHT.red, [cyl('z', 0.0042, 0.002, LIGHT.red, { x: k.lens.x, y: k.lens.y, z: front - 0.0175 }, 10)])

  // --- the QR reader's window (flickers while it scans)
  g.region(region.qr(i), LIGHT.teal, [bx(k.qr.x - 0.026, k.qr.x + 0.026, k.qr.y - 0.026, k.qr.y + 0.026, front - 0.0113, front - 0.0108, LIGHT.teal)])

  // --- the printed slip: five segments coming out of the slot towards the user (-z), a little drooping
  const seg = 0.022
  for (let n = 0; n < SLIP_SEGMENTS; n++) {
    const z1 = front - 0.012 - n * seg
    const sag = 0.0035 * n * n * 0.25
    g.region(region.slip(i, n), LIGHT.paper, [bx(k.printer.x - 0.05, k.printer.x + 0.05, k.printer.y - 0.006 - sag, k.printer.y - 0.0035 - sag, z1 - seg + 0.001, z1, LIGHT.paper)])
  }

  // --- the BP unit's status strip above its screen
  g.region(region.bpLed(i), LIGHT.blue, [bx(k.bpLed.x - 0.08, k.bpLed.x + 0.08, k.bpLed.y - 0.004, k.bpLed.y + 0.004, k.bpLed.z - 0.0025, k.bpLed.z - 0.0012, LIGHT.blue)])
}

/** The glow mesh of both kiosks. */
export function buildKioskGlow(): GlowGeometry {
  const g = new GlowBuilder()
  for (const k of KIOSKS) addKiosk(g, k)
  return g.build()
}

/** Triangles of the whole glow mesh (both kiosks). */
export function glowTriangles(g: GlowGeometry): number {
  return triangles(g.geometry)
}

export { PLATFORM }
