'use client';
import { useMemo } from 'react';
import { BacktestPanel } from '../stockpilot-backtest/src/BacktestPanel';
import { createStockPilotStrategy, fromStockPilotDataset, naiveStrategy, type BacktestInput } from '../stockpilot-backtest/src/core';
import { detectOutliers, mean, stdDev, weightedForecast } from '../lib/analytics';
import type { Dataset, Recommendation } from '../lib/types';
import { weeklyHistoryIssue } from '../lib/presentation';
import { Field, Notice, PageHeader } from './ui';
import styles from './Workspace.module.css';
const strategy = createStockPilotStrategy({ detectOutliers, weightedForecast, stdDev, mean });
const strategies = [{ name: 'Обычное среднее', run: naiveStrategy }, { name: 'StockPilot · основной прогноз', run: strategy }] as const;

export function HistoryPanel({ dataset, recommendations, sourceLabel, sku, onSku, dataRevision }: { dataset: Dataset; recommendations: Recommendation[]; sourceLabel: string; sku: string; onSku: (value: string) => void; dataRevision: number }) {
  const selected = recommendations.find(item => item.sku === sku);
  const prepared = useMemo((): { input?: BacktestInput; error?: string } => {
    const issue = weeklyHistoryIssue(dataset, sku);
    if (issue) return { error: issue };
    const count = dataset.sales.filter(row => row.sku === sku).length;
    const supplier = selected?.selectedSupplier;
    try {
      return { input: fromStockPilotDataset(dataset, {
        sku, startIndex: Math.min(20, Math.max(1, count - 6)), endIndex: count - 1,
        settings: { initialStock: 45, leadTimeDays: supplier?.leadTimeDays ?? 21, reviewPeriod: 1, moq: supplier?.minOrderQty ?? 1, packSize: supplier?.packSize ?? 1, serviceLevel: '0.95' },
        unitCost: supplier?.unitCost, currency: '₸',
      }) };
    } catch { return { error: 'История не соответствует требованиям проверки. Нужны неотрицательные продажи одного SKU, одна строка на каждую последовательную неделю и период после начала истории.' }; }
  }, [dataset, sku, selected?.selectedSupplier]);
  return <>
    <PageHeader title="Проверка на истории" description="Сравнение прогнозов при одинаковых правилах закупки." />
    <div className={styles.historyIntro}><Field label="Товар для проверки"><select value={sku} onChange={event => onSku(event.target.value)}>{dataset.products.map(product => <option key={product.sku} value={product.sku}>{product.productName} · {product.sku}</option>)}</select></Field><p>Используется основной прогноз StockPilot. Начальный запас задаётся как допущение, а не берётся из сегодняшнего склада. {selected?.selectedSupplier ? 'Цена и условия выбранного поставщика — текущие допущения для обеих стратегий.' : 'Поставщик не задан: сроки и упаковка — ручные допущения, стоимости не рассчитываются.'}</p></div>
    {prepared.error ? <Notice tone="error">{prepared.error} Исправьте недельную структуру файла в разделе «Данные» или выберите другой товар. Пропуски не заменяются нулями.</Notice> : prepared.input && <BacktestPanel key={`${dataRevision}:${sku}`} initialInput={prepared.input} allowDemo={false} strategies={strategies} sourceLabel={sourceLabel} embedded hideProductPicker strategyNotice="Основной прогноз подключён. Параметры спроса и задержки из раздела «Сценарии» не применяются к этому историческому эксперименту: здесь свои условия." />}
  </>;
}
