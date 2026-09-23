import type { Dataset, Recommendation, Scenario } from './types';

export const BASE_SCENARIO: Scenario = { demandMultiplier: 1, delayDays: 0, serviceLevel: .95, budget: 1_500_000 };
export const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(value);
export const integer = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
export const decimal = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
export const dateLabel = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
export const isBudgetExcluded = (item: Recommendation) => item.warnings.includes('Не вошло в установленный бюджет');
export const statusLabel = (item: Recommendation) => isBudgetExcluded(item) ? 'Вне бюджета' : item.recommendationStatus;
export function orderBlockReason(item: Recommendation, salesOnly = false): string | null {
  if (salesOnly) return 'Импортированы только продажи. Для заказа нужны подтверждённые остатки и условия поставщика.';
  if (!item.selectedSupplier) return 'Нет поставщика. Укажите условия поставки перед созданием заказа.';
  if (item.recommendationStatus === 'Недостаточно данных') return 'Недостаточно истории для заказа: требуется проверка менеджера.';
  if (isBudgetExcluded(item)) return 'Позиция не вошла в бюджет. Измените сценарий и проверьте расчёт.';
  if (item.recommendedQuantity <= 0) return 'По текущему расчёту заказ не требуется.';
  if (!Number.isFinite(item.estimatedCost) || !Number.isFinite(item.recommendedQuantity)) return 'Проверьте количество и стоимость.';
  if (item.recommendedQuantity < item.minOrderQty || item.recommendedQuantity % Math.max(1, item.packSize) !== 0) return 'Количество не соответствует MOQ или упаковке. Нужна проверка расчёта.';
  return null;
}
export function weeklyHistoryIssue(dataset: Dataset, sku: string): string | null {
  const rows = dataset.sales.filter(row => row.sku === sku).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 2) return 'Нужны как минимум две последовательные недели истории.';
  for (let i = 0; i < rows.length; i++) {
    const time = Date.parse(rows[i].date);
    if (!Number.isFinite(time)) return 'В истории есть некорректная дата.';
    if (i && time - Date.parse(rows[i - 1].date) !== 7 * 86_400_000) return 'Нужна одна строка на неделю без дублей и пропусков. Подготовьте недельную историю и импортируйте файл повторно.';
  }
  return null;
}
export type ProblemFilter = 'all' | 'urgent' | 'order' | 'anomalies' | 'supplier' | 'budget' | 'quality';
export type SortKey = 'priority' | 'productName' | 'stockPosition' | 'daysOfCover' | 'forecastDemand' | 'recommendedQuantity' | 'estimatedCost';
export function filterRecommendations(items: Recommendation[], search: string, filter: ProblemFilter) {
  const term = search.trim().toLocaleLowerCase('ru-RU');
  return items.filter(item => {
    if (!`${item.productName} ${item.sku}`.toLocaleLowerCase('ru-RU').includes(term)) return false;
    switch (filter) {
      case 'urgent': return item.stockoutRisk === 'critical';
      case 'order': return item.recommendedQuantity > 0;
      case 'anomalies': return item.outliers.length > 0;
      case 'supplier': return !item.selectedSupplier;
      case 'budget': return isBudgetExcluded(item);
      case 'quality': return !item.selectedSupplier || item.rawHistory.length < 12 || (item.recommendedQuantity > 0 && !!orderBlockReason(item));
      default: return true;
    }
  });
}
export function sortRecommendations(items: Recommendation[], key: SortKey, direction: 'asc' | 'desc') {
  if (key === 'priority') return [...items];
  return [...items].sort((a, b) => {
    const difference = key === 'productName' ? a.productName.localeCompare(b.productName, 'ru') : a[key] - b[key];
    return (direction === 'asc' ? 1 : -1) * difference || a.sku.localeCompare(b.sku);
  });
}
export function summarize(items: Recommendation[], salesOnly = false) {
  return {
    critical: items.filter(item => item.stockoutRisk === 'critical').length,
    risk: items.filter(item => ['critical', 'high'].includes(item.stockoutRisk)).length,
    cost: items.filter(item => !orderBlockReason(item, salesOnly)).reduce((sum, item) => sum + item.estimatedCost, 0),
    anomalies: items.reduce((sum, item) => sum + item.outliers.length, 0),
    anomalySkus: items.filter(item => item.outliers.length).length,
    supplier: items.filter(item => !item.selectedSupplier).length,
    budget: items.filter(isBudgetExcluded).length,
    quality: items.filter(item => salesOnly || !item.selectedSupplier || item.rawHistory.length < 12 || (item.recommendedQuantity > 0 && !!orderBlockReason(item))).length,
  };
}
export type Draft = { id: string; createdAt: string; revision: string; items: Recommendation[] };
export function createDraft(items: Recommendation[], selected: readonly string[], revision: string, salesOnly = false): Draft | null {
  const selectedSet = new Set(selected);
  const valid = items.filter(item => selectedSet.has(item.sku) && !orderBlockReason(item, salesOnly));
  if (!valid.length) return null;
  return { id: 'Черновик заказа', createdAt: new Date().toISOString(), revision, items: structuredClone(valid) };
}
export function csvCell(value: unknown) {
  const raw = String(value ?? '');
  const safe = /^[\s]*[=+@\-]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function draftCsv(draft: Draft) {
  const rows: unknown[][] = [['SKU', 'Товар', 'Поставщик', 'Количество, шт.', 'Цена, ₸', 'Сумма, ₸', 'Срок поставки, дней', 'Прогнозируемая дата дефицита']];
  draft.items.forEach(item => rows.push([item.sku, item.productName, item.selectedSupplier?.supplierName, item.recommendedQuantity, item.selectedSupplier?.unitCost, item.estimatedCost, item.leadTimeDays, item.estimatedStockoutDate ?? '']));
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
}
export function draftEmail(draft: Draft) {
  return `Тема: Черновик заказа StockPilot\n\n${draft.items.map(item => `${item.selectedSupplier?.supplierName}: ${item.productName} (${item.sku}) — ${item.recommendedQuantity} шт., ${money(item.estimatedCost)}`).join('\n')}\n\nИтого: ${money(draft.items.reduce((sum, item) => sum + item.estimatedCost, 0))}\nЧерновик для согласования. Заказ не отправлен.`;
}
