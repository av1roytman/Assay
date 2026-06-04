import type { ValuationData } from '../../shared/types'

const VERDICT_STYLES: Record<string, { label: string; cls: string }> = {
  undervalued: { label: 'UNDERVALUED', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  fair: { label: 'ROUGHLY FAIR', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  overvalued: { label: 'OVERVALUED', cls: 'bg-red-500/15 text-red-300 ring-red-500/30' }
}

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

function signedPct(x: number): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`
}

export function ValuationPanel({ data }: { data: ValuationData }): JSX.Element {
  if (!data.applicable) {
    return <p className="py-6 text-center text-sm text-zinc-500">{data.reason ?? 'Not available'}</p>
  }

  const style = VERDICT_STYLES[data.verdict ?? 'fair'] ?? VERDICT_STYLES.fair
  const mos = data.marginOfSafety ?? 0

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`rounded-md px-2.5 py-1 text-sm font-bold tracking-wide ring-1 ${style.cls}`}>
          {style.label}
        </span>
        <span className="text-sm text-zinc-300">{signedPct(mos)} margin of safety vs price</span>
      </div>

      <div className="mt-4 flex items-baseline gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Fair value / share</div>
          <div className="text-lg font-semibold tabular-nums text-zinc-100">
            {data.fairValueLow != null && data.fairValueHigh != null
              ? `${money(data.fairValueLow)} – ${money(data.fairValueHigh)}`
              : money(data.fairValue ?? 0)}
          </div>
          {data.fairValue != null && (
            <div className="text-xs tabular-nums text-zinc-500">center {money(data.fairValue)}</div>
          )}
        </div>
        {data.price != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Current price</div>
            <div className="text-lg tabular-nums text-zinc-300">{money(data.price)}</div>
          </div>
        )}
      </div>

      {data.impliedGrowth != null && (
        <p className="mt-4 text-[13px] leading-relaxed text-zinc-400">
          <span className="font-medium text-zinc-300">Reverse DCF:</span> to justify today's price, FCF
          must grow ~{(data.impliedGrowth * 100).toFixed(0)}%/yr for 5 yr
          {data.impliedGrowthRead ? ` — ${data.impliedGrowthRead}` : ''}.
        </p>
      )}

      {data.assumptions && data.assumptions.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Assumptions</div>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
            {data.assumptions.map((a) => (
              <div key={a.label} className="flex justify-between gap-2">
                <dt className="text-zinc-500">{a.label}</dt>
                <dd className="tabular-nums text-zinc-300">{a.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-zinc-600">{data.note}</p>
    </div>
  )
}
