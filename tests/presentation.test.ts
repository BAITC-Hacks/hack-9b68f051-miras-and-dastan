import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDataset } from "../lib/analytics";
import { makeDemoData } from "../lib/demo-data";
import { BASE_SCENARIO, createDraft, csvCell, draftCsv, filterRecommendations, orderBlockReason, sortRecommendations, statusLabel, summarize, weeklyHistoryIssue } from "../lib/presentation";
import type { Dataset, Recommendation } from "../lib/types";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-23T00:00:00.000Z")); });
afterEach(() => vi.useRealTimers());
const recommendations = () => analyzeDataset(makeDemoData(), BASE_SCENARIO);

describe("recommendation table presentation", () => {
  it("makes all 32 products reachable through sorted page slices without mutating calculation order", () => {
    const items = recommendations();
    const originalOrder = items.map(item => item.sku);
    const visible = sortRecommendations(filterRecommendations(items, "", "all"), "estimatedCost", "desc");
    const pages = Array.from({ length: Math.ceil(visible.length / 10) }, (_, page) => visible.slice(page * 10, (page + 1) * 10));
    expect(pages.map(page => page.length)).toEqual([10, 10, 10, 2]);
    expect(new Set(pages.flat().map(item => item.sku))).toEqual(new Set(originalOrder));
    expect(visible.every((item, index) => index === 0 || visible[index - 1].estimatedCost >= item.estimatedCost)).toBe(true);
    expect(items.map(item => item.sku)).toEqual(originalOrder);
    expect(filterRecommendations(items, "  cab-nym-3x2.5  ", "all").map(item => item.sku)).toEqual(["CAB-NYM-3X2.5"]);
    expect(filterRecommendations(items, "кабель nym", "all").map(item => item.sku)).toEqual(["CAB-NYM-3X2.5"]);
    expect(filterRecommendations(items, "несуществующий товар", "all")).toEqual([]);
  });

  it("distinguishes a budget exclusion from an absent supplier and a position needing no order", () => {
    const items = recommendations();
    const outsideBudget = filterRecommendations(items, "", "budget");
    const withoutSupplier = filterRecommendations(items, "", "supplier");
    expect(outsideBudget.length).toBeGreaterThan(0);
    expect(withoutSupplier.map(item => item.sku)).toEqual(["SURGE-3P"]);
    expect(outsideBudget.every(item => item.selectedSupplier !== null)).toBe(true);
    expect(outsideBudget.every(item => statusLabel(item) === "Вне бюджета")).toBe(true);
    expect(statusLabel(withoutSupplier[0])).toBe("Нет поставщика");
    expect(outsideBudget.some(item => withoutSupplier.some(other => item.sku === other.sku))).toBe(false);
    expect(orderBlockReason(outsideBudget[0])).toContain("бюджет");
    expect(orderBlockReason(withoutSupplier[0])).toContain("Нет поставщика");
    const noOrder = items.find(item => item.recommendedQuantity === 0 && item.selectedSupplier && !item.warnings.includes("Не вошло в установленный бюджет"))!;
    expect(orderBlockReason(noOrder)).toContain("заказ не требуется");
  });

  it("counts anomalous observations separately from affected products", () => {
    const item = structuredClone(recommendations().find(result => result.sku === "CAB-NYM-3X2.5")!);
    item.outliers.push({ ...item.outliers[0], date: "2025-10-20" });
    const summary = summarize([item]);
    expect(summary.anomalies).toBe(2);
    expect(summary.anomalySkus).toBe(1);
    expect(summarize([item], true).cost).toBe(0);
  });
});

describe("explicit purchase draft snapshots", () => {
  it("includes only selected valid positions and does not change when calculation objects change", () => {
    const items = recommendations();
    const valid = items.filter(item => !orderBlockReason(item)).slice(0, 2);
    const invalid = items.filter(item => orderBlockReason(item));
    const selected = [valid[0].sku, ...invalid.map(item => item.sku), "UNKNOWN-SKU", valid[0].sku];
    const draft = createDraft(items, selected, "revision-1");
    expect(draft).not.toBeNull();
    expect(draft!.items.map(item => item.sku)).toEqual([valid[0].sku]);
    expect(draft!.createdAt).toBe("2026-09-23T00:00:00.000Z");
    expect(draft!.revision).toBe("revision-1");
    const snapshot = structuredClone(draft);
    valid[0].recommendedQuantity += 100;
    valid[0].rawHistory[0] += 100;
    valid[0].selectedSupplier!.supplierName = "Изменённый поставщик";
    items.splice(0, items.length);
    expect(draft).toEqual(snapshot);
  });

  it("cannot create an empty or sales-only draft, or order a quantity violating pack constraints", () => {
    const items = recommendations();
    expect(createDraft(items, [], "revision-1")).toBeNull();
    expect(createDraft(items, items.map(item => item.sku), "revision-1", true)).toBeNull();
    const item = structuredClone(items.find(candidate => !orderBlockReason(candidate))!);
    item.packSize = 5; item.minOrderQty = 7; item.recommendedQuantity = 7;
    expect(orderBlockReason(item)).toContain("упаковке");
    expect(createDraft([item], [item.sku], "revision-1")).toBeNull();
  });

  it("escapes CSV formula prefixes even after whitespace and labels shortage dates honestly", () => {
    for (const dangerous of ["=1+1", "  =1+1", "\t+1", "\n@SUM(1)", " -1", "+cmd"]) {
      expect(csvCell(dangerous)).toBe(`"'${dangerous}"`);
    }
    expect(csvCell('Кабель "А"; B')).toBe('"Кабель ""А""; B"');
    const item: Recommendation = structuredClone(recommendations().find(candidate => candidate.sku === "CAB-NYM-3X2.5")!);
    item.productName = "  =HYPERLINK(1)";
    const draft = createDraft([item], [item.sku], "revision-1")!;
    const csv = draftCsv(draft);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Прогнозируемая дата дефицита"');
    expect(csv).toContain('"Срок поставки, дней"');
    expect(csv).not.toContain('"Дата поставки"');
    expect(csv).not.toContain("ETA");
    expect(csv).toContain('"\'  =HYPERLINK(1)"');
    expect(csv).toContain('"2026-10-04"');
  });
});

describe("weekly data eligibility", () => {
  function weeklyDataset(): Dataset {
    const demo = makeDemoData();
    return { ...demo, sales: demo.sales.filter(row => row.sku === "CAB-NYM-3X2.5").slice(0, 6).reverse() };
  }

  it("accepts complete weekly history without sorting or filling the input array", () => {
    const dataset = weeklyDataset();
    const previous = structuredClone(dataset);
    expect(weeklyHistoryIssue(dataset, "CAB-NYM-3X2.5")).toBeNull();
    expect(dataset).toEqual(previous);
  });

  it("rejects duplicate weeks, gaps, invalid dates and insufficient history", () => {
    const dataset = weeklyDataset();
    const duplicate = { ...dataset, sales: [...dataset.sales, { ...dataset.sales[0] }] };
    const gap = { ...dataset, sales: dataset.sales.filter((_, index) => index !== 2) };
    const invalid = { ...dataset, sales: dataset.sales.map((sale, index) => index === 0 ? { ...sale, date: "invalid" } : sale) };
    const short = { ...dataset, sales: dataset.sales.slice(0, 1) };
    for (const input of [duplicate, gap, invalid, short]) {
      const previous = structuredClone(input);
      expect(weeklyHistoryIssue(input, "CAB-NYM-3X2.5")).toEqual(expect.any(String));
      expect(input).toEqual(previous);
    }
  });
});
