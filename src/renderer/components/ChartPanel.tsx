import { useEffect, useRef } from 'react'
import { createChart, ColorType, type IChartApi } from 'lightweight-charts'
import type { DailyBar } from '../../shared/types'

// Candlestick chart with 50/200-day moving averages and a volume overlay.
export function ChartPanel({ bars }: { bars: DailyBar[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || bars.length === 0) return

    const chart: IChartApi = createChart(el, {
      width: el.clientWidth,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: '#09090b' },
        textColor: '#a1a1aa'
      },
      grid: {
        vertLines: { color: '#1f1f23' },
        horzLines: { color: '#1f1f23' }
      },
      rightPriceScale: { borderColor: '#3f3f46' },
      timeScale: { borderColor: '#3f3f46' }
    })

    const candles = chart.addCandlestickSeries({
      upColor: '#34d399',
      downColor: '#f87171',
      wickUpColor: '#34d399',
      wickDownColor: '#f87171',
      borderVisible: false
    })
    candles.setData(
      bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }))
    )

    const addMa = (period: number, color: string): void => {
      const line = chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false
      })
      line.setData(sma(bars, period))
    }
    addMa(50, '#60a5fa')
    addMa(200, '#f59e0b')

    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    vol.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: '#3f3f4688' })))

    chart.timeScale().fitContent()

    const onResize = (): void => chart.applyOptions({ width: el.clientWidth })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
    }
  }, [bars])

  return <div ref={containerRef} className="w-full" />
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
