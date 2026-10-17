// Adopted from Waltz City (src/scene/frameAllocations.test.ts).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A guard against the commonest source of frame hitches: building vectors, colours, sets and arrays inside a `useFrame`
 * callback, which runs 60 times a second and fills the garbage collector with short-lived objects. Hoist them to the
 * module (`const _v = new Vector3()`) or to a `useMemo`/`useRef`. This reads the source, so it only sees the callback's
 * own body, not the helpers it calls: it catches the pattern, it does not prove a frame allocates nothing.
 */
const FLAGGED = /new (Vector[234]|Color|Quaternion|Euler|Matrix[34]|Object3D|Box3|Sphere|Raycaster|Set|Map|Float32Array|Array)\b|\[\.\.\./

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

/** The text of every `useFrame(...)` call in `src`, with the line its body starts on. */
function frameBodies(src: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = []
  const re = /useFrame\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index)
    let depth = 0
    let end = open
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++
      else if (src[end] === ')' && --depth === 0) break
    }
    found.push({ line: src.slice(0, open).split('\n').length, text: src.slice(open, end) })
  }
  return found
}

describe('frame callbacks', () => {
  it('do not build vectors, colours, sets or arrays on every frame', () => {
    const offenders: string[] = []
    let callbacks = 0
    for (const file of sources(join(process.cwd(), 'src'))) {
      for (const body of frameBodies(readFileSync(file, 'utf8'))) {
        callbacks++
        body.text.split('\n').forEach((line, i) => {
          if (!/^\s*\/\//.test(line) && FLAGGED.test(line)) offenders.push(`${file.replace(process.cwd() + '/', '')}:${body.line + i}: ${line.trim()}`)
        })
      }
    }
    expect(callbacks).toBeGreaterThan(0) // the scan found the frame callbacks it is meant to guard
    expect(offenders).toEqual([])
  })
})
