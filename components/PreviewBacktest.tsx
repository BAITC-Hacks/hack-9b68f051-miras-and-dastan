'use client';

import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, History, ShieldCheck } from 'lucide-react';
import type { Dataset } from '../lib/types';
import { detectOutliers, mean, stdDev, weightedForecast } from '../lib/analytics';
import { BacktestPanel } from '../stockpilot-backtest/src/BacktestPanel';
import { createStockPilotStrategy, fromStockPilotDataset, naiveStrategy, type BacktestInput } from '../stockpilot-backtest/src/core';
import styles from './PreviewBacktest.module.css';

const stockPilot = createStockPilotStrategy({ detectOutliers, mean, stdDev, weightedForecast });

export function BacktestNavigationButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className={styles.launchButton} onClick={onClick}>
    <History size={17} aria-hidden="true" />
    <span>Проверка на прошлом</span>
    <ArrowRight size={15} aria-hidden="true" />
  </button>;
}

export default function PreviewBacktest({ dataset, onBack }: { dataset: Dataset; onBack: () => void }) {
  const prepared = useMemo(() => {
    const inputs: BacktestInput[] = [];
    const issues: string[] = [];
    const skus = [...new Set(dataset.sales.map(row => row.sku))];
    for (const sku of skus) {
      const count = dataset.sales.filter(row => row.sku === sku).length;
      try {
        inputs.push(fromStockPilotDataset(dataset, {
          sku,
          startIndex: count > 20 ? 20 : Math.min(2, count - 1),
          endIndex: count - 1,
          settings: { initialStock: 45, leadTimeDays: 21, reviewPeriod: 1, moq: 5, packSize: 5, serviceLevel: '0.95' },
        }));
      } catch (error) {
        issues.push(`${sku}: ${error instanceof Error ? error.message : 'Нужна непрерывная недельная история.'}`);
      }
    }
    inputs.sort((a, b) => a.sku === 'CAB-NYM-3X2.5' ? -1 : b.sku === 'CAB-NYM-3X2.5' ? 1 : a.sku.localeCompare(b.sku));
    return { inputs, issues };
  }, [dataset]);

  return <div className={styles.screen}>
    <div className={styles.navigation}>
      <button type="button" className={styles.backButton} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Вернуться к закупкам</button>
      <span className={styles.source}><ShieldCheck size={15} aria-hidden="true" /> История из текущего набора · {prepared.inputs.length} SKU</span>
    </div>
    {prepared.inputs.length > 0 ? <BacktestPanel
      inputs={prepared.inputs}
      allowDemo={false}
      strategies={[{ name: 'Обычное среднее', run: naiveStrategy }, { name: 'StockPilot · основной прогноз', run: stockPilot }]}
      strategyNotice="Расчёт по загруженной истории. Начальный запас и условия поставки — отдельные настройки исторического эксперимента."
    /> : <div className={styles.empty}><h1>Нужна недельная история продаж</h1><p>В текущем наборе нет непрерывного недельного ряда. Вернитесь к закупкам и загрузите подходящие данные.</p></div>}
    {prepared.issues.length > 0 && <details className={styles.issues}><summary>Не включено SKU: {prepared.issues.length}</summary><ul>{prepared.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
  </div>;
}
