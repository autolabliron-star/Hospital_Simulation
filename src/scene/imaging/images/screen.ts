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
import { newProbeFrame } from '../phantom/usViews'
import { US_FULL, US_LITE, fanGeometry } from '../render/us'
import type { ImagingBackend } from '../worker/client'
import type { FrameIn } from '../worker/client'
import type { SliceJob, UsJob } from '../worker/protocol'
import { regionsFor, regionsReady } from '../phantom/regions'
import { specKnown } from '../render/spec'
import { probeFrameInto, usProbeContext, type UsProbeContext } from '../machines/motion'
import { probeLive } from '../machines/probeLive'
import { paintUsChrome, paintUsStatus } from './chrome/us'
import { paintCtChrome, type SliceChrome } from './chrome/ct'
import { paintMriChrome } from './chrome/mri'
import { paintXrayChrome } from './chrome/xray'
import type { SliceMeta } from '../render/spec'

export const SCREEN_SIZE = 384
const S = SCREEN_SIZE

const ACCENT: Record<ImagingModality, string> = { mri: '#5aa9ff', ct: '#ff6a5a', xray: '#fff3b0', us: '#7ee0c3' }
const FONT = 'ui-monospace, Menlo, Consolas, monospace'
export const DISCLAIMER = 'Simulated image, not real patient data'

type Mode = 'none' | 'standby' | 'setup' | 'image' | 'us' | 'usLive'

/** Side of the kept scout pictures (the CT topogram, the MR localisers) the inset is drawn from. */
const SCOUT_SIZE = 128
/** Output size of the worker's ultrasound frames: the focused room's and the background's. */
const US_SIZE_FOCUSED = 512
const US_SIZE_BACKGROUND = 384
/** An update interval above this (ms) means a background screen: the lighter preset. */
const BACKGROUND_FROM_MS = 300

/** A short synthetic patient number for the screen's header, from the exam id. */
function patientNumber(id: string): string {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return `ID ${String((h >>> 0) % 9000000 + 1000000)}`
}

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
  // R3: the worker-rendered ultrasound
  private usCtx: UsProbeContext | null = null
  private usCtxExam: ImagingExam | null = null
  private usBitmap: ImageBitmap | null = null
  private usStage: Surface | null = null
  private usHasFrame = false
  private usLastReq = -1e9
  private usLastReqT = -1
  private usN = 0
  private usJobId = 0
  private usContact = 1
  private readonly usFrame = newProbeFrame()
  // R3: the worker-rendered slices (CT, MRI, X-ray)
  private curKey: string | null = null
  private slicePending: string | null = null
  private nextKey: string | null = null
  private nextBitmap: ImageBitmap | null = null
  private nextStage: Surface | null = null
  private stage: Surface | null = null
  private sliceJobId = 0
  private readonly sliceJob: SliceJob = { t: 'slice', slot: '', id: 0, key: '', seed: 0, modality: 'ct', bodyPart: 'abdomen', seq: { name: '', plane: 'axial', contrast: 'none', images: 1 }, k: 0, size: 512 }
  private readonly thumbs = new Map<string, Surface>()
  /** The scanner's words of the slice on screen and of the prefetched one (from the worker), and the scout pictures kept for the inset. */
  private curMeta: SliceMeta | null = null
  private nextMeta: SliceMeta | null = null
  private readonly scouts = new Map<string, Surface>()
  private scoutAsked = ''
  private readonly chrome: SliceChrome = { size: S, patientName: '', patientId: '', protocol: '', series: '', plane: 'axial', image: 1, images: 1, meta: null as unknown as SliceMeta, scout: null }
  private readonly usJob: UsJob = { t: 'us', slot: 'us', id: 0, seed: 0, frame: newProbeFrame(), depth: 140, time: 0, n: 0, lite: false, size: US_SIZE_FOCUSED }

  constructor(
    readonly modality: ImagingModality,
    private readonly env: Env,
    private readonly painter: Painter,
    /** R3: the imaging worker (null: the R1 vector pictures). */
    private readonly backend: ImagingBackend | null = null,
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
    const ex = state.exam
    if (this.backend && this.modality === 'us' && ex && state.sequence >= 0 && (state.phase === 'scanning' || state.phase === 'tableOut' || state.phase === 'cleanup')) {
      // R3: frames come from the worker whenever they are ready; requests follow the rate limit
      const drew = this.updateUsLive(ex, state, simT, nowMs, minInterval)
      if (drew) {
        this.lastDraw = nowMs
        this.onDraw?.()
      }
      return drew
    }
    if (this.backend && this.modality !== 'us' && ex && state.sequence >= 0 && (state.phase === 'scanning' || state.phase === 'tableOut' || state.phase === 'cleanup') && this.phantomSlices(ex)) {
      const drew = this.updateSlicesLive(ex, state, nowMs, minInterval)
      if (drew) {
        this.lastDraw = nowMs
        this.onDraw?.()
      }
      return drew
    }
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

  // --- R3: the worker's slices (CT, MRI, X-ray) --------------------------------------------------------------

  /** Can the worker picture this exam (its regions built and its planner known)? */
  private phantomSlices(exam: ImagingExam): boolean {
    return specKnown(exam.modality, exam.bodyPart) && regionsReady(regionsFor(exam.modality, exam.bodyPart))
  }

  private sendSlice(exam: ImagingExam, si: number, k: number, slot: string): string {
    const seq = exam.sequences[si]
    const j = this.sliceJob
    j.slot = slot
    j.id = ++this.sliceJobId
    j.key = `${exam.id}:${si}:${k}`
    j.seed = exam.imageSeed
    j.modality = exam.modality
    j.bodyPart = exam.bodyPart
    j.seq = { name: seq.name, plane: seq.plane, contrast: seq.contrast, images: seq.images }
    j.k = k
    j.size = 512
    this.backend!.send(j)
    return j.key
  }

  /** The next picture after slice k of step si (the next slice, or the first of the next step), or null at the end. */
  private nextOf(exam: ImagingExam, si: number, k: number): [number, number] | null {
    if (k + 1 < exam.sequences[si].images) return [si, k + 1]
    if (si + 1 < exam.sequences.length) return [si + 1, 0]
    return null
  }

  /** Draw a worker frame (bitmap or raw pixels) into a surface, scaled to it. */
  private blitFrame(f: FrameIn, into: Surface, stage: 'stage' | 'nextStage'): ImageBitmap | null {
    const c = into.ctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
    if (f.bitmap) {
      c.drawImage(f.bitmap, 0, 0, f.w, f.h, 0, 0, S, S)
      return f.bitmap
    }
    if (f.rgba) {
      let st = this[stage]
      if (!st || st.canvas.width !== f.w) {
        st = this.env.createSurface(f.w, f.h)
        this[stage] = st
      }
      const img = st.ctx.createImageData(f.w, f.h)
      img?.data?.set?.(f.rgba)
      st.ctx.putImageData(img, 0, 0)
      c.drawImage(st.canvas, 0, 0, f.w, f.h, 0, 0, S, S)
    }
    return null
  }

  private updateSlicesLive(exam: ImagingExam, state: ScannerState, nowMs: number, minInterval: number): boolean {
    const backend = this.backend!
    const m = this.modality
    const done = state.phase !== 'scanning'
    const seqIndex = Math.max(0, Math.min(exam.sequences.length - 1, state.sequence))
    const seq = exam.sequences[seqIndex]
    const { index, frac } = sliceAt(seq.images, done ? 1 : state.progress)
    const reveal = done ? 1 : frac
    const key = `${exam.id}:${seqIndex}:${index}`
    let arrived = false
    if (this.exam !== exam || this.mode !== 'image') {
      this.resetSeries()
      this.curKey = null
      this.slicePending = null
      this.curMeta = null
      this.nextMeta = null
      this.exam = exam
      this.mode = 'image'
    }
    // a new slice: the current one becomes the previous; take it from the prefetch or ask the worker
    if (key !== this.curKey && key !== this.slicePending) {
      if (this.curValid) {
        const p = this.prev.ctx
        p.setTransform(1, 0, 0, 1, 0, 0)
        p.globalCompositeOperation = 'source-over'
        p.globalAlpha = 1
        p.drawImage(this.cur.canvas, 0, 0)
        this.prevValid = true
      }
      this.curValid = false
      this.seq = seqIndex
      this.slice = index
      // until the new slice's words arrive, the series' last ones stand (the position is the only thing that moves)
      if (this.curMeta && this.curKey && !this.curKey.startsWith(`${exam.id}:${seqIndex}:`)) this.curMeta = null
      this.buildSliceOverlay(exam, seqIndex, index)
      if (this.nextKey === key && (this.nextBitmap || this.nextStage)) {
        const c = this.cur.ctx
        c.setTransform(1, 0, 0, 1, 0, 0)
        const src = this.nextBitmap ?? this.nextStage!.canvas
        c.drawImage(src, 0, 0, src.width, src.height, 0, 0, S, S)
        this.curValid = true
        this.curKey = key
        this.nextKey = null
        this.curMeta = this.nextMeta
        this.keepScout(exam, seqIndex, index)
        this.buildSliceOverlay(exam, seqIndex, index)
        arrived = true
        this.prefetch(exam, seqIndex, index)
      } else {
        this.slicePending = this.sendSlice(exam, seqIndex, index, m)
      }
    }
    const f = backend.take(m)
    if (f && f.key === this.slicePending) {
      this.blitFrame(f, this.cur, 'stage')?.close()
      this.curValid = true
      this.curKey = f.key
      this.slicePending = null
      this.curMeta = f.meta.slice ?? null
      this.keepScout(exam, seqIndex, index)
      this.buildSliceOverlay(exam, seqIndex, index)
      arrived = true
      this.prefetch(exam, seqIndex, index)
    } else f?.bitmap?.close()
    const g = backend.take(`${m}:next`)
    if (g) {
      this.nextBitmap?.close()
      this.nextBitmap = g.bitmap ?? null
      if (!g.bitmap && g.rgba) {
        if (!this.nextStage || this.nextStage.canvas.width !== g.w) this.nextStage = this.env.createSurface(g.w, g.h)
        const img = this.nextStage.ctx.createImageData(g.w, g.h)
        img?.data?.set?.(g.rgba)
        this.nextStage.ctx.putImageData(img, 0, 0)
      }
      this.nextKey = g.key
      this.nextMeta = g.meta.slice ?? null
    }
    // the scout picture for the inset: kept when its step ran, else asked for once (a scan joined mid-way)
    const h = backend.take(`${m}:scout`)
    if (h && h.key.startsWith(`${exam.id}:`)) {
      const sc = this.env.createSurface(SCOUT_SIZE, SCOUT_SIZE)
      this.blitInto(h, sc)
      this.scouts.set(h.key, sc)
      if (this.scouts.size > 8) this.scouts.delete(this.scouts.keys().next().value as string)
      this.buildSliceOverlay(exam, seqIndex, index)
      arrived = true
    } else h?.bitmap?.close()
    if (arrived && index === Math.floor(seq.images / 2)) this.keepThumb(exam, seqIndex)
    const fracQ = Math.round(reveal * 20)
    if (!arrived && (nowMs - this.lastDraw < minInterval || (fracQ === this.fracQ && this.phase === state.phase))) return false
    this.fracQ = fracQ
    this.phase = state.phase
    this.composeSlice(exam, reveal)
    return true
  }

  private prefetch(exam: ImagingExam, si: number, k: number): void {
    const nx = this.nextOf(exam, si, k)
    if (nx) this.sendSlice(exam, nx[0], nx[1], `${this.modality}:next`)
  }

  /** The previous slice, the current one revealed down to `reveal`, the scan line and the words. */
  private composeSlice(exam: ImagingExam, reveal: number): void {
    const f = this.final.ctx
    f.setTransform(1, 0, 0, 1, 0, 0)
    f.globalAlpha = 1
    f.globalCompositeOperation = 'source-over'
    f.fillStyle = '#000'
    f.fillRect(0, 0, S, S)
    if (this.prevValid) f.drawImage(this.prev.canvas, 0, 0)
    const y = this.curValid ? Math.round(reveal * S) : 0
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
  }

  /** Keep a small copy of a scout picture (a topogram or a localiser) for the later series' insets. */
  private keepScout(exam: ImagingExam, si: number, k: number): void {
    if (exam.sequences[si].plane !== 'scout' || !this.curValid) return
    const sc = this.env.createSurface(SCOUT_SIZE, SCOUT_SIZE)
    sc.ctx.drawImage(this.cur.canvas, 0, 0, S, S, 0, 0, SCOUT_SIZE, SCOUT_SIZE)
    this.scouts.set(`${exam.id}:0:${k}`, sc)
    if (this.scouts.size > 8) this.scouts.delete(this.scouts.keys().next().value as string)
  }

  /** A worker frame scaled into a surface of any size. */
  private blitInto(f: FrameIn, into: Surface): void {
    const W = into.canvas.width
    const c = into.ctx
    if (f.bitmap) {
      c.drawImage(f.bitmap, 0, 0, f.w, f.h, 0, 0, W, W)
      f.bitmap.close()
    } else if (f.rgba) {
      const st = this.env.createSurface(f.w, f.h)
      const img = st.ctx.createImageData(f.w, f.h)
      img?.data?.set?.(f.rgba)
      st.ctx.putImageData(img, 0, 0)
      c.drawImage(st.canvas, 0, 0, f.w, f.h, 0, 0, W, W)
    }
  }

  /** The words round a worker slice: the modality's scanner chrome once the worker's words for it are in, plain words until then. */
  private buildSliceOverlay(exam: ImagingExam, si: number, k: number): void {
    const seq = exam.sequences[si]
    const meta = this.curMeta
    if (meta) {
      const ch = this.chrome
      ch.patientName = exam.patientName
      ch.patientId = patientNumber(exam.id)
      ch.protocol = exam.protocol
      ch.series = seq.name
      ch.plane = seq.plane
      ch.image = k + 1
      ch.images = seq.images
      ch.meta = meta
      ch.scout = null
      if (meta.insetK >= 0 && exam.sequences[0]?.plane === 'scout') {
        const key = `${exam.id}:0:${meta.insetK}`
        const sc = this.scouts.get(key)
        if (sc) ch.scout = sc.canvas
        else if (this.scoutAsked !== key && this.backend) {
          this.scoutAsked = key
          this.sendSlice(exam, 0, meta.insetK, `${this.modality}:scout`)
        }
      }
      if (exam.modality === 'ct') paintCtChrome(this.overlay.ctx, ch)
      else if (exam.modality === 'mri') paintMriChrome(this.overlay.ctx, { ...ch, bodyPart: exam.bodyPart })
      else paintXrayChrome(this.overlay.ctx, { ...ch, bodyPart: exam.bodyPart })
      return
    }
    const pick = pickImage(exam, si, k)
    const o = this.overlay.ctx
    o.setTransform(1, 0, 0, 1, 0, 0)
    o.clearRect(0, 0, S, S)
    text(o, exam.patientName.toUpperCase(), 8, 14, 'left')
    text(o, exam.protocol, 8, 27, 'left', 9, 'rgba(190,215,218,0.9)', false)
    text(o, seq.name, S - 8, 14, 'right')
    text(o, seq.images > 1 ? `Im ${k + 1}/${seq.images}` : 'Im 1/1', S - 8, 27, 'right', 9, 'rgba(190,215,218,0.9)', false)
    text(o, pick.tag, 8, S - 24, 'left', 11, ACCENT[exam.modality])
    text(o, paramsLine(exam.modality, seq, exam.bodyPart), 8, S - 11, 'left', 9, 'rgba(190,215,218,0.9)', false)
    text(o, DISCLAIMER, S - 8, S - 11, 'right', 8, 'rgba(160,185,188,0.8)', false)
  }

  /** Keep a small copy of a step's middle slice for the viewer's thumbnails. */
  private keepThumb(exam: ImagingExam, si: number): void {
    const t = this.env.createSurface(128, 128)
    t.ctx.drawImage(this.cur.canvas, 0, 0, S, S, 0, 0, 128, 128)
    this.thumbs.set(`${exam.id}:${si}`, t)
    if (this.thumbs.size > 24) this.thumbs.delete(this.thumbs.keys().next().value as string)
  }

  /** A kept thumbnail of a step, if the worker drew it. */
  thumbOf(exam: ImagingExam, si: number): Surface | null {
    return this.thumbs.get(`${exam.id}:${si}`) ?? null
  }

  // --- R3: the worker's ultrasound ----------------------------------------------------------------------

  private updateUsLive(exam: ImagingExam, state: ScannerState, simT: number, nowMs: number, minInterval: number): boolean {
    const backend = this.backend!
    const seqIndex = Math.max(0, Math.min(exam.sequences.length - 1, state.sequence))
    const live = state.phase === 'scanning' && state.activity > 0.3
    if (this.usCtxExam !== exam) {
      this.usCtxExam = exam
      this.usCtx = usProbeContext(exam)
    }
    const ctx = this.usCtx
    const spec = ctx ? ctx.specs[seqIndex] : null
    let drew = false
    if (!(this.mode === 'usLive' && this.exam === exam && this.seq === seqIndex)) {
      this.resetSeries()
      this.exam = exam
      this.seq = seqIndex
      this.mode = 'usLive'
      this.usHasFrame = false
      const lite = minInterval > BACKGROUND_FROM_MS
      const view = ctx ? ctx.views[seqIndex] : 'liver'
      const depth = spec ? spec.depth : 140
      paintUsChrome(this.overlay.ctx, {
        size: S,
        geometry: fanGeometry(lite ? US_LITE : US_FULL, depth, S),
        patientName: exam.patientName,
        patientId: patientNumber(exam.id),
        view,
        focusMm: depth * 0.55,
        freq: (lite ? US_LITE : US_FULL).freq,
        gain: 58,
        dr: (lite ? US_LITE : US_FULL).dr,
        fps: lite ? 1 : 10,
      })
      // until the first frame: the empty screen with its chrome
      this.composeUs(false)
      drew = true
    }
    // ask for the next frame while sweeping (one per interval, and only when the sim moved)
    if (live && ctx && spec && nowMs - this.usLastReq >= minInterval * 0.9 && simT !== this.usLastReqT) {
      let f = this.usFrame
      if (probeLive.active && probeLive.examId === exam.id) f = probeLive.frame
      else probeFrameInto(f, state.phase, state.sequence, state.detail, state.activity, simT, ctx)
      const j = this.usJob
      const lite = minInterval > BACKGROUND_FROM_MS
      j.id = ++this.usJobId
      j.seed = exam.imageSeed
      Object.assign(j.frame, f)
      j.depth = spec.depth
      j.time = simT
      j.n = this.usN++
      j.lite = lite
      j.size = lite ? US_SIZE_BACKGROUND : US_SIZE_FOCUSED
      this.usContact = f.contact
      backend.send(j)
      this.usLastReq = nowMs
      this.usLastReqT = simT
    }
    const frame = backend.take('us')
    if (frame) {
      if (frame.bitmap) {
        this.usBitmap?.close()
        this.usBitmap = frame.bitmap
      } else if (frame.rgba) {
        if (!this.usStage || this.usStage.canvas.width !== frame.w) this.usStage = this.env.createSurface(frame.w, frame.h)
        const img = this.usStage.ctx.createImageData(frame.w, frame.h)
        img?.data?.set?.(frame.rgba)
        this.usStage.ctx.putImageData(img, 0, 0)
        this.usBitmap?.close()
        this.usBitmap = null
      }
      this.usHasFrame = true
      this.frozenDrawn = !live
      const seq = exam.sequences[seqIndex]
      this.composeUs(live, Math.min(seq.images, Math.floor(state.progress * seq.images)), seq.images)
      return true
    }
    if (!live && this.usHasFrame && !this.frozenDrawn) {
      // the sweep ended: the last frame stays up, frozen
      this.frozenDrawn = true
      const seq = exam.sequences[seqIndex]
      this.composeUs(false, seq.images, seq.images)
      return true
    }
    return drew
  }

  /** The last frame scaled onto the screen, the chrome over it and the live words. */
  private composeUs(live: boolean, stored = 0, total = 0): void {
    const c = this.final.ctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = '#000'
    c.fillRect(0, 0, S, S)
    if (this.usHasFrame) {
      const src = this.usBitmap ?? this.usStage?.canvas ?? null
      if (src) c.drawImage(src, 0, 0, src.width, src.height, 0, 0, S, S)
    }
    c.drawImage(this.overlay.canvas, 0, 0)
    paintUsStatus(c, S, live, this.usContact, stored, total)
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
