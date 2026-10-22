/**
 * Keyboard, mouse, wheel and pointer lock for the walk mode (adapted from Waltz City's `input.ts`, without touch, emotes or
 * photo mode). It only records what happened; the player system reads it once a frame. Presses are COUNTED, so a quick tap
 * between two frames is never lost.
 *
 * Rules that keep the world quiet when it should be:
 *  - listeners are on `window` in the bubbling phase, so a panel or dialog that stops a key's propagation is obeyed, and keys
 *    typed into a text field, or anywhere inside a dialog (the Go-to and Jump menus use the arrow keys), are ignored;
 *  - while an overlay owns the keyboard (`walkCam.inputBlocked`) the walk keys, `V`, `Q` and `Tab` are not heard at all, so Tab moves
 *    focus through the overlay as the browser intends; otherwise `Tab` is `preventDefault`ed, so the browser never moves focus
 *    off the view;
 *  - losing focus releases every key, so nobody keeps walking after switching tabs.
 *
 * The mouse: a CLICK into the view (a press that hardly moves) asks for POINTER LOCK; `Esc` releases it (the browser's default,
 * `pointerlockchange` tells us). Locked, every mouse move looks around. Unlocked, a held button drags the view (left or right).
 * The wheel zooms the boom whether the pointer is locked or not.
 */
import { DEFAULT_KEYMAP } from '@/sim/types'
import { walkCam } from './state'

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'])

export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  if (target.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type)
  return false
}

/** Is the key's target inside a dialog (the Go-to menu, the Jump menu, a panel)? Its keys are its own: they never walk you. */
export function isInsideDialog(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  return target.closest('[role="dialog"], [aria-modal="true"]') !== null
}

/** The key presses the player system counts: `walk` (Tab: walk <-> overview), `firstPerson` (V) and `shoulderSwap` (Q: the other shoulder). */
export type PressName = 'walk' | 'firstPerson' | 'shoulderSwap'

/**
 * The walk keys as three numbers: `forward` is W (+1) minus S (-1), `right` is D (+1) minus A (-1), `hurry` is Shift. What they mean is the
 * control scheme's business (scheme.ts): by default A and D turn you; in the classic scheme they walk you sideways, relative to the camera.
 */
export interface InputAxes {
  forward: number
  right: number
  hurry: boolean
}

/** The most one pointer event may turn the view by, pixels (a few hundred is a very fast flick; more is a glitch). */
const MAX_MOVE = 300
const clampMove = (v: number): number => (v > MAX_MOVE ? MAX_MOVE : v < -MAX_MOVE ? -MAX_MOVE : v)

const ARROWS = { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const
const KM = DEFAULT_KEYMAP

/** A press this short (ms) that moved this little (px) is a click, which asks for pointer lock; anything more is a drag. */
const CLICK = { ms: 400, px: 6 } as const

/** How long to wait before the one retry of a refused pointer lock, ms. */
export const LOCK_RETRY_MS = 1000

export interface LockTarget {
  requestPointerLock?: () => Promise<void> | void
}

export class PlayerInput {
  private readonly keys = new Set<string>()
  private readonly presses: Record<PressName, number> = { walk: 0, firstPerson: 0, shoulderSwap: 0 }
  private orbitX = 0
  private orbitY = 0
  private wheelY = 0
  private dragId = -1
  private lastX = 0
  private lastY = 0
  private downX = 0
  private downY = 0
  private downT = 0
  private moved = 0
  private container: HTMLElement | null = null
  private detach: (() => void) | null = null
  /** The one retry of a refused pointer lock (F-39): 0 = not used yet, 1 = scheduled or used. A new click starts afresh. */
  private lockRetry = 0
  private lockTimer: ReturnType<typeof setTimeout> | null = null
  /** Set by the owner: whether walk keys and the mouse should be heard right now (walking, with no overlay open). */
  listening = false
  /** Called when the pointer lock starts or ends. */
  onLockChange: ((locked: boolean) => void) | null = null

  /** True while a mouse drag is turning the camera. */
  get dragging(): boolean {
    return this.dragId !== -1
  }

  /** Is the pointer locked to the view right now? */
  get locked(): boolean {
    return typeof document !== 'undefined' && this.container !== null && document.pointerLockElement === this.container
  }

  attach(container: HTMLElement): void {
    this.detach?.()
    this.container = container
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target) || isInsideDialog(e.target)) return
      if (walkCam.inputBlocked) return
      const code = e.code
      if (code === KM.walk) e.preventDefault() // the browser never moves focus off the view
      // stop the page scrolling while the arrows walk
      else if (this.listening && code.startsWith('Arrow')) e.preventDefault()
      this.keyDown(code, e.repeat)
    }
    const onKeyUp = (e: KeyboardEvent) => this.keyUp(e.code)
    const onBlur = () => this.clear()
    const onVisibility = () => {
      if (document.hidden) this.clear()
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!this.listening || this.dragId !== -1) return
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
      this.pointerDown(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (this.locked) {
        // a locked pointer reports raw movement; a browser's odd first report after the lock must not spin the view
        if (this.listening) this.addLook(clampMove(e.movementX), clampMove(e.movementY))
        return
      }
      if (e.pointerId !== this.dragId) return
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        this.dragId = -1 // released outside the window
        return
      }
      this.pointerMove(e.clientX, e.clientY)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== this.dragId) return
      const click = this.pointerUp(e.clientX, e.clientY, e.timeStamp, e.type === 'pointerup')
      if (click && this.listening && e.button === 0) this.requestLock()
    }
    const onWheel = (e: WheelEvent) => {
      if (!this.listening) return
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1
      this.addWheel(e.deltaY * unit)
      e.preventDefault()
    }
    const onContextMenu = (e: Event) => {
      if (this.listening) e.preventDefault()
    }
    const onLock = () => {
      if (this.locked) this.cancelLockRetry()
      this.onLockChange?.(this.locked)
    }
    const onLockError = () => this.scheduleLockRetry()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('pointerlockchange', onLock)
    document.addEventListener('pointerlockerror', onLockError)
    container.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('contextmenu', onContextMenu)
    this.detach = () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('pointerlockchange', onLock)
      document.removeEventListener('pointerlockerror', onLockError)
      this.cancelLockRetry()
      container.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('contextmenu', onContextMenu)
      this.releaseLock()
      this.clear()
      this.container = null
    }
  }

  dispose(): void {
    this.detach?.()
    this.detach = null
  }

  // ------------------------------------------------------------------------------------------
  // What the handlers do (also the hooks the tests drive)
  // ------------------------------------------------------------------------------------------

  /** A key went down. `Tab`, `V` and `Q` are counted presses (never on key repeat); the walk keys are tracked while held. */
  keyDown(code: string, repeat = false): void {
    if (walkCam.inputBlocked) return
    if (code === KM.walk) {
      if (!repeat) this.presses.walk++
      return
    }
    if (code === KM.firstPerson) {
      if (!repeat) this.presses.firstPerson++
      return
    }
    if (code === KM.shoulderSwap) {
      if (!repeat) this.presses.shoulderSwap++
      return
    }
    this.keys.add(code)
  }

  keyUp(code: string): void {
    this.keys.delete(code)
  }

  /** The mouse looked around by this many pixels (locked: raw movement; unlocked: the drag). */
  addLook(dx: number, dy: number): void {
    this.orbitX += dx
    this.orbitY += dy
  }

  /** The wheel turned by this many units (positive pulls the camera back). */
  addWheel(dy: number): void {
    this.wheelY += dy
  }

  pointerDown(id: number, x: number, y: number, t: number): void {
    this.dragId = id
    this.lastX = x
    this.lastY = y
    this.downX = x
    this.downY = y
    this.downT = t
    this.moved = 0
  }

  pointerMove(x: number, y: number): void {
    this.orbitX += x - this.lastX
    this.orbitY += y - this.lastY
    this.lastX = x
    this.lastY = y
    this.moved = Math.max(this.moved, Math.hypot(x - this.downX, y - this.downY))
  }

  /** The press ended. Returns whether it was a CLICK (short, and hardly moved), which asks for pointer lock. */
  pointerUp(x: number, y: number, t: number, released = true): boolean {
    const moved = Math.max(this.moved, Math.hypot(x - this.downX, y - this.downY))
    const click = released && moved < CLICK.px && t - this.downT < CLICK.ms
    this.dragId = -1
    return click
  }

  /**
   * Ask the browser to lock the pointer to the view (it needs a recent click; a refusal is fine: dragging still looks). A refusal (a rejected
   * promise or `pointerlockerror`: Chrome refuses a request made right after Esc released the lock) is retried ONCE, about a second later.
   */
  requestLock(): void {
    this.cancelLockRetry()
    this.lockRetry = 0
    this.tryLock()
  }

  private tryLock(): void {
    const c = this.container as LockTarget | null
    if (!c || typeof c.requestPointerLock !== 'function' || this.locked) return
    try {
      const p = c.requestPointerLock()
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => this.scheduleLockRetry())
    } catch {
      this.scheduleLockRetry() // the browser said no
    }
  }

  /** Retry the lock once, 1 s from now. Never more than once per click, and never while one is already waiting. */
  private scheduleLockRetry(): void {
    if (this.lockRetry > 0 || this.container === null) return
    this.lockRetry = 1
    this.lockTimer = setTimeout(() => {
      this.lockTimer = null
      if (this.listening && !walkCam.inputBlocked) this.tryLock()
    }, LOCK_RETRY_MS)
  }

  private cancelLockRetry(): void {
    if (this.lockTimer !== null) clearTimeout(this.lockTimer)
    this.lockTimer = null
  }

  releaseLock(): void {
    if (this.locked && typeof document !== 'undefined') document.exitPointerLock()
  }

  /** Release everything: keys, presses, drag. */
  clear(): void {
    this.keys.clear()
    this.dragId = -1
    this.orbitX = 0
    this.orbitY = 0
    this.wheelY = 0
    this.presses.walk = 0
    this.presses.firstPerson = 0
    this.presses.shoulderSwap = 0
  }

  /** Forget presses and mouse motion that arrived while nothing was listening (the keys stay, so a held W carries on once the walk starts). */
  discardPending(): void {
    this.orbitX = 0
    this.orbitY = 0
    this.wheelY = 0
    this.dragId = -1
  }

  /** The keys as `forward`, `right` and `hurry` (W and the up arrow, D and the right arrow...). */
  axes(out: InputAxes): InputAxes {
    const k = this.keys
    out.forward = (k.has(KM.forward) || k.has(ARROWS.forward) ? 1 : 0) - (k.has(KM.back) || k.has(ARROWS.back) ? 1 : 0)
    out.right = (k.has(KM.right) || k.has(ARROWS.right) ? 1 : 0) - (k.has(KM.left) || k.has(ARROWS.left) ? 1 : 0)
    out.hurry = k.has(KM.hurry) || k.has('ShiftRight')
    return out
  }

  /** True once per press. */
  take(name: PressName): boolean {
    if (this.presses[name] <= 0) return false
    this.presses[name]--
    return true
  }

  /** Mouse look and wheel since the last call; resets them. */
  takeLook(out: { dx: number; dy: number; wheel: number }): { dx: number; dy: number; wheel: number } {
    out.dx = this.orbitX
    out.dy = this.orbitY
    out.wheel = this.wheelY
    this.orbitX = 0
    this.orbitY = 0
    this.wheelY = 0
    return out
  }
}
