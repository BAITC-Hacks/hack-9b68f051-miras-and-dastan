import type { HistoricalObservation } from '../../src/contracts';
export function createDemo() {
  let seed=20260923;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  return [
    {sku:'CAB-NYM-3X2.5',label:'Кабель NYM · разовый всплеск',kind:'spike',unitCost:850,leadTimeDays:21,packSize:5},
    {sku:'STABLE-01',label:'Крепёж · стабильный спрос',kind:'stable',unitCost:120,leadTimeDays:14,packSize:10},
    {sku:'GROW-01',label:'Автомат · растущий спрос',kind:'growth',unitCost:2400,leadTimeDays:14,packSize:5},
    {sku:'SEASON-01',label:'Светильник · сезонный спрос',kind:'season',unitCost:3600,leadTimeDays:21,packSize:5},
    {sku:'SHORT-01',label:'Новинка · короткая история',kind:'short',unitCost:undefined,leadTimeDays:7,packSize:1},
    {sku:'ZERO-01',label:'Резерв · нулевой спрос',kind:'zero',unitCost:undefined,leadTimeDays:0,packSize:1},
  ].map(item=>({...item,observations:Array.from({length:item.kind==='short'?8:52},(_,i):HistoricalObservation=>({sku:item.sku,date:new Date(Date.UTC(2025,0,6+i*7)).toISOString().slice(0,10),demand:item.kind==='zero'?0:item.kind==='spike'&&i===26?180:item.kind==='growth'?Math.round(5+i*0.65+random()*3):item.kind==='season'?Math.max(0,Math.round(15+12*Math.sin(i*2*Math.PI/26)+random()*3)):8+Math.floor(random()*5)}))}));
}
