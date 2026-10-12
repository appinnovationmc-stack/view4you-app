import { useId, useState } from 'react'

/* Single-series daily chart. Colours come from the --series-* tokens (see styles.css), which carry the validated
   light and dark values. Every value is also reachable without hovering through the "Table" view below the chart. */

const W = 640, H = 220, PAD = { l: 48, r: 12, t: 12, b: 26 }

export interface Point { label: string; value: number }

function niceMax(v: number): number {
  if (v <= 0) return 4
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

export function DailyChart({ title, points, kind, format, series = 1 }: {
  title: string; points: Point[]; kind: 'line' | 'bar'; format: (n: number) => string; series?: 1 | 2
}) {
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const n = points.length
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)))
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1))
  const bw = Math.max(2, Math.min(24, (iw / Math.max(n, 1)) * 0.7))
  const bx = (i: number) => PAD.l + ((i + 0.5) * iw) / Math.max(n, 1)
  const y = (v: number) => PAD.t + ih - (v / max) * ih
  const xs = (i: number) => (kind === 'bar' ? bx(i) : x(i))
  const color = `var(--series-${series})`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const labelIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1]
  const total = points.reduce((a, p) => a + p.value, 0)

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    let best = 0, d = Infinity
    for (let i = 0; i < n; i++) { const dd = Math.abs(xs(i) - px); if (dd < d) { d = dd; best = i } }
    setHover(best)
  }
  const h = hover != null ? points[hover] : null
  const tipLeft = hover != null ? Math.min(Math.max((xs(hover) / W) * 100, 12), 88) : 0

  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`}><strong>{title}</strong> <span className="muted">· total {format(total)}</span></figcaption>
      <div className="chartbox">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, ${n} days, total ${format(total)}`}
             onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{format(t)}</text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text key={i} x={xs(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="axis">{points[i]?.label}</text>
          ))}
          {kind === 'bar'
            ? points.map((p, i) => (
                <rect key={i} x={bx(i) - bw / 2} y={y(p.value)} width={bw} height={Math.max(0, y(0) - y(p.value))} rx={2}
                      fill={color} opacity={hover == null || hover === i ? 1 : 0.55} />))
            : <>
                <polyline fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                          points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
                {n <= 31 && points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 2.5} fill={color} />)}
              </>}
          {hover != null && <line x1={xs(hover)} x2={xs(hover)} y1={PAD.t} y2={PAD.t + ih} className="cross" />}
        </svg>
        {h && <div className="tip" style={{ left: `${tipLeft}%` }}><strong>{format(h.value)}</strong><span>{h.label}</span></div>}
      </div>
      <details className="chartdata">
        <summary>Table</summary>
        <table>
          <thead><tr><th>Day</th><th>Value</th></tr></thead>
          <tbody>{points.map((p, i) => <tr key={i}><td>{p.label}</td><td>{format(p.value)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  )
}

/* A horizontal funnel: one bar per step, the first step is 100%. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1)
  return (
    <div className="funnel">
      {steps.map((s) => (
        <div key={s.label} className="frow">
          <span className="flabel">{s.label}</span>
          <span className="fbar"><span style={{ width: `${Math.round((s.value / top) * 100)}%` }} /></span>
          <span className="fval"><strong>{s.value}</strong> <span className="muted">{Math.round((s.value / top) * 100)}%</span></span>
        </div>
      ))}
    </div>
  )
}
