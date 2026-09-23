import { describe, it, expect } from 'vitest';
import { makeDemoData } from '../lib/demo-data';
import { analyzeDataset, detectOutliers, mean, stdDev, weightedForecast } from '../lib/analytics';
import { createStockPilotStrategy, fromStockPilotDataset, naiveStrategy, compareStrategies } from '../stockpilot-backtest/src/core';

const strategy = createStockPilotStrategy({ detectOutliers, mean, stdDev, weightedForecast });
const options = {
  sku: 'CAB-NYM-3X2.5', startIndex: 20, endIndex: 35,
  settings: { initialStock:45, leadTimeDays:21, reviewPeriod:1, moq:5, packSize:5, serviceLevel:'0.95' as const },
};
describe('Integration with the real StockPilot functions', () => {
  it('accepts actual Dataset and reproduces the host forecast on each past prefix', () => {
    const dataset = makeDemoData();
    const input = fromStockPilotDataset(dataset, options);
    const results = compareStrategies(input,[{name:'Average',run:naiveStrategy},{name:'Production',run:strategy}]);
    for(const step of results[1].steps) {
      const pastDataset = { ...dataset, sales:dataset.sales.filter(s=>s.sku===options.sku && s.date<step.date), products:dataset.products.filter(p=>p.sku===options.sku) };
      const expected = analyzeDataset(pastDataset,{demandMultiplier:1,delayDays:0,serviceLevel:0.95,budget:0})[0];
      expect(step.decision?.forecast).toBeCloseTo(expected.forecastDemand);
      expect(step.decision?.deviation).toBeCloseTo(expected.demandStdDev);
    }
    expect(results[0].steps[0].openingStock).toBe(45);
    expect(results[1].steps[0].openingStock).toBe(45);
  });
  it('keeps past production decisions unchanged when future host sales change', () => {
    const dataset = makeDemoData();
    const changed = structuredClone(dataset);
    const future = changed.sales.filter(s=>s.sku===options.sku)[34];
    future.quantity=99999;
    const first = compareStrategies(fromStockPilotDataset(dataset,options),[{name:'Average',run:naiveStrategy},{name:'Production',run:strategy}]);
    const second = compareStrategies(fromStockPilotDataset(changed,options),[{name:'Average',run:naiveStrategy},{name:'Production',run:strategy}]);
    expect(first[1].steps.slice(0,14)).toEqual(second[1].steps.slice(0,14));
    expect(first[1].steps[14].ordered).toEqual(second[1].steps[14].ordered);
  });
});
