import { ipcMain } from 'electron'
import { getQuote } from '../services/stooqService'
import {
  getFundamentals,
  getDailyHistory,
  getIntradayHistory,
  getResearchData
} from '../services/yahooService'
import { getTrackRecord } from '../services/trackRecord'
import { listHistory } from '../database/history'
import { openResearchWindow } from '../windows'
import { getStoredPanels } from '../database/panels'
import { getScorecards } from '../services/scorecardService'
import { getValuation } from '../services/valuationService'
import { getGraph } from '../database/valueChain'
import { getDb } from '../database/connection'

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
  // Reopen a saved dossier from the Home history list (no recordResearch — a
  // reopen isn't a new research run).
  ipcMain.handle('research:open', (_e, symbol: string) => openResearchWindow(symbol))
  // Track record of recommendation calls ("audit the analyst"), quotes attached.
  ipcMain.handle('track:list', () => getTrackRecord())
  // Calendar rides the cached research bundle — no extra Yahoo round-trip.
  ipcMain.handle(
    'stocks:calendar',
    async (_e, symbol: string) => (await getResearchData(symbol))?.calendar ?? null
  )
  ipcMain.handle('panels:get', (_e, symbol: string) => getStoredPanels(symbol))
  ipcMain.handle('valuechain:get', (_e, seed: string) => getGraph(getDb(), seed))
}
