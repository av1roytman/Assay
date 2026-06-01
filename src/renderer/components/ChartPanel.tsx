import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp
} from 'lightweight-charts'
import type { DailyBar, IntradayBar } from '../../shared/types'

// Selectable windows. Short ranges fetch intraday candles; the rest derive from
// the full daily history we already hold (aggregated to weekly/monthly).
const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y', 'MAX'] as const
type Range = (typeof RANGES)[number]

type Gran = 'daily' | 'weekly' | 'monthly'
interface RangeSpec {
  // Intraday: fetched on demand at `interval`, over Yahoo's `fetch` range.
  intraday?: { interval: string; fetch: string; label: string }
  // Daily-derived: candle granularity + visible-window lookback in days.
  gran?: Gran
  days?: number
}
const SPECS: Record<Range, RangeSpec> = {
  '1D': { intraday: { interval: '5m', fetch: '1d', label: '5m' } },
  '1W': { intraday: { interval: '15m', fetch: '5d', label: '15m' } },
  '1M': { intraday: { interval: '60m', fetch: '1mo', label: '1h' } },
  '3M': { gran: 'daily', days: 90 },
  '6M': { gran: 'daily', days: 180 },
  '1Y': { gran: 'daily', days: 365 },
  '5Y': { gran: 'weekly', days: 1825 },
  '10Y': { gran: 'monthly', days: 3650 },
  MAX: { gran: 'monthly' }
}

interface Readout {
  intraday: boolean
  time: string | number
  open: number
  high: number
  low: number
  close: number
  change: number
  changePct: number
}

const UP = '#34d399'
const DOWN = '#f87171'
const MA50 = '#60a5fa'
const MA200 = '#f59e0b'
const VOL = '#3f3f4688'

interface Series {
  candles: ISeriesApi<'Candlestick'>
  ma50: ISeriesApi<'Line'>
  ma200: ISeriesApi<'Line'>
  vol: ISeriesApi<'Histogram'>
}

export function ChartPanel({ bars, symbol }: { bars: DailyBar[]; symbol: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Series | null>(null)
  const viewKeyRef = useRef<string | null>(null)
  const cacheRef = useRef<Partial<Record<Range, IntradayBar[]>>>({})
  const [range, setRange] = useState<Range>('6M')
  const [readout, setReadout] = useState<Readout | null>(null)
  const [intraday, setIntraday] = useState<IntradayBar[] | null>(null)
  const [loading, setLoading] = useState(false)

  // Build the chart + series once per dataset; views are applied separately.
  useEffect(() => {
    const el = containerRef.current
    if (!el || bars.length === 0) return

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#09090b' },
        textColor: '#a1a1aa',
        attributionLogo: false
      },
      grid: { vertLines: { color: '#1f1f23' }, horzLines: { color: '#1f1f23' } },
      rightPriceScale: { borderColor: '#3f3f46' },
      timeScale: { borderColor: '#3f3f46' },
      crosshair: { mode: 0 }
    })
    chartRef.current = chart

    const candles = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false
    })
    const mkMa = (color: string): ISeriesApi<'Line'> =>
      chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    seriesRef.current = { candles, ma50: mkMa(MA50), ma200: mkMa(MA200), vol }
    viewKeyRef.current = null

    const onMove = (param: MouseEventParams): void => {
      const bar = param.seriesData.get(candles) as
        | { open: number; high: number; low: number; close: number }
        | undefined
      if (param.time == null || !bar) {
        setReadout(null)
        return
      }
      const change = bar.close - bar.open
      setReadout({
        intraday: typeof param.time === 'number',
        time: param.time as string | number,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        change,
        changePct: bar.open ? (change / bar.open) * 100 : 0
      })
    }
    chart.subscribeCrosshairMove(onMove)

    return () => {
      chart.unsubscribeCrosshairMove(onMove)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      viewKeyRef.current = null
    }
  }, [bars])

  // Apply the selected view: fetch + render intraday, or aggregate daily.
  useEffect(() => {
    const chart = chartRef.current
    const s = seriesRef.current
    if (!chart || !s) return
    const spec = SPECS[range]
    let cancelled = false
    setReadout(null)

    async function go(): Promise<void> {
      if (!chart || !s) return
      if (spec.intraday) {
        let data = cacheRef.current[range]
        if (!data) {
          setLoading(true)
          data = await window.api.getIntradayHistory(symbol, spec.intraday.interval, spec.intraday.fetch)
          if (cancelled) return
          cacheRef.current[range] = data
          setLoading(false)
        }
        setIntraday(data)
        const key = `intra:${range}`
        if (viewKeyRef.current !== key) {
          renderIntraday(s, data)
          viewKeyRef.current = key
        }
        chart.timeScale().applyOptions({ timeVisible: true, secondsVisible: false })
        chart.timeScale().fitContent()
      } else {
        setIntraday(null)
        const key = `daily:${spec.gran}`
        if (viewKeyRef.current !== key) {
          renderDaily(s, bars, spec.gran as Gran)
          viewKeyRef.current = key
        }
        chart.timeScale().applyOptions({ timeVisible: false })
        applyDailyRange(chart, bars, spec.days)
      }
    }
    void go()
    return () => {
      cancelled = true
    }
  }, [range, bars, symbol])

  const spec = SPECS[range]
  const periodLabel = spec.intraday
    ? spec.intraday.label
    : spec.gran === 'monthly'
      ? 'mo'
      : spec.gran === 'weekly'
        ? 'wk'
        : 'day'

  const summary = useMemo(() => {
    if (spec.intraday) {
      const d = intraday
      if (!d || d.length === 0) return null
      const base = d[0].close
      const last = d[d.length - 1].close
      return {
        last,
        baseClose: base,
        delta: last - base,
        pct: base ? ((last - base) / base) * 100 : 0,
        from: fmtDate(tsToISO(d[0].time)),
        to: fmtDate(tsToISO(d[d.length - 1].time))
      }
    }
    const last = bars[bars.length - 1]
    const fromMs = spec.days ? Date.parse(last.time) - spec.days * 86_400_000 : -Infinity
    const windowBars = spec.days ? bars.filter((b) => Date.parse(b.time) >= fromMs) : bars
    const base = windowBars[0] ?? bars[0]
    return {
      last: last.close,
      baseClose: base.close,
      delta: last.close - base.close,
      pct: base.close ? ((last.close - base.close) / base.close) * 100 : 0,
      from: fmtDate(windowBars[0]?.time ?? bars[0].time),
      to: fmtDate(last.time)
    }
  }, [bars, range, intraday, spec.days, spec.intraday])

  const accent = (readout ? readout.change : (summary?.delta ?? 0)) >= 0 ? UP : DOWN
  const sinceStartPct =
    readout && summary?.baseClose
      ? ((readout.close - summary.baseClose) / summary.baseClose) * 100
      : null

  return (
    <div className="flex w-full flex-1 flex-col min-h-0">
      <div className="mb-2 flex items-start justify-between gap-2">
        {/* Fixed height so swapping summary ↔ hover-readout never reflows the
            chart below (which would jiggle with autoSize). */}
        <div className="h-12 overflow-hidden">
          {readout ? (
            <>
              <div className="flex items-baseline gap-2 whitespace-nowrap">
                <span className="text-xl font-bold tabular-nums text-zinc-100">
                  {money(readout.close)}
                </span>
                <span className="text-xs font-semibold tabular-nums" style={{ color: accent }}>
                  {readout.change >= 0 ? '+' : '−'}
                  {money(Math.abs(readout.change))} ({readout.changePct >= 0 ? '+' : ''}
                  {readout.changePct.toFixed(2)}%) {periodLabel}
                </span>
                {sinceStartPct != null && (
                  <span
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                    style={{ color: sinceStartPct >= 0 ? UP : DOWN }}
                  >
                    {range} {sinceStartPct >= 0 ? '+' : ''}
                    {sinceStartPct.toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500 tabular-nums">
                {readout.intraday
                  ? fmtIntradayStamp(readout.time as number)
                  : fmtReadoutDate(readout.time as string, spec.gran ?? 'daily')}{' '}
                · O {readout.open.toFixed(2)} H {readout.high.toFixed(2)} L {readout.low.toFixed(2)} C{' '}
                {readout.close.toFixed(2)}
              </div>
            </>
          ) : summary ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold tabular-nums text-zinc-100">
                  {money(summary.last)}
                </span>
                <span className="text-xs font-semibold tabular-nums" style={{ color: accent }}>
                  {summary.delta >= 0 ? '+' : '−'}
                  {money(Math.abs(summary.delta))} ({summary.pct >= 0 ? '+' : ''}
                  {summary.pct.toFixed(2)}%)
                </span>
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500 tabular-nums">
                {summary.from} → {summary.to}
              </div>
            </>
          ) : (
            <div className="py-2 text-sm text-zinc-500">{loading ? 'Loading…' : 'No data'}</div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] transition-colors ${
                range === r
                  ? 'bg-zinc-700 text-zinc-50 ring-1 ring-inset ring-zinc-600'
                  : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-1.5 flex items-center gap-4 text-[10px] font-medium text-zinc-400">
        {spec.intraday ? (
          <span className="text-zinc-500">
            {loading
              ? 'loading…'
              : `${spec.intraday.label} candles${intraday && intraday.length === 0 ? ' · no intraday data' : ''}`}
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[2px] w-3.5 rounded" style={{ backgroundColor: MA50 }} />
              50-day MA
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[2px] w-3.5 rounded"
                style={{ backgroundColor: MA200 }}
              />
              200-day MA
            </span>
            {spec.gran !== 'daily' && <span className="text-zinc-500">· {spec.gran} candles</span>}
          </>
        )}
      </div>
      <div ref={containerRef} className="min-h-[240px] w-full flex-1" />
    </div>
  )
}

function renderDaily(s: Series, bars: DailyBar[], gran: Gran): void {
  const disp = aggregate(bars, gran)
  s.candles.setData(
    disp.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }))
  )
  s.vol.setData(disp.map((b) => ({ time: b.time, value: b.volume, color: VOL })))
  // MAs computed on DAILY closes, sampled at displayed dates → stay true 50/200-day.
  const times = new Set(disp.map((b) => b.time))
  s.ma50.setData(sma(bars, 50).filter((p) => times.has(p.time)))
  s.ma200.setData(sma(bars, 200).filter((p) => times.has(p.time)))
}

function renderIntraday(s: Series, data: IntradayBar[]): void {
  s.candles.setData(
    data.map((b) => ({
      time: localTs(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close
    }))
  )
  s.vol.setData(data.map((b) => ({ time: localTs(b.time), value: b.volume, color: VOL })))
  // Day-based MAs don't apply intraday — clear them.
  s.ma50.setData([])
  s.ma200.setData([])
}

// Shift a UTC timestamp so lightweight-charts (which renders times in UTC) shows
// the viewer's local wall-clock — i.e. a 9:30 ET open reads "09:30", not "13:30".
function localTs(sec: number): UTCTimestamp {
  return (sec - new Date(sec * 1000).getTimezoneOffset() * 60) as UTCTimestamp
}

function aggregate(bars: DailyBar[], gran: Gran): DailyBar[] {
  if (gran === 'daily') return bars
  const groups = new Map<string, DailyBar[]>()
  const order: string[] = []
  for (const b of bars) {
    const key = gran === 'weekly' ? weekKey(b.time) : b.time.slice(0, 7)
    let g = groups.get(key)
    if (!g) {
      g = []
      groups.set(key, g)
      order.push(key)
    }
    g.push(b)
  }
  return order.map((key) => {
    const g = groups.get(key) as DailyBar[]
    let high = -Infinity
    let low = Infinity
    let volume = 0
    for (const x of g) {
      if (x.high > high) high = x.high
      if (x.low < low) low = x.low
      volume += x.volume
    }
    return { time: g[g.length - 1].time, open: g[0].open, high, low, close: g[g.length - 1].close, volume }
  })
}

function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return d.toISOString().slice(0, 10)
}

function applyDailyRange(chart: IChartApi, bars: DailyBar[], days?: number): void {
  const ts = chart.timeScale()
  if (!days) {
    ts.fitContent()
    return
  }
  const lastMs = Date.parse(bars[bars.length - 1].time)
  const firstMs = Date.parse(bars[0].time)
  const fromMs = Math.max(lastMs - days * 86_400_000, firstMs)
  try {
    ts.setVisibleRange({ from: toISO(fromMs), to: bars[bars.length - 1].time })
  } catch {
    ts.fitContent()
  }
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function tsToISO(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtReadoutDate(iso: string, gran: Gran): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  if (gran === 'monthly') return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// `shiftedSec` is already offset to local-wall-as-UTC (see localTs), so read UTC.
function fmtIntradayStamp(shiftedSec: number): string {
  const d = new Date(shiftedSec * 1000)
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${date}, ${hh}:${mm}`
}

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

function sma(bars: DailyBar[], period: number): { time: string; value: number }[] {
  const out: { time: string; value: number }[] = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close
    if (i >= period) sum -= bars[i - period].close
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period })
  }
  return out
}
