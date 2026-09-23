import type { Strategy, StrategyContext, StrategyDecision } from './contracts';
export const mean = (xs:number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
function quantile(xs:number[], p:number):number { const s=[...xs].sort((a,b)=>a-b); if(!s.length) return 0; const pos=(s.length-1)*p; const lo=Math.floor(pos); return s[lo]!+(s[Math.ceil(pos)]!-s[lo]!)*(pos-lo); }
function describe(xs:number[], adjustedCount:number, method:string):StrategyDecision { const forecast=mean(xs); return { forecast, deviation:Math.sqrt(mean(xs.map(x=>(x-forecast)**2))),adjustedCount,method }; }
export const naiveStrategy:Strategy = c => describe(c.history.map(o=>o.demand),0,'Среднее всей доступной истории');
export const robustStrategy:Strategy = c => {
  const xs=c.history.map(o=>o.demand);
  if(xs.length<5) return describe(xs,0,'Короткая история: обычное среднее');
  const median=quantile(xs,0.5), mad=quantile(xs.map(x=>Math.abs(x-median)),0.5);
  const q1=quantile(xs,0.25),q3=quantile(xs,0.75);
  // Upper-tail only. Both robust bounds must be exceeded; floor avoids zero-MAD instability.
  const limit=Math.max(median+3*1.4826*mad,q3+1.5*(q3-q1),median+Math.max(1,median*0.5));
  let count=0;
  const cleaned=xs.map(x=>{if(x>limit){count++; return median;} return x;});
  return describe(cleaned,count,'Медиана / MAD / IQR');
};
export function replenishment(c:StrategyContext,d:StrategyDecision):number {
  const horizon=Math.ceil(c.settings.leadTimeDays/7)+c.settings.reviewPeriod;
  const z={ '0.5':0,'0.9':1.281552,'0.95':1.644854,'0.99':2.326348 }[c.settings.serviceLevel];
  const target=d.forecast*horizon+z*d.deviation*Math.sqrt(horizon);
  const gap=target-c.currentStock-c.openOrders.reduce((s,o)=>s+o.quantity,0);
  if(gap<=1e-9) return 0;
  return Math.ceil(Math.max(gap,c.settings.moq)/c.settings.packSize)*c.settings.packSize;
}
