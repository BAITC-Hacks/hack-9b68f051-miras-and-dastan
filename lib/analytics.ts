import type { Dataset, Outlier, Recommendation, Risk, Scenario, Status, Supplier } from "./types";

const DAY = 86_400_000;
export const roundToPack = (value: number, pack: number, moq: number) => value <= 0 ? 0 : Math.max(moq, Math.ceil(value / Math.max(pack, 1)) * Math.max(pack, 1));
export const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export const stdDev = (values: number[]) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
};
export const detectOutliers = (values: number[], labels: string[]): Outlier[] => {
  if (values.length < 6) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
  const q1 = q(.25), q3 = q(.75), iqr = q3 - q1;
  const median = q(.5);
  const deviations = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)] || 0;
  return values.flatMap((value, index) => {
    const iqrFlag = iqr > 0 && (value > q3 + 1.5 * iqr || value < q1 - 1.5 * iqr);
    const modifiedZ = mad ? 0.6745 * (value - median) / mad : 0;
    if (!iqrFlag && Math.abs(modifiedZ) < 3.5) return [];
    return [{ date: labels[index], quantity: value, score: Number(modifiedZ.toFixed(1)), reason: "Нетипичная разовая продажа" }];
  });
};
export const weightedForecast = (values: number[]) => {
  const recent = values.slice(-8);
  if (!recent.length) return 0;
  const weights = recent.map((_, i) => i + 1);
  return recent.reduce((sum, value, i) => sum + value * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
};
const plusDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

export function analyzeDataset(dataset: Dataset, scenario: Scenario): Recommendation[] {
  const bySku = new Map(dataset.sales.map(s => [s.sku, [] as typeof dataset.sales]));
  dataset.sales.forEach(s => bySku.get(s.sku)?.push(s));
  const recommendations = dataset.products.map(product => {
    const historyRows = (bySku.get(product.sku) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const rawHistory = historyRows.map(row => row.quantity);
    const outliers = detectOutliers(rawHistory, historyRows.map(row => row.date));
    const outlierDates = new Set(outliers.map(item => item.date));
    const cleanedHistory = historyRows.map(row => outlierDates.has(row.date) ? Math.round(mean(rawHistory.filter(v => v < row.quantity))) : row.quantity);
    const clean = cleanedHistory.length ? cleanedHistory : rawHistory;
    const averageDemand = mean(clean);
    const baseForecast = weightedForecast(clean);
    const forecastDemand = baseForecast * scenario.demandMultiplier;
    const demandStdDev = stdDev(clean);
    const inventoryRecord = dataset.inventory.find(item => item.sku === product.sku);
    // Missing inventory is not the same as a confirmed zero balance. Keep a numeric
    // placeholder for charts, but prevent the item from becoming an orderable SKU.
    const inventoryKnown = Boolean(inventoryRecord);
    const inventory = inventoryRecord ?? { onHand: 0, reserved: 0, backorders: 0 };
    const transitRows = dataset.transit.filter(item => item.sku === product.sku);
    const inTransit = transitRows.reduce((sum, row) => sum + row.quantity, 0);
    const suppliers = dataset.suppliers.filter(item => item.sku === product.sku).sort((a, b) => (b.reliabilityScore - a.reliabilityScore) || (a.unitCost - b.unitCost));
    const selectedSupplier = suppliers[0] ?? null;
    const leadTimeDays = (selectedSupplier?.leadTimeDays ?? 21) + scenario.delayDays;
    const weeklyLeadTime = leadTimeDays / 7;
    const z = scenario.serviceLevel >= .97 ? 2.05 : scenario.serviceLevel >= .95 ? 1.65 : 1.28;
    const safetyStock = Math.ceil(z * demandStdDev * Math.sqrt(Math.max(weeklyLeadTime, 1)));
    const reorderPoint = Math.ceil(forecastDemand * weeklyLeadTime + safetyStock);
    const targetStock = Math.ceil(forecastDemand * (weeklyLeadTime + 4) + safetyStock);
    const stockPosition = inventory.onHand - inventory.reserved - inventory.backorders + inTransit;
    const rawRecommendedQuantity = Math.max(0, targetStock - stockPosition);
    const recommendedQuantity = selectedSupplier ? roundToPack(rawRecommendedQuantity, selectedSupplier.packSize, selectedSupplier.minOrderQty) : 0;
    const daysOfCover = forecastDemand ? Math.max(0, Math.round((inventory.onHand - inventory.reserved) / forecastDemand * 7)) : 999;
    const stockoutRisk: Risk = !selectedSupplier ? "review" : stockPosition < reorderPoint * .55 ? "critical" : stockPosition < reorderPoint ? "high" : stockPosition > targetStock * 1.5 ? "overstock" : stockPosition > targetStock ? "watch" : "healthy";
    const overstockRisk = stockPosition > targetStock * 1.5;
    const warnings: string[] = [];
    if (outliers.length) warnings.push(`${outliers.length} аномалия исключена из базового спроса`);
    if (!inventoryKnown) warnings.push("Остатки не переданы: позиция не считается подтверждённым нулём");
    if (!selectedSupplier) warnings.push("Нет подходящего поставщика");
    if (historyRows.length < 12) warnings.push("Недостаточно истории для устойчивого прогноза");
    const confidenceScore = Math.max(28, Math.min(96, 90 - outliers.length * 4 - (historyRows.length < 12 ? 25 : 0) - (demandStdDev > forecastDemand * .8 ? 14 : 0)));
    const confidenceReasons = [historyRows.length >= 12 ? "Есть достаточная история продаж" : "История продаж короткая", outliers.length ? "Выбросы отделены от регулярного спроса" : "Продажи стабильны", selectedSupplier ? `Поставщик ${selectedSupplier.reliabilityScore}% надёжности` : "Поставщик не найден"];
    let recommendationStatus: Status = "Заказ не требуется";
    if (!inventoryKnown) recommendationStatus = "Недостаточно данных";
    else if (!selectedSupplier) recommendationStatus = "Нет поставщика";
    else if (historyRows.length < 6) recommendationStatus = "Недостаточно данных";
    else if (stockoutRisk === "critical") recommendationStatus = "Заказать срочно";
    else if (recommendedQuantity > 0 && stockoutRisk !== "overstock") recommendationStatus = "Запланировать заказ";
    else if (overstockRisk) recommendationStatus = "Избыточный запас";
    const orderableQuantity = inventoryKnown ? recommendedQuantity : 0;
    const estimatedCost = orderableQuantity * (selectedSupplier?.unitCost ?? 0);
    return { sku: product.sku, productName: product.productName, category: product.category, rawHistory, cleanedHistory: clean, outliers, averageDemand, forecastDemand, demandStdDev, forecastMethod: "Взвешенное скользящее среднее (8 недель)", forecastError: Math.round(Math.min(45, demandStdDev / Math.max(forecastDemand, 1) * 100)), onHand: inventory.onHand, reserved: inventory.reserved, backorders: inventory.backorders, inTransit, stockPosition, inventoryKnown, leadTimeDays, safetyStock, reorderPoint, targetStock, rawRecommendedQuantity, recommendedQuantity: orderableQuantity, packSize: selectedSupplier?.packSize ?? 1, minOrderQty: selectedSupplier?.minOrderQty ?? 0, daysOfCover, estimatedStockoutDate: stockoutRisk === "critical" || stockoutRisk === "high" ? plusDays(daysOfCover) : null, stockoutRisk, overstockRisk, confidenceScore, confidenceReasons, selectedSupplier, recommendationStatus, warnings, estimatedCost, naiveForecast: weightedForecast(rawHistory) };
  });
  let leftBudget = scenario.budget;
  return recommendations.sort((a, b) => (a.stockoutRisk === "critical" ? -1 : 0) - (b.stockoutRisk === "critical" ? -1 : 0) || a.daysOfCover - b.daysOfCover).map(item => {
    if (item.estimatedCost <= leftBudget) { leftBudget -= item.estimatedCost; return item; }
    return { ...item, recommendedQuantity: 0, estimatedCost: 0, recommendationStatus: "Требуется проверка" as Status, warnings: [...item.warnings, "Не вошло в установленный бюджет"] };
  });
}
export const explanationFor = (item: Recommendation) => `${item.productName}: прогноз ${item.forecastDemand.toFixed(1)} шт./нед. В позиции ${item.stockPosition} шт. с учётом товара в пути. Точка заказа — ${item.reorderPoint} шт.; страховой запас — ${item.safetyStock} шт. ${item.outliers.length ? `Разовая продажа ${item.outliers[0].quantity} шт. исключена из регулярного спроса. ` : ""}${item.recommendedQuantity ? `Рекомендуем ${item.recommendedQuantity} шт. у ${item.selectedSupplier?.supplierName}.` : item.warnings.join(". ") || "Заказ сейчас не требуется."}`;
