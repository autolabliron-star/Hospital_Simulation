// Adapted from the living-3d-world template (Waltz City src/app/PowerLoop.tsx).
import { advance, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { useWalk } from '@/scene/player/state'
import { reportFrame } from '@/scene/quality/frameTiming'
import { FramePacer, GameClock, PowerMachine, isWalkingMode, usePower, usePresent } from './power'

interface BatteryLike extends EventTarget {
  charging: boolean
}

export interface PowerLoopProps {
  /** The loading screen is up (warm-up running, or Enter not pressed yet): 30 fps instead of 60. */
  loading?: boolean
}

/**
 * The demo's frame loop. The Canvas runs with `frameloop="never"`, and this drives it at the frame cap (60, or 30 on the loading
 * screen and on battery outside presentation mode and walk mode), and not at all while paused. The rules are in power.ts (pure and
 * tested); this wires the browser's events to them:
 *
 *   - the tab is hidden: paused, always (and the audio engines go quiet, they read `usePower`);
 *   - the window lost focus: paused, except in presentation mode (`?present=1`), where screen sharing must never freeze the picture;
 *   - on battery (the Battery API, where there is one; a desktop or a browser without it counts as plugged in): 30 fps, except in
 *     presentation mode, which holds 60, and while you are in walk mode (W3: the walk is the thing that must be smooth).
 *
 * The time handed to R3F is the game's own clock, clamped to 0.1 s a frame, so an hour in another window adds one frame to the
 * clock and never fast-forwards the simulation. One `advance()` is one whole frame in the order written down in
 * scene/camera/frameOrder.ts (the simulation first, the draw last); nothing here takes the draw over.
 *
 * Every drawn frame is timed (the `advance()` call, and the gap since the previous drawn frame) and reported to the quality ladder
 * through scene/quality/frameTiming.ts. Nothing in the tick allocates.
 */
export function PowerLoop({ loading = false }: PowerLoopProps) {
  const get = useThree((s) => s.get)
  const machine = useRef<PowerMachine | null>(null)

  // Inputs: tab visibility, window focus, battery, presentation mode.
  useEffect(() => {
    const m = new PowerMachine(
      { hidden: document.hidden, focused: document.hasFocus(), present: usePresent.getState().on, loading, walking: isWalkingMode(useWalk.getState().mode) },
      (next) => usePower.getState().set(next),
    )
    machine.current = m
    usePower.getState().set(m.decision)

    const onVisibility = () => m.set({ hidden: document.hidden })
    const onFocus = () => m.set({ focused: true })
    const onBlur = () => m.set({ focused: false })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    const unsubPresent = usePresent.subscribe((s, prev) => {
      if (s.on !== prev.on) m.set({ present: s.on })
    })
    // walk mode (and the flights to and from it) holds 60 fps on battery; the overview does not need to
    const unsubWalk = useWalk.subscribe((s, prev) => {
      if (s.mode !== prev.mode) m.set({ walking: isWalkingMode(s.mode) })
    })

    let battery: BatteryLike | null = null
    let disposed = false
    const onCharging = () => {
      if (battery) m.set({ onBattery: !battery.charging })
    }
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
    nav.getBattery?.().then(
      (b) => {
        if (disposed) return
        battery = b
        b.addEventListener('chargingchange', onCharging)
        onCharging()
      },
      () => undefined,
    )

    return () => {
      disposed = true
      machine.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      battery?.removeEventListener('chargingchange', onCharging)
      unsubPresent()
      unsubWalk()
    }
    // `loading` is read once, at mount: later changes are handled by the next effect
  }, [])

  // The loading screen goes away (or comes back): the cap changes at once.
  useEffect(() => {
    machine.current?.set({ loading })
  }, [loading])

  // The loop itself.
  useEffect(() => {
    let raf = 0
    let lastDrawn = -1
    const clock = new GameClock()
    const pacer = new FramePacer()
    const restart = () => {
      clock.reset()
      pacer.reset()
      lastDrawn = -1
    }
    // A hidden tab runs no animation frames, so the tick below never sees the pause: reset on the change itself.
    const unsubPower = usePower.subscribe((s, prev) => {
      if (s.paused !== prev.paused) restart()
    })
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const power = usePower.getState()
      if (power.paused) {
        restart()
        return
      }
      if (!pacer.accept(now, power.fps)) return
      const gameTime = clock.tick(now, power.fps)
      const interval = lastDrawn < 0 ? 0 : now - lastDrawn
      lastDrawn = now
      const t0 = performance.now()
      advance(gameTime, true, get())
      reportFrame(performance.now() - t0, interval, power.fps, now, pacer.refreshMs)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      unsubPower()
    }
  }, [get])

  return null
}
