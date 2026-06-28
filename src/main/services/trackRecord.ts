// Enrich stored calls with the current quote so the Home list can show
// "+X% since". One Stooq fetch per distinct symbol; a failed quote just leaves
// returnPct unset for that row.

import { listCalls } from '../database/calls'
import { getQuote } from './stooqService'
import type { TrackRecordEntry } from '../../shared/types'

export async function getTrackRecord(): Promise<TrackRecordEntry[]> {
  const rows = listCalls()
  if (rows.length === 0) return []
  const symbols = [...new Set(rows.map((r) => r.symbol))]
  const quotes = new Map(
    await Promise.all(symbols.map(async (s) => [s, await getQuote(s)] as const))
  )
  return rows.map((r) => {
    const price = quotes.get(r.symbol)?.price ?? null
    const ret =
      price != null && r.price_at_call != null && r.price_at_call > 0
        ? ((price - r.price_at_call) / r.price_at_call) * 100
        : undefined
    return {
      symbol: r.symbol,
      call: r.call,
      headline: r.headline ?? undefined,
      priceAtCall: r.price_at_call ?? undefined,
      priceNow: price ?? undefined,
      returnPct: ret,
      at: r.created_at
    }
  })
}
