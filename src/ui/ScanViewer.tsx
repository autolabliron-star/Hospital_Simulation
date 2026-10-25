/**
 * The Scan viewer: the room panel's body for the MRI, CT, X-ray and ultrasound rooms (and their control rooms).
 *
 * The big picture is the machines agent's live canvas for this scanner: the very element that is also the 3D monitor's
 * texture. It is mounted here while the viewer is open and taken out again when it closes; no pixels are copied.
 * Everything else is text and numbers read from the sim at 4 Hz.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudio } from '@/audio/audio.store'
import { IMAGING_UI } from '@/content/imagingUi'
import { sim } from '@/sim'
import { DEMO_PROCEDURES } from '@/sim/imaging/department'
import type { ImagingModality } from '@/sim/types'
import { loadImagingScene, type ImagingScene } from './imagingApi'
import { imagingOf, scannerView, type ScannerView } from './roomSnapshot'
import { usePoll } from './usePoll'

/** Edge of the series thumbnails in pixels (drawn once per finished step). */
const THUMB_PX = 112

interface ViewerSnap {
  view: ScannerView | null
  title: string
  line: string
  /** F-06: nobody is on duty to run this scanner (MRI and ultrasound after 18:00): "Start a scan now" cannot work. */
  noOperator: boolean
}

/** Does the sim know of nobody on duty for this scanner? Unknown (an older sim without the question) counts as "somebody". */
function hasNoOperator(img: object, m: ImagingModality): boolean {
  const q = (img as { hasOperator?: (m: ImagingModality) => boolean }).hasOperator
  return typeof q === 'function' ? !q.call(img, m) : false
}

/** The machines & images module: undefined while loading, null if it is not part of this build. */
function useImagingScene(): ImagingScene | null | undefined {
  const [scene, setScene] = useState<ImagingScene | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void loadImagingScene().then((s) => {
      if (live) setScene(s)
    })
    return () => {
      live = false
    }
  }, [])
  return scene
}

// ---------------------------------------------------------------------------------------------
// The live image
// ---------------------------------------------------------------------------------------------

function LiveImage({ scene, modality, label }: { scene: ImagingScene | null | undefined; modality: ImagingModality; label: string }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el || !scene) return
    let canvas: HTMLCanvasElement
    try {
      canvas = scene.getScanCanvas(modality)
    } catch {
      return
    }
    const previous = canvas.style.cssText
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.objectFit = 'contain'
    canvas.style.display = 'block'
    el.appendChild(canvas)
    return () => {
      if (canvas.parentElement === el) el.removeChild(canvas) // give it back: the 3D monitor keeps using it
      canvas.style.cssText = previous
    }
  }, [scene, modality])

  return (
    <div className="sv-image" role="img" aria-label={label}>
      <div className="sv-image__host" ref={host} />
      {!scene && (
        <p className="sv-image__empty">{scene === undefined ? 'Loading the scan image…' : 'The live scan image appears here when imaging is ready.'}</p>
      )}
      {/* the "Simulated image, not real patient data" label is drawn into the canvas itself, so the 3D monitors carry it too */}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Series thumbnails
// ---------------------------------------------------------------------------------------------

/** One tile per step: a picture once the step is finished, a pulse while it runs, a dim tile before. */
function Series({ scene, modality, view }: { scene: ImagingScene | null | undefined; modality: ImagingModality; view: ScannerView }) {
  const cache = useRef(new Map<string, string>())
  const [, bump] = useState(0)
  const doneKey = view.completed.join(',')

  useEffect(() => {
    if (!scene || !view.examId) return
    const exam = imagingOf(sim)?.scanners[modality].exam
    if (!exam || exam.id !== view.examId) return
    let added = false
    for (const i of view.completed) {
      const key = `${exam.id}:${i}`
      if (cache.current.has(key)) continue
      try {
        cache.current.set(key, scene.renderThumbnail(exam, i, THUMB_PX).toDataURL('image/png'))
        added = true
      } catch {
        // a step without a picture just shows its name
      }
    }
    for (const key of [...cache.current.keys()]) if (!key.startsWith(`${exam.id}:`)) cache.current.delete(key) // earlier patients
    if (added) bump((n) => n + 1)
  }, [scene, modality, view.examId, doneKey])

  if (view.steps === 0) return <p className="sv-muted">Series appear here as each step finishes.</p>
  return (
    <ul className="sv-series" aria-label="Series of this exam">
      {view.stepNames.map((name, i) => {
        const done = view.completed.includes(i)
        const current = !done && view.phase === 'scanning' && view.step === i + 1
        const url = done && view.examId ? cache.current.get(`${view.examId}:${i}`) : undefined
        return (
          <li key={`${view.examId}:${i}`} className="sv-series__item" data-state={done ? 'done' : current ? 'current' : 'todo'}>
            <span className="sv-series__tile">
              {url ? <img src={url} alt={`Finished: ${name}`} width={THUMB_PX} height={THUMB_PX} /> : <span className="sv-series__num" aria-hidden="true">{i + 1}</span>}
            </span>
            <span className="sv-series__name">
              {name}
              <span className="sr-only">{done ? ', finished' : current ? ', scanning now' : ', not started'}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------
// The device card (a cryoablation: docs/research/cryoablation.md)
// ---------------------------------------------------------------------------------------------

/** What the machine is and what it is authorized for, in three short lines; the patient is synthetic. */
export function CryoCard() {
  const c = IMAGING_UI.cryoCard
  return (
    <section className="sv-device" aria-label={`${c.label}: ${c.title}`}>
      <h3 className="hud-field__label">{c.label}</h3>
      <p className="sv-device__title">
        {c.title} <span className="hud-chip">{c.synthetic}</span>
      </p>
      <p className="sv-device__line">{c.what}</p>
      <p className="sv-device__line sv-device__status">{c.status}</p>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Sound toggle
// ---------------------------------------------------------------------------------------------

function SoundToggle() {
  const muted = useAudio((s) => s.muted)
  const setMuted = useAudio((s) => s.setMuted)
  return (
    <button type="button" className="sv-sound" aria-pressed={!muted} title={muted ? 'Turn scanner sounds on (M)' : 'Mute scanner sounds (M)'} onClick={() => setMuted(!muted)}>
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path d="M2 6h2.6L8 3v10L4.6 10H2z" fill="currentColor" />
        {muted ? (
          <path d="M10.5 6l3.5 4M14 6l-3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        ) : (
          <path d="M10.4 5.6a3.6 3.6 0 010 4.8M12.2 3.8a6.2 6.2 0 010 8.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        )}
      </svg>
      <span>{muted ? 'Sound off' : 'Sound on'}</span>
      <kbd className="hud-kbd">M</kbd>
    </button>
  )
}

// ---------------------------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------------------------

/** The ultrasound room's procedure demo: the ProSense cryoablation (docs/research/cryoablation.md). */
const CRYO_DEMO = DEMO_PROCEDURES.us?.[0]

export function ScanViewer({ modality }: { modality: ImagingModality }) {
  const scene = useImagingScene()
  const read = useCallback((): ViewerSnap => {
    const img = imagingOf(sim)
    if (!img) return { view: null, title: '', line: '', noOperator: false }
    const view = scannerView(img, modality, sim.t)
    let caption = { title: '', line: '' }
    if (scene) {
      try {
        caption = scene.scanCaption(img.scanners[modality])
      } catch {
        // fall back to the protocol name below
      }
    }
    return { view, title: caption.title, line: caption.line, noOperator: hasNoOperator(img, modality) }
  }, [modality, scene])
  const { view, title, line, noOperator } = usePoll(read)

  // "Start a scan now" was pressed and the patient has not reached the scanner yet.
  const [asked, setAsked] = useState(false)
  const busy = view?.busy ?? false
  useEffect(() => {
    if (busy) setAsked(false)
  }, [busy])
  useEffect(() => {
    // nobody on duty: whatever was asked is not coming
    if (noOperator) setAsked(false)
  }, [noOperator])

  const start = (protocolId?: string) => {
    try {
      // F-06: the sim refuses (false) when nobody is on duty; then nobody is booked and nobody walks to the hall
      const img = imagingOf(sim)
      const result = img?.startDemoScan(modality, protocolId) as unknown
      if (result !== false) setAsked(true)
    } catch {
      // the sim refused (nothing to do); the button stays available
    }
  }

  const name = view?.modalityName ?? modality
  const headline = title || view?.protocol || `${name} scanner`
  const waitingForPatient = !noOperator && !busy && (asked || (view?.demoPending ?? false))
  const staffTitle = modality === 'us' ? 'sonographer' : 'radiographer'

  return (
    <div className="sv" role="region" aria-label={`Scan viewer: ${name}`}>
      <LiveImage scene={scene} modality={modality} label={`Live simulated ${name} image`} />

      {!view ? (
        <p className="sv-muted" role="status">
          Imaging is starting up.
        </p>
      ) : (
        <>
          <div className="sv-caption">
            <span className="sv-caption__title">{headline}</span>
            {line && <span className="sv-caption__line">{line}</span>}
          </div>

          <p className="sv-phase" aria-live="polite" data-phase={view.phase}>
            <span className="sv-phase__dot" aria-hidden="true" />
            {view.phaseText}
          </p>

          <div className="sv-progress">
            <div className="sv-progress__row">
              <span>{view.steps > 0 ? `Step ${view.step} / ${view.steps}` : 'No exam running'}</span>
              <span>{view.remainingText ? `${view.remainingText} left` : ''}</span>
            </div>
            <div className="sv-bar" role="progressbar" aria-label="Progress of the current step" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}>
              <span className="sv-bar__fill" style={{ width: `${view.percent}%` }} />
            </div>
          </div>

          <dl className="sv-facts">
            <div className="sv-facts__row">
              <dt>Patient</dt>
              <dd>
                {view.patientName ? (
                  <>
                    {view.patientName} <span className="hud-chip">{view.sourceText}</span>
                  </>
                ) : (
                  <span className="sv-muted">No patient on the table</span>
                )}
              </dd>
            </div>
            <div className="sv-facts__row">
              <dt>{modality === 'us' ? 'Sonographer' : 'Radiographer'}</dt>
              <dd>{view.operatorName ?? <span className="sv-muted">Not at the console</span>}</dd>
            </div>
          </dl>

          {view.cryo && <CryoCard />}

          <section className="sv-section" aria-label="Series">
            <h3 className="hud-field__label">Series</h3>
            <Series scene={scene} modality={modality} view={view} />
          </section>

          <div className="sv-actions">
            <button type="button" className="hud-send sv-start" disabled={busy || waitingForPatient || noOperator} aria-describedby="sv-queue" onClick={() => start()}>
              {waitingForPatient ? 'Patient on the way…' : 'Start a scan now'}
            </button>
            {modality === 'us' && CRYO_DEMO && !waitingForPatient && (
              <button type="button" className="hud-send sv-start" disabled={busy || noOperator} onClick={() => start(CRYO_DEMO)}>
                {IMAGING_UI.cryoCard.start}
              </button>
            )}
            {noOperator && (
              <p className="sv-queue sv-queue--closed" role="status">
                No {staffTitle} on duty: the {name} is closed until the day team is back.
              </p>
            )}
            <p className="sv-queue" id="sv-queue">
              <span className="sv-queue__label">{view.queueLabel}:</span> {view.queueText}
            </p>
          </div>
        </>
      )}

      <SoundToggle />
    </div>
  )
}
