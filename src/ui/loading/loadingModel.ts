/**
 * What the loading screen says and shows, as a pure function of the warm-up's state (so node tests check it with no DOM).
 *
 *   - the hospital's name, a tagline and a calm progress line ("Preparing the hospital…"), no numbers and no countdown;
 *   - the Enter button exists only once the warm-up is done (before that it is in the layout, invisible and disabled, so nothing jumps);
 *   - `?skipIntro=1` has no button: it enters by itself when ready (for scripted checks);
 *   - when the warm-up failed or ran out of time the line says so kindly, and Enter is there all the same.
 */
import type { LoadingCopy } from '@/content/loading'

/** The overlay fades out over this long after Enter, ms. */
export const FADE_MS = 400
/** If the warm-up has not finished after this long, the loading screen calls it ready so it can never keep the presenter out, ms. */
export const GIVE_UP_MS = 30000
/** From this progress the line says "Almost ready…". */
export const FINISHING_FROM = 0.85

export interface LoadingInput {
  ready: boolean
  /** 0..1 */
  progress: number
  failed: boolean
  timedOut: boolean
  entered: boolean
  skipIntro: boolean
}

export interface LoadingView {
  title: string
  tagline: string
  progressLabel: string
  /** The one calm line under the bar. */
  line: string
  /** 0..100, whole numbers: for the bar and the screen reader. Never 100 before ready. */
  percent: number
  ready: boolean
  /** The Enter button can be seen. */
  enterVisible: boolean
  /** The Enter button cannot be pressed (always true until the warm-up is done). */
  enterDisabled: boolean
  enterLabel: string
  hint: string
  /** Enter was pressed: the card is fading out. */
  leaving: boolean
  /** `?skipIntro=1` and the warm-up is done: enter now, without a click. */
  autoEnter: boolean
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

export function loadingView(copy: LoadingCopy, s: LoadingInput): LoadingView {
  const progress = clamp01(s.progress)
  const line = s.ready ? (s.failed || s.timedOut ? copy.status.readyDegraded : copy.status.ready) : progress >= FINISHING_FROM ? copy.status.finishing : copy.status.preparing
  return {
    title: copy.title,
    tagline: copy.tagline,
    progressLabel: copy.progressLabel,
    line,
    percent: s.ready ? 100 : Math.min(99, Math.round(progress * 100)),
    ready: s.ready,
    enterVisible: s.ready && !s.skipIntro && !s.entered,
    enterDisabled: !s.ready,
    enterLabel: copy.enter.label,
    hint: copy.enter.hint,
    leaving: s.entered,
    autoEnter: s.skipIntro && s.ready && !s.entered,
  }
}
