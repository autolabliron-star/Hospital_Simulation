/**
 * W4: the two entrance health kiosks (China's 健康一体机), in the lobby's free south-east strip. Static furniture only, merged into the building's
 * meshes like everything else (0 extra draw calls): the glowing and moving parts (status LED, ultrasonic ping, LED digits, cuff ring, paper slip) are the
 * rig in src/scene/kiosks, the screens are atlas tiles registered by the kiosk layer. Where everything stands comes from src/scene/kiosks/layout.ts.
 *
 *   TOWER     0.56 x 2.06 m against the south wall, screen side facing north: a plinth, the white body with teal side strips, the cap with the overhead
 *             ultrasonic arm and its puck over the stand spot, the tilted 15.6" touchscreen bezel, the camera and IR thermometer bar, the QR/ID reader,
 *             the printer slot, the SpO2 finger-clip cradle and the two body-fat grips on its sides.
 *   PLATFORM  0.50 x 0.05 x 0.46 weighing platform on the stand spot (nothing to collide with: you stand on it).
 *   BP WING   a desk beside the tower with the Omron HBP-9020-style unit on it: an arm tunnel (an octagonal tube, inner radius 0.085, 0.40 m long) whose
 *             axis runs through the point the seated hand rests on (ARM_IN in the crowd's armIn.ts), the unit's screen and finger indicator, and
 *             the stool in front, seat 'kioskBp:<i>'.
 */
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import { ARM_IN, GRIP, KIOSK_SEAT_HEIGHT } from '@/scene/actors/crowd/armIn'
import { DEVICE, KIOSKS, PLATFORM, SCREEN, TOWER, WING } from '@/scene/kiosks/layout'
import { HEALTH_KIOSKS } from '@/sim/places'

/** Which sides of the stool the seat's approach spot may come from, best first: the sides (the user steps off the platform), then behind, never the desk. */
const APPROACH: readonly number[] = [-Math.PI / 2, Math.PI / 2, Math.PI, 2.4, -2.4]

function tower(b: LayoutBuilder, i: number): void {
  const k = HEALTH_KIOSKS[i]
  const T = b.at(k.tower.x, k.tower.z, Math.PI) // local +lz looks at the user (north), +lx is the user's right
  const half = TOWER.d / 2
  const out = k.tower.z - k.stand.at.z // 0.47: the stand spot, from the tower's centre

  T.rbox(0, 0, 0, 0.6, TOWER.plinth, 0.46, 'metalDark', { r: 0.02, cast: false })
  T.rbox(0, TOWER.plinth, 0, TOWER.w, TOWER.bodyTop - TOWER.plinth, TOWER.d, 'whitePlastic', { r: 0.05 })
  T.rbox(0, TOWER.bodyTop, 0, 0.58, TOWER.capTop - TOWER.bodyTop, 0.44, 'whitePlastic', { r: 0.03 })
  T.box(0, TOWER.bodyTop + 0.025, half + 0.0125, 0.4, 0.012, 0.004, 'glowTeal')
  // teal side strips, on the back half of the sides (the grips are on the front half)
  for (const s of [-1, 1]) T.box(s * (TOWER.w / 2 + 0.002), 0.4, -0.05, 0.006, 1.4, 0.2, 'glowTeal')

  // the overhead ultrasonic height sensor: an arm out of the cap over the stand spot, and the puck under its end
  const armBack = 0.15
  const armFront = out + TOWER.puck.dia / 2 + 0.005
  T.rbox(0, TOWER.arm.y0, (armBack + armFront) / 2, TOWER.arm.w, TOWER.arm.y1 - TOWER.arm.y0, armFront - armBack, 'whitePlastic', { r: 0.02 })
  T.cyl(0, TOWER.puck.bottom, out, TOWER.puck.dia, TOWER.puck.top - TOWER.puck.bottom, 'metalDark', { cast: false })

  // the touchscreen: a dark bezel tilted back (the picture is the atlas tile the kiosk layer registers 3 mm in front of it)
  T.rbox(0, SCREEN.yc - SCREEN.h / 2, half - 0.005, SCREEN.w, SCREEN.h, SCREEN.t, 'metalDark', { rx: -SCREEN.lean, r: 0.012, cast: false })
  // the status LED's housing above it (the strip itself is the rig's)
  T.rbox(0, DEVICE.ledY - 0.015, half, 0.22, 0.03, 0.012, 'metalDark', { r: 0.005, cast: false })
  // the camera and infrared thermometer bar with its lens
  T.rbox(0, DEVICE.lensY - 0.03, half, 0.3, 0.06, 0.02, 'metalDark', { r: 0.01, cast: false })
  T.cyl(0, DEVICE.lensY - 0.006, half + 0.01, 0.034, 0.012, 'screen', { rx: Math.PI / 2, cast: false })
  T.cyl(0.085, DEVICE.lensY - 0.005, half + 0.011, 0.016, 0.01, 'screen', { rx: Math.PI / 2, cast: false })
  T.cyl(-0.085, DEVICE.lensY - 0.005, half + 0.011, 0.016, 0.01, 'screen', { rx: Math.PI / 2, cast: false })

  // the QR / ID reader: a dark plate with a window
  T.rbox(DEVICE.qrX, DEVICE.qrY - 0.0375, half, 0.075, 0.075, 0.015, 'metalDark', { r: 0.008, cast: false })
  T.box(DEVICE.qrX, DEVICE.qrY - 0.0275, half + 0.008, 0.055, 0.055, 0.004, 'screen', { cast: false })

  // the printer slot
  T.rbox(DEVICE.printerX, DEVICE.printerY - 0.02, half, 0.17, 0.04, 0.014, 'metalDark', { r: 0.006, cast: false })
  T.box(DEVICE.printerX, DEVICE.printerY - 0.005, half + 0.008, 0.13, 0.01, 0.006, 'rubber', { cast: false })

  // the SpO2 finger-clip cradle: a shelf with a hood the index finger slides into
  T.rbox(DEVICE.clipX, DEVICE.clipY - 0.03, half + 0.04, 0.085, 0.02, 0.08, 'whitePlastic', { r: 0.008, cast: false })
  T.rbox(DEVICE.clipX, DEVICE.clipY - 0.01, half + 0.025, 0.06, 0.032, 0.06, 'rubber', { r: 0.012, cast: false })

  // the two body-fat grips: a steel bar on each side, on two brackets, where the hands land (GRIP, in the crowd's armIn.ts)
  const gz = out - GRIP.ahead
  const bracketX0 = TOWER.w / 2 - 0.01
  for (const s of [-1, 1]) {
    T.cyl(s * GRIP.side, DEVICE.gripY0, gz, 0.03, DEVICE.gripY1 - DEVICE.gripY0, 'frame', { cast: false })
    for (const y of [DEVICE.gripY0 + 0.005, DEVICE.gripY1 - 0.025]) T.box((s * (bracketX0 + GRIP.side)) / 2, y, gz, GRIP.side - bracketX0, 0.02, 0.025, 'frame', { cast: false })
  }

  // collision and nav: a little shallower than the body, so the stand spot is clear of it (the player's body is 0.3 m)
  T.rect(`health:tower:${i}`, 0, -(TOWER.d - TOWER.footprintDepth) / 2, TOWER.w, TOWER.footprintDepth)
}

function platform(b: LayoutBuilder, i: number): void {
  const a = KIOSKS[i]
  const F = b.at(a.stand.x, a.stand.z, 0)
  F.rbox(0, 0, 0, PLATFORM.w, PLATFORM.h - 0.006, PLATFORM.d, 'whitePlastic', { r: 0.012, cast: false })
  F.rbox(0, PLATFORM.h - 0.006, 0, PLATFORM.w - 0.04, 0.006, PLATFORM.d - 0.04, 'rubber', { r: 0.004, cast: false })
  // the dark window the LED digits glow in (the digits are the rig's)
  F.box(0, PLATFORM.h, a.digits.z - a.stand.z, 0.16, 0.001, 0.07, 'screen', { cast: false })
}

/** The arm tunnel: an octagonal tube of 8 slabs (a dark liner and a white sleeve) whose inner radius is ARM_IN.radius, from the mouth into the unit. */
function tunnel(S: Frame): void {
  const axisY = KIOSK_SEAT_HEIGHT + ARM_IN.up
  const z0 = ARM_IN.mouth
  // the drawn tube ends at the unit's front face (the rest of the logical tunnel, ARM_IN.length, is inside the housing)
  const len = WING.unit.z0 + 0.004 - z0
  const linerT = 0.012
  const sleeveT = 0.01
  const linerR = ARM_IN.radius + linerT / 2
  const sleeveR = ARM_IN.radius + linerT + sleeveT / 2
  const tan = Math.tan(Math.PI / 8)
  for (let k = 0; k < 8; k++) {
    const th = (k * Math.PI) / 4
    const c = Math.cos(th)
    const s = Math.sin(th)
    const rz = th - Math.PI / 2
    S.box(ARM_IN.left + linerR * c, axisY + linerR * s - linerT / 2, z0 + len / 2, 2 * (linerR + linerT / 2) * tan + 0.002, linerT, len, 'metalDark', { rz, cast: false })
    S.box(ARM_IN.left + sleeveR * c, axisY + sleeveR * s - sleeveT / 2, z0 + len / 2, 2 * (sleeveR + sleeveT / 2) * tan + 0.002, sleeveT, len, 'whitePlastic', { rz, cast: false })
  }
  // a dark disc closes the far end: looking into the tube you see its dark floor, not the unit's white face
  S.cyl(ARM_IN.left, axisY - 0.0015, WING.unit.z0 - 0.0015, 2 * (ARM_IN.radius + 0.003), 0.003, 'metalDark', { rx: Math.PI / 2, cast: false })
}

function wing(b: LayoutBuilder, i: number): void {
  const k = HEALTH_KIOSKS[i]
  const S = b.at(k.bpSeat.at.x, k.bpSeat.at.z, 0) // local +lx is the sitter's left, +lz ahead (towards the desk)
  const deskCx = (WING.deskX0 + WING.deskX1) / 2
  const deskCz = (WING.deskZ0 + WING.deskZ1) / 2
  const u = WING.unit

  // the desk: a back pedestal and two side panels (knee room in front), a wooden top
  S.rbox(deskCx, 0, WING.deskZ1 - 0.1, WING.deskW - 0.04, WING.deskTop - 0.04, 0.2, 'whitePlastic', { r: 0.02 })
  for (const x of [WING.deskX0 + 0.01, WING.deskX1 - 0.01]) S.box(x, 0, deskCz, 0.02, WING.deskTop - 0.04, WING.deskD, 'whitePlastic')
  S.rbox(deskCx, WING.deskTop - 0.04, deskCz, WING.deskW, 0.04, WING.deskD, 'woodOak', { r: 0.012 })

  // the blood-pressure unit and its arm tunnel
  S.rbox((u.x0 + u.x1) / 2, u.y0, (u.z0 + u.z1) / 2, u.x1 - u.x0, u.y1 - u.y0, u.z1 - u.z0, 'whitePlastic', { r: 0.04 })
  S.box((u.x0 + u.x1) / 2, u.y1 - 0.004, (u.z0 + u.z1) / 2, 0.3, 0.006, 0.2, 'glowTeal', { cast: false })
  tunnel(S)
  // the unit's screen (an atlas tile registered by the layer sits 3 mm in front), tilted up to the seated face, and the finger indicator's plate
  const sc = WING.screen
  S.rbox(sc.lx, sc.yc - sc.h / 2, u.z0 + 0.005, sc.w, sc.h, sc.t, 'metalDark', { ry: Math.PI, rx: -sc.lean, r: 0.01, cast: false })
  S.rbox(u.x1 - 0.045, u.y1 - 0.06, u.z0, 0.06, 0.03, 0.008, 'metalDark', { r: 0.005, cast: false })

  // the stool the sitter perches on: a base, a stem and a round cushion at the crowd's seat height
  S.cyl(0, 0, 0, 0.34, 0.02, 'metalDark', { cast: false })
  S.cyl(0, 0.02, 0, 0.06, KIOSK_SEAT_HEIGHT - 0.07, 'metalDark', { cast: false })
  S.cyl(0, KIOSK_SEAT_HEIGHT - 0.05, 0, 0.34, 0.05, 'fabricTeal', { cast: false })

  S.rect(`health:wing:${i}`, deskCx, deskCz, WING.deskW, WING.deskD)
  S.circle(`health:stool:${i}`, 0, 0, 0.18)
  S.seat(`kioskBp:${i}`, 'kioskBp', 0, 0, KIOSK_SEAT_HEIGHT, { prefer: APPROACH })
}

export function buildHealthKiosks(b: LayoutBuilder): void {
  b.area = 'lobby'
  for (let i = 0; i < HEALTH_KIOSKS.length; i++) {
    tower(b, i)
    platform(b, i)
    wing(b, i)
  }
}
