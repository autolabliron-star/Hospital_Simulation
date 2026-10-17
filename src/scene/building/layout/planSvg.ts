/**
 * A top-down SVG of the layout (dev aid, pure): every primitive as a coloured shape in palette colour, tall things drawn
 * last, plus the nav edges and robot lane centre lines when asked. Used to eyeball composition without a browser:
 *   npx tsx -e "import('./src/scene/building/layout/planSvg').then(m => require('fs').writeFileSync('/tmp/plan.svg', m.planSvg()))"
 */
import { MAT } from '@/scene/materials'
import { NAV } from '@/sim/nav/graph'
import { CIRCUITS, pointAt, type PathPoint } from '@/sim/meds/circuit'
import { getLayout } from './index'
import type { BuildingLayout, Prim } from './types'

export interface PlanOptions {
  x0?: number
  x1?: number
  z0?: number
  z1?: number
  scale?: number
  nav?: boolean
  lanes?: boolean
  footprints?: boolean
}

export function planSvg(layout: BuildingLayout = getLayout(), o: PlanOptions = {}): string {
  const x0 = o.x0 ?? -80
  const x1 = o.x1 ?? 50
  const z0 = o.z0 ?? -33
  const z1 = o.z1 ?? 33
  const s = o.scale ?? 14
  const X = (x: number) => ((x - x0) * s).toFixed(1)
  const Z = (z: number) => ((z - z0) * s).toFixed(1)
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${(x1 - x0) * s}" height="${(z1 - z0) * s}" style="background:#e9eeed">`]
  const colorOf = (p: Prim): string => p.color ?? `#${MAT[p.mat].color.getHexString()}`
  const sorted = [...layout.prims].sort((a, b) => a.position[1] + a.size[1] / 2 - (b.position[1] + b.size[1] / 2))
  for (const p of sorted) {
    if (p.shape === 'quad') continue
    const cx = p.position[0]
    const cz = p.position[2]
    const op = p.mat === 'glass' ? 0.3 : 1
    const fill = `fill="${colorOf(p)}" fill-opacity="${op}"`
    if (p.shape === 'cylinder' || p.shape === 'sphere' || p.shape === 'capsule') {
      out.push(`<ellipse cx="${X(cx)}" cy="${Z(cz)}" rx="${((p.size[0] / 2) * s).toFixed(1)}" ry="${((p.size[2] / 2) * s).toFixed(1)}" ${fill}/>`)
    } else if (p.shape === 'torus') {
      out.push(`<circle cx="${X(cx)}" cy="${Z(cz)}" r="${((p.size[0] / 2) * s).toFixed(1)}" fill="none" stroke="${colorOf(p)}" stroke-width="${(p.size[1] * s).toFixed(1)}"/>`)
    } else {
      const w = p.size[0] * s
      const d = p.size[2] * s
      const deg = (-p.rotationY * 180) / Math.PI
      out.push(`<rect x="${(cx - p.size[0] / 2 - x0) * s}" y="${(cz - p.size[2] / 2 - z0) * s}" width="${w.toFixed(1)}" height="${d.toFixed(1)}" ${fill} transform="rotate(${deg.toFixed(1)} ${X(cx)} ${Z(cz)})"/>`)
    }
  }
  if (o.footprints) {
    for (const f of layout.footprints) {
      if (f.kind === 'circle') out.push(`<circle cx="${X(f.x)}" cy="${Z(f.z)}" r="${(f.hw * s).toFixed(1)}" fill="none" stroke="#d0342c" stroke-width="1"/>`)
      else out.push(`<rect x="${(f.x - f.hw - x0) * s}" y="${(f.z - f.hd - z0) * s}" width="${(f.hw * 2 * s).toFixed(1)}" height="${(f.hd * 2 * s).toFixed(1)}" fill="none" stroke="#d0342c" stroke-width="1" transform="rotate(${((-f.rotationY * 180) / Math.PI).toFixed(1)} ${X(f.x)} ${Z(f.z)})"/>`)
    }
  }
  if (o.nav) {
    for (const e of NAV.edges) {
      const a = NAV.nodes[e.a]
      const b = NAV.nodes[e.b]
      out.push(`<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(b.x)}" y2="${Z(b.z)}" stroke="#2a62d6" stroke-width="0.6" stroke-opacity="0.6"/>`)
    }
  }
  if (o.lanes) {
    const p: PathPoint = { x: 0, z: 0, heading: 0 }
    for (const w of ['A', 'B'] as const) {
      const c = CIRCUITS[w]
      const pts: string[] = []
      for (let t = 0; t < c.length; t += 0.25) {
        pointAt(c, t, p)
        pts.push(`${X(p.x)},${Z(p.z)}`)
      }
      out.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="#17a398" stroke-width="1.2"/>`)
    }
  }
  out.push('</svg>')
  return out.join('\n')
}
