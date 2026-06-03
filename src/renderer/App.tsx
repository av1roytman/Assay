import { useEffect, useState, type ReactNode } from 'react'
import type {
  StockQuote,
  DailyBar,
  PushPanel,
  HistoryEntry,
  RecommendationData,
  SecSummaryData,
  Metric,
  NewsData,
  NewsItem,
  NewsSentiment,
  PriceTargets,
  AnalystCall,
  Fundamentals,
  Scorecards
} from '../shared/types'
import { ChartPanel } from './components/ChartPanel'
import { ScorecardGrid } from './components/ScorecardPanel'

export default function App(): JSX.Element {
  const [ticker, setTicker] = useState<string | null>(null)

  useEffect(() => window.api.onInit((init) => setTicker(init.ticker)), [])

  return ticker ? <Dashboard ticker={ticker} /> : <Home />
}

function Home(): JSX.Element {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  useEffect(() => {
    void window.api.getHistory().then(setHistory)
  }, [])

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Assay</h1>
      <p className="mt-3 text-zinc-400">
        Ask Claude to research a ticker — e.g.{' '}
        <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm text-zinc-200">/research AAPL</code>
        . The dossier opens in its own window and fills in live.
      </p>
      {history.length > 0 && (
        <div className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recent</h2>
          <ul className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {history.map((h) => (
              <li
                key={h.symbol}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="font-medium">{h.symbol}</span>
                <span className="text-zinc-500">
                  {new Date(h.lastResearchedAt).toLocaleDateString()} · {h.count}×
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Dashboard({ ticker }: { ticker: string }): JSX.Element {
  const [quote, setQuote] = useState<StockQuote | null>(null)
  const [bars, setBars] = useState<DailyBar[] | null>(null)
  const [panels, setPanels] = useState<Record<string, PushPanel>>({})
  const [fundamentals, setFundamentals] = useState<Fundamentals | null | undefined>(undefined)
  const [scorecards, setScorecards] = useState<Scorecards | null | undefined>(undefined)

  useEffect(() => {
    void window.api.getQuote(ticker).then(setQuote)
    void window.api.getDailyHistory(ticker).then(setBars)
    setFundamentals(undefined)
    void window.api
      .getFundamentals(ticker)
      .then(setFundamentals)
      .catch(() => setFundamentals(null))
    setScorecards(undefined)
    void window.api
      .getScorecards(ticker)
      .then(setScorecards)
      .catch(() => setScorecards(null))
  }, [ticker])

  // Seed from any persisted panels (the last dossier) so the window isn't blank
  // on reopen; live pushes below overwrite them once Claude finishes a fresh pass.
  useEffect(() => {
    let cancelled = false
    void window.api.getPanels(ticker).then((stored) => {
      if (!cancelled) setPanels((prev) => mergePanels(prev, stored))
    })
    return () => {
      cancelled = true
    }
  }, [ticker])

  useEffect(
    () =>
      window.api.onPanel((p) => {
        if (p.ticker.toUpperCase() === ticker.toUpperCase()) {
          setPanels((prev) => mergePanels(prev, [p]))
        }
      }),
    [ticker]
  )

  return (
    <div className="flex h-full flex-col">
      <Header ticker={ticker} quote={quote} />
      <div className="grid flex-1 auto-rows-min gap-4 overflow-auto p-4 lg:grid-cols-2">
        <Panel title="Price" className="flex flex-col">
          {bars === null ? (
            <Loading />
          ) : bars.length === 0 ? (
            <Empty msg="No price history" />
          ) : (
            <ChartPanel bars={bars} symbol={ticker} />
          )}
        </Panel>
        <Panel title="Key stats">
          <KeyStats quote={quote} bars={bars} fundamentals={fundamentals} />
        </Panel>
        <Panel title="Scorecards">
          {scorecards === undefined ? (
            <Loading />
          ) : scorecards === null || scorecards.cards.length === 0 ? (
            <Empty msg="No scorecard data" />
          ) : (
            <ScorecardGrid data={scorecards} />
          )}
        </Panel>
        <RecommendationCard panel={panels['recommendation']} />
        <SecSummaryCard panel={panels['sec-summary']} />
        <NewsCard panel={panels['news']} />
      </div>
    </div>
  )
}

// Keep the newest version per panel type (live pushes carry a fresh savedAt and
// thus win over stored ones; a late stored load can't clobber a fresh push).
function mergePanels(
  prev: Record<string, PushPanel>,
  incoming: PushPanel[]
): Record<string, PushPanel> {
  const next = { ...prev }
  for (const p of incoming) {
    const existing = next[p.type]
    if (!existing || (p.savedAt ?? 0) >= (existing.savedAt ?? 0)) next[p.type] = p
  }
  return next
}

function Header({ ticker, quote }: { ticker: string; quote: StockQuote | null }): JSX.Element {
  const up = (quote?.change ?? 0) >= 0
  return (
    <header className="flex items-baseline gap-4 border-b border-zinc-800 px-5 py-4">
      <h1 className="text-xl font-semibold tracking-tight">{ticker}</h1>
      {quote && quote.price !== null && (
        <div className="flex items-baseline gap-2">
          <span className="text-lg tabular-nums">{fmt(quote.price)}</span>
          <span className={`text-sm tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
            {up ? '+' : ''}
            {fmt(quote.change)} ({up ? '+' : ''}
            {fmt(quote.changePct)}%)
          </span>
        </div>
      )}
    </header>
  )
}

function Panel({
  title,
  meta,
  className,
  children
}: {
  title: string
  meta?: ReactNode
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section
      className={`rounded-lg border border-zinc-800 bg-zinc-900/40 p-4${className ? ` ${className}` : ''}`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
        {meta && <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{meta}</span>}
      </div>
      {children}
    </section>
  )
}

// ── Recommendation ──────────────────────────────────────────────────────────

const CALL_STYLES: Record<AnalystCall, { label: string; cls: string }> = {
  buy: { label: 'BUY', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  hold: { label: 'HOLD', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  avoid: { label: 'AVOID', cls: 'bg-red-500/15 text-red-300 ring-red-500/30' }
}

function RecommendationCard({ panel }: { panel: PushPanel | undefined }): JSX.Element {
  const data = panel?.data as RecommendationData | undefined
  return (
    <Panel
      title={panel?.title ?? 'Recommendation'}
      meta={panel?.savedAt ? `researched ${fmtStamp(panel.savedAt)}` : undefined}
    >
      {data ? <Recommendation data={data} /> : <Loading label="Waiting for Claude…" />}
    </Panel>
  )
}

function Recommendation({ data }: { data: RecommendationData }): JSX.Element {
  const style = CALL_STYLES[data.call] ?? CALL_STYLES.hold
  const { street } = data
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`rounded-md px-2.5 py-1 text-sm font-bold tracking-wide ring-1 ${style.cls}`}>
          {style.label}
        </span>
        <span className="text-sm font-medium text-zinc-200">{data.headline}</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <SubHead>My call</SubHead>
          <p className="text-[13px] leading-relaxed text-zinc-400">{data.thesis}</p>
          {(data.buyIf || data.avoidIf) && (
            <div className="mt-3 space-y-1 text-[13px]">
              {data.buyIf && (
                <div className="flex gap-2">
                  <span className="shrink-0 font-medium text-emerald-400">▲ Buy if</span>
                  <span className="text-zinc-400">{data.buyIf}</span>
                </div>
              )}
              {data.avoidIf && (
                <div className="flex gap-2">
                  <span className="shrink-0 font-medium text-red-400">▼ Avoid if</span>
                  <span className="text-zinc-400">{data.avoidIf}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <SubHead>The street</SubHead>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {street.rating && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-medium text-zinc-200">
                {street.rating}
              </span>
            )}
            {street.score != null && (
              <span className="text-xs text-zinc-500">★ {street.score.toFixed(2)}</span>
            )}
            {street.analysts != null && (
              <span className="text-xs text-zinc-500">· {street.analysts} analysts</span>
            )}
          </div>
          {street.targets && <TargetBar targets={street.targets} />}
          {street.notable && street.notable.length > 0 && (
            <div className="mt-3 space-y-0.5 text-[12px]">
              {street.notable.map((n, i) => (
                <div key={i}>
                  <span className="text-zinc-300">{n.firm}</span>
                  {n.target != null && (
                    <span className="ml-1 tabular-nums text-emerald-300">{fmtUsd(n.target)}</span>
                  )}
                  {n.note && <span className="text-zinc-500"> · {n.note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.asOf && <div className="mt-4 text-[11px] text-zinc-600">{data.asOf}</div>}
    </div>
  )
}

function TargetBar({ targets }: { targets: PriceTargets }): JSX.Element {
  const { low, high, mean, median, current } = targets
  const target = mean ?? median
  const usable = low != null && high != null && high > low
  const pos = (v: number): string =>
    `${Math.min(100, Math.max(0, ((v - low!) / (high! - low!)) * 100))}%`

  return (
    <div className="mt-3">
      {usable && (
        <div className="relative mb-1 h-3">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-700" />
          {target != null && (
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400 ring-2 ring-zinc-900"
              style={{ left: pos(target) }}
            />
          )}
          {current != null && (
            <div
              className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-zinc-100"
              style={{ left: pos(current) }}
            />
          )}
        </div>
      )}
      {usable && (
        <div className="flex justify-between text-[10px] tabular-nums text-zinc-500">
          <span>{fmtUsd(low!)}</span>
          <span>{fmtUsd(high!)}</span>
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
        {target != null && (
          <span className="text-emerald-300">● target {fmtUsd(target)}</span>
        )}
        {current != null && <span className="text-zinc-300">▏now {fmtUsd(current)}</span>}
      </div>
    </div>
  )
}

// ── SEC filing summary ──────────────────────────────────────────────────────

function SecSummaryCard({ panel }: { panel: PushPanel | undefined }): JSX.Element {
  const data = panel?.data as SecSummaryData | undefined
  return (
    <Panel
      title={panel?.title ?? 'SEC Filing Summary'}
      meta={panel?.savedAt ? `researched ${fmtStamp(panel.savedAt)}` : undefined}
    >
      {data ? <SecSummary data={data} /> : <Loading label="Waiting for Claude…" />}
    </Panel>
  )
}

function SecSummary({ data }: { data: SecSummaryData }): JSX.Element {
  return (
    <div>
      <p className="text-[13px] leading-relaxed text-zinc-400">{data.business}</p>

      {data.metrics.length > 0 && (
        <div className="mt-4 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
          {data.metrics.map((m, i) => (
            <MetricCell key={i} m={m} />
          ))}
        </div>
      )}

      {data.highlights.length > 0 && (
        <>
          <SubHead>Notable</SubHead>
          <ul className="space-y-1 text-[13px] text-zinc-300">
            {data.highlights.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-zinc-600">•</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.trajectory && (
        <>
          <SubHead>Trajectory</SubHead>
          <p className="text-[13px] leading-relaxed text-zinc-400">{data.trajectory}</p>
        </>
      )}

      {data.note && (
        <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-200/80">
          {data.note}
        </div>
      )}

      {data.filing && (
        <div className="mt-4 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          {data.filing.form}
          {data.filing.period ? ` · ${data.filing.period}` : ''}
          {data.filing.filed ? ` · filed ${data.filing.filed}` : ''}
        </div>
      )}
    </div>
  )
}

// ── News & catalysts ─────────────────────────────────────────────────────────

function NewsCard({ panel }: { panel: PushPanel | undefined }): JSX.Element {
  const data = panel?.data as NewsData | undefined
  return (
    <Panel
      title={panel?.title ?? 'News & catalysts'}
      meta={panel?.savedAt ? `researched ${fmtStamp(panel.savedAt)}` : undefined}
    >
      {data ? <News data={data} /> : <Loading label="Waiting for Claude…" />}
    </Panel>
  )
}

function News({ data }: { data: NewsData }): JSX.Element {
  return (
    <div>
      {data.items.length > 0 ? (
        <ul className="space-y-3">
          {data.items.map((it, i) => (
            <NewsRow key={i} item={it} />
          ))}
        </ul>
      ) : (
        <Empty msg="No recent news" />
      )}

      {data.catalysts && data.catalysts.length > 0 && (
        <>
          <SubHead>Catalysts ahead</SubHead>
          <ul className="space-y-1 text-[13px]">
            {data.catalysts.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-zinc-600">▸</span>
                <span className="text-zinc-300">{c.label}</span>
                {c.when && <span className="text-zinc-500">· {c.when}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.note && (
        <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-200/80">
          {data.note}
        </div>
      )}

      {data.asOf && <div className="mt-4 text-[11px] text-zinc-600">{data.asOf}</div>}
    </div>
  )
}

function NewsRow({ item }: { item: NewsItem }): JSX.Element {
  return (
    <li>
      <div className="flex items-start justify-between gap-2">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-medium text-zinc-200 hover:text-emerald-300 hover:underline"
          >
            {item.headline}
          </a>
        ) : (
          <span className="text-[13px] font-medium text-zinc-200">{item.headline}</span>
        )}
        {item.sentiment && <SentimentPill sentiment={item.sentiment} />}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">
        {item.source}
        {item.date && ` · ${fmtRelDate(item.date)}`}
      </div>
      {item.why && (
        <div className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{item.why}</div>
      )}
    </li>
  )
}

const SENTIMENT_STYLES: Record<NewsSentiment, { label: string; cls: string }> = {
  positive: { label: 'pos', cls: 'bg-emerald-500/15 text-emerald-300' },
  negative: { label: 'neg', cls: 'bg-red-500/15 text-red-300' },
  neutral: { label: 'neu', cls: 'bg-zinc-700/50 text-zinc-400' }
}

function SentimentPill({ sentiment }: { sentiment: NewsSentiment }): JSX.Element {
  const s = SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

function MetricCell({ m, featured = false }: { m: Metric; featured?: boolean }): JSX.Element {
  const tone =
    m.tone === 'good' ? 'text-emerald-300' : m.tone === 'bad' ? 'text-red-300' : 'text-zinc-100'
  return (
    <div
      className={`rounded-md px-3 py-2 ${featured ? 'bg-zinc-800/70 ring-1 ring-zinc-700' : 'bg-zinc-800/40'}`}
    >
      <div className="text-[11px] text-zinc-500">{m.label}</div>
      <div className={`text-base font-medium tabular-nums ${tone}`}>{m.value}</div>
      {m.sub && <div className="text-[11px] text-zinc-500">{m.sub}</div>}
    </div>
  )
}

// ── shared bits ─────────────────────────────────────────────────────────────

function SubHead({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h3 className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
      {children}
    </h3>
  )
}

// ── Key stats ───────────────────────────────────────────────────────────────

interface DerivedStats {
  price: number
  change: number
  changePct: number
  prevClose: number
  dayLow?: number
  dayHigh?: number
  lo52?: number
  hi52?: number
  fromHigh?: number
  fromLow?: number
  vs50?: number
  vs200?: number
  ret1m?: number
  ret3m?: number
  ret6m?: number
  ret1y?: number
  volume?: number
  avgVol30?: number
}

// Everything the panel can compute from the quote + daily bars we already fetch.
function deriveStats(quote: StockQuote | null, bars: DailyBar[]): DerivedStats | null {
  if (bars.length === 0) {
    if (!quote || quote.price === null) return null
    return {
      price: quote.price,
      change: 0,
      changePct: 0,
      prevClose: quote.price,
      dayLow: quote.low ?? undefined,
      dayHigh: quote.high ?? undefined,
      volume: quote.volume ?? undefined
    }
  }
  const n = bars.length
  const last = bars[n - 1].close
  const sameSession = quote?.price == null || Math.abs(quote.price - last) < 1e-6
  const price = quote?.price ?? last
  const prevClose = sameSession ? (n >= 2 ? bars[n - 2].close : last) : last
  const change = price - prevClose
  const changePct = prevClose ? (change / prevClose) * 100 : 0

  const avg = (arr: number[]): number => arr.reduce((s, v) => s + v, 0) / arr.length
  const closes = bars.map((b) => b.close)
  const window52 = bars.slice(-252)
  const hi52 = Math.max(...window52.map((b) => b.high))
  const lo52 = Math.min(...window52.map((b) => b.low))
  const ma50 = n >= 50 ? avg(closes.slice(-50)) : undefined
  const ma200 = n >= 200 ? avg(closes.slice(-200)) : undefined
  // Calendar-based return: base = the first close on/after `days` calendar days
  // before the last bar — the same convention as the chart's range deltas, so
  // the two panels agree. Returns undefined when history doesn't span the window.
  const lastMs = Date.parse(bars[n - 1].time)
  const oldestMs = Date.parse(bars[0].time)
  const ret = (days: number): number | undefined => {
    const cutoff = lastMs - days * 86_400_000
    if (oldestMs > cutoff) return undefined
    const base = bars.find((b) => Date.parse(b.time) >= cutoff)
    return base && base.close ? ((price - base.close) / base.close) * 100 : undefined
  }
  const vols = bars.map((b) => b.volume).filter((v) => v > 0)

  return {
    price,
    change,
    changePct,
    prevClose,
    dayLow: quote?.low ?? bars[n - 1].low,
    dayHigh: quote?.high ?? bars[n - 1].high,
    lo52,
    hi52,
    fromHigh: ((price - hi52) / hi52) * 100,
    fromLow: ((price - lo52) / lo52) * 100,
    vs50: ma50 ? ((price - ma50) / ma50) * 100 : undefined,
    vs200: ma200 ? ((price - ma200) / ma200) * 100 : undefined,
    ret1m: ret(30),
    ret3m: ret(90),
    ret6m: ret(180),
    ret1y: ret(365),
    volume: quote?.volume ?? bars[n - 1].volume,
    avgVol30: vols.length ? avg(vols.slice(-30)) : undefined
  }
}

function KeyStats({
  quote,
  bars,
  fundamentals
}: {
  quote: StockQuote | null
  bars: DailyBar[] | null
  fundamentals: Fundamentals | null | undefined
}): JSX.Element {
  const d = deriveStats(quote, bars ?? [])
  if (!d) return <Loading />
  const up = d.change >= 0
  const hasRange = d.dayLow != null || d.lo52 != null
  const hasTrend = d.vs50 != null || d.vs200 != null || d.ret1y != null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{fmtUsd(d.price)}</span>
        <span
          className={`text-sm font-medium tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {up ? '▲' : '▼'} {fmtUsd(Math.abs(d.change))} ({up ? '+' : '−'}
          {Math.abs(d.changePct).toFixed(2)}%)
        </span>
        <span className="text-xs tabular-nums text-zinc-500">prev {fmtUsd(d.prevClose)}</span>
      </div>

      <Valuation f={fundamentals} />

      {hasRange && (
        <div>
          <SubHead>Range</SubHead>
          <div className="space-y-3">
            {d.dayLow != null && d.dayHigh != null && (
              <RangeRow label="Day" low={d.dayLow} high={d.dayHigh} current={d.price} />
            )}
            {d.lo52 != null && d.hi52 != null && (
              <RangeRow
                label="52-week"
                low={d.lo52}
                high={d.hi52}
                current={d.price}
                note={d.fromHigh != null ? `${pctStr(d.fromHigh)} from high` : undefined}
              />
            )}
          </div>
        </div>
      )}

      {hasTrend && (
        <div>
          <SubHead>Trend</SubHead>
          <div className="grid grid-cols-2 gap-2">
            <DeltaCell label="vs 50-day" v={d.vs50} featured />
            <DeltaCell label="vs 200-day" v={d.vs200} featured />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <DeltaCell label="1M" v={d.ret1m} />
            <DeltaCell label="3M" v={d.ret3m} />
            <DeltaCell label="6M" v={d.ret6m} />
            <DeltaCell label="1Y" v={d.ret1y} featured />
          </div>
        </div>
      )}

      {d.volume != null && (
        <div>
          <SubHead>Volume</SubHead>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm tabular-nums">
            <span>
              Today <span className="font-medium">{fmtVol(d.volume)}</span>
            </span>
            {d.avgVol30 != null && (
              <span className="text-zinc-500">· 30-day avg {fmtVol(d.avgVol30)}</span>
            )}
            {d.avgVol30 != null && d.avgVol30 > 0 && d.volume / d.avgVol30 >= 1.25 && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                {(d.volume / d.avgVol30).toFixed(1)}× avg
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Valuation({ f }: { f: Fundamentals | null | undefined }): JSX.Element | null {
  if (f === undefined) {
    return (
      <div>
        <SubHead>Valuation</SubHead>
        <div className="text-xs text-zinc-600">Loading…</div>
      </div>
    )
  }
  if (f === null) return null

  const cells: { m: Metric; featured?: boolean }[] = []
  if (f.marketCap != null)
    cells.push({ m: { label: 'Market cap', value: fmtBig(f.marketCap) }, featured: true })
  if (f.trailingPE != null)
    cells.push({ m: { label: 'P/E (ttm)', value: f.trailingPE.toFixed(1) }, featured: true })
  if (f.forwardPE != null) cells.push({ m: { label: 'Fwd P/E', value: f.forwardPE.toFixed(1) } })
  if (f.eps != null) cells.push({ m: { label: 'EPS (ttm)', value: fmtUsd(f.eps) } })
  if (f.dividendYield != null)
    cells.push({ m: { label: 'Div yield', value: `${f.dividendYield.toFixed(2)}%` } })
  if (f.beta != null) cells.push({ m: { label: 'Beta', value: f.beta.toFixed(2) } })
  if (cells.length === 0) return null

  return (
    <div>
      <SubHead>Valuation</SubHead>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(96px,1fr))]">
        {cells.map((c, i) => (
          <MetricCell key={i} m={c.m} featured={c.featured} />
        ))}
      </div>
    </div>
  )
}

function RangeRow({
  label,
  low,
  high,
  current,
  note
}: {
  label: string
  low: number
  high: number
  current: number
  note?: string
}): JSX.Element {
  const pct = high > low ? Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100)) : 50
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] tabular-nums">
        <span className="text-zinc-400">{label}</span>
        {note && <span className="text-zinc-400">{note}</span>}
      </div>
      <div className="relative h-1.5 rounded-full bg-zinc-700">
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-100 ring-2 ring-zinc-900"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500">
        <span>{fmtUsd(low)}</span>
        <span>{fmtUsd(high)}</span>
      </div>
    </div>
  )
}

function DeltaCell({
  label,
  v,
  featured = false
}: {
  label: string
  v?: number
  featured?: boolean
}): JSX.Element {
  const tone = v == null ? 'text-zinc-500' : v >= 0 ? 'text-emerald-300' : 'text-red-300'
  return (
    <div
      className={`rounded-md px-2.5 py-1.5 ${featured ? 'bg-zinc-800/70 ring-1 ring-zinc-700' : 'bg-zinc-800/40'}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${tone}`}>
        {v != null ? pctStr(v) : '—'}
      </div>
    </div>
  )
}

function Loading({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return <div className="py-6 text-sm text-zinc-500">{label}</div>
}

function Empty({ msg }: { msg: string }): JSX.Element {
  return <div className="py-6 text-sm text-zinc-600">{msg}</div>
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined
    ? '—'
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fmtUsd(n: number): string {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 })
}

function fmtBig(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  return fmtUsd(n)
}

function fmtVol(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K'
  return String(n)
}

function pctStr(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

// Relative age of an ISO date, computed at view time so reopened dossiers stay
// accurate. Falls back to an absolute "Mon D" for future or >30-day-old dates.
function fmtRelDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days < 0) return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtStamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}
