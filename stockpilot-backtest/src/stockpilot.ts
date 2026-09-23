import { z } from 'zod';
import {
  BacktestInputSchema,
  SettingsSchema,
  StrategyDecisionSchema,
  type BacktestInput,
  type Strategy,
} from './contracts';

/** Structural subset of the partner's Sale; product metadata is not needed by the simulation. */
export interface StockPilotSale {
  date: string;
  sku: string;
  quantity: number;
}

/** Field names match lib/types.ts; no import from the partner's private source tree is required. */
export interface StockPilotSupplier {
  supplierId: string;
  sku: string;
  leadTimeDays: number;
  unitCost: number;
  minOrderQty: number;
  packSize: number;
}

/** A complete StockPilot Dataset is structurally assignable to this read-only view. */
export interface StockPilotDataset {
  sales: readonly StockPilotSale[];
  suppliers: readonly StockPilotSupplier[];
}

export interface StockPilotBacktestOptions {
  sku: string;
  startIndex: number;
  endIndex: number;
  /** Historical starting stock and every policy parameter must be chosen explicitly. */
  settings: BacktestInput['settings'];
  unitCost?: number;
  currency?: string;
}

/**
 * Uses the partner's existing weekly Sale shape. No inventory or transit fields are read.
 * Missing/duplicate weeks are rejected rather than filled, aggregated, or interpreted as zero.
 */
export function fromStockPilotDataset(
  dataset: StockPilotDataset,
  options: StockPilotBacktestOptions,
): BacktestInput {
  return BacktestInputSchema.parse({
    ...options,
    currency: options.currency ?? '₸',
    source: 'sales',
    observations: dataset.sales
      .filter(row => row.sku === options.sku)
      .map(row => ({ sku: row.sku, date: row.date, demand: row.quantity }))
      .sort((left, right) => left.date.localeCompare(right.date)),
  });
}

const SupplierParametersSchema = z.object({
  leadTimeDays: SettingsSchema.shape.leadTimeDays,
  moq: SettingsSchema.shape.moq,
  packSize: SettingsSchema.shape.packSize,
  unitCost: z.number().finite().nonnegative(),
});

export type StockPilotSupplierParameters = z.infer<typeof SupplierParametersSchema>;

/**
 * Explicit opt-in to one supplier's commercial terms. They are current assumptions, not
 * proof of historical terms. The caller still supplies initialStock/reviewPeriod/serviceLevel.
 */
export function getStockPilotSupplierParameters(
  dataset: StockPilotDataset,
  sku: string,
  supplierId: string,
): StockPilotSupplierParameters {
  const matches = dataset.suppliers.filter(row => row.sku === sku && row.supplierId === supplierId);
  if (matches.length !== 1) {
    throw new Error('Укажите одного существующего поставщика для выбранного SKU; совпадение должно быть единственным.');
  }
  const supplier = matches[0]!;
  return SupplierParametersSchema.parse({
    leadTimeDays: supplier.leadTimeDays,
    moq: supplier.minOrderQty,
    packSize: supplier.packSize,
    unitCost: supplier.unitCost,
  });
}

export interface StockPilotOutlier {
  date: string;
  quantity: number;
}

/** Pass the four corresponding named exports from the host's analytics module. */
export interface StockPilotAnalytics {
  detectOutliers: (values: number[], labels: string[]) => readonly StockPilotOutlier[];
  weightedForecast: (values: number[]) => number;
  stdDev: (values: number[]) => number;
  mean: (values: number[]) => number;
}

/**
 * Reproduces the cleanup/forecast part of the partner's analyzeDataset using past data only.
 * No scenario multiplier, live inventory, supplier ranking, budget, or purchase policy is reused:
 * the backtest engine applies the same replenishment policy to both forecast strategies.
 */
export function createStockPilotStrategy(analytics: StockPilotAnalytics): Strategy {
  return context => {
    const raw = context.history.map(row => row.demand);
    if (raw.length === 0) {
      return {
        forecast: 0,
        deviation: 0,
        adjustedCount: 0,
        method: 'StockPilot: нет завершённой истории',
      };
    }
    const dates = context.history.map(row => row.date);
    const outliers = analytics.detectOutliers([...raw], [...dates]);
    const outlierDates = new Set(outliers.map(item => item.date));
    const cleaned = context.history.map(row => outlierDates.has(row.date)
      ? Math.round(analytics.mean(raw.filter(value => value < row.demand)))
      : row.demand);
    return StrategyDecisionSchema.parse({
      forecast: analytics.weightedForecast([...cleaned]),
      deviation: analytics.stdDev([...cleaned]),
      adjustedCount: dates.filter(date => outlierDates.has(date)).length,
      method: 'StockPilot: очистка выбросов и взвешенное среднее (8 недель)',
    });
  };
}
