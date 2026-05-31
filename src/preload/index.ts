import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AssayApi,
  StockQuote,
  DailyBar,
  Fundamentals,
  HistoryEntry,
  PushPanel,
  ResearchInit
} from '../shared/types'

const api: AssayApi = {
  getQuote: (symbol: string): Promise<StockQuote | null> =>
    ipcRenderer.invoke('stocks:quote', symbol),
  getDailyHistory: (symbol: string): Promise<DailyBar[]> =>
    ipcRenderer.invoke('stocks:history', symbol),
  getFundamentals: (symbol: string): Promise<Fundamentals | null> =>
    ipcRenderer.invoke('stocks:fundamentals', symbol),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
  onInit: (cb: (init: ResearchInit) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, init: ResearchInit): void => cb(init)
    ipcRenderer.on('research:init', handler)
    return () => ipcRenderer.removeListener('research:init', handler)
  },
  onPanel: (cb: (panel: PushPanel) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, panel: PushPanel): void => cb(panel)
    ipcRenderer.on('panel:update', handler)
    return () => ipcRenderer.removeListener('panel:update', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
