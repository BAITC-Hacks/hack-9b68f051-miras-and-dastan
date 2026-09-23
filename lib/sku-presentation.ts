import { roundToPack } from "./analytics";
import type { Dataset, Recommendation } from "./types";

/** Keep the engine's observation order, and identify a flagged observation by its date. */
export function skuHistoryRows(dataset: Dataset, item: Recommendation) {
  return dataset.sales
    .filter(row => row.sku === item.sku)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row, index) => ({
      id: `${row.date}-${index}`,
      date: row.date,
      raw: item.rawHistory[index] ?? row.quantity,
      clean: item.cleanedHistory[index] ?? row.quantity,
      anomaly: item.outliers.find(outlier => outlier.date === row.date && outlier.quantity === row.quantity),
    }));
}

/** Present the existing engine stages; never replace its MOQ or budget policy. */
export function quantityBreakdown(item: Recommendation) {
  return {
    target: item.targetStock,
    position: item.stockPosition,
    raw: item.rawRecommendedQuantity,
    beforeBudget: item.selectedSupplier
      ? roundToPack(item.rawRecommendedQuantity, item.packSize, item.minOrderQty)
      : null,
    final: item.recommendedQuantity,
  };
}
