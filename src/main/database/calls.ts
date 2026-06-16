import { getDb } from './connection'
import type { AnalystCall } from '../../shared/types'

export interface CallRow {
  symbol: string
  call: AnalystCall
  headline: string | null
  price_at_call: number | null
  created_at: number
}

// Append-only: every recommendation push records the call as made. This is the
// raw material for the Home track-record list ("audit the analyst").
export function recordCall(
  symbol: string,
  call: AnalystCall,
  headline: string | undefined,
  priceAtCall: number | undefined
): void {
  getDb()
    .prepare(
      'INSERT INTO calls (symbol, call, headline, price_at_call, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(symbol.toUpperCase(), call, headline ?? null, priceAtCall ?? null, Date.now())
}

export function listCalls(): CallRow[] {
  return getDb()
    .prepare(
      'SELECT symbol, call, headline, price_at_call, created_at FROM calls ORDER BY created_at DESC'
    )
    .all() as CallRow[]
}
