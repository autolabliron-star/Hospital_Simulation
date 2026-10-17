import { describe, expect, it } from 'vitest'
import type { ImagingScene } from '@/ui/imagingApi'
import type * as Imaging from './index'

/** The module the Scan viewer loads must satisfy the interface it pins (checked by the compiler: this file is part of `npm run typecheck`). */
type Satisfies = Pick<typeof Imaging, 'getScanCanvas' | 'renderThumbnail' | 'scanCaption'> extends ImagingScene ? true : never
const ok: Satisfies = true

describe('imaging module API', () => {
  it('exports exactly what the Scan viewer pins', () => {
    expect(ok).toBe(true)
  })
})
