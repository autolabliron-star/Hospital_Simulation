/**
 * The "Record" tab of the bedside tablet: the patient banner (with the allergy badge), then Summary (alerts, latest observations with trends,
 * problems, medicines with their next dose, pending results, today's plan), This stay (the timeline, newest first, with filters) and History
 * (allergies, past conditions and procedures, home medicines, social, immunisations).
 *
 * `RecordBody` reads the sim at the tablet's 4 Hz poll, and only while it is mounted (the tablet open on this tab); `RecordBodyView` is the pure
 * markup of a view model (src/ui/rx/record/recordView.ts), so node tests render it with react-dom/server. No keys of its own: the section and
 * filter buttons are ordinary buttons (Tab and Enter), Esc and P close the tablet as before.
 */
import { useCallback, useState } from 'react'
import { RECORD_UI } from '@/content/patientHistory'
import { sim } from '@/sim'
import { recordForRoom } from '@/sim/records/record'
import { usePoll } from '../../usePoll'
import { recordView, type RecordFilter, type RecordSection, type RecordView, type Tone } from './recordView'
import './record.css'

const blurAfter = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur()

function Heading({ children }: { children: string }) {
  return <h4 className="rec-h">{children}</h4>
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="rec-none">{empty}</p>
  return (
    <ul className="rec-list">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  )
}

function Banner({ view }: { view: RecordView }) {
  const b = view.banner!
  return (
    <header className="rec-banner">
      <div className="rec-banner__top">
        <span className="rec-banner__name">{b.name}</span>
        <span className="rec-banner__age">{b.ageSex}</span>
      </div>
      <div className="rec-banner__ids">
        <span title={b.mrnLabel}>{b.mrn}</span>
        <span>{b.location}</span>
        <span>{b.stay}</span>
      </div>
      <div className="rec-banner__line">{b.admitted}</div>
      <div className="rec-banner__line">{b.team}</div>
      <dl className="rec-banner__facts">
        <div data-review={b.code.review}>
          <dt>{b.code.label}</dt>
          <dd>{b.code.value}</dd>
        </div>
        <div data-on={b.isolation.on}>
          <dt>{b.isolation.label}</dt>
          <dd>{b.isolation.value}</dd>
        </div>
        {b.body && (
          <div>
            <dt>{b.bodyLabel}</dt>
            <dd>{b.body}</dd>
          </div>
        )}
      </dl>
      <div className="rec-allergy" data-on={b.allergy.on} role={b.allergy.on ? 'note' : undefined}>
        <span className="rec-allergy__title">{b.allergy.title}</span>
        {b.allergy.items.length > 0 && <span className="rec-allergy__items">{b.allergy.items.join(' · ')}</span>}
      </div>
    </header>
  )
}

function Summary({ view }: { view: RecordView }) {
  const h = view.headings
  return (
    <div className="rec-summary">
      {view.alerts.length > 0 && (
        <section>
          <Heading>{h.alerts}</Heading>
          <ul className="rec-alerts">
            {view.alerts.map((a, i) => (
              <li key={i} data-tone={a.tone}>
                {a.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <Heading>{h.obs}</Heading>
        {view.obs ? (
          <>
            <p className="rec-obs__when">
              {view.obs.when}
              <span className="rec-news" data-tone={view.obs.news2.tone} title={view.obs.news2.note}>
                {view.obs.news2.text}
                <small> · {view.obs.news2.note}</small>
              </span>
            </p>
            {view.obs.news2.partial && <p className="rec-obs__partial">{view.obs.news2.partial}</p>}
            <ul className="rec-vitals">
              {view.obs.vitals.map((v) => (
                <li key={v.id} data-tone={v.tone}>
                  <span className="rec-vital__label">{v.label}</span>
                  <span className="rec-vital__value">
                    {v.value}
                    {v.unit && <small> {v.unit}</small>}
                    {v.trend && <span className="rec-vital__trend"> {v.trend}</span>}
                  </span>
                  {v.spark ? (
                    <svg className="rec-spark" viewBox="0 0 60 18" width="60" height="18" aria-hidden="true">
                      <polyline points={v.spark} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <span className="rec-spark" />
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="rec-none">{view.noObs}</p>
        )}
      </section>
      <section>
        <Heading>{h.problems}</Heading>
        <List items={view.problems} empty={view.nothing} />
      </section>
      <section>
        <Heading>{h.meds}</Heading>
        {view.meds.length === 0 ? (
          <p className="rec-none">{view.nothing}</p>
        ) : (
          <ul className="rec-meds">
            {view.meds.map((m, i) => (
              <li key={i} data-tone={m.tone}>
                <span className="rec-med__name">
                  {m.name} <small>{m.strength}</small>
                  {m.badge && <span className="rec-badge">{m.badge}</span>}
                </span>
                <span className="rec-med__next">{m.next}</span>
                <span className="rec-med__plan">{m.plan}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <Heading>{h.pending}</Heading>
        <List items={view.pending} empty={view.nothing} />
      </section>
      <section>
        <Heading>{h.plan}</Heading>
        <List items={view.plan} empty={view.nothing} />
      </section>
    </div>
  )
}

function Stay({ view, onFilter }: { view: RecordView; onFilter: (f: RecordFilter) => void }) {
  let lastDay = ''
  return (
    <div className="rec-stay">
      <div className="rec-filters" role="group" aria-label={RECORD_UI.filtersLabel as string}>
        {view.filters.map((f) => (
          <button
            key={f.id}
            type="button"
            className="rec-chip"
            aria-pressed={view.filter === f.id}
            disabled={f.count === 0 && f.id !== 'all'}
            onClick={(e) => {
              onFilter(f.id)
              blurAfter(e)
            }}
          >
            {f.label} <span className="rec-chip__n">{f.count}</span>
          </button>
        ))}
      </div>
      {view.gap && <p className="rec-gap">{view.gap}</p>}
      {view.entries.length === 0 ? (
        <p className="rec-none">{view.noEntries}</p>
      ) : (
        <ol className="rec-timeline">
          {view.entries.map((e) => {
            const head = e.day !== lastDay ? e.day : null
            lastDay = e.day
            return (
              <li key={e.key} data-kind={e.kind} data-flag={e.flag ?? undefined}>
                {head && <div className="rec-day">{head}</div>}
                <div className="rec-entry">
                  <span className="rec-entry__time">{e.time}</span>
                  <span className="rec-entry__kind">{e.kindLabel}</span>
                  <span className="rec-entry__text">
                    {e.text}
                    {e.by && <span className="rec-entry__by"> · {e.by}</span>}
                    {e.detail && <span className="rec-entry__detail">{e.detail}</span>}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function Rows({ rows, empty }: { rows: { a: string; b: string; tone?: Tone }[]; empty: string }) {
  if (rows.length === 0) return <p className="rec-none">{empty}</p>
  return (
    <ul className="rec-rows">
      {rows.map((r, i) => (
        <li key={i} data-tone={r.tone}>
          <span>{r.a}</span>
          <span className="rec-rows__b">{r.b}</span>
        </li>
      ))}
    </ul>
  )
}

function History({ view }: { view: RecordView }) {
  const h = view.history!
  const H = view.headings
  return (
    <div className="rec-history">
      <section>
        <Heading>{H.allergyDetail}</Heading>
        <Rows rows={h.allergies.map((a) => ({ a: a.text, b: a.detail, tone: a.tone }))} empty={view.banner?.allergy.title ?? view.nothing} />
      </section>
      <section>
        <Heading>{H.pmh}</Heading>
        <Rows rows={h.pmh.map((c) => ({ a: c.name, b: c.since }))} empty={view.nothing} />
      </section>
      <section>
        <Heading>{H.psh}</Heading>
        <Rows rows={h.psh.map((p) => ({ a: p.name, b: p.year }))} empty={view.nothing} />
      </section>
      <section>
        <Heading>{H.homeMeds}</Heading>
        <Rows rows={h.homeMeds.map((m) => ({ a: m.name, b: m.detail, tone: m.tone }))} empty={view.nothing} />
      </section>
      <section>
        <Heading>{H.social}</Heading>
        <Rows rows={h.social.map((s) => ({ a: s.label, b: s.value }))} empty={view.nothing} />
      </section>
      <section>
        <Heading>{H.immunisations}</Heading>
        <Rows rows={h.immunisations.map((i) => ({ a: i.name, b: i.status }))} empty={view.nothing} />
      </section>
    </div>
  )
}

export interface RecordBodyViewProps {
  view: RecordView
  section: RecordSection
  onSection: (s: RecordSection) => void
  onFilter: (f: RecordFilter) => void
}

/** The record as markup, from its view model (no sim, no store). */
export function RecordBodyView({ view, section, onSection, onFilter }: RecordBodyViewProps) {
  if (view.empty !== null) {
    return (
      <div className="rec">
        <p className="rec-none">{view.empty}</p>
      </div>
    )
  }
  return (
    <div className="rec" data-section={section}>
      <Banner view={view} />
      <div className="rec-sections" role="group" aria-label={RECORD_UI.sectionsLabel as string}>
        {view.sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className="rec-section-btn"
            aria-pressed={section === s.id}
            onClick={(e) => {
              onSection(s.id)
              blurAfter(e)
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="rec-scroll">
        {section === 'summary' && <Summary view={view} />}
        {section === 'stay' && <Stay view={view} onFilter={onFilter} />}
        {section === 'history' && <History view={view} />}
        <p className="rec-synthetic">{view.syntheticNote}</p>
      </div>
    </div>
  )
}

/** The live record of the patient in `roomId`, re-read at about 4 Hz while it is on screen. */
export function RecordBody({ roomId }: { roomId: string }) {
  const [section, setSection] = useState<RecordSection>('summary')
  const [filter, setFilter] = useState<RecordFilter>('all')
  const view = usePoll(useCallback(() => recordView(recordForRoom(sim, roomId), filter), [roomId, filter]))
  return <RecordBodyView view={view} section={section} onSection={setSection} onFilter={setFilter} />
}
