import { describe, expect, it } from 'vitest'
import { CHECKLIST, evaluate, rowDefaults } from './reportTemplate'

describe('inspection report integrity evaluation', () => {
  it('does not pass a report when a safety-critical item is N/A', () => {
    const items = rowDefaults()
    const safetyItem = items.find(item => item.section === 'exterior' && item.component === 'brake_lights')!
    safetyItem.condition = 'na'
    expect(evaluate(items, [], []).roadworthy).toBe('fail')
  })

  it('does not pass a report when a safety-critical item is missing', () => {
    const items = rowDefaults().filter(item => !(item.section === 'interior' && item.component === 'seatbelts'))
    expect(evaluate(items, [], []).roadworthy).toBe('fail')
  })

  it('treats a poor safety item as a fault even if the client marks it non-roadworthy', () => {
    const items = rowDefaults()
    const safetyItem = items.find(item => item.section === 'exterior' && item.component === 'brake_lights')!
    safetyItem.condition = 'poor'
    safetyItem.roadworthy_relevant = false
    expect(evaluate(items, [], []).roadworthy).toBe('fail')
  })

  it('flags duplicate and unknown checklist keys', () => {
    const items = rowDefaults()
    items.push({ ...items[0] })
    items.push({ section: 'forged', component: 'item', condition: 'good', roadworthy_relevant: false })
    const result = evaluate(items, [], [])
    expect(result.roadworthy).toBe('fail')
    expect(result.faults.some(fault => fault.includes('Duplicate checklist items'))).toBe(true)
    expect(result.faults.some(fault => fault.includes('Unknown checklist item'))).toBe(true)
  })

  it('keeps the template count explicit for server validation', () => {
    expect(CHECKLIST.reduce((total, section) => total + section.rows.length, 0)).toBe(115)
  })
})
