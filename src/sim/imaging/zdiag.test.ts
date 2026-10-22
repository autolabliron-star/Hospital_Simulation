import { appendFileSync } from 'node:fs'
import { it } from 'vitest'
import { CONFIG } from '../config'
import { Actor } from '../er/actor'
import { inDoorway } from '../er/spots'
import { mayStandAt } from '../person'
import { Reactions } from '../reactions'
import { Rng } from '../rng'
import { Simulation } from '../Simulation'

const DT = CONFIG.sim.step
const inPinch = (x: number, z: number): boolean => !mayStandAt(x, z) || inDoorway(x, z, 0)
for (const seed of [2026, 5, 9, 31]) it('diag xray gap ' + seed, { timeout: 1_800_000 }, () => {
  const sim = new Simulation(seed, {})
  if (sim.director) sim.director.occupantName = (room) => sim.beds.occupantName(room)
  const stand = (x: number, z: number, h = 0) => { if (!sim.player) sim.addPlayer({ at: { x, z }, heading: h }); sim.movePlayer(x, z, h, 0) }
  const sc = sim.imaging.machines.xray
  let seen = 0
  let next = 0
  const hist: string[] = []
  const snap = () => {
    const op = sc.operator as any
    const s = (sc as any).sess
    return `t=${sim.t.toFixed(0)} step=${s?.step} stepT=${s?.stepT?.toFixed(0)} op mode=${op.mode} done=${op.done} pos=${op.pos.x.toFixed(1)},${op.pos.z.toFixed(1)} hold=${(op.holdUntil - sim.t).toFixed(0)} speed=${op.walker.speed.toFixed(2)} toStation=${op.toStation} stationSent=${s?.stationSent} atStation=${op.isAtStation()}`
  }
  let px = -20
  let dir = 1
  const CZ = -14
  sim.addPlayer({ at: { x: px, z: CZ }, heading: Math.PI / 2 })
  while (sim.t < (23.4 - CONFIG.sim.startHour) * 3600) {
    for (let k = 0; k < 30; k++) {
      px += dir * CONFIG.player.walkSpeed * DT
      if (px > 12) dir = -1
      if (px < -22) dir = 1
      sim.movePlayer(px, CZ, dir > 0 ? Math.PI / 2 : -Math.PI / 2, CONFIG.player.walkSpeed)
      sim.step(DT)
    }
    const s = (sc as any).sess
    if (s?.step === 'gap' && sim.t >= next) { next = sim.t + 15; hist.push(snap()); if (hist.length > 12) hist.shift() }
    if (sim.imaging.stuckLog.length > seen) {
      seen = sim.imaging.stuckLog.length
      appendFileSync('/private/tmp/claude-501/diag/out2.txt', `STUCK ${sim.imaging.stuckLog[seen - 1]} player=${sim.player?.x.toFixed(1)},${sim.player?.z.toFixed(1)} station=${JSON.stringify(sc.sites.station.at)} handler=${JSON.stringify(sc.sites.handler.at)}\n  ${snap()}\n  ${hist.join('\n  ')}\n`)
    }
  }
  appendFileSync('/private/tmp/claude-501/diag/out2.txt', `done fixes=${sim.imaging.stuckFixes} ${sim.imaging.stuckLog.join(';')}\n`)
})
