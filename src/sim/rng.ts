// Template from Waltz City (src/sim/rng.ts). Proven in production there; adjust the imports and names to your project.
/**
 * Seeded PRNG for the simulation. Nothing under src/sim may call Math.random: every random choice
 * goes through an Rng so that `?seed=42` reproduces the same event feed (plan: deterministic check).
 *
 * Streams: the world has one root Rng, and every agent gets its own stream via `fork(id)`. A fork is
 * derived from the root SEED (not from its current state), so an agent's stream never depends on how
 * many numbers other agents consumed, which keeps replays stable when the camera changes who is
 * simulated at which LOD tier.
 */

export type RandomFn = () => number

/** mulberry32: tiny, fast, good enough statistically for game logic. Returns floats in [0, 1). */
export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32 bit string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Combine a seed and a label hash into a new, well-mixed 32 bit seed. */
export function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

// Functional helpers over any RandomFn (the Rng class methods call these).

export function range(r: RandomFn, min: number, max: number): number {
  return min + (max - min) * r()
}

export function int(r: RandomFn, min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1))
}

export function chance(r: RandomFn, p: number): boolean {
  return r() < p
}

export function pick<T>(r: RandomFn, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() from an empty array')
  return items[Math.min(items.length - 1, Math.floor(r() * items.length))]
}

/** Standard normal via Box-Muller (uses two uniforms, returns one sample; see Rng for the cached pair). */
export function gaussian(r: RandomFn, mean = 0, sd = 1): number {
  let u = 0
  while (u === 0) u = r()
  const v = r()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export class Rng {
  readonly seed: number
  private readonly next: RandomFn
  private spare: number | null = null

  constructor(seed: number) {
    this.seed = seed >>> 0
    this.next = mulberry32(this.seed)
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next()
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return range(this.next, min, max)
  }

  /** Range from a [min, max] tuple (config durations). */
  between(span: readonly [number, number]): number {
    return range(this.next, span[0], span[1])
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return int(this.next, min, max)
  }

  chance(p: number): boolean {
    return chance(this.next, p)
  }

  pick<T>(items: readonly T[]): T {
    return pick(this.next, items)
  }

  /** Pick by weights (weights need not be normalised; zero or negative weights are never chosen). */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0
    for (let i = 0; i < items.length; i++) total += Math.max(0, weights[i] ?? 0)
    if (total <= 0) return this.pick(items)
    let roll = this.next() * total
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i] ?? 0)
      if (roll < 0) return items[i]
    }
    return items[items.length - 1]
  }

  /** Normal distribution. Box-Muller yields pairs, so the second value is cached. */
  gaussian(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const s = this.spare
      this.spare = null
      return mean + sd * s
    }
    let u = 0
    while (u === 0) u = this.next()
    const v = this.next()
    const mag = Math.sqrt(-2 * Math.log(u))
    this.spare = mag * Math.sin(2 * Math.PI * v)
    return mean + sd * mag * Math.cos(2 * Math.PI * v)
  }

  /** Normal sample clamped to [lo, hi]. */
  clampedGaussian(mean: number, sd: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, this.gaussian(mean, sd)))
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1
  }

  /** In-place Fisher-Yates. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const t = items[i]
      items[i] = items[j]
      items[j] = t
    }
    return items
  }

  /** Independent, reproducible sub-stream. Same label always yields the same stream. */
  fork(label: string | number): Rng {
    const salt = typeof label === 'number' ? label | 0 : hashString(label)
    return new Rng(mixSeed(this.seed, salt))
  }
}
