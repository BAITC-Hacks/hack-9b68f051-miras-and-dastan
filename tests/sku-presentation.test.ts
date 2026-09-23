import { describe, expect, it } from "vitest";
import { analyzeDataset } from "../lib/analytics";
import { makeDemoData } from "../lib/demo-data";
import { quantityBreakdown, skuHistoryRows } from "../lib/sku-presentation";

const scenario = { demandMultiplier: 1, delayDays: 0, serviceLevel: .95, budget: 1_500_000 };

describe("SKU explanation presentation", () => {
  it("matches anomaly observations by date, never by repeated quantity alone", () => {
    const dataset = makeDemoData();
    const item = analyzeDataset(dataset, scenario).find(row => row.sku === "CAB-NYM-3X2.5")!;
    const sales = dataset.sales.filter(row => row.sku === item.sku).sort((a, b) => a.date.localeCompare(b.date));
    const repeated = { ...item, outliers: [{ date: sales[0].date, quantity: 12, score: 4, reason: "Аномалия" }], rawHistory: [12, 12], cleanedHistory: [8, 12] };
    const rows = skuHistoryRows({ ...dataset, sales: [{ ...sales[1], quantity: 12 }, { ...sales[0], quantity: 12 }] }, repeated);
    expect(rows.map(row => Boolean(row.anomaly))).toEqual([true, false]);
    expect(rows.map(row => row.clean)).toEqual([8, 12]);
    expect(rows.map(row => row.date)).toEqual([sales[0].date, sales[1].date]);
  });

  it("keeps the positive pre-budget need visible when the final quantity is zero", () => {
    const item = analyzeDataset(makeDemoData(), { ...scenario, budget: 1 }).find(row => row.sku === "CAB-NYM-3X2.5")!;
    const breakdown = quantityBreakdown(item);
    expect(breakdown.raw).toBeGreaterThan(0);
    expect(breakdown.beforeBudget).toBeGreaterThan(0);
    expect(breakdown.final).toBe(0);
    expect(item.warnings).toContain("Не вошло в установленный бюджет");
  });

  it("does not manufacture supplier terms or silently change the existing rounding", () => {
    const item = analyzeDataset(makeDemoData(), scenario)[0];
    expect(quantityBreakdown({ ...item, selectedSupplier: null }).beforeBudget).toBeNull();
    expect(quantityBreakdown({ ...item, rawRecommendedQuantity: 1, packSize: 5, minOrderQty: 7 }).beforeBudget).toBe(7);
  });
});
