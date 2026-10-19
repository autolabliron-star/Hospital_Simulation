/**
 * W4: where the hands go at the health kiosk and at the robot blood-draw chairs. ONE place for the numbers, so the pose (pose.ts) and everything that is
 * built around it (the BP wing's arm tunnel, the robot cabinets' tunnels, the grips and the finger clip on the kiosk tower) agree to the centimetre.
 *
 * Frames. A person's own frame has +x to their left, +y up and +z ahead (the way they face). Every number below is a FIXED POINT IN THE WORLD, in
 * metres, measured from the person's seat centre (seated) or from where they stand (standing), at the height of the floor or of the seat surface. A
 * taller or shorter person reaches the same point (pose.ts divides by their size before the rig scales the target back).
 *
 * ARM_IN  The seated arm-in pose ('sitArmIn': the BP stool and the robot chairs). `left`, `ahead` and `up` give the MIDDLE of the left hand (the wrist plus
 *         the hand's half length); `up` is above the seat surface. The cuff or robot tunnel is a tube of inner `radius` whose axis runs straight ahead
 *         through that point: its mouth is `mouth` metres ahead of the seat centre and it reaches `length` metres in, so the hand rests `ahead - mouth`
 *         inside the mouth and the last stretch of the forearm lies in the tube. The numbers are chosen so that EVERY body of the crowd (the procedural
 *         one and all 17 realistic avatars, at 0.94 to 1.06 of their size) puts its hand within 1 cm of the point with the forearm inside the tube's radius
 *         minus 3 cm from the mouth on: the shortest arms (0.94 of the female avatars' 0.59 m) just reach it, so `ahead` cannot grow. A robot cabinet
 *         (S2) aligns its tunnel to this line: axis through (left, up above the chair seat, ahead), mouth at `mouth`, any length from `length` down to
 *         the drawn part. For a seated avatar's hand to land there the rig must tell the pose its skeleton: see `seatedReachY` in pose.ts.
 * GRIP    The two body-fat handles on the sides of the kiosk tower ('grip'): each hand at x = +-side, `up` above the floor, `ahead` in front of the person.
 * FINGER  The right hand held out to the tower's QR reader, SpO2 clip and printer ('finger'): x is to the left (negative: the right hand).
 * CONSOLE R2: the seated surgeon console ('sitConsole', the anim 'console'): both hands on the hand controllers, forearms forward and about level (the
 *         elbows near the body at elbow height), the head tipped into the viewer. `side` is each hand's offset from the seat centre line (the left hand
 *         is +x), `ahead` the middle of the hand in front of the seat centre, `up` above the seat surface; like ARM_IN these are fixed points of the
 *         world, so a tall and a short surgeon reach the same controllers. The console model (scene/surgery, agent O) puts its controllers here.
 */

/** Seat surface height of the BP stool (the crowd draws every plain seat at 0.45 m), and so of the robot chairs. */
export const KIOSK_SEAT_HEIGHT = 0.45

export const ARM_IN = {
  left: 0.17,
  ahead: 0.44,
  up: 0.4,
  mouth: 0.3,
  length: 0.4,
  radius: 0.085,
} as const

export const GRIP = { side: 0.31, up: 1.04, ahead: 0.33 } as const

export const FINGER = { x: -0.1, up: 1.1, ahead: 0.19 } as const

export const CONSOLE_HANDS = { side: 0.2, ahead: 0.4, up: 0.34 } as const

/** A point of the world seen from a seated person: their seat centre (x, z) and heading, the seat surface height. Heading 0 faces +z, +x is then the left. */
export interface SeatFrame {
  x: number
  z: number
  heading: number
  seatHeight?: number
}

/** The world point at (`left`, `up` above the seat, `ahead`) of a seated person. */
export function seatPoint(f: SeatFrame, left: number, up: number, ahead: number): { x: number; y: number; z: number } {
  const c = Math.cos(f.heading)
  const s = Math.sin(f.heading)
  return { x: f.x + c * left + s * ahead, y: (f.seatHeight ?? KIOSK_SEAT_HEIGHT) + up, z: f.z - s * left + c * ahead }
}

/** Where the middle of the left hand rests for a person seated at `f` (the point the cuff or robot tunnel's axis passes through). */
export function armInPoint(f: SeatFrame): { x: number; y: number; z: number } {
  return seatPoint(f, ARM_IN.left, ARM_IN.up, ARM_IN.ahead)
}

/** The tunnel's axis for a person seated at `f`: its mouth, its far end (both on the axis) and the unit direction it runs along (the way the person faces). */
export function armInTunnel(f: SeatFrame): { mouth: { x: number; y: number; z: number }; far: { x: number; y: number; z: number }; dir: { x: number; z: number } } {
  return {
    mouth: seatPoint(f, ARM_IN.left, ARM_IN.up, ARM_IN.mouth),
    far: seatPoint(f, ARM_IN.left, ARM_IN.up, ARM_IN.mouth + ARM_IN.length),
    dir: { x: Math.sin(f.heading), z: Math.cos(f.heading) },
  }
}
