import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AssayApi,
  StockQuote,
  DailyBar,
  IntradayBar,
  Fundamentals,
  Scorecards,
  ValuationData,
  HistoryEntry,
  PushPanel,
  SurfaceInit,
  VcGraph,
  TrackRecordEntry,
  CalendarData
} from '../shared/types'

const api: AssayApi = {
  getQuote: (symbol: string): Promise<StockQuote | null> =>
    ipcRenderer.invoke('stocks:quote', symbol),
  getDailyHistory: (symbol: string): Promise<DailyBar[]> =>
    ipcRenderer.invoke('stocks:history', symbol),
  getIntradayHistory: (symbol: string, interval: string, range: string): Promise<IntradayBar[]> =>
    ipcRenderer.invoke('stocks:intraday', symbol, interval, range),
  getFundamentals: (symbol: string): Promise<Fundamentals | null> =>
    ipcRenderer.invoke('stocks:fundamentals', symbol),
  getScorecards: (symbol: string): Promise<Scorecards | null> =>
    ipcRenderer.invoke('stocks:scorecards', symbol),
  getValuation: (symbol: string): Promise<ValuationData | null> =>
    ipcRenderer.invoke('stocks:valuation', symbol),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
  openResearch: (symbol: string): Promise<void> => ipcRenderer.invoke('research:open', symbol),
  getTrackRecord: (): Promise<TrackRecordEntry[]> => ipcRenderer.invoke('track:list'),
  getCalendar: (symbol: string): Promise<CalendarData | null> =>
    ipcRenderer.invoke('stocks:calendar', symbol),
  getPanels: (symbol: string): Promise<PushPanel[]> => ipcRenderer.invoke('panels:get', symbol),
  onInit: (cb: (init: SurfaceInit) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, init: SurfaceInit): void => cb(init)
    ipcRenderer.on('research:init', handler)
    return () => ipcRenderer.removeListener('research:init', handler)
  },
  getValueChain: (seed: string): Promise<VcGraph | null> =>
    ipcRenderer.invoke('valuechain:get', seed),
  onValueChain: (cb: (graph: VcGraph) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, graph: VcGraph): void => cb(graph)
    ipcRenderer.on('value-chain:update', handler)
    return () => ipcRenderer.removeListener('value-chain:update', handler)
  },
  onPanel: (cb: (panel: PushPanel) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, panel: PushPanel): void => cb(panel)
    ipcRenderer.on('panel:update', handler)
    return () => ipcRenderer.removeListener('panel:update', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
