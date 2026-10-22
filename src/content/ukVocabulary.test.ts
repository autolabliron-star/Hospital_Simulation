/**
 * F-33: one vocabulary, UK. The copy the sim and the UI read from src/content, and the words this change moved into content, say "theatre" and
 * "centre" (never "OR" for the operating room, "center", "anesthesia"), and a patient's belly is not a "tummy".
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GO_TO_COPY } from './goTo'
import { POST_LABEL_COPY } from './postLabels'
import { ER_EVENTS } from './erEvents'
import { SURGERY_COPY } from './surgery'
import { buildGoToGroups } from '@/ui/goToModel'
import { POST_LABELS } from '@/sim/day/roster'

/** "OR" is only wrong in capitals (the operating room); the other patterns are wrong in any case. */
const usWord = (s: string): string | null => {
  if (/\bOR\b/.test(s)) return 'OR'
  const m = s.match(/\bcenters?\b|\bcentered\b|anesth\w*|\bdiarrhea|\bgurney|\bhospitalization|\bpediatric|\btummy\b/i)
  return m ? m[0] : null
}

function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  if (Array.isArray(o)) return o.flatMap((v, i) => strings(v, `${path}[${i}]`))
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

describe('UK vocabulary in content (F-33)', () => {
  it('has no US word in any content file', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(30)
    const KNOWN: Record<string, RegExp> = {}
    const offenders: string[] = []
    for (const f of files) {
      for (const [path, text] of strings(JSON.parse(readFileSync(`${dir}${f}`, 'utf8')))) {
        const hit = usWord(text)
        if (hit && !KNOWN[f]?.test(hit)) offenders.push(`${f} ${path}: "${text}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('says "centre" and "theatre" in the words this change moved into content', () => {
    for (const source of [ER_EVENTS, GO_TO_COPY, POST_LABEL_COPY, SURGERY_COPY.checklist]) {
      for (const [path, text] of strings(source)) expect(usWord(text), `${path}: ${text}`).toBeNull()
    }
    expect(POST_LABEL_COPY.command).toBe('the command centre')
    expect(GO_TO_COPY.groups.command).toBe('Command centre')
    expect(GO_TO_COPY.areaWords.l2Or.label).toBe('Robotic theatre')
  })

  it('shows the same words in the roster handover labels and in the Go to… menu', () => {
    expect(POST_LABELS.command).toBe('the command centre')
    for (const g of buildGoToGroups()) {
      expect(usWord(g.title), g.title).toBeNull()
      for (const i of g.items) {
        expect(usWord(i.label), i.label).toBeNull()
        expect(usWord(i.detail), i.detail).toBeNull()
      }
    }
    const l2 = buildGoToGroups().find((g) => g.id === 'level2')!
    expect(l2.items.find((i) => i.area === 'l2Or')!.label).toBe('Robotic theatre')
    expect(buildGoToGroups().find((g) => g.id === 'command')!.items[0].label).toBe('Command centre')
  })

})
