// Shape checks for panels pushed via the control server. Shallow by design:
// verify only the type tag and the fields the renderer dereferences
// unconditionally, so a malformed push 400s at the boundary instead of being
// persisted and crashing the dashboard on every reopen. The renderer's
// PanelBoundary is the backstop for anything subtler.

import type { PushPanelType } from '../../shared/types'

const PANEL_TYPES: ReadonlySet<string> = new Set<PushPanelType>([
  'sec-summary',
  'recommendation',
  'value-chain',
  'news',
  'risks',
  'peers'
])

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const allObj = (a: unknown[]): boolean => a.every(isObj)
const allStr = (a: unknown[]): boolean => a.every((x) => typeof x === 'string')

// Returns an error string, or null when the panel is acceptable.
export function validatePanel(type: string, data: unknown, markdown: unknown): string | null {
  if (!PANEL_TYPES.has(type)) return `unknown panel type "${type}"`
  if (data == null) {
    // Markdown transport is the fallback for types without a structured layout.
    return typeof markdown === 'string' && markdown.trim() ? null : 'data or markdown required'
  }
  if (!isObj(data)) return 'data must be an object'

  switch (type) {
    case 'sec-summary':
      if (typeof data.business !== 'string') return 'sec-summary: business (string) required'
      if (!Array.isArray(data.metrics) || !allObj(data.metrics))
        return 'sec-summary: metrics (array of objects) required'
      if (!Array.isArray(data.highlights) || !allStr(data.highlights))
        return 'sec-summary: highlights (array of strings) required'
      return null
    case 'recommendation': {
      if (typeof data.headline !== 'string') return 'recommendation: headline (string) required'
      if (typeof data.thesis !== 'string') return 'recommendation: thesis (string) required'
      if (data.call !== 'buy' && data.call !== 'hold' && data.call !== 'avoid')
        return 'recommendation: call must be buy|hold|avoid'
      if (!isObj(data.street)) return 'recommendation: street (object) required'
      const street = data.street
      if (street.targets != null && !isObj(street.targets))
        return 'recommendation: street.targets must be an object'
      if (street.notable != null && (!Array.isArray(street.notable) || !allObj(street.notable)))
        return 'recommendation: street.notable must be an array of objects'
      return null
    }
    case 'news':
      if (!Array.isArray(data.items) || !allObj(data.items))
        return 'news: items (array of objects) required'
      return null
    case 'risks': {
      if (!Array.isArray(data.categories) || !allObj(data.categories))
        return 'risks: categories (array of objects) required'
      const cats = data.categories as Obj[]
      if (!cats.every((c) => Array.isArray(c.points) && allStr(c.points)))
        return 'risks: every category needs points (array of strings)'
      if (data.screens != null && (!Array.isArray(data.screens) || !allObj(data.screens)))
        return 'risks: screens must be an array of objects'
      return null
    }
    case 'peers':
      // Push carries just tickers; main enriches into PeersData before persisting.
      if (!Array.isArray(data.tickers) || !allStr(data.tickers) || data.tickers.length === 0)
        return 'peers: tickers (non-empty array of strings) required'
      return null
    default:
      // value-chain has no structured /panel renderer — accept any object.
      return null
  }
}
