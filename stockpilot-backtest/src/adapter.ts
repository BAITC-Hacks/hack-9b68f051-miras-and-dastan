import { BacktestInputSchema, type BacktestInput } from './contracts';
/** Example canonical contract; map the partner's actual schema explicitly at integration. */
export interface CanonicalStockPilotRow { sku:string; weekStart:string; salesUnits:number }
export function fromStockPilot(rows:CanonicalStockPilotRow[],options:Omit<BacktestInput,'observations'|'source'>):BacktestInput {
  return BacktestInputSchema.parse({...options,source:'sales',observations:rows.filter(r=>r.sku===options.sku).map(r=>({sku:r.sku,date:r.weekStart,demand:r.salesUnits})).sort((a,b)=>a.date.localeCompare(b.date))});
}
