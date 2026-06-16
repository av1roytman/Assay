// Plain-language explanations for metric acronyms, shown as native title
// tooltips. Matched by scanning the label for a known term (listed longest /
// most-specific first so "Fwd P/E" and "P/E (ttm)" both resolve sensibly).

const TERMS: [string, string][] = [
  ['EV/EBITDA', 'Enterprise value ÷ EBITDA — a capital-structure-neutral price tag; lower is cheaper'],
  ['FCF yield', 'Free cash flow ÷ market cap — the cash return the business earns at the current price'],
  ['FCF coverage', 'Free cash flow vs debt/obligations — how comfortably cash covers what is owed'],
  ['FCF', 'Free cash flow — operating cash flow minus capital expenditures'],
  ['margin of safety', 'Discount of the current price to estimated fair value — bigger is safer'],
  ['reverse DCF', 'Solves the DCF backwards: the growth rate needed to justify today’s price'],
  ['DCF', 'Discounted cash flow — future cash flows valued in today’s dollars'],
  ['PEG', 'P/E ÷ growth rate — under ~1 suggests growth is cheaply priced'],
  ['Fwd P/E', 'Price ÷ next-12-months expected earnings per share'],
  ['P/E', 'Price ÷ earnings per share — years of current profits you pay for the stock'],
  ['P/B', 'Price ÷ book (accounting net-asset) value per share'],
  ['P/S', 'Price ÷ sales per share — useful when earnings are thin or negative'],
  ['ROIC', 'Return on invested capital — operating profit ÷ all capital employed'],
  ['ROE', 'Return on equity — net income ÷ shareholder equity (buybacks can inflate it)'],
  ['ROA', 'Return on assets — net income ÷ total assets'],
  ['RSI', 'Relative strength index (0–100) — momentum; above 70 often read as overbought, below 30 oversold'],
  ['EPS', 'Earnings per share — net income ÷ shares outstanding'],
  ['beta', 'Volatility vs the market — 1 moves with it, above 1 swings harder'],
  ['div yield', 'Annual dividends ÷ share price'],
  ['payout ratio', 'Share of earnings paid out as dividends — lower leaves more room to grow or cushion'],
  ['current ratio', 'Current assets ÷ current liabilities — short-term liquidity; ~1 is thin'],
  ['debt/equity', 'Total debt ÷ shareholder equity — balance-sheet leverage'],
  ['D/E', 'Total debt ÷ shareholder equity — balance-sheet leverage'],
  ['net debt', 'Total debt minus cash — what borrowing remains after the cash pile'],
  ['accruals', 'Gap between reported earnings and operating cash flow — cash-backed earnings are higher quality'],
  ['market cap', 'Share price × shares outstanding — the equity’s total price tag'],
  ['expense ratio', 'Annual fund fee as a share of assets'],
  ['AUM', 'Assets under management — total money in the fund'],
  ['50-day', 'Average closing price over the last 50 trading days — a medium-term trend line'],
  ['200-day', 'Average closing price over the last 200 trading days — a long-term trend line']
]

export function explain(label: string): string | undefined {
  const l = label.toLowerCase()
  const hit = TERMS.find(([term]) => l.includes(term.toLowerCase()))
  return hit?.[1]
}
