import type { BacktestResult } from './contracts';
export function csvCell(value:unknown):string {
  let s=String(value??'');
  // Strip leading whitespace/control characters only for detection, not from the exported value.
  let i=0; while(i<s.length && (s.charCodeAt(i)<=32 || /\s/u.test(s[i]!))) i++;
  if('=+@-'.includes(s[i]??'\uFFFF') || /^[\t\r\n]/u.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function exportCsv(results:readonly BacktestResult[]):string {
  const rows:unknown[][]=[['SKU','Стратегия','Неделя','Спрос','Отгружено','Дефицит','Остаток','Заказ','Поступление','В пути','Прогноз','Приход заказа (индекс)','Стоимость заказанного','Валюта']];
  for(const r of results) for(const s of r.steps) rows.push([r.sku,r.strategy,s.date,s.demand,s.served,s.unmet,s.endingStock,s.ordered,s.receipts,s.inTransit,s.decision?.forecast,s.order?.arrivesAt,r.metrics.purchaseCost===undefined?'':(r.metrics.orderedQuantity ? r.metrics.purchaseCost/r.metrics.orderedQuantity*s.ordered:0),r.metrics.purchaseCost===undefined?'':r.currency]);
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
}
