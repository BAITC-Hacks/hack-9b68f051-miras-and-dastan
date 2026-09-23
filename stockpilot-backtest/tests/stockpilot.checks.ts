import { describe, expect, it } from 'vitest';
import { simulate } from '../src/engine';
import { type BacktestInput, type StrategyContext } from '../src/contracts';
import {
  createStockPilotStrategy,
  fromStockPilotDataset,
  getStockPilotSupplierParameters,
  type StockPilotAnalytics,
  type StockPilotBacktestOptions,
} from '../src/stockpilot';

const sku = 'CAB-NYM-3X2.5';
const settings: BacktestInput['settings'] = {
  initialStock: 12, leadTimeDays: 21, reviewPeriod: 1, moq: 5, packSize: 5, serviceLevel: '0.95',
};
const options: StockPilotBacktestOptions = { sku, startIndex: 6, endIndex: 9, settings };
const mean = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function dataset() {
  return {
    sales: [10, 11, 9, 10, 12, 11, 180, 10, 11, 9].map((quantity, index) => ({
      date: new Date(Date.UTC(2025, 0, 6 + index * 7)).toISOString().slice(0, 10),
      sku, productName: 'Кабель', quantity, category: 'Кабель', promotionFlag: false,
    })),
    inventory: [{ sku, onHand: 99999, reserved: 20, backorders: 30 }],
    transit: [{ sku, quantity: 10000, eta: '2025-12-29', supplierId: 'S1' }],
    suppliers: [{
      supplierId: 'S1', supplierName: 'Поставщик', sku, leadTimeDays: 14,
      unitCost: 850, minOrderQty: 10, packSize: 5, reliabilityScore: 97,
    }],
    products: [{ sku, productName: 'Кабель', category: 'Кабель', criticality: 3 }],
  };
}

function callbacks(): StockPilotAnalytics {
  return {
    detectOutliers: () => [],
    weightedForecast: mean,
    stdDev: values => Math.sqrt(mean(values.map(value => (value - mean(values)) ** 2))),
    mean,
  };
}

describe('Адаптер фактического Dataset StockPilot', () => {
  it('сопоставляет date/sku/quantity, сортирует выбранный SKU и требует исторические настройки', () => {
    const source = dataset();
    source.sales.reverse();
    source.sales.push({ ...source.sales[0]!, sku: 'OTHER', quantity: 999 });
    const result = fromStockPilotDataset(source, options);
    expect(result.observations.map(row => row.demand)).toEqual([10, 11, 9, 10, 12, 11, 180, 10, 11, 9]);
    expect(result.settings).toEqual(settings);
    expect(result.settings.initialStock).toBe(12);
    expect(result.source).toBe('sales');
    expect(result.currency).toBe('₸');
    expect(result.unitCost).toBeUndefined();
    expect(() => fromStockPilotDataset(source, { ...options, settings: undefined } as unknown as StockPilotBacktestOptions)).toThrow();
  });

  it('не читает текущие inventory/transit и не изменяет исходные данные или настройки', () => {
    const source = dataset();
    const original = structuredClone(source);
    const originalOptions = structuredClone(options);
    const baseline = fromStockPilotDataset(source, options);
    expect(source).toEqual(original);
    expect(options).toEqual(originalOptions);
    Object.defineProperty(source, 'inventory', { get() { throw new Error('Live inventory must not be read'); } });
    Object.defineProperty(source, 'transit', { get() { throw new Error('Live transit must not be read'); } });
    expect(fromStockPilotDataset(source, options)).toEqual(baseline);
  });

  it('отклоняет пропущенную неделю, дубли недели и ежедневный ряд', () => {
    const missing = dataset();
    missing.sales.splice(2, 1);
    expect(() => fromStockPilotDataset(missing, { ...options, endIndex: 8 })).toThrow();
    const duplicate = dataset();
    duplicate.sales.push({ ...duplicate.sales[2]! });
    expect(() => fromStockPilotDataset(duplicate, { ...options, endIndex: 10 })).toThrow();
    const daily = dataset();
    daily.sales[1]!.date = '2025-01-07';
    expect(() => fromStockPilotDataset(daily, options)).toThrow();
  });

  it('применяет параметры только явно выбранного поставщика и не подменяет начальный запас', () => {
    const source = dataset();
    const terms = getStockPilotSupplierParameters(source, sku, 'S1');
    expect(terms).toEqual({ leadTimeDays: 14, moq: 10, packSize: 5, unitCost: 850 });
    const { unitCost, ...policy } = terms;
    const result = fromStockPilotDataset(source, {
      ...options, settings: { ...settings, ...policy }, unitCost,
    });
    expect(result.settings.initialStock).toBe(12);
    expect(result.unitCost).toBe(850);
    expect(() => getStockPilotSupplierParameters(source, sku, 'UNKNOWN')).toThrow();
    expect(() => getStockPilotSupplierParameters(source, 'OTHER', 'S1')).toThrow();
    source.suppliers.push({ ...source.suppliers[0]! });
    expect(() => getStockPilotSupplierParameters(source, sku, 'S1')).toThrow();
  });
});

describe('Подключение аналитических функций StockPilot', () => {
  it('воспроизводит замену выброса округлённым средним меньших прошлых значений', () => {
    const input = fromStockPilotDataset(dataset(), options);
    const history = input.observations.slice(0, 7);
    const context: StrategyContext = { history, currentStock: 12, openOrders: [], settings };
    const before = structuredClone(context);
    const dependencies = callbacks();
    const seen: number[][] = [];
    dependencies.detectOutliers = (values, labels) => [{ date: labels[6]!, quantity: values[6]! }];
    dependencies.weightedForecast = values => { seen.push([...values]); return mean(values); };
    dependencies.stdDev = values => { seen.push([...values]); return 2; };
    const decision = createStockPilotStrategy(dependencies)(context);
    expect(seen).toEqual([[10, 11, 9, 10, 12, 11, 11], [10, 11, 9, 10, 12, 11, 11]]);
    expect(decision.forecast).toBe(mean(seen[0]!));
    expect(decision.deviation).toBe(2);
    expect(decision.adjustedCount).toBe(1);
    expect(context).toEqual(before);
  });

  it('безопасно обрабатывает пустую историю без вызова внешних функций', () => {
    const fail = () => { throw new Error('No history'); };
    const strategy = createStockPilotStrategy({ detectOutliers: fail, mean: fail, weightedForecast: fail, stdDev: fail });
    expect(strategy({ history: [], currentStock: 0, openOrders: [], settings })).toMatchObject({
      forecast: 0, deviation: 0, adjustedCount: 0,
    });
  });

  it('передаёт callback только завершённые прошлые значения и даты', () => {
    const input = fromStockPilotDataset(dataset(), options);
    const dependencies = callbacks();
    const seenValues: number[][] = [];
    const seenDates: string[][] = [];
    dependencies.detectOutliers = (values, labels) => {
      seenValues.push([...values]); seenDates.push([...labels]); return [];
    };
    simulate(input, createStockPilotStrategy(dependencies), 'StockPilot');
    seenValues.forEach((values, index) => {
      const past = input.observations.slice(0, input.startIndex + index);
      expect(values).toEqual(past.map(row => row.demand));
      expect(seenDates[index]).toEqual(past.map(row => row.date));
    });
    expect(seenValues).toHaveLength(4);
    const changed = structuredClone(input);
    changed.observations[8]!.demand = 50000;
    const strategy = createStockPilotStrategy(callbacks());
    const before = simulate(input, strategy, 'StockPilot');
    const after = simulate(changed, strategy, 'StockPilot');
    expect(after.steps.slice(0, 2)).toEqual(before.steps.slice(0, 2));
    expect(after.steps[2]!.decision).toEqual(before.steps[2]!.decision);
    expect(after.steps[2]!.ordered).toEqual(before.steps[2]!.ordered);
  });

  it('защищает историю и следующие callbacks от мутации переданных массивов', () => {
    const input = fromStockPilotDataset(dataset(), options);
    const context: StrategyContext = {
      history: input.observations.slice(0, 6), currentStock: 12, openOrders: [], settings,
    };
    const original = structuredClone(context);
    const dependencies = callbacks();
    dependencies.detectOutliers = (values, labels) => { values.fill(999); labels.fill('2099-01-01'); return []; };
    dependencies.weightedForecast = values => { values.fill(500); return 10; };
    dependencies.stdDev = values => { expect(values).toEqual([10, 11, 9, 10, 12, 11]); return 1; };
    createStockPilotStrategy(dependencies)(context);
    expect(context).toEqual(original);
  });
});
