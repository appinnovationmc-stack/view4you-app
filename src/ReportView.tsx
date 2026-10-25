import {
  CONDITION_LABEL, TYRE_POSITIONS, evaluate, labelFor, summariseSection, checklistForTier,
  type Measurement, type ReportItem, type ReportPhoto, type Tyre,
} from './lib/reportTemplate'

export interface ReportViewProps {
  reportNumber: string
  tierName?: string
  vehicle: { make?: string; model?: string; year?: number | string; odometer_km?: number; colour?: string; fuel?: string; transmission?: string; body?: string; vin?: string; plate?: string }
  items: ReportItem[]
  measurements: Measurement[]
  tyres: Tyre[]
  photos?: ReportPhoto[]
  inspectorName?: string
  inspectedAt?: string
}

const css = `\n/* rv-glass */
.rv{font-family:var(--f,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);color:#17191c;background:#f7f7f5;max-width:900px;margin:0 auto;padding:clamp(16px,3vw,36px) clamp(14px,3vw,28px) 56px;font-size:14px;line-height:1.6}
.rv h1{font-size:clamp(28px,4vw,42px);font-weight:650;letter-spacing:-.045em;margin:24px 0 12px;line-height:1.08;color:#101114}
.rv .meta{color:#565b62;font-size:12px;line-height:1.7}
.rv .lead{color:#565b62;margin:12px 0 24px;max-width:760px}
.rv h2{font-size:18px;font-weight:650;letter-spacing:-.025em;margin:32px 0 12px;display:flex;align-items:center;gap:10px;border:none;padding:0;color:#17191c}
.rv h2::before{content:"";width:7px;height:7px;border-radius:50%;flex-shrink:0;background:#17191c}
.rv .tw{margin:10px 0;border:1px solid #e1e2e4;border-radius:16px;overflow-x:auto;-webkit-overflow-scrolling:touch;background:#fff;box-shadow:0 4px 18px rgba(20,22,28,.035)}
.rv table{width:100%;border-collapse:collapse;background:transparent}
.rv table.wide{min-width:600px}
.rv th{text-align:left;font-weight:600;color:#565b62;background:#f0f1f2}
.rv th,.rv td{padding:11px 14px;border:none;border-bottom:1px solid #e8e9eb;vertical-align:top}
.rv tr:last-child th,.rv tr:last-child td{border-bottom:none}
.rv .pass{color:var(--green,#9cf2bf);font-weight:500}.rv .fail{color:var(--red,#ffb9b1);font-weight:500}.rv .warn{color:var(--amber,#ffdf9a);font-weight:500}
.rv .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}.rv .grid img{width:100%;border-radius:14px;aspect-ratio:4/3;object-fit:cover;background:#e9eaec}
.rv .box{margin:18px 0;padding:18px 20px;border-radius:18px;border:1px solid #e1e2e4;background:#fff;box-shadow:0 4px 18px rgba(20,22,28,.035)}
.rv .box ul{margin:8px 0 0;padding-left:18px}
.rv .rw{text-align:center}
.rv button.noprint{background:#111315;color:#fff;border:none;border-radius:999px;padding:13px 22px;min-height:44px;font:600 14px var(--f,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);cursor:pointer;box-shadow:none}.rv button.noprint:focus-visible{outline:3px solid #176bff;outline-offset:3px}
@media (max-width:480px){.rv{padding:16px 14px 56px}.rv th,.rv td{padding:9px 8px;font-size:13px}.rv th{font-size:12px}.rv .rw{width:1%}}
@media print{
  .rv{color:#111;max-width:none;padding:0}
  .rv h1,.rv h2{color:#111;text-shadow:none}
  .rv .meta{color:#222}.rv .lead{color:#444}
  .rv h2::before{background:#111}
  .rv h2{break-after:avoid}
  .rv .tw,.rv .box{background:#fff;border:1px solid #cfcfcf;border-radius:12px;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;overflow:visible;break-inside:avoid}
  .rv .box{background:#f5f5f5}
  .rv table.wide{min-width:0}
  .rv th{background:#f1f1f1;color:#333}.rv th,.rv td{border-bottom:1px solid #ddd}
  .rv .pass{color:#058547}.rv .fail{color:#c0261b}.rv .warn{color:#8a5200}
  .rv .grid{break-inside:avoid}
  .rv .noprint{display:none}
}
`

const cls = (c: string) => (c === 'poor' ? 'fail' : c === 'fair' ? 'warn' : '')

export default function ReportView(p: ReportViewProps) {
  const activeChecklist = checklistForTier(p.tierName)
  const v = evaluate(p.items, p.measurements, p.tyres, activeChecklist)
  const photosFor = (s: string) => (p.photos ?? []).filter(x => x.section === s)
  const tests = (t: Measurement['test']) => p.measurements.filter(m => m.test === t)
  const veh = p.vehicle

  return (
    <div className="rv">
      <style>{css}</style>
      <button className="noprint" onClick={() => window.print()}>Print / save as PDF</button>

      <h1>CheckVertical Condition Report</h1>
      <div className="meta"><b>{p.tierName || 'Standard'}</b> inspection · Report no. <b>{p.reportNumber}</b>{p.inspectedAt && <> · Inspected {p.inspectedAt}</>}{p.inspectorName && <> · by {p.inspectorName}</>}</div>
      <p className="lead">This report records the {p.tierName || 'Standard'} inspection scope and the vehicle's observed condition at the time of inspection. It is a non-invasive condition report, not an official roadworthy certificate. Uninspected areas, hidden faults and future failures may not be represented.</p>

      <div className="grid">{photosFor('overview').map((x, i) => <img key={i} src={x.url} alt={x.caption ?? 'Overview'} />)}</div>

      <h2>Vehicle details</h2>
      <div className="tw"><table><tbody>
        {([['Make', veh.make], ['Model', veh.model], ['Year', veh.year], ['Odometer', veh.odometer_km != null ? `${veh.odometer_km.toLocaleString()} km` : ''],
          ['Colour', veh.colour], ['Fuel', veh.fuel], ['Transmission', veh.transmission], ['Body', veh.body], ['VIN', veh.vin], ['Registration', veh.plate]] as const)
          .filter(([, val]) => val).map(([k, val]) => <tr key={k}><th style={{ width: '30%' }}>{k}</th><td>{val}</td></tr>)}
      </tbody></table></div>

      <div className="box">
        <b>Roadworthiness-related findings (not a certification): </b><span className={v.roadworthy}>{v.roadworthy === 'pass' ? 'No issues were recorded in the inspected items' : 'One or more issues were recorded'}</span>
        {v.faults.length > 0 && <ul>{v.faults.map((f, i) => <li key={i} className="fail">{f}</li>)}</ul>}
        {v.warnings.length > 0 && <><div style={{ marginTop: 10 }}><b>Items to watch</b></div><ul>{v.warnings.map((w, i) => <li key={i} className="warn">{w}</li>)}</ul></>}
      </div>

      {activeChecklist.map(s => {
        const rows = p.items.filter(i => i.section === s.key)
        if (!rows.length) return null
        return (
          <section key={s.key}>
            <h2>{s.title}</h2>
            <div className="grid">{photosFor(s.key).map((x, i) => <img key={i} src={x.url} alt={x.caption ?? s.title} />)}</div>
            <p>{summariseSection(s.key, p.items)}</p>
            <div className="tw"><table>
              <thead><tr><th>Component</th><th>Condition</th><th>Notes</th><th className="rw">Roadworthy</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.component}>
                  <td>{labelFor(r.section, r.component)}</td>
                  <td className={cls(r.condition)}>{CONDITION_LABEL[r.condition]}</td>
                  <td>{r.explanation}</td>
                  <td className="rw">{r.roadworthy_relevant ? (r.condition === 'poor' || r.condition === 'fair' ? '⚠' : '✓') : ''}</td>
                </tr>))}
              </tbody>
            </table></div>
          </section>
        )
      })}

      {tests('brake').length > 0 && <section><h2>Brake test</h2>
        <div className="tw"><table><thead><tr><th></th><th>Right (kN)</th><th>Left (kN)</th><th>Diff</th><th>Result</th></tr></thead>
          <tbody>{tests('brake').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td>{m.left_value}</td><td>{m.diff_pct}%</td><td className={m.result === 'Passed' ? 'pass' : 'fail'}>{m.result}</td></tr>)}</tbody></table></div></section>}

      {tests('shock').length > 0 && <section><h2>Shock test</h2>
        <div className="tw"><table><thead><tr><th></th><th>Right</th><th>Left</th><th>Diff</th><th>Result</th></tr></thead>
          <tbody>{tests('shock').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td>{m.left_value}</td><td>{m.diff_pct}%</td><td className={m.result === 'Normal' ? 'pass' : 'warn'}>{m.result}</td></tr>)}</tbody></table></div></section>}

      {tests('slip').length > 0 && <section><h2>Slip (alignment) test</h2>
        <div className="tw"><table><thead><tr><th></th><th>Alignment (m/km)</th><th>Result</th></tr></thead>
          <tbody>{tests('slip').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td className={m.result === 'Ok' ? 'pass' : 'warn'}>{m.result}</td></tr>)}</tbody></table></div></section>}

      {p.tyres.length > 0 && <section><h2>Tyres</h2>
        <div className="grid">{photosFor('tyres').map((x, i) => <img key={i} src={x.url} alt={x.caption ?? 'Tyre'} />)}</div>
        <div className="tw"><table className="wide"><thead><tr><th></th><th>Size</th><th>Load/speed</th><th>Make</th><th>Model</th><th>Type</th><th>Tread (mm)</th></tr></thead>
          <tbody>{TYRE_POSITIONS.map(pos => { const t = p.tyres.find(x => x.position === pos); if (!t) return null
            return <tr key={pos}><td>{pos}</td><td>{t.size ?? '-'}</td><td>{t.load_speed ?? '-'}</td><td>{t.make ?? '-'}</td><td>{t.model ?? '-'}</td><td>{t.tyre_type ?? '-'}</td><td>{t.tread_mm ?? '-'}</td></tr> })}</tbody></table></div></section>}
    </div>
  )
}
