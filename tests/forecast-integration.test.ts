import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDataset, detectOutliers, mean, stdDev, weightedForecast } from "../lib/analytics";
import { makeDemoData } from "../lib/demo-data";
import { BASE_SCENARIO } from "../lib/presentation";
import type { Dataset } from "../lib/types";
import { compareStrategies } from "../stockpilot-backtest/src/engine";
import { createStockPilotStrategy, fromStockPilotDataset } from "../stockpilot-backtest/src/stockpilot";
import { naiveStrategy } from "../stockpilot-backtest/src/strategies";
import type { StrategyContext } from "../stockpilot-backtest/src/contracts";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-23T00:00:00.000Z")); });
afterEach(() => vi.useRealTimers());

const stockPilot = createStockPilotStrategy({ detectOutliers, weightedForecast, stdDev, mean });
const settings: StrategyContext["settings"] = { initialStock: 50, leadTimeDays: 14, reviewPeriod: 1, moq: 10, packSize: 5, serviceLevel: "0.95" };

describe("main forecast integrated into historical testing", () => {
  it.each(["CAB-NYM-3X2.5", "LED-36W"])("matches the actual host forecast/deviation for every available prefix of %s", sku => {
    const dataset = makeDemoData();
    const observations = dataset.sales.filter(row => row.sku === sku).sort((a, b) => a.date.localeCompare(b.date));
    for (let length = 0; length <= observations.length; length++) {
      const history = observations.slice(0, length);
      const prefix: Dataset = { ...dataset, products: dataset.products.filter(product => product.sku === sku), sales: history };
      const recommendation = analyzeDataset(prefix, BASE_SCENARIO)[0];
      const context: StrategyContext = { history: history.map(row => ({ sku, date: row.date, demand: row.quantity })), currentStock: 50, openOrders: [], settings: { ...settings } };
      const previous = structuredClone(context);
      const decision = stockPilot(context);
      expect(decision.forecast).toBe(recommendation.forecastDemand);
      expect(decision.deviation).toBe(recommendation.demandStdDev);
      expect(decision.adjustedCount).toBe(recommendation.outliers.length);
      expect(context).toEqual(previous);
    }
  });

  it("keeps decisions before and at an unseen future demand shock unchanged", () => {
    const dataset = makeDemoData();
    const input = fromStockPilotDataset(dataset, { sku: "CAB-NYM-3X2.5", startIndex: 12, endIndex: 35, settings, unitCost: 650 });
    const changed = structuredClone(input);
    changed.observations[28].demand = 10_000;
    const strategies = [{ name: "Обычное среднее", run: naiveStrategy }, { name: "StockPilot · основной прогноз", run: stockPilot }] as const;
    const before = structuredClone(input);
    const original = compareStrategies(input, strategies);
    const withFutureShock = compareStrategies(changed, strategies);
    for (let strategy = 0; strategy < original.length; strategy++) {
      const originalEarly = original[strategy].steps.filter(step => step.index < 28);
      const changedEarly = withFutureShock[strategy].steps.filter(step => step.index < 28);
      expect(changedEarly).toEqual(originalEarly);
      // The decision is placed at the start of week 28, before demand for that week is observed.
      const originalAtShock = original[strategy].steps.find(step => step.index === 28)!;
      const changedAtShock = withFutureShock[strategy].steps.find(step => step.index === 28)!;
      expect(changedAtShock.decision).toEqual(originalAtShock.decision);
      expect(changedAtShock.ordered).toBe(originalAtShock.ordered);
      expect(changedAtShock.demand).not.toBe(originalAtShock.demand);
    }
    expect(input).toEqual(before);
  });

  it("passes only completed history to the imported forecast during simulation", () => {
    const input = fromStockPilotDataset(makeDemoData(), { sku: "CAB-NYM-3X2.5", startIndex: 12, endIndex: 35, settings });
    const calls: number[] = [];
    const result = compareStrategies(input, [
      { name: "Обычное среднее", run: naiveStrategy },
      { name: "StockPilot · основной прогноз", run: context => {
        calls.push(context.history.length);
        expect(context.history).toEqual(input.observations.slice(0, context.history.length));
        return stockPilot(context);
      } },
    ])[1];
    expect(calls).toEqual(Array.from({ length: 24 }, (_, index) => index + 12));
    expect(result.steps).toHaveLength(24);
    expect(result.metrics.purchaseCost).toBeUndefined();
    expect(result.metrics.averageInventoryCost).toBeUndefined();
  });
});

describe("unchanged deterministic analytics after redesign", () => {
  // These complete-result digests and totals were captured by evaluating analytics.ts and
  // demo-data.ts directly from git commit 09ff771, before the redesign, at the frozen time.
  // They protect MOQ, packs, supplier ranking, anomaly treatment and budget allocation,
  // including their existing limitations. Updating formulas requires a separate decision.
  it.each([
    { scenario: BASE_SCENARIO, digest: "fb318e332a0e19c3953b1abdb65a42263baa2c397070a9de8127cec7ac85efde", cost: 1_487_725, quantity: 755, cabQuantity: 50 },
    { scenario: { ...BASE_SCENARIO, delayDays: 7 }, digest: "cdcbe52cbbae88d22b39a9234fd1e9deaa8436eb37279a60f026ab36b0835f67", cost: 1_497_975, quantity: 795, cabQuantity: 70 },
    { scenario: { demandMultiplier: 1.2, delayDays: 7, serviceLevel: .97, budget: 150_000 }, digest: "191461badc527332e7b6962c533d22e06b0d7ac789064cc91dc140e0123faf35", cost: 146_875, quantity: 125, cabQuantity: 0 },
  ])("matches the pre-redesign result for scenario $scenario", ({ scenario, digest, cost, quantity, cabQuantity }) => {
    const dataset = makeDemoData();
    const before = structuredClone(dataset);
    const result = analyzeDataset(dataset, scenario);
    expect(result).toHaveLength(32);
    expect(result.reduce((sum, item) => sum + item.estimatedCost, 0)).toBe(cost);
    expect(result.reduce((sum, item) => sum + item.recommendedQuantity, 0)).toBe(quantity);
    expect(result.find(item => item.sku === "CAB-NYM-3X2.5")?.recommendedQuantity).toBe(cabQuantity);
    expect(createHash("sha256").update(JSON.stringify(result)).digest("hex")).toBe(digest);
    expect(dataset).toEqual(before);
  });
});
