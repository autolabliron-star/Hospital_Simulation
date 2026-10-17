/** The small clock of walk mode: the time, and a quiet tag when the hospital is paused or running faster. (Space and 1, 2, 4 still work.) */
import { WALK, fillWalk } from '@/content/walk'
import { useWorld } from '@/sim/world.store'

export function ClockView({ clock, speed, paused }: { clock: string; speed: number; paused: boolean }) {
  return (
    <section className="hud-card walk-clock" aria-label={fillWalk(WALK.hud.clockLabel, { time: clock })}>
      <span className="walk-clock__time">{clock}</span>
      {paused ? <span className="walk-clock__tag">{WALK.hud.paused}</span> : speed > 1 ? <span className="walk-clock__tag">{speed}×</span> : null}
    </section>
  )
}

export function WalkClock() {
  const clock = useWorld((s) => s.clock)
  const speed = useWorld((s) => s.speed)
  const paused = useWorld((s) => s.paused)
  return <ClockView clock={clock} speed={speed} paused={paused} />
}
