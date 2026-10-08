import {
  CHECKLIST, CONDITION_LABEL, TYRE_POSITIONS, evaluate, labelFor, summariseSection,
  type Measurement, type ReportItem, type ReportPhoto, type Tyre,
} from './lib/reportTemplate'

export interface ReportViewProps {
  reportNumber: string
  vehicle: { make?: string; model?: string; year?: number | string; odometer_km?: number; colour?: string; fuel?: string; transmission?: string; body?: string; vin?: string; plate?: string }
  items: ReportItem[]
  measurements: Measurement[]
  tyres: Tyre[]
  photos?: ReportPhoto[]
  inspectorName?: string
  inspectedAt?: string
}

const css = `
.rv{font-family:Inter,system-ui,sans-serif;color:#111;max-width:820px;margin:0 auto;padding:16px;font-size:13px;line-height:1.45}
.rv h1{font-size:20px;margin:0}.rv h2{font-size:16px;margin:24px 0 6px;color:#0a7f6f;border-bottom:1px solid #ddd;padding-bottom:4px}
.rv table{width:100%;border-collapse:collapse;margin:8px 0}.rv th{background:#eee;text-align:left}
.rv th,.rv td{padding:5px 8px;border:1px solid #ddd;vertical-align:top}
.rv .pass{color:#0a7f3f;font-weight:700}.rv .fail{color:#c62828;font-weight:700}.rv .warn{color:#b26a00;font-weight:600}
.rv .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.rv .grid img{width:100%;border-radius:6px;aspect-ratio:4/3;object-fit:cover}
.rv .box{background:#f6f8f8;border-radius:8px;padding:12px;margin:12px 0}
.rv .rw{text-align:center}
@media print{.rv{max-width:none;padding:0}.rv h2{break-after:avoid}.rv table,.rv .grid{break-inside:avoid}.rv .noprint{display:none}}
`

const cls = (c: string) => (c === 'poor' ? 'fail' : c === 'fair' ? 'warn' : '')

export default function ReportView(p: ReportViewProps) {
  const v = evaluate(p.items, p.measurements, p.tyres)
  const photosFor = (s: string) => (p.photos ?? []).filter(x => x.section === s)
  const tests = (t: Measurement['test']) => p.measurements.filter(m => m.test === t)
  const veh = p.vehicle

  return (
    <div className="rv">
      <style>{css}</style>
      <button className="noprint" onClick={() => window.print()}>Print / save as PDF</button>

      <h1>RealName Condition Report</h1>
      <div>Report no. <b>{p.reportNumber}</b>{p.inspectedAt && <> · Inspected {p.inspectedAt}</>}{p.inspectorName && <> · by {p.inspectorName}</>}</div>
      <p style={{ color: '#555' }}>A non-invasive visual and diagnostic inspection of key safety and roadworthy indicators. It reflects the vehicle's condition at the time of inspection only and does not predict future performance or wear.</p>

      <div className="grid">{photosFor('overview').map((x, i) => <img key={i} src={x.url} alt={x.caption ?? 'Overview'} />)}</div>

      <h2>Vehicle details</h2>
      <table><tbody>
        {([['Make', veh.make], ['Model', veh.model], ['Year', veh.year], ['Odometer', veh.odometer_km != null ? `${veh.odometer_km.toLocaleString()} km` : ''],
          ['Colour', veh.colour], ['Fuel', veh.fuel], ['Transmission', veh.transmission], ['Body', veh.body], ['VIN', veh.vin], ['Registration', veh.plate]] as const)
          .filter(([, val]) => val).map(([k, val]) => <tr key={k}><th style={{ width: '30%' }}>{k}</th><td>{val}</td></tr>)}
      </tbody></table>

      <div className="box">
        <b>Roadworthy compliance: </b><span className={v.roadworthy}>{v.roadworthy === 'pass' ? 'No roadworthy issues found' : 'Roadworthy issues found'}</span>
        {v.faults.length > 0 && <ul>{v.faults.map((f, i) => <li key={i} className="fail">{f}</li>)}</ul>}
        {v.warnings.length > 0 && <><div style={{ marginTop: 8 }}><b>Items to watch</b></div><ul>{v.warnings.map((w, i) => <li key={i} className="warn">{w}</li>)}</ul></>}
      </div>

      {CHECKLIST.map(s => {
        const rows = p.items.filter(i => i.section === s.key)
        if (!rows.length) return null
        return (
          <section key={s.key}>
            <h2>{s.title}</h2>
            <div className="grid">{photosFor(s.key).map((x, i) => <img key={i} src={x.url} alt={x.caption ?? s.title} />)}</div>
            <p>{summariseSection(s.key, p.items)}</p>
            <table>
              <thead><tr><th>Component</th><th>Condition</th><th>Notes</th><th className="rw">Roadworthy</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.component}>
                  <td>{labelFor(r.section, r.component)}</td>
                  <td className={cls(r.condition)}>{CONDITION_LABEL[r.condition]}</td>
                  <td>{r.explanation}</td>
                  <td className="rw">{r.roadworthy_relevant ? (r.condition === 'poor' || r.condition === 'fair' ? '⚠' : '✓') : ''}</td>
                </tr>))}
              </tbody>
            </table>
          </section>
        )
      })}

      {tests('brake').length > 0 && <section><h2>Brake test</h2>
        <table><thead><tr><th></th><th>Right (kN)</th><th>Left (kN)</th><th>Diff</th><th>Result</th></tr></thead>
          <tbody>{tests('brake').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td>{m.left_value}</td><td>{m.diff_pct}%</td><td className={m.result === 'Passed' ? 'pass' : 'fail'}>{m.result}</td></tr>)}</tbody></table></section>}

      {tests('shock').length > 0 && <section><h2>Shock test</h2>
        <table><thead><tr><th></th><th>Right</th><th>Left</th><th>Diff</th><th>Result</th></tr></thead>
          <tbody>{tests('shock').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td>{m.left_value}</td><td>{m.diff_pct}%</td><td className={m.result === 'Normal' ? 'pass' : 'warn'}>{m.result}</td></tr>)}</tbody></table></section>}

      {tests('slip').length > 0 && <section><h2>Slip (alignment) test</h2>
        <table><thead><tr><th></th><th>Alignment (m/km)</th><th>Result</th></tr></thead>
          <tbody>{tests('slip').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td className={m.result === 'Ok' ? 'pass' : 'warn'}>{m.result}</td></tr>)}</tbody></table></section>}

      {p.tyres.length > 0 && <section><h2>Tyres</h2>
        <div className="grid">{photosFor('tyres').map((x, i) => <img key={i} src={x.url} alt={x.caption ?? 'Tyre'} />)}</div>
        <table><thead><tr><th></th><th>Size</th><th>Load/speed</th><th>Make</th><th>Model</th><th>Type</th><th>Tread (mm)</th></tr></thead>
          <tbody>{TYRE_POSITIONS.map(pos => { const t = p.tyres.find(x => x.position === pos); if (!t) return null
            return <tr key={pos}><td>{pos}</td><td>{t.size ?? '-'}</td><td>{t.load_speed ?? '-'}</td><td>{t.make ?? '-'}</td><td>{t.model ?? '-'}</td><td>{t.tyre_type ?? '-'}</td><td>{t.tread_mm ?? '-'}</td></tr> })}</tbody></table></section>}
    </div>
  )
}
