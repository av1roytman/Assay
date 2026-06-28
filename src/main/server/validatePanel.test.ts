import { describe, expect, it } from 'vitest'
import { validatePanel } from './validatePanel'

describe('validatePanel', () => {
  it('rejects unknown panel types', () => {
    expect(validatePanel('bogus', { a: 1 }, undefined)).toMatch(/unknown panel type/)
  })

  it('requires data or markdown', () => {
    expect(validatePanel('news', undefined, undefined)).toMatch(/data or markdown/)
    expect(validatePanel('news', undefined, '   ')).toMatch(/data or markdown/)
  })

  it('accepts markdown fallback for a known type', () => {
    expect(validatePanel('peers', undefined, '## peers')).toBeNull()
  })

  it('rejects non-object data', () => {
    expect(validatePanel('news', 'just a string', undefined)).toMatch(/must be an object/)
  })

  it('validates sec-summary required fields', () => {
    expect(validatePanel('sec-summary', { business: 'x' }, undefined)).toMatch(/metrics/)
    expect(
      validatePanel('sec-summary', { business: 'x', metrics: [], highlights: [{}] }, undefined)
    ).toMatch(/highlights/)
    expect(
      validatePanel(
        'sec-summary',
        { business: 'x', metrics: [{ label: 'Revenue', value: '$1B' }], highlights: ['a'] },
        undefined
      )
    ).toBeNull()
  })

  it('validates recommendation required fields', () => {
    expect(validatePanel('recommendation', { headline: 'h', thesis: 't' }, undefined)).toMatch(
      /call/
    )
    expect(
      validatePanel('recommendation', { call: 'hold', headline: 'h', thesis: 't' }, undefined)
    ).toMatch(/street/)
    expect(
      validatePanel(
        'recommendation',
        { call: 'hold', headline: 'h', thesis: 't', street: {} },
        undefined
      )
    ).toBeNull()
    expect(
      validatePanel(
        'recommendation',
        { call: 'hold', headline: 'h', thesis: 't', street: { targets: 'nope' } },
        undefined
      )
    ).toMatch(/targets/)
  })

  it('validates news items', () => {
    expect(validatePanel('news', { items: 'nope' }, undefined)).toMatch(/items/)
    expect(validatePanel('news', { items: [{ headline: 'x', source: 'y' }] }, undefined)).toBeNull()
  })

  it('validates risks categories and screens', () => {
    expect(validatePanel('risks', { categories: [{ category: 'F' }] }, undefined)).toMatch(
      /points/
    )
    expect(
      validatePanel(
        'risks',
        { categories: [{ category: 'F', severity: 'high', points: ['p'] }], screens: 'nope' },
        undefined
      )
    ).toMatch(/screens/)
    expect(
      validatePanel(
        'risks',
        { categories: [{ category: 'F', severity: 'high', points: ['p'] }] },
        undefined
      )
    ).toBeNull()
  })

  it('validates peers tickers', () => {
    expect(validatePanel('peers', { anything: true }, undefined)).toMatch(/tickers/)
    expect(validatePanel('peers', { tickers: [] }, undefined)).toMatch(/tickers/)
    expect(validatePanel('peers', { tickers: ['MSFT', 'GOOGL'] }, undefined)).toBeNull()
  })

  it('accepts any object for types without a structured renderer', () => {
    expect(validatePanel('value-chain', { anything: true }, undefined)).toBeNull()
  })
})
