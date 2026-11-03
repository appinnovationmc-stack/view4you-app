import { buildSummary, type Issue } from './lib/reportSummary'
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

const css = `
.rv{font-family:var(--f,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);color:var(--mt-text);background:var(--mt-bg);max-width:900px;margin:0 auto;padding:clamp(16px,3vw,36px) clamp(14px,3vw,28px) 56px;font-size:14px;line-height:1.6}
.rv h1{font-size:clamp(26px,4vw,40px);font-weight:650;letter-spacing:-.04em;margin:18px 0 10px;line-height:1.1;color:var(--mt-text)}
.rv .meta{color:var(--mt-text-2);font-size:12px;line-height:1.7}
.rv .lead{color:var(--mt-text-2);margin:12px 0 20px;max-width:760px;font-size:13px}
.rv h2{font-size:18px;font-weight:650;letter-spacing:-.025em;margin:30px 0 12px;display:flex;align-items:center;gap:10px;border:none;padding:0;color:var(--mt-text)}
.rv h2::before{content:"";width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--mt-signal)}
.rv .tw{margin:10px 0;border-radius:16px;overflow-x:auto;-webkit-overflow-scrolling:touch;background:var(--mt-card);box-shadow:var(--mt-shadow)}
.rv table{width:100%;border-collapse:collapse;background:transparent}
.rv table.wide{min-width:600px}
.rv th{text-align:left;font-weight:600;color:var(--mt-text-2);background:var(--mt-chip)}
.rv th,.rv td{padding:11px 14px;border:none;border-bottom:1px solid var(--mt-chip);vertical-align:top}
.rv tr:last-child th,.rv tr:last-child td{border-bottom:none}
.rv .pass{color:var(--green);font-weight:650}.rv .fail{color:var(--red);font-weight:650}.rv .warn{color:var(--amber);font-weight:650}
.rv .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}.rv .grid img{width:100%;border-radius:14px;aspect-ratio:4/3;object-fit:cover;background:var(--mt-chip)}
.rv .box{margin:18px 0;padding:18px 20px;border-radius:16px;background:var(--mt-card);box-shadow:var(--mt-shadow)}
.rv .box ul{margin:8px 0 0;padding-left:18px}
.rv .rw{text-align:center}
.rv button.noprint{background:var(--mt-prim);color:var(--mt-on-prim);border:none;border-radius:999px;padding:13px 22px;min-height:44px;font:600 14px var(--f,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);cursor:pointer;box-shadow:none}.rv button.noprint:focus-visible{outline:3px solid var(--mt-signal);outline-offset:3px}
.rv .verdict{margin:18px 0 8px;padding:20px;border-radius:16px;background:var(--mt-card);box-shadow:var(--mt-shadow);border-left:6px solid var(--green)}
.rv .verdict.negotiate{border-left-color:var(--amber)}.rv .verdict.avoid{border-left-color:var(--red)}
.rv .verdict small{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mt-text-3);margin-bottom:6px}
.rv .verdict b{display:block;font-size:22px;letter-spacing:-.03em;line-height:1.2;margin-bottom:6px}
.rv .verdict p{margin:0;color:var(--mt-text-2)}
.rv .tally{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}
.rv .tally span{padding:6px 12px;border-radius:999px;font-size:12px;font-weight:650;background:var(--mt-chip);color:var(--mt-text-2)}
.rv .tally .t-now{background:var(--red-dim);color:var(--red)}.rv .tally .t-soon{background:var(--amber-dim);color:var(--amber)}.rv .tally .t-ok{background:var(--green-dim);color:var(--green)}
.rv .issue{margin:10px 0;padding:16px 18px;border-radius:16px;background:var(--mt-card);box-shadow:var(--mt-shadow);border-left:4px solid var(--mt-text-3);break-inside:avoid}
.rv .issue.now{border-left-color:var(--red)}.rv .issue.soon{border-left-color:var(--amber)}
.rv .issue b{display:block;font-size:15px;letter-spacing:-.01em}
.rv .issue .st{font-size:12px;font-weight:650;margin:2px 0 8px;color:var(--mt-text-2)}
.rv .issue.now .st{color:var(--red)}.rv .issue.soon .st{color:var(--amber)}
.rv .issue p{margin:0 0 6px;color:var(--mt-text-2);font-size:13px}
.rv .issue .nt{padding:8px 12px;border-radius:10px;background:var(--mt-chip);color:var(--mt-text);font-size:13px}
.rv .grp{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mt-text-3);margin:22px 0 4px}
.rv details.fold{margin:12px 0;border-radius:16px;background:var(--mt-card);box-shadow:var(--mt-shadow)}
.rv details.fold>summary{cursor:pointer;padding:16px 18px;font-weight:650;list-style:none;display:flex;justify-content:space-between;align-items:center;min-height:44px}
.rv details.fold>summary::-webkit-details-marker{display:none}
.rv details.fold>summary::after{content:"+";font-size:20px;color:var(--mt-text-3)}
.rv details.fold[open]>summary::after{content:"\\2212"}
.rv details.fold>.in{padding:0 14px 14px}
.rv details.fold .tw,.rv details.fold .box{box-shadow:none;background:var(--mt-bg)}
.rv .cap{font-size:12px;color:var(--mt-text-3);margin:10px 2px 0}
@media (max-width:480px){.rv{padding:16px 14px 56px}.rv th,.rv td{padding:9px 8px;font-size:13px}.rv th{font-size:12px}.rv .rw{width:1%}.rv .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.rv .box{padding:15px 14px}.rv table.wide{min-width:560px}}
@media print{
  .rv{color:#111;background:#fff;max-width:none;padding:0}
  .rv h1,.rv h2{color:#111;text-shadow:none}
  .rv .meta{color:#222}.rv .lead{color:#444}
  .rv h2::before{background:#111}
  .rv h2{break-after:avoid}
  .rv .tw,.rv .box,.rv .verdict,.rv .issue,.rv details.fold{background:#fff;color:#111;border:1px solid #cfcfcf;box-shadow:none;border-radius:12px;overflow:visible;break-inside:avoid}
  .rv .verdict p,.rv .issue p,.rv .issue .st,.rv .grp,.rv .cap{color:#333}
  .rv .issue .nt{background:#f1f1f1;color:#111}
  .rv .tally span{background:#eee;color:#222}.rv .tally .t-now{background:#fbe4e1;color:#b42318}.rv .tally .t-soon{background:#fbeccf;color:#8a5200}.rv .tally .t-ok{background:#dff3e8;color:#087443}
  .rv .issue.now .st{color:#b42318}.rv .issue.soon .st{color:#8a5200}.rv .verdict{border-left:6px solid #087443}.rv .verdict.negotiate{border-left-color:#c27a00}.rv .verdict.avoid{border-left-color:#b42318}.rv .issue.now{border-left:4px solid #b42318}.rv .issue.soon{border-left:4px solid #c27a00}
  .rv table.wide{min-width:0}
  .rv th{background:#f1f1f1;color:#333}.rv th,.rv td{border-bottom:1px solid #ddd}
  .rv .pass{color:#058547}.rv .fail{color:#c0261b}.rv .warn{color:#8a5200}
  .rv details.fold .tw,.rv details.fold .box{background:#fff}
  .rv details.fold>summary::after{content:""}
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
  const sum = buildSummary(p.items, p.measurements, p.tyres, activeChecklist)
  const printAll = () => { document.querySelectorAll<HTMLDetailsElement>('.rv details').forEach(d => { d.open = true }); window.print() }
  const group = (u: Issue['urgency'], title: string) => {
    const list = sum.issues.filter(i => i.urgency === u)
    if (!list.length) return null
    return <section key={u}><div className="grp">{title}</div>{list.map(i => (
      <div key={i.key} className={`issue ${i.urgency}`}><b>{i.title}</b><div className="st">{i.state}</div><p>{i.why}</p>{i.note && <div className="nt">{i.fact ? 'Measured: ' : 'Inspector: '}{i.note}</div>}</div>))}</section>
  }

  return (
    <div className="rv">
      <style>{css}</style>
      <button className="noprint" onClick={printAll}>Print / save as PDF</button>

      <h1>CheckVertical Condition Report</h1>
      <div className="meta"><b>{p.tierName || 'Standard'}</b> inspection · Report no. <b>{p.reportNumber}</b>{p.inspectedAt && <> · Inspected {p.inspectedAt}</>}{p.inspectorName && <> · by {p.inspectorName}</>}</div>
      <p className="lead">This report records the {p.tierName || 'Standard'} inspection scope and the vehicle's observed condition at the time of inspection. It is a non-invasive condition report, not an official roadworthy certificate. Uninspected areas, hidden faults and future failures may not be represented.</p>

      <div className={`verdict ${sum.level}`}>
        <small>Our verdict</small>
        <b>{sum.headline}</b>
        <p>{sum.reason}</p>
        <div className="tally">
          {sum.counts.now > 0 && <span className="t-now">{sum.counts.now} fix now</span>}
          {sum.counts.soon > 0 && <span className="t-soon">{sum.counts.soon} fix soon</span>}
          {sum.counts.watch > 0 && <span>{sum.counts.watch} to watch</span>}
          <span className="t-ok">{sum.counts.ok} checked and fine</span>
        </div>
        {sum.notInspectedSafety > 0 && <p className="cap">{sum.notInspectedSafety} safety check{sum.notInspectedSafety === 1 ? ' was' : 's were'} not inspected, so this verdict does not cover {sum.notInspectedSafety === 1 ? 'it' : 'them'}.</p>}
      </div>

      {sum.issues.length > 0 && <h2>What needs attention</h2>}
      {group('now', 'Fix now: safety or roadworthy')}
      {group('soon', 'Fix soon')}
      {group('watch', 'Keep an eye on')}
      {sum.issues.length === 0 && <p className="cap">Nothing was flagged in the areas inspected.</p>}

      <div className="grid">{photosFor('overview').map((x, i) => <img key={i} src={x.url} alt={x.caption ?? 'Overview'} />)}</div>

      <h2>Full inspection detail</h2>
      <details className="fold"><summary>Vehicle details</summary><div className="in"><div className="tw"><table><tbody>
        {([['Make', veh.make], ['Model', veh.model], ['Year', veh.year], ['Odometer', veh.odometer_km != null ? `${veh.odometer_km.toLocaleString()} km` : ''],
          ['Colour', veh.colour], ['Fuel', veh.fuel], ['Transmission', veh.transmission], ['Body', veh.body], ['VIN', veh.vin], ['Registration', veh.plate]] as const)
          .filter(([, val]) => val).map(([k, val]) => <tr key={k}><th style={{ width: '30%' }}>{k}</th><td>{val}</td></tr>)}
      </tbody></table></div></div></details>

      <details className="fold"><summary>Roadworthiness-related findings</summary><div className="in"><div className="box">
        <b>Roadworthiness-related findings (not a certification): </b><span className={v.roadworthy}>{v.roadworthy === 'pass' ? 'No issues were recorded in the inspected items' : 'One or more issues were recorded'}</span>
        {v.faults.length > 0 && <ul>{v.faults.map((f, i) => <li key={i} className="fail">{f}</li>)}</ul>}
        {v.warnings.length > 0 && <><div style={{ marginTop: 10 }}><b>Items to watch</b></div><ul>{v.warnings.map((w, i) => <li key={i} className="warn">{w}</li>)}</ul></>}
      </div></div></details>

      {activeChecklist.map(s => {
        const rows = p.items.filter(i => i.section === s.key)
        if (!rows.length) return null
        return (
          <details className="fold" key={s.key}><summary>{s.title}</summary><div className="in">
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
          </div></details>
        )
      })}

      {tests('brake').length > 0 && <details className="fold"><summary>Brake test</summary><div className="in">
        <div className="tw"><table><thead><tr><th></th><th>Right (kN)</th><th>Left (kN)</th><th>Diff</th><th>Result</th></tr></thead>
          <tbody>{tests('brake').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td>{m.left_value}</td><td>{m.diff_pct}%</td><td className={m.result === 'Passed' ? 'pass' : 'fail'}>{m.result}</td></tr>)}</tbody></table></div></div></details>}

      {tests('shock').length > 0 && <details className="fold"><summary>Shock test</summary><div className="in">
        <div className="tw"><table><thead><tr><th></th><th>Right</th><th>Left</th><th>Diff</th><th>Result</th></tr></thead>
          <tbody>{tests('shock').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td>{m.left_value}</td><td>{m.diff_pct}%</td><td className={m.result === 'Normal' ? 'pass' : 'warn'}>{m.result}</td></tr>)}</tbody></table></div></div></details>}

      {tests('slip').length > 0 && <details className="fold"><summary>Slip (alignment) test</summary><div className="in">
        <div className="tw"><table><thead><tr><th></th><th>Alignment (m/km)</th><th>Result</th></tr></thead>
          <tbody>{tests('slip').map(m => <tr key={m.position}><td>{m.position}</td><td>{m.right_value}</td><td className={m.result === 'Ok' ? 'pass' : 'warn'}>{m.result}</td></tr>)}</tbody></table></div></div></details>}

      {p.tyres.length > 0 && <details className="fold"><summary>Tyres</summary><div className="in">
        <div className="grid">{photosFor('tyres').map((x, i) => <img key={i} src={x.url} alt={x.caption ?? 'Tyre'} />)}</div>
        <div className="tw"><table className="wide"><thead><tr><th></th><th>Size</th><th>Load/speed</th><th>Make</th><th>Model</th><th>Type</th><th>Tread (mm)</th></tr></thead>
          <tbody>{TYRE_POSITIONS.map(pos => { const t = p.tyres.find(x => x.position === pos); if (!t) return null
            return <tr key={pos}><td>{pos}</td><td>{t.size ?? '-'}</td><td>{t.load_speed ?? '-'}</td><td>{t.make ?? '-'}</td><td>{t.model ?? '-'}</td><td>{t.tyre_type ?? '-'}</td><td>{t.tread_mm ?? '-'}</td></tr> })}</tbody></table></div></div></details>}
    </div>
  )
}
