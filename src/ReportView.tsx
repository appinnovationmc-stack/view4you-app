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

const css = `\n/* rv-modern */
.rv{font-family:Poppins,Inter,system-ui,sans-serif;color:#17140f;max-width:820px;margin:0 auto;padding:20px 18px 44px;font-size:13px;line-height:1.55}
.rv h1{font-size:27px;font-weight:500;letter-spacing:-.03em;margin:8px 0 6px;line-height:1.15}
.rv h2{font-size:17px;font-weight:500;letter-spacing:-.02em;margin:30px 0 10px;color:#17140f;display:flex;align-items:center;gap:10px;border:none;padding:0}
.rv h2::before{content:"";width:11px;height:11px;border-radius:50%;flex-shrink:0;background:linear-gradient(145deg,var(--accent-2,#ffe066),var(--accent,#ffb400))}
.rv table{width:100%;border-collapse:separate;border-spacing:0;margin:8px 0;border:1px solid #e8e3da;border-radius:18px;overflow:hidden;background:#fff}
.rv th{background:#f4f1ec;text-align:left;font-weight:500;color:#5a544b}
.rv th,.rv td{padding:10px 13px;border:none;border-bottom:1px solid #eee9e1;vertical-align:top}
.rv tr:last-child th,.rv tr:last-child td{border-bottom:none}
.rv .pass{color:#058547;font-weight:600}.rv .fail{color:#d92d20;font-weight:600}.rv .warn{color:#9a5b00;font-weight:600}
.rv .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:8px 0}.rv .grid img{width:100%;border-radius:16px;aspect-ratio:4/3;object-fit:cover}
.rv .box{background:#f4f1ec;border-radius:22px;padding:16px 18px;margin:16px 0}
.rv .rw{text-align:center}
.rv button.noprint{background:#17140f;color:#fff;border:none;border-radius:999px;padding:11px 20px;font:500 13px Poppins,Inter,system-ui,sans-serif;cursor:pointer;margin-bottom:6px}
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

      <h1>Your Real Name Condition Report</h1>
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
