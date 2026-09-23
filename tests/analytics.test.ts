import { describe, expect, it } from "vitest";
import { analyzeDataset, detectOutliers, roundToPack, weightedForecast } from "../lib/analytics";
import { makeDemoData } from "../lib/demo-data";

describe("StockPilot deterministic analytics", () => {
  it("detects a one-off 176-unit sale", () => {
    const outliers = detectOutliers([8, 9, 10, 11, 8, 9, 176, 10, 9, 11], Array.from({ length: 10 }, (_, i) => `W${i}`));
    expect(outliers.some(item => item.quantity === 176)).toBe(true);
  });
  it("does not report outliers in a stable series", () => expect(detectOutliers([8, 9, 8, 9, 10, 9, 8, 9], []).length).toBe(0));
  it("uses recent values for weighted forecast", () => expect(weightedForecast([1, 1, 1, 10])).toBeGreaterThan(4));
  it("rounds positive recommendations to MOQ and pack size", () => expect(roundToPack(12, 5, 20)).toBe(20));
  it("never creates a negative order", () => expect(roundToPack(-2, 5, 10)).toBe(0));
  it("keeps the CAB anomaly from multiplying regular demand", () => {
    const result = analyzeDataset(makeDemoData(), { demandMultiplier: 1, delayDays: 0, serviceLevel: .95, budget: 1_500_000 }).find(item => item.sku === "CAB-NYM-3X2.5");
    expect(result?.outliers.length).toBeGreaterThan(0);
    expect(result?.forecastDemand).toBeLessThan(result?.naiveForecast ?? Infinity);
    expect(result?.recommendedQuantity).toBeGreaterThan(0);
  });
});
