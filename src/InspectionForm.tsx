// Inspector's on-site data-entry screen for the detailed Your Real Name report.
// Replaces the old 12-row pass/warn/fail screen. Everything the buyer later sees
// (score, verdict, roadworthy pass/fail, area findings) is derived from the data entered here.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import * as Data from './lib/data'
import ReportView, { type ReportViewProps } from './ReportView'
import {
  CHECKLIST, TEST_POSITIONS, TYRE_POSITIONS, evaluate, testResult,
  type Condition, type Measurement, type ReportItem, type Tyre,
} from './lib/reportTemplate'
import { deriveFindings, scoreFromFindings } from './lib/reportMapping'

// ---- palette: mirrors C in LemonCheckApp.tsx ----
const C = {
  bg: 'var(--bg)', s1: 'var(--s1)', s2: 'var(--s2)', s3: 'var(--s3)',
  t: 'var(--t)', t2: 'var(--t2)', t3: 'var(--t3)',
  lime: 'var(--ink)', limeDim2: 'var(--ink-dim2)',
  green: 'var(--green)', greenDim: 'var(--green-dim)',
  red: 'var(--red)', redDim: 'var(--red-dim)',
  amber: 'var(--amber)', amberDim: 'var(--amber-dim)',
}

export interface InspectionJob {
  id: string; vin: string; make: string; model: string; year: number
  customer: string; location: string; date: string; pay: number; notes?: string
}
export interface InspectionFormProps {
  job: InspectionJob | undefined
  nav: (screen: string) => void
  showToast: (message: string, isError?: boolean) => void
  onSubmitted: () => void
}

// ---- form state ----
interface TyreForm { size: string; load_speed: string; make: string; model: string; tyre_type: string; tread: string }
interface TestForm { right: string; left: string }
interface Draft {
  odometer: string
  conds: Record<string, Condition>
  notes: Record<string, string>
  tests: Record<string, TestForm>
  tyres: Record<string, TyreForm>
}
const emptyDraft = (): Draft => ({ odometer: '', conds: {}, notes: {}, tests: {}, tyres: {} })
const emptyTyre = (): TyreForm => ({ size: '', load_speed: '', make: '', model: '', tyre_type: '', tread: '' })

const rk = (section: string, component: string) => `${section}.${component}`
const TOTAL_ITEMS = CHECKLIST.reduce((n, s) => n + s.rows.length, 0)
const MAIN_TYRES = TYRE_POSITIONS.filter(p => p !== 'Spare')
const TYRE_TYPES = ['Summer', 'All-season', 'All-terrain', 'Run-flat', 'Winter']
const PHOTO_SECTIONS: [string, string][] = [
  ['overview', 'Overview'], ...CHECKLIST.map(s => [s.key, s.title] as [string, string]), ['tyres', 'Tyres'],
]

/** Accepts "12 345", "2,5" (South African decimal comma) and "2.5". Returns null for blank/invalid. */
function toNum(s: string | undefined): number | null {
  if (s == null) return null
  const t = s.replace(/\s/g, '').replace(',', '.')
  if (t === '' || t === '-' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const draftKey = (id: string) => `lc-draft-${id}`
function loadDraft(id: string): Draft {
  try {
    const raw = localStorage.getItem(draftKey(id))
    if (raw) return { ...emptyDraft(), ...(JSON.parse(raw) as Partial<Draft>) }
  } catch { /* blocked or corrupt storage: start fresh */ }
  return emptyDraft()
}

/** Shrinks a camera photo before upload: max 1600px, JPEG. Keeps mobile-data use sensible. */
async function shrink(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', quality))
}

interface PhotoEntry { id: string; blob: Blob; url: string }

// ---- small UI pieces ----
const card: CSSProperties = { background: C.s1, borderRadius: 'var(--rl)', border: '1px solid var(--b)', overflow: 'hidden', marginBottom: 10 }
const inputStyle: CSSProperties = { fontSize: 'var(--fs-caption)', borderRadius: 8, background: C.s3, border: '1px solid var(--b)', padding: '9px 10px', width: '100%', color: C.t }
const caption: CSSProperties = { fontSize: 'var(--fs-caption)', color: C.t3 }

const COND_STYLE: Record<Condition, { c: string; bg: string; short: string }> = {
  good: { c: C.green, bg: C.greenDim, short: 'Good' },
  as_expected: { c: C.green, bg: 'rgba(50,215,75,.07)', short: 'Expected' },
  fair: { c: C.amber, bg: C.amberDim, short: 'Fair' },
  poor: { c: C.red, bg: C.redDim, short: 'Poor' },
  na: { c: C.t2, bg: C.s3, short: 'N/A' },
}
const COND_ORDER: Condition[] = ['good', 'as_expected', 'fair', 'poor', 'na']

function Accordion(p: { title: string; meta?: string; metaColor?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div style={card}>
      <button type="button" onClick={p.onToggle} aria-expanded={p.open}
        style={{ width: '100%', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', color: C.t, textAlign: 'left' }}>
        <span style={{ fontWeight: 700, fontSize: 'var(--fs-body)', letterSpacing: '-.01em' }}>{p.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {p.meta && <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: p.metaColor ?? C.t3 }}>{p.meta}</span>}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: p.open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </button>
      {p.open && <div style={{ borderTop: '1px solid var(--b)', background: C.s2 }}>{p.children}</div>}
    </div>
  )
}

interface ItemRowProps {
  k: string; label: string; rw: boolean; cond: Condition | undefined; note: string
  onCond: (k: string, c: Condition) => void; onNote: (k: string, v: string) => void
}
const ItemRow = memo(function ItemRow({ k, label, rw, cond, note, onCond, onNote }: ItemRowProps) {
  const needsNote = cond === 'fair' || cond === 'poor'
  return (
    <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--b)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {rw && <span title="Affects the roadworthy verdict" aria-label="Roadworthy item" style={{ width: 6, height: 6, borderRadius: 3, background: C.amber, flexShrink: 0 }} />}
        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: cond ? C.t : C.t2 }}>{label}</span>
      </div>
      <div role="group" aria-label={label} style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5 }}>
        {COND_ORDER.map(c => {
          const sel = cond === c, st = COND_STYLE[c]
          return (
            <button key={c} type="button" aria-pressed={sel} onClick={() => onCond(k, c)}
              style={{ background: sel ? st.bg : C.s3, border: `1px solid ${sel ? st.c : 'var(--b)'}`, color: sel ? st.c : C.t3, borderRadius: 7, padding: '8px 0', fontSize: 11, fontWeight: 700 }}>
              {st.short}
            </button>
          )
        })}
      </div>
      {needsNote && (
        <input aria-label={`Note for ${label}`} placeholder={cond === 'poor' ? 'What is wrong? (required)' : 'Note (optional)'}
          value={note} onChange={e => onNote(k, e.target.value)}
          style={{ ...inputStyle, marginTop: 8, borderColor: cond === 'poor' && !note.trim() ? C.red : undefined }} />
      )}
    </div>
  )
})

function Field(p: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; numeric?: boolean; invalid?: boolean }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ ...caption, display: 'block', marginBottom: 4 }}>{p.label}</span>
      <input value={p.value} onChange={e => p.onChange(e.target.value)} placeholder={p.placeholder}
        inputMode={p.numeric ? 'decimal' : undefined} autoCapitalize="characters" autoComplete="off"
        style={{ ...inputStyle, borderColor: p.invalid ? C.red : undefined }} />
    </label>
  )
}

function PhotoPicker(p: { title: string; entries: PhotoEntry[]; busy: boolean; onAdd: (files: FileList) => void; onRemove: (id: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div style={{ padding: '10px 16px 12px', borderBottom: '1px solid var(--b)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: p.entries.length ? 8 : 0 }}>
        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: C.t2 }}>{p.title} · {p.entries.length}</span>
        <button type="button" disabled={p.busy} onClick={() => ref.current?.click()}
          style={{ background: C.s3, border: '1px solid var(--b)', color: C.t, borderRadius: 8, padding: '7px 12px', fontSize: 11, fontWeight: 700 }}>
          Add photo
        </button>
        <input ref={ref} type="file" accept="image/*" multiple hidden
          onChange={e => { if (e.target.files?.length) p.onAdd(e.target.files); e.target.value = '' }} />
      </div>
      {p.entries.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
          {p.entries.map(en => (
            <div key={en.id} style={{ position: 'relative', aspectRatio: '1' }}>
              <img src={en.url} alt={`${p.title} photo`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
              <button type="button" aria-label="Remove photo" onClick={() => p.onRemove(en.id)}
                style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, background: 'rgba(0,0,0,.7)', color: '#fff', fontSize: 12, lineHeight: '20px', padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- main screen ----
type Phase = 'form' | 'saving' | 'done'

export default function InspectionForm({ job, nav, showToast, onSubmitted }: InspectionFormProps) {
  const jobId = job?.id ?? 'none'
  const [draft, setDraft] = useState<Draft>(() => loadDraft(jobId))
  const [open, setOpen] = useState<string | null>(CHECKLIST[0].key)
  const [phase, setPhase] = useState<Phase>('form')
  const [photos, setPhotos] = useState<Record<string, PhotoEntry[]>>({})
  const [photoBusy, setPhotoBusy] = useState(false)
  const [result, setResult] = useState<Data.SubmittedReport | null>(null)
  const [failedPhotos, setFailedPhotos] = useState<Data.PhotoUpload[]>([])
  const [photoStatus, setPhotoStatus] = useState<'idle' | 'uploading'>('idle')
  const [view, setView] = useState<ReportViewProps | null>(null)
  const [loadingView, setLoadingView] = useState(false)
  const photosRef = useRef(photos)
  photosRef.current = photos

  // Autosave so a dropped connection or a closed tab never loses an hour of work.
  useEffect(() => {
    if (phase !== 'form') return
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey(jobId), JSON.stringify(draft)) } catch { /* storage full or blocked */ }
    }, 500)
    return () => clearTimeout(t)
  }, [draft, jobId, phase])

  // Release photo object URLs on leave.
  useEffect(() => () => { Object.values(photosRef.current).flat().forEach(e => URL.revokeObjectURL(e.url)) }, [])

  const setCond = useCallback((k: string, c: Condition) => setDraft(d => ({ ...d, conds: { ...d.conds, [k]: c } })), [])
  const setNote = useCallback((k: string, v: string) => setDraft(d => ({ ...d, notes: { ...d.notes, [k]: v } })), [])
  const setTest = (k: string, f: Partial<TestForm>) =>
    setDraft(d => ({ ...d, tests: { ...d.tests, [k]: { ...(d.tests[k] as TestForm | undefined ?? { right: '', left: '' }), ...f } } }))
  const setTyre = (pos: string, f: Partial<TyreForm>) =>
    setDraft(d => ({ ...d, tyres: { ...d.tyres, [pos]: { ...emptyTyre(), ...d.tyres[pos], ...f } } }))
  const markRestGood = (sectionKey: string) => setDraft(d => {
    const next = { ...d.conds }
    CHECKLIST.find(s => s.key === sectionKey)?.rows.forEach(([key]) => { if (!next[rk(sectionKey, key)]) next[rk(sectionKey, key)] = 'good' })
    return { ...d, conds: next }
  })

  // ---- derived data ----
  const items: ReportItem[] = useMemo(() => CHECKLIST.flatMap(s => s.rows.flatMap(([key, , rw]) => {
    const c = draft.conds[rk(s.key, key)]
    return c ? [{ section: s.key, component: key, condition: c, explanation: (draft.notes[rk(s.key, key)] ?? '').trim(), roadworthy_relevant: !!rw }] : []
  })), [draft.conds, draft.notes])

  const measurements: Measurement[] = useMemo(() => {
    const out: Measurement[] = []
    for (const test of ['brake', 'shock', 'slip'] as const) {
      for (const position of TEST_POSITIONS[test]) {
        const t = draft.tests[`${test}.${position}`]
        if (!t) continue
        const right = toNum(t.right)
        const left = test === 'slip' ? null : toNum(t.left)
        if (right === null || (test !== 'slip' && left === null)) continue
        const { diff_pct, result: res } = testResult(test, right, left ?? 0)
        out.push({ test, position, right_value: right, left_value: left, diff_pct, result: res })
      }
    }
    return out
  }, [draft.tests])

  const tyres: Tyre[] = useMemo(() => TYRE_POSITIONS.flatMap(position => {
    const t = draft.tyres[position]
    if (!t) return []
    const any = Object.values(t).some(v => v.trim() !== '')
    if (!any) return []
    return [{ position, size: t.size.trim(), load_speed: t.load_speed.trim(), make: t.make.trim(), model: t.model.trim(), tyre_type: t.tyre_type, tread_mm: toNum(t.tread) }]
  }), [draft.tyres])

  const verdict = useMemo(() => evaluate(items, measurements, tyres), [items, measurements, tyres])
  const unset = TOTAL_ITEMS - items.length
  const score = useMemo(() => (unset === 0 ? scoreFromFindings(deriveFindings(items, measurements, tyres)) : null), [unset, items, measurements, tyres])

  const issues = useMemo(() => {
    const out: string[] = []
    const od = toNum(draft.odometer)
    if (od === null || od < 0 || !Number.isInteger(od)) out.push('Enter the odometer reading (whole km)')
    if (unset > 0) out.push(`${unset} checklist item${unset === 1 ? '' : 's'} not checked yet`)
    const noNote = items.filter(i => i.condition === 'poor' && !i.explanation).length
    if (noNote > 0) out.push(`${noNote} "Poor" item${noNote === 1 ? '' : 's'} need a note`)
    const noTread = MAIN_TYRES.filter(p => toNum(draft.tyres[p]?.tread) === null)
    if (noTread.length) out.push(`Tread depth missing: ${noTread.join(', ')}`)
    const badTread = TYRE_POSITIONS.filter(p => { const v = toNum(draft.tyres[p]?.tread); return v !== null && (v < 0 || v > 20) })
    if (badTread.length) out.push(`Tread depth out of range (0–20 mm): ${badTread.join(', ')}`)
    for (const test of ['brake', 'shock', 'slip'] as const) {
      for (const position of TEST_POSITIONS[test]) {
        const t = draft.tests[`${test}.${position}`]
        if (!t) continue
        const r = toNum(t.right), l = toNum(t.left)
        const touched = t.right.trim() !== '' || (test !== 'slip' && t.left.trim() !== '')
        if (touched && (r === null || (test !== 'slip' && l === null))) out.push(`${test[0].toUpperCase()}${test.slice(1)} test, ${position}: fill in both values`)
        if (test !== 'slip' && ((r ?? 0) < 0 || (l ?? 0) < 0)) out.push(`${test[0].toUpperCase()}${test.slice(1)} test, ${position}: values can't be negative`)
      }
    }
    return out
  }, [draft.odometer, draft.tyres, draft.tests, items, unset])

  // ---- photos ----
  const addPhotos = async (section: string, files: FileList) => {
    setPhotoBusy(true)
    const added: PhotoEntry[] = []
    let skipped = 0
    for (const f of Array.from(files)) {
      try {
        const blob = await shrink(f)
        added.push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) })
      } catch { skipped++ }
    }
    if (added.length) setPhotos(p => ({ ...p, [section]: [...(p[section] ?? []), ...added] }))
    if (skipped) showToast(`${skipped} photo${skipped === 1 ? '' : 's'} couldn't be read. Try again.`, true)
    setPhotoBusy(false)
  }
  const removePhoto = (section: string, id: string) => setPhotos(p => {
    const gone = (p[section] ?? []).find(e => e.id === id)
    if (gone) URL.revokeObjectURL(gone.url)
    return { ...p, [section]: (p[section] ?? []).filter(e => e.id !== id) }
  })
  const photoCount = Object.values(photos).reduce((n, a) => n + a.length, 0)

  // ---- submit ----
  const submit = async () => {
    if (!job || issues.length || phase !== 'form') return
    setPhase('saving')
    let saved: Data.SubmittedReport
    try {
      saved = await Data.submitDetailedReport({
        bookingId: job.id, odometerKm: toNum(draft.odometer) ?? 0, items, measurements, tyres,
      })
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? ''
      setPhase('form')
      showToast(/already been submitted/i.test(msg) ? 'This job already has a report.' : 'Submission failed. Your work is saved. Try again.', true)
      return
    }
    try { localStorage.removeItem(draftKey(jobId)) } catch { /* ignore */ }
    setResult(saved)
    setPhase('done')
    onSubmitted()

    const pending: Data.PhotoUpload[] = PHOTO_SECTIONS.flatMap(([section]) => (photos[section] ?? []).map(e => ({ section, blob: e.blob })))
    if (pending.length) await uploadPhotos(saved.inspectionId, pending)
  }

  const uploadPhotos = async (inspectionId: string, list: Data.PhotoUpload[]) => {
    setPhotoStatus('uploading')
    try {
      const res = await Data.uploadReportPhotos(inspectionId, list)
      setFailedPhotos(res.failed)
      if (res.failed.length) showToast(`${res.failed.length} photo${res.failed.length === 1 ? '' : 's'} didn't upload. Tap retry.`, true)
    } catch (err) {
      console.error(err)
      setFailedPhotos(list)
    } finally {
      setPhotoStatus('idle')
    }
  }

  const openReport = async () => {
    if (!result) return
    setLoadingView(true)
    try {
      const r = await Data.fetchDetailedReport(result.inspectionId)
      if (r) setView(r)
      else showToast('Report not found.', true)
    } catch (err) {
      console.error(err)
      showToast('Could not load the report.', true)
    } finally {
      setLoadingView(false)
    }
  }

  if (!job) return null
  const vehicleName = `${job.year} ${job.make} ${job.model}`

  // ---- report viewer ----
  if (view) {
    return (
      <div className="lc-paper" style={{ position: 'fixed', inset: 0, background: '#fff', overflowY: 'auto', zIndex: 300 }}>
        <div className="noprint" style={{ padding: '12px 16px' }}>
          <button type="button" onClick={() => setView(null)} style={{ background: '#eee', color: '#111', borderRadius: 8, padding: '8px 14px', fontWeight: 700 }}>← Close report</button>
        </div>
        <ReportView {...view} />
      </div>
    )
  }

  // ---- done ----
  if (phase === 'done' && result) {
    const rwPass = result.roadworthy === 'pass'
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: 36, background: C.greenDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, marginBottom: 18 }}>✓</div>
        <p style={{ fontSize: 26, fontWeight: 900, color: C.t, letterSpacing: '-.05em', marginBottom: 6 }}>Report submitted</p>
        <p style={{ ...caption, marginBottom: 14 }}>{result.reportNumber} · {vehicleName}</p>
        <p style={{ fontSize: 'var(--fs-body)', color: C.t2, lineHeight: 1.7, marginBottom: 6 }}>
          Score <strong style={{ color: C.t }}>{result.score}/100</strong> ·{' '}
          <strong style={{ color: rwPass ? C.green : C.red }}>{rwPass ? 'Roadworthy: pass' : 'Roadworthy: issues found'}</strong>
        </p>
        <p style={{ fontSize: 'var(--fs-body)', color: C.t2, marginBottom: 18 }}>Payment of <strong style={{ color: C.lime }}>R&nbsp;{job.pay.toLocaleString()}</strong> within 24 hrs.</p>
        {photoStatus === 'uploading' && <p style={{ ...caption, marginBottom: 14 }}>Uploading photos… keep this screen open.</p>}
        {photoStatus === 'idle' && failedPhotos.length > 0 && (
          <div style={{ background: C.amberDim, border: '1px solid rgba(255,159,10,.25)', borderRadius: 'var(--r)', padding: '12px 14px', marginBottom: 14, width: '100%' }}>
            <p style={{ fontSize: 'var(--fs-caption)', color: C.amber, marginBottom: 8 }}>{failedPhotos.length} photo{failedPhotos.length === 1 ? '' : 's'} didn't upload.</p>
            <button type="button" onClick={() => uploadPhotos(result.inspectionId, failedPhotos)}
              style={{ background: C.amber, color: '#0A0A0A', borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 'var(--fs-caption)' }}>Retry upload</button>
          </div>
        )}
        <div style={{ width: '100%', display: 'grid', gap: 10 }}>
          <button type="button" onClick={openReport} disabled={loadingView || photoStatus === 'uploading'}
            style={{ background: C.s2, color: C.t, border: '1px solid var(--b)', borderRadius: 'var(--r)', padding: '15px', fontWeight: 700, fontSize: 'var(--fs-body)', opacity: loadingView || photoStatus === 'uploading' ? .5 : 1 }}>
            {loadingView ? 'Loading…' : 'View full report'}
          </button>
          <button type="button" onClick={() => nav('ijobs')} disabled={photoStatus === 'uploading'}
            style={{ background: C.lime, color: 'var(--on-ink)', borderRadius: 'var(--r)', padding: '15px', fontWeight: 700, fontSize: 'var(--fs-body)', opacity: photoStatus === 'uploading' ? .5 : 1 }}>
            Back to jobs
          </button>
        </div>
        <p style={{ ...caption, marginTop: 18 }}>You earn R70 every time this report is resold.</p>
      </div>
    )
  }

  // ---- form ----
  const saving = phase === 'saving'
  const checkedBySection = (key: string) => CHECKLIST.find(s => s.key === key)!.rows.filter(([c]) => draft.conds[rk(key, c)]).length
  const progressPct = Math.round((items.length / TOTAL_ITEMS) * 100)

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 150 }}>
      <div style={{ padding: 'var(--safe-top) 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <button type="button" aria-label="Save draft and go back" onClick={() => nav('ijobs')}
            style={{ width: 40, height: 40, borderRadius: '50%', background: C.s2, border: '1px solid var(--b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8L10 13" stroke={C.t} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 'var(--fs-headline)', fontWeight: 800, color: C.t, letterSpacing: '-.02em', lineHeight: 1.2 }}>{vehicleName}</p>
            <p style={{ ...caption, marginTop: 3 }}>VIN: {job.vin} · {job.location}</p>
          </div>
        </div>

        {job.notes && (
          <div style={{ background: 'rgba(10,132,255,.14)', border: '1px solid rgba(10,132,255,.14)', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 10 }}>
            <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--blue)', lineHeight: 1.5 }}>"{job.notes}"</p>
          </div>
        )}

        <div style={{ ...card, padding: '14px 16px' }}>
          <Field label="Odometer (km)" value={draft.odometer} numeric placeholder="e.g. 128450"
            onChange={v => setDraft(d => ({ ...d, odometer: v }))} invalid={draft.odometer !== '' && (toNum(draft.odometer) === null || !Number.isInteger(toNum(draft.odometer)))} />
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={caption}>Checklist progress</span>
              <span style={{ ...caption, color: C.t2, fontWeight: 700 }}>{items.length} / {TOTAL_ITEMS}</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: C.s3 }}>
              <div style={{ height: 5, borderRadius: 3, width: `${progressPct}%`, background: 'linear-gradient(90deg,var(--accent-2),var(--accent))', transition: 'width .2s' }} />
            </div>
          </div>
        </div>

        <div style={{ ...card, padding: '12px 16px', borderColor: verdict.roadworthy === 'fail' ? 'rgba(255,69,58,.4)' : undefined }} aria-live="polite">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: verdict.roadworthy === 'fail' ? C.red : C.green }}>
              {verdict.roadworthy === 'fail' ? 'Roadworthy issues so far' : 'No roadworthy issues so far'}
            </span>
            <span style={{ ...caption }}>{verdict.faults.length} fault{verdict.faults.length === 1 ? '' : 's'} · {verdict.warnings.length} to watch</span>
          </div>
          {verdict.faults.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
              {verdict.faults.slice(0, 4).map((f, i) => <li key={i} style={{ fontSize: 11, color: C.red, lineHeight: 1.5 }}>{f}</li>)}
              {verdict.faults.length > 4 && <li style={{ fontSize: 11, color: C.t3 }}>+{verdict.faults.length - 4} more</li>}
            </ul>
          )}
        </div>

        <p style={{ ...caption, margin: '4px 2px 8px' }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: C.amber, marginRight: 6 }} />
          marks items that affect the roadworthy verdict. Everything saves on this phone as you go.
        </p>

        {CHECKLIST.map(s => {
          const done = checkedBySection(s.key)
          const complete = done === s.rows.length
          return (
            <Accordion key={s.key} title={s.title} meta={`${done}/${s.rows.length}`} metaColor={complete ? C.green : C.t3}
              open={open === s.key} onToggle={() => setOpen(o => (o === s.key ? null : s.key))}>
              {!complete && (
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--b)' }}>
                  <button type="button" onClick={() => markRestGood(s.key)}
                    style={{ background: C.greenDim, color: C.green, border: '1px solid rgba(50,215,75,.25)', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontWeight: 700 }}>
                    Mark everything not yet checked as Good
                  </button>
                </div>
              )}
              {s.rows.map(([key, label, rw]) => (
                <ItemRow key={key} k={rk(s.key, key)} label={label} rw={!!rw} cond={draft.conds[rk(s.key, key)]}
                  note={draft.notes[rk(s.key, key)] ?? ''} onCond={setCond} onNote={setNote} />
              ))}
            </Accordion>
          )
        })}

        <Accordion title="Measured tests" meta={`${measurements.length} entered`} open={open === 'tests'} onToggle={() => setOpen(o => (o === 'tests' ? null : 'tests'))}>
          <div style={{ padding: '12px 16px 4px' }}>
            <p style={{ ...caption, marginBottom: 10 }}>Optional. Skip any test you didn't run. Use a comma or a dot for decimals.</p>
            {(['brake', 'shock', 'slip'] as const).map(test => (
              <div key={test} style={{ marginBottom: 14 }}>
                <p style={{ fontWeight: 700, fontSize: 'var(--fs-caption)', color: C.t, marginBottom: 8 }}>
                  {test === 'brake' ? 'Brake test (kN)' : test === 'shock' ? 'Shock test' : 'Slip / alignment test (m/km)'}
                </p>
                {TEST_POSITIONS[test].map(position => {
                  const k = `${test}.${position}`
                  const t = draft.tests[k] ?? { right: '', left: '' }
                  const m = measurements.find(x => x.test === test && x.position === position)
                  return (
                    <div key={k} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: test === 'slip' ? '1fr' : '1fr 1fr', gap: 8 }}>
                        <Field label={test === 'slip' ? `${position}: alignment` : `${position}: right`} value={t.right} numeric onChange={v => setTest(k, { right: v })} />
                        {test !== 'slip' && <Field label={`${position}: left`} value={t.left} numeric onChange={v => setTest(k, { left: v })} />}
                      </div>
                      {m && (
                        <p style={{ fontSize: 11, marginTop: 4, color: m.result === 'Passed' || m.result === 'Normal' || m.result === 'Ok' ? C.green : C.amber }}>
                          {m.diff_pct != null ? `Difference ${m.diff_pct}% · ` : ''}{m.result}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </Accordion>

        <Accordion title="Tyres" meta={`${MAIN_TYRES.filter(p => toNum(draft.tyres[p]?.tread) !== null).length}/4 tread`}
          metaColor={MAIN_TYRES.every(p => toNum(draft.tyres[p]?.tread) !== null) ? C.green : C.t3}
          open={open === 'tyres'} onToggle={() => setOpen(o => (o === 'tyres' ? null : 'tyres'))}>
          <div style={{ padding: '12px 16px 4px' }}>
            {TYRE_POSITIONS.map(pos => {
              const t = draft.tyres[pos] ?? emptyTyre()
              const tread = toNum(t.tread)
              const bad = tread !== null && (tread < 0 || tread > 20)
              return (
                <div key={pos} style={{ marginBottom: 16 }}>
                  <p style={{ fontWeight: 700, fontSize: 'var(--fs-caption)', color: C.t, marginBottom: 8 }}>
                    {pos}{pos !== 'Spare' && <span style={{ color: C.t3, fontWeight: 500 }}> · tread required</span>}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Field label="Tread depth (mm)" value={t.tread} numeric invalid={bad} onChange={v => setTyre(pos, { tread: v })} />
                    <Field label="Size" value={t.size} placeholder="205/55R16" onChange={v => setTyre(pos, { size: v })} />
                    <Field label="Load / speed" value={t.load_speed} placeholder="91V" onChange={v => setTyre(pos, { load_speed: v })} />
                    <label style={{ display: 'block' }}>
                      <span style={{ ...caption, display: 'block', marginBottom: 4 }}>Type</span>
                      <select value={t.tyre_type} onChange={e => setTyre(pos, { tyre_type: e.target.value })} style={inputStyle}>
                        <option value="">—</option>
                        {TYRE_TYPES.map(x => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </label>
                    <Field label="Make" value={t.make} onChange={v => setTyre(pos, { make: v })} />
                    <Field label="Model" value={t.model} onChange={v => setTyre(pos, { model: v })} />
                  </div>
                </div>
              )
            })}
          </div>
        </Accordion>

        <Accordion title="Photos" meta={`${photoCount}`} open={open === 'photos'} onToggle={() => setOpen(o => (o === 'photos' ? null : 'photos'))}>
          {PHOTO_SECTIONS.map(([key, title]) => (
            <PhotoPicker key={key} title={title} entries={photos[key] ?? []} busy={photoBusy}
              onAdd={files => addPhotos(key, files)} onRemove={id => removePhoto(key, id)} />
          ))}
          <p style={{ ...caption, padding: '10px 16px 14px' }}>Photos upload after the report is saved. They aren't kept if you close the app before submitting.</p>
        </Accordion>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 430, margin: '0 auto', background: 'transparent', backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)', borderTop: '1px solid var(--b)', padding: '10px 20px', paddingBottom: 'max(18px, var(--safe-bot))', zIndex: 100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: issues.length ? 4 : 8 }}>
          <span style={caption}>Score</span>
          <span style={{ fontSize: 19, fontWeight: 900, color: score === null ? C.t3 : score >= 80 ? C.green : score >= 60 ? C.amber : C.red, letterSpacing: '-.04em' }}>
            {score === null ? 'Check all items' : `${score} / 100`}
          </span>
        </div>
        {issues.length > 0 && (
          <p style={{ fontSize: 11, color: C.amber, lineHeight: 1.45, marginBottom: 8 }}>
            {issues.slice(0, 2).join(' · ')}{issues.length > 2 ? ` · +${issues.length - 2} more` : ''}
          </p>
        )}
        <button type="button" onClick={submit} disabled={issues.length > 0 || saving}
          style={{ width: '100%', background: issues.length || saving ? 'var(--ink-dim2)' : C.lime, color: issues.length || saving ? C.t3 : 'var(--on-ink)',
            borderRadius: 'var(--r)', padding: '15px 22px', fontSize: 'var(--fs-body)', fontWeight: 700, opacity: issues.length || saving ? .6 : 1 }}>
          {saving ? 'Saving report…' : `Submit report · Earn R ${job.pay.toLocaleString()}`}
        </button>
      </div>
    </div>
  )
}
