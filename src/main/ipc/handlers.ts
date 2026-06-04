import { ipcMain } from 'electron'
import { getQuote } from '../services/stooqService'
import { getFundamentals, getDailyHistory, getIntradayHistory } from '../services/yahooService'
import { listHistory } from '../database/history'
import { getStoredPanels } from '../database/panels'
import { getScorecards } from '../services/scorecardService'
import { getValuation } from '../services/valuationService'

// Renderer-facing channels. Keep mirrored in src/shared/types.ts (AssayApi)
// and src/preload/index.ts. Push channels (research:init, panel:update) are
// sent from the main process via webContents.send — see windows.ts.
export function registerIpc(): void {
  ipcMain.handle('stocks:quote', (_e, symbol: string) => getQuote(symbol))
  ipcMain.handle('stocks:history', (_e, symbol: string) => getDailyHistory(symbol))
  ipcMain.handle('stocks:intraday', (_e, symbol: string, interval: string, range: string) =>
    getIntradayHistory(symbol, interval, range)
  )
  ipcMain.handle('stocks:fundamentals', (_e, symbol: string) => getFundamentals(symbol))
  ipcMain.handle('stocks:scorecards', (_e, symbol: string) => getScorecards(symbol))
  ipcMain.handle('stocks:valuation', (_e, symbol: string) => getValuation(symbol))
  ipcMain.handle('history:list', () => listHistory())
  ipcMain.handle('panels:get', (_e, symbol: string) => getStoredPanels(symbol))
}
