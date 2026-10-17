/**
 * One live scan screen: the canvas the Scan viewer shows and the 3D monitors use as a texture (one per modality, created lazily).
 *
 * What it shows follows the scanner (`ScannerState`, mutated in place by the sim):
 *   idle                       a standby page
 *   prep / positioning / table the patient-setup page (name, protocol, what is happening)
 *   scanning (MRI, CT, X-ray)  the current slice of the current series, revealed from the top down as the acquisition advances
 *                              (the previous slice stays below the reveal line); after the last step the final slice stays up
 *   scanning (ultrasound)      the live fan, redrawn at the update rate; it freezes between sweeps
 *
 * Cost: the anatomy is rasterised only when the SLICE changes (every few seconds); every other update is one image blit, a clip and
 * a line. `update` is called every frame and decides itself whether this frame needs a redraw (a rate limit, then a change check).
 */
import type { ImagingExam, ImagingModality, ScannerState } from '@/sim/types'
import { MODALITY_LABEL, phaseWords } from './captions'
import type { Env, Surface } from './ctx'
import type { Painter } from './paint'
import { paramsLine, pickImage, sliceAt } from './scan'
import { createUsScene, usScene } from './ultrasound'
import { paintUltrasound } from './usPaint'

export const SCREEN_SIZE = 384
const S = SCREEN_SIZE

const ACCENT: Record<ImagingModality, string> = { mri: '#5aa9ff', ct: '#ff6a5a', xray: '#fff3b0', us: '#7ee0c3' }
const FONT = 'ui-monospace, Menlo, Consolas, monospace'
export const DISCLAIMER = 'Simulated image, not real patient data'

type Mode = 'none' | 'standby' | 'setup' | 'image' | 'us'

function text(c: Surface['ctx'], s: string, x: number, y: number, align: 'left' | 'right' | 'center', size = 10, fill = 'rgba(225,238,238,0.95)', bold = true): void {
  c.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.lineJoin = 'round'
  c.lineWidth = 3
  c.strokeStyle = 'rgba(0,0,0,0.75)'
  c.strokeText(s, x, y)
  c.fillStyle = fill
  c.fillText(s, x, y)
}

export class LiveScreen {
  readonly canvas: Surface['canvas']
  /** Called after every redraw (the 3D texture flags itself for upload here). */
  onDraw: (() => void) | null = null

  private readonly final: Surface
  private readonly cur: Surface
  private readonly prev: Surface
  private readonly overlay: Surface
  private readonly us = createUsScene()
  private lastDraw = -1e9
  private prevValid = false
  private curValid = false
  private mode: Mode = 'none'
  private exam: ImagingExam | null = null
  private phase = ''
  private seq = -2
  private slice = -1
  private fracQ = -1
  private tQ = -1
  private frozenDrawn = false

  constructor(
    readonly modality: ImagingModality,
    env: Env,
    private readonly painter: Painter,
  ) {
    this.final = env.createSurface(S, S)
    this.cur = env.createSurface(S, S)
    this.prev = env.createSurface(S, S)
    this.overlay = env.createSurface(S, S)
    this.canvas = this.final.canvas
    this.drawStandby()
  }

  /** Call every frame. `minInterval` is the redraw period in milliseconds (100 in the focused room, 1000 elsewhere). Returns true if it drew. */
  update(state: ScannerState, simT: number, nowMs: number, minInterval: number): boolean {
    if (nowMs - this.lastDraw < minInterval) return false
    const exam = state.exam
    let drew = false
    if (!exam || state.phase === 'idle') {
      if (this.mode !== 'standby') {
        this.drawStandby()
        this.resetSeries()
        drew = true
      }
    } else if (state.phase === 'scanning' || state.phase === 'tableOut' || state.phase === 'cleanup') {
      if (state.sequence < 0 && state.phase === 'scanning') drew = this.updateSetup(exam, state)
      else drew = exam.modality === 'us' ? this.updateUs(exam, state, simT) : this.updateSlices(exam, state)
    } else {
      drew = this.updateSetup(exam, state)
    }
    if (drew) {
      this.lastDraw = nowMs
      this.onDraw?.()
    }
    return drew
  }

  // --- pages ----------------------------------------------------------------------------------------

  private resetSeries(): void {
    this.exam = null
    this.prevValid = false
    this.curValid = false
    this.seq = -2
    this.slice = -1
    this.fracQ = -1
    this.phase = ''
    this.frozenDrawn = false
  }

  private page(draw: (c: Surface['ctx']) => void): void {
    const c = this.final.ctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = '#04080a'
    c.fillRect(0, 0, S, S)
    draw(c)
  }

  private drawStandby(): void {
    this.mode = 'standby'
    this.page((c) => {
      const g = c.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7)
      g.addColorStop(0, 'rgba(40,70,76,0.55)')
      g.addColorStop(1, 'rgba(4,8,10,0)')
      c.fillStyle = g
      c.fillRect(0, 0, S, S)
      text(c, MODALITY_LABEL[this.modality].toUpperCase(), S / 2, S / 2 - 6, 'center', 34, 'rgba(200,225,228,0.85)')
      text(c, phaseWords('idle', this.modality), S / 2, S / 2 + 18, 'center', 12, 'rgba(160,190,194,0.9)', false)
      text(c, DISCLAIMER, S / 2, S - 10, 'center', 9, 'rgba(150,175,178,0.85)', false)
    })
  }

  private updateSetup(exam: ImagingExam, state: ScannerState): boolean {
    if (this.mode === 'setup' && this.exam === exam && this.phase === state.phase) return false
    if (this.exam !== exam) this.resetSeries()
    this.mode = 'setup'
    this.exam = exam
    this.phase = state.phase
    this.page((c) => {
      const accent = ACCENT[exam.modality]
      c.fillStyle = accent
      c.globalAlpha = 0.9
      c.fillRect(24, 70, 4, 112)
      c.globalAlpha = 1
      text(c, `${MODALITY_LABEL[exam.modality].toUpperCase()}  PATIENT SETUP`, 38, 86, 'left', 13, accent)
      text(c, exam.patientName, 38, 114, 'left', 18)
      text(c, exam.protocol, 38, 136, 'left', 12, 'rgba(200,225,228,0.9)', false)
      text(c, phaseWords(state.phase, exam.modality), 38, 164, 'left', 12, 'rgba(255,214,140,0.95)')
      text(c, `${exam.sequences.length} ${exam.sequences.length === 1 ? 'step' : 'steps'} planned`, 38, 182, 'left', 10, 'rgba(160,190,194,0.9)', false)
      text(c, DISCLAIMER, S / 2, S - 10, 'center', 9, 'rgba(150,175,178,0.85)', false)
    })
    return true
  }

  // --- MRI, CT, X-ray -----------------------------------------------------------------------------------

  private updateSlices(exam: ImagingExam, state: ScannerState): boolean {
    const done = state.phase !== 'scanning'
    const seqIndex = Math.max(0, Math.min(exam.sequences.length - 1, state.sequence))
    const seq = exam.sequences[seqIndex]
    const { index, frac } = sliceAt(seq.images, done ? 1 : state.progress)
    const reveal = done ? 1 : frac
    const fracQ = Math.round(reveal * 20)
    if (this.mode === 'image' && this.exam === exam && this.seq === seqIndex && this.slice === index && this.fracQ === fracQ && this.phase === state.phase) return false

    if (this.exam !== exam) {
      this.resetSeries()
      this.exam = exam
    }
    if (this.seq !== seqIndex || this.slice !== index || !this.curValid) {
      this.renderSlice(exam, seqIndex, index)
      this.seq = seqIndex
      this.slice = index
    }
    this.mode = 'image'
    this.phase = state.phase
    this.fracQ = fracQ

    const f = this.final.ctx
    f.setTransform(1, 0, 0, 1, 0, 0)
    f.globalAlpha = 1
    f.globalCompositeOperation = 'source-over'
    f.fillStyle = '#000'
    f.fillRect(0, 0, S, S)
    if (this.prevValid) f.drawImage(this.prev.canvas, 0, 0)
    const y = Math.round(reveal * S)
    if (y > 0) {
      f.save()
      f.beginPath()
      f.rect(0, 0, S, y)
      f.clip()
      f.drawImage(this.cur.canvas, 0, 0)
      f.restore()
    }
    if (reveal < 0.995) {
      f.fillStyle = ACCENT[exam.modality]
      f.globalAlpha = 0.8
      f.fillRect(0, Math.max(0, y - 1), S, 2)
      f.globalAlpha = 1
    }
    f.drawImage(this.overlay.canvas, 0, 0)
    return true
  }

  /** Rasterise slice `k` of step `si` into `cur` (the previous slice moves to `prev`) and rebuild the text overlay. */
  private renderSlice(exam: ImagingExam, si: number, k: number): void {
    if (this.curValid) {
      const p = this.prev.ctx
      p.setTransform(1, 0, 0, 1, 0, 0)
      p.globalCompositeOperation = 'source-over'
      p.globalAlpha = 1
      p.drawImage(this.cur.canvas, 0, 0)
      this.prevValid = true
    }
    const pick = pickImage(exam, si, k)
    if (pick.kind === 'slice') this.painter.paint(this.cur, S, pick.model, pick.look, pick.grain, pick.coil)
    this.curValid = true
    const seq = exam.sequences[si]
    const tag = pick.tag
    const o = this.overlay.ctx
    o.setTransform(1, 0, 0, 1, 0, 0)
    o.clearRect(0, 0, S, S)
    text(o, exam.patientName.toUpperCase(), 8, 14, 'left')
    text(o, exam.protocol, 8, 27, 'left', 9, 'rgba(190,215,218,0.9)', false)
    text(o, seq.name, S - 8, 14, 'right')
    text(o, seq.images > 1 ? `Im ${k + 1}/${seq.images}` : 'Im 1/1', S - 8, 27, 'right', 9, 'rgba(190,215,218,0.9)', false)
    text(o, tag, 8, S - 24, 'left', 11, ACCENT[exam.modality])
    text(o, paramsLine(exam.modality, seq, exam.bodyPart), 8, S - 11, 'left', 9, 'rgba(190,215,218,0.9)', false)
    if (pick.kind === 'slice' && pick.model.marker) {
      const m = pick.model.marker
      text(o, m.text, S / 2 + (m.x * S) / 2, S / 2 + (m.y * S) / 2 + 4, 'center', 12, 'rgba(255,230,150,0.95)')
    }
    text(o, DISCLAIMER, S - 8, S - 11, 'right', 8, 'rgba(160,185,188,0.8)', false)
  }

  // --- ultrasound ---------------------------------------------------------------------------------------

  private updateUs(exam: ImagingExam, state: ScannerState, simT: number): boolean {
    const seqIndex = Math.max(0, Math.min(exam.sequences.length - 1, state.sequence))
    const live = state.phase === 'scanning' && state.activity > 0.3
    const tQ = Math.floor(simT * 10)
    const sameSeries = this.mode === 'us' && this.exam === exam && this.seq === seqIndex
    if (sameSeries && !live && this.frozenDrawn) return false
    if (sameSeries && live && this.tQ === tQ) return false
    if (!sameSeries) {
      this.resetSeries()
      this.exam = exam
      this.seq = seqIndex
      this.buildUsOverlay(exam, seqIndex)
    }
    this.mode = 'us'
    this.tQ = tQ
    this.frozenDrawn = !live
    const pick = pickImage(exam, seqIndex, 0)
    if (pick.kind !== 'us') return false
    usScene(this.us, pick.view, exam.imageSeed + seqIndex * 977, state.detail, simT)
    const { fine, speckle } = this.painter.tiles
    paintUltrasound(this.final.ctx, S, this.us, speckle, fine, simT, state.detail, live)
    this.final.ctx.globalAlpha = 1
    this.final.ctx.drawImage(this.overlay.canvas, 0, 0)
    text(this.final.ctx, live ? `${this.us.title.toUpperCase()}  LIVE` : 'FREEZE', S / 2, 14, 'center', 10, live ? '#7ee0c3' : '#ffd68c')
    text(this.final.ctx, `${Math.round(state.detail * 100)}%`, 8, S - 24, 'left', 9, 'rgba(190,215,218,0.9)', false)
    return true
  }

  private buildUsOverlay(exam: ImagingExam, si: number): void {
    const seq = exam.sequences[si]
    const o = this.overlay.ctx
    o.setTransform(1, 0, 0, 1, 0, 0)
    o.clearRect(0, 0, S, S)
    text(o, exam.patientName.toUpperCase(), 8, 14, 'left')
    text(o, exam.protocol, 8, 27, 'left', 9, 'rgba(190,215,218,0.9)', false)
    text(o, seq.name, S - 8, 27, 'right', 9, 'rgba(190,215,218,0.9)', false)
    text(o, paramsLine('us', seq, exam.bodyPart), 8, S - 11, 'left', 9, 'rgba(190,215,218,0.9)', false)
    text(o, DISCLAIMER, S - 8, S - 11, 'right', 8, 'rgba(160,185,188,0.8)', false)
  }
}

// ---------------------------------------------------------------------------------------------
// Thumbnails (once per finished step, on a fresh canvas the caller can read)
// ---------------------------------------------------------------------------------------------

export function renderThumbnailOn(env: Env, painter: Painter, exam: ImagingExam, si: number, size: number): Surface['canvas'] {
  const s = env.createSurface(size, size)
  const seq = exam.sequences[Math.max(0, Math.min(exam.sequences.length - 1, si))]
  const pick = pickImage(exam, si, Math.floor(seq.images / 2))
  if (pick.kind === 'slice') {
    painter.paint(s, size, pick.model, pick.look, pick.grain, pick.coil)
  } else {
    const sc = createUsScene()
    usScene(sc, pick.view, exam.imageSeed + si * 977, 0.5, 3)
    paintUltrasound(s.ctx, size, sc, painter.tiles.speckle, painter.tiles.fine, 3, 0.5, false)
  }
  const c = s.ctx
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  const fs = Math.max(8, Math.round(size / 11))
  c.font = `bold ${fs}px ${FONT}`
  c.textAlign = 'left'
  c.textBaseline = 'alphabetic'
  c.lineWidth = 3
  c.strokeStyle = 'rgba(0,0,0,0.75)'
  c.strokeText(pick.tag, 4, size - 5)
  c.fillStyle = ACCENT[exam.modality]
  c.fillText(pick.tag, 4, size - 5)
  return s.canvas
}
