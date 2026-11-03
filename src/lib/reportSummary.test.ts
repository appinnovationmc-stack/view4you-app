import { describe, expect, it } from 'vitest'
import { CHECKLIST, rowDefaults, type ReportItem } from './reportTemplate'
import { buildSummary, plainWhy } from './reportSummary'

const base = () => rowDefaults()
const set = (items: ReportItem[], s: string, c: string, condition: ReportItem['condition'], explanation = '') =>
  items.map(i => (i.section === s && i.component === c ? { ...i, condition, explanation } : i))

describe('buildSummary', () => {
  it('is a good buy when nothing is wrong', () => {
    const s = buildSummary(base(), [], [], CHECKLIST)
    expect(s.level).toBe('good'); expect(s.issues).toHaveLength(0); expect(s.counts.ok).toBeGreaterThan(100)
  })
  it('only watch items still counts as a good buy', () => {
    const s = buildSummary(set(base(), 'interior', 'seats', 'fair'), [], [], CHECKLIST)
    expect(s.level).toBe('good'); expect(s.counts.watch).toBe(1)
  })
  it('a poor safety item is fix-now and asks for negotiation', () => {
    const s = buildSummary(set(base(), 'drive_system', 'brake_lines', 'poor', 'Leaking at rear left'), [], [], CHECKLIST)
    expect(s.level).toBe('negotiate'); expect(s.issues[0]).toMatchObject({ urgency: 'now', title: 'Brake lines & hoses', note: 'Leaking at rear left' })
  })
  it('three safety problems is not recommended', () => {
    let it = set(base(), 'drive_system', 'brake_lines', 'poor'); it = set(it, 'drive_system', 'tie_rods', 'poor'); it = set(it, 'exterior', 'windscreen', 'poor')
    expect(buildSummary(it, [], [], CHECKLIST).level).toBe('avoid')
  })
  it('sorts by urgency and flags bad tyres and brake imbalance', () => {
    const s = buildSummary(set(base(), 'interior', 'seats', 'fair'),
      [{ test: 'brake', position: 'Front Axle', right_value: 5, left_value: 2, diff_pct: 60, result: 'Failed' }],
      [{ position: 'Front Left', tread_mm: 0.5 }, { position: 'Rear Left', tread_mm: 2 }], CHECKLIST)
    expect(s.issues.map(i => i.urgency)).toEqual(['now', 'now', 'soon', 'watch'])
  })
  it('never treats uninspected safety items as passes', () => {
    const s = buildSummary(base().filter(i => i.component !== 'seatbelts'), [], [], CHECKLIST)
    expect(s.notInspectedSafety).toBe(1)
  })
  it('falls back to the section sentence', () => {
    expect(plainWhy('exterior', 'door_handles')).toMatch(/safe and visible/)
  })
})
