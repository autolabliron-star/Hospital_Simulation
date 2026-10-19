/**
 * Hand-made robot and theatre states for the node tests of the surgery scene (synthetic: nothing here reads the sim's internals).
 */
import { SURGERY, type PortLayout } from '@/sim/places'
import type { CasePhase, RobotArmState, RobotPhase, RobotState, SurgeryCaseView, SurgeryState, TheatreState } from '@/sim/types'

export const LAYOUTS: readonly PortLayout[] = ['oblique', 'transverse']

export function arm(i: number, over: Partial<RobotArmState> = {}): RobotArmState {
  return { index: i as 0 | 1 | 2 | 3, instrument: '', port: null, drape: 0, engage: 0, force: 0, exchanges: 0, ...over }
}

/** The robot docked at the table with all four arms on the ports of `layout`. */
export function dockedRobot(layout: PortLayout = 'transverse', over: Partial<RobotState> = {}): RobotState {
  const ports = SURGERY.ports[layout]
  return {
    phase: 'docked',
    cart: { x: SURGERY.cart.dock.at.x, z: SURGERY.cart.dock.at.z, heading: SURGERY.cart.dock.heading },
    boomYaw: 0.1,
    boomHeight: 2.3,
    boomExtend: 1,
    laser: false,
    arms: [0, 1, 2, 3].map((i) => arm(i, { instrument: `Tool ${i}`, port: ports[i], drape: 1, engage: 1, force: 0.4 })),
    motionSeed: 7,
    phaseSince: 0,
    version: 1,
    ...over,
  }
}

/** The robot parked and stowed (folded) by the west wall. */
export function stowedRobot(phase: RobotPhase = 'stowed', drape = 0): RobotState {
  return {
    phase,
    cart: { x: SURGERY.cart.park.at.x, z: SURGERY.cart.park.at.z, heading: SURGERY.cart.park.heading },
    boomYaw: 0,
    boomHeight: SURGERY.cart.size.stowedHeight,
    boomExtend: 0,
    laser: false,
    arms: [0, 1, 2, 3].map((i) => arm(i, { drape })),
    motionSeed: 7,
    phaseSince: 0,
    version: 1,
  }
}

export function theatre(phase: TheatreState['phase'] = 'idle', over: Partial<TheatreState> = {}): TheatreState {
  return {
    caseId: phase === 'idle' || phase === 'turnover' ? null : 'c1',
    phase,
    phaseSince: 0,
    phaseEnds: null,
    lights: phase !== 'idle' && phase !== 'turnover',
    surgeonAtConsole: phase === 'console',
    teachingInUse: false,
    cases: [],
    kpis: { casesToday: 3, firstCaseOnTime: null, dockingMin: null, consoleMin: null, turnoverMin: null, pacuMin: null, utilisation: null },
    version: 1,
    ...over,
  }
}

export function caseView(id: string, over: Partial<SurgeryCaseView> = {}): SurgeryCaseView {
  return {
    id,
    patientId: `p-${id}`,
    name: `Patient ${id}`,
    procedure: 'cholecystectomy',
    phase: 'scheduled' as CasePhase,
    plannedIn: 3600,
    wheelsIn: null,
    dockedAt: null,
    consoleStart: null,
    consoleEnd: null,
    wheelsOut: null,
    outcome: 'home',
    bay: null,
    ...over,
  }
}

/** A whole surgery state: the theatre, the robot, and the seven bays (four pre-op, three recovery), all empty. */
export function surgeryState(over: { theatre?: TheatreState; robot?: RobotState } = {}): SurgeryState {
  const bays: SurgeryState['bays'] = [
    ...[0, 1, 2, 3].map((i) => ({ seatId: `surgeryBed:preop:${i}`, kind: 'preOp' as const, patientId: null, since: 0, curtain: false })),
    ...[0, 1, 2].map((i) => ({ seatId: `surgeryBed:pacu:${i}`, kind: 'pacu' as const, patientId: null, since: 0, curtain: false })),
  ]
  return { theatre: over.theatre ?? theatre(), robot: over.robot ?? stowedRobot(), bays, version: 1 }
}
