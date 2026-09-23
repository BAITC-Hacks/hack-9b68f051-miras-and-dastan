import { BacktestInputSchema, BacktestResultSchema, StrategyDecisionSchema, type BacktestInput, type BacktestResult, type SimulationStep, type Strategy, type StrategyContext } from './contracts';
import { mean, replenishment, naiveStrategy, robustStrategy } from './strategies';
export function simulate(raw:BacktestInput,strategy:Strategy,name:string):BacktestResult {
  const input=BacktestInputSchema.parse(raw), {settings}=input;
  const leadTimeWeeks=Math.ceil(settings.leadTimeDays/7);
  let stock=settings.initialStock;
  let orders:StrategyContext['openOrders']=[];
  const steps:SimulationStep[]=[];
  for(let i=input.startIndex;i<=input.endIndex;i++) {
    const observation=input.observations[i]!;
    const openingStock=stock;
    let receipts=orders.filter(o=>o.arrivesAt<=i).reduce((a,o)=>a+o.quantity,0);
    orders=orders.filter(o=>o.arrivesAt>i); stock+=receipts;
    let decision:SimulationStep['decision']; let order:SimulationStep['order']; let ordered=0;
    if((i-input.startIndex)%settings.reviewPeriod===0) {
      const context:StrategyContext={history:input.observations.slice(0,i).map(o=>({...o})), currentStock:stock,openOrders:orders.map(o=>({...o})),settings:{...settings}};
      // A separate snapshot protects policy state against a third-party callback's mutations.
      decision=StrategyDecisionSchema.parse(strategy(structuredClone(context)));
      ordered=replenishment(context,decision);
      if(ordered>0) { order={placedAt:i,arrivesAt:i+leadTimeWeeks,quantity:ordered}; if(leadTimeWeeks===0){stock+=ordered;receipts+=ordered;} else orders.push(order); }
    }
    const peakStock=stock, served=Math.min(stock,observation.demand), unmet=observation.demand-served;
    stock-=served;
    steps.push({index:i,date:observation.date,demand:observation.demand,openingStock,receipts,served,unmet,endingStock:stock,peakStock,ordered,inTransit:orders.reduce((s,o)=>s+o.quantity,0),decision,order});
  }
  const sum=(key:'served'|'unmet'|'ordered')=>steps.reduce((s,x)=>s+x[key],0);
  const servedDemand=sum('served'),unmetDemand=sum('unmet'),orderedQuantity=sum('ordered'),averageEndingStock=mean(steps.map(s=>s.endingStock));
  return BacktestResultSchema.parse({strategy:name,sku:input.sku,leadTimeWeeks,steps,openOrders:orders,currency:input.currency,metrics:{servedDemand,unmetDemand,fillRate:servedDemand+unmetDemand ? servedDemand/(servedDemand+unmetDemand):1,shortagePeriods:steps.filter(s=>s.unmet>0).length,averageEndingStock,maxStock:Math.max(...steps.map(s=>s.peakStock)),orderCount:steps.filter(s=>s.ordered>0).length,orderedQuantity,endingStock:stock,inTransit:orders.reduce((s,o)=>s+o.quantity,0),...(input.unitCost===undefined?{}:{purchaseCost:orderedQuantity*input.unitCost,averageInventoryCost:averageEndingStock*input.unitCost})}});
}
export interface NamedStrategy { name: string; run: Strategy }
export type StrategyPair = readonly [NamedStrategy, NamedStrategy];
export function compareStrategies(input:BacktestInput, strategies:StrategyPair = [{ name:'Обычное среднее',run:naiveStrategy },{ name:'StockPilot · демо',run:robustStrategy }]) {
  return [simulate(input,strategies[0].run,strategies[0].name),simulate(input,strategies[1].run,strategies[1].name)] as const;
}
