import type { Scorecards, Scorecard, ScorecardTone, Metric } from '../../shared/types'
import { explain } from '../glossary'

const DOT: Record<ScorecardTone, string> = {
  good: 'bg-emerald-400',
  bad: 'bg-red-400',
  neutral: 'bg-amber-400'
}

const VALUE_TONE: Record<ScorecardTone, string> = {
  good: 'text-emerald-300',
  bad: 'text-red-300',
  neutral: 'text-zinc-100'
}

export function ScorecardGrid({ data }: { data: Scorecards }): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.cards.map((c) => (
        <Card key={c.key} card={c} />
      ))}
    </div>
  )
}

function Card({ card }: { card: Scorecard }): JSX.Element {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-800/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${DOT[card.status]}`} />
        <span className="text-sm font-medium text-zinc-200">{card.title}</span>
      </div>
      {card.metrics.length > 0 ? (
        <div className="space-y-1">
          {card.metrics.map((m, i) => (
            <Row key={i} m={m} />
          ))}
        </div>
      ) : (
        <div className="text-xs text-zinc-500">{card.note ?? 'No data'}</div>
      )}
      {card.metrics.length > 0 && card.note && (
        <div className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">{card.note}</div>
      )}
    </div>
  )
}

function Row({ m }: { m: Metric }): JSX.Element {
  const tone = VALUE_TONE[m.tone ?? 'neutral']
  return (
    <div className="flex items-baseline justify-between gap-2 text-[13px]">
      <span className="text-zinc-500" title={explain(m.label)}>
        {m.label}
      </span>
      <span className={`tabular-nums font-medium ${tone}`}>{m.value}</span>
    </div>
  )
}
