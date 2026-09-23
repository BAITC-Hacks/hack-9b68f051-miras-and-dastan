'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bot, CheckCircle2, CircleHelp, Code2, PackageCheck, ShieldCheck, Wallet } from 'lucide-react';
import { explanationFor } from '../lib/analytics';
import type { Recommendation } from '../lib/types';
import styles from './PurchaseApiPanel.module.css';

const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 });
export default function PurchaseApiPanel({ recommendations, onBack }: { recommendations: Recommendation[]; onBack?: () => void }) {
  const [sku, setSku] = useState(() => recommendations.find(item => item.sku === 'CAB-NYM-3X2.5')?.sku ?? recommendations[0]?.sku ?? '');
  const [mode, setMode] = useState<'local' | 'api'>('local');

  const selected = recommendations.find(item => item.sku === sku) ?? recommendations[0];
  const orders = recommendations.filter(item => item.recommendedQuantity > 0);
  const totalQuantity = orders.reduce((sum, item) => sum + item.recommendedQuantity, 0);
  const pricedOrders = orders.filter(item => item.selectedSupplier !== null && Number.isFinite(item.selectedSupplier.unitCost));
  const totalCost = pricedOrders.reduce((sum, item) => sum + item.estimatedCost, 0);

  const context = selected ? {
    sku: selected.sku,
    productName: selected.productName,
    forecastDemand: selected.forecastDemand,
    stockPosition: selected.stockPosition,
    reorderPoint: selected.reorderPoint,
    targetStock: selected.targetStock,
    recommendedQuantity: selected.recommendedQuantity,
    outliers: selected.outliers.length,
    supplier: selected.selectedSupplier?.supplierName ?? null,
    cost: selected.selectedSupplier ? selected.estimatedCost : null,
    leadTimeDays: selected.leadTimeDays,
    minOrderQty: selected.minOrderQty,
    packSize: selected.packSize,
    recommendationStatus: selected.recommendationStatus,
    warnings: selected.warnings,
  } : null;

  return <section className={styles.panel} aria-labelledby="purchase-api-title">
    <div className={styles.heading}>
      <div>
        <span className={styles.eyebrow}><Bot size={15} aria-hidden="true" /> Помощник закупщика</span>
        <h1 id="purchase-api-title">API и анализ закупок</h1>
        <p>Разбор текущих рекомендаций и предварительный вид панели ассистента.</p>
      </div>
      {onBack && <button type="button" className={styles.secondaryButton} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> К обзору</button>}
    </div>

    <div className={styles.summary}>
      <div className={styles.summaryCard}><PackageCheck size={20} aria-hidden="true" /><div><span>Товаров к закупке</span><strong>{format.format(orders.length)} <small>из {recommendations.length} SKU</small></strong></div></div>
      <div className={styles.summaryCard}><ArrowUpRight size={20} aria-hidden="true" /><div><span>Рекомендовано заказать</span><strong>{format.format(totalQuantity)} <small>шт.</small></strong></div></div>
      <div className={styles.summaryCard}><Wallet size={20} aria-hidden="true" /><div><span>Оценка закупок{pricedOrders.length < orders.length ? ' · цены известны частично' : ''}</span><strong>{orders.length === 0 ? money.format(0) : pricedOrders.length > 0 ? money.format(totalCost) : 'Нет цен'}</strong></div></div>
    </div>

    {!selected ? <div className={styles.empty}><CircleHelp size={30} aria-hidden="true" /><h2>Сначала выберите данные</h2><p>Анализ станет доступен после загрузки истории и расчёта рекомендаций.</p></div> : <div className={styles.layout}>
      <aside className={styles.productCard}>
        <label className={styles.field} htmlFor="api-sku">Товар для анализа
          <select id="api-sku" value={selected.sku} onChange={event => setSku(event.target.value)}>{recommendations.map(item => <option key={item.sku} value={item.sku}>{item.sku} · {item.productName}</option>)}</select>
        </label>
        <span className={styles.productCode}>{selected.sku}</span>
        <h2>{selected.productName}</h2>
        <span className={styles.status}>{selected.recommendationStatus}</span>
        <div className={styles.order}><span>Рекомендуемый заказ</span><strong>{format.format(selected.recommendedQuantity)} <small>шт.</small></strong><p>{selected.selectedSupplier ? `${money.format(selected.estimatedCost)} · ${selected.selectedSupplier.supplierName}` : 'Цена и поставщик не определены'}</p></div>
        <dl className={styles.facts}>
          <div><dt>Прогноз в неделю</dt><dd>{format.format(selected.forecastDemand)} шт.</dd></div>
          <div><dt>Позиция с товаром в пути</dt><dd>{format.format(selected.stockPosition)} шт.</dd></div>
          <div><dt>Точка заказа</dt><dd>{format.format(selected.reorderPoint)} шт.</dd></div>
          <div><dt>Срок поставки</dt><dd>{format.format(selected.leadTimeDays)} дн.</dd></div>
          <div><dt>MOQ / упаковка</dt><dd>{format.format(selected.minOrderQty)} / {format.format(selected.packSize)}</dd></div>
        </dl>
        <p className={styles.note}><ShieldCheck size={16} aria-hidden="true" /> Числа из текущего расчёта, с учётом выбранного сценария и бюджета.</p>
      </aside>

      <div className={styles.analysisCard}>
        <div className={styles.tabs} role="tablist" aria-label="Режим анализа">
          <button id="local-analysis-tab" type="button" role="tab" aria-selected={mode === 'local'} aria-controls="local-analysis-content" className={mode === 'local' ? styles.activeTab : ''} onClick={() => setMode('local')}><ShieldCheck size={16} aria-hidden="true" /> Локальный разбор</button>
          <button id="api-analysis-tab" type="button" role="tab" aria-selected={mode === 'api'} aria-controls="api-analysis-content" className={mode === 'api' ? styles.activeTab : ''} onClick={() => setMode('api')}><Bot size={16} aria-hidden="true" /> API-ассистент</button>
        </div>
        {mode === 'local' ? <div id="local-analysis-content" role="tabpanel" aria-labelledby="local-analysis-tab" className={styles.analysisBody}>
          <span className={styles.localBadge}><CheckCircle2 size={15} aria-hidden="true" /> Без отправки данных</span>
          <h2>Почему такая рекомендация</h2>
          <p className={styles.explanation}>{explanationFor(selected)}</p>
          <div className={styles.formula}><span>Потребность до ограничений</span><p>Целевой запас <b>{format.format(selected.targetStock)}</b> − позиция <b>{format.format(selected.stockPosition)}</b> = <b>{format.format(selected.rawRecommendedQuantity)} шт.</b></p><small>Отрицательная потребность принимается равной нулю. Итог выше уже учитывает поставщика, MOQ, упаковку и бюджет.</small></div>
          {selected.warnings.length > 0 && <div className={styles.warnings}><h3>Что проверить перед заказом</h3><ul>{selected.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div>}
          <p className={styles.note}>Этот разбор построен по правилам приложения. Он не создаёт заказ у поставщика.</p>
          <button type="button" className={styles.primaryButton} onClick={() => setMode('api')}>Посмотреть интерфейс API <ArrowUpRight size={16} aria-hidden="true" /></button>
        </div> : <div id="api-analysis-content" role="tabpanel" aria-labelledby="api-analysis-tab" className={styles.analysisBody}>
          <span className={styles.apiBadge}><Bot size={15} aria-hidden="true" /> API пока не подключён</span>
          <h2>Будущая панель ассистента</h2>
          <p className={styles.description}>Здесь можно будет задавать вопросы по выбранному товару. Пока доступен только предпросмотр интерфейса: данные никуда не отправляются.</p>
          <label className={styles.field} htmlFor="api-question">Вопрос ассистенту<textarea id="api-question" placeholder="Почему система рекомендует это количество и что проверить перед закупкой?" rows={4} disabled /></label>
          <div className={styles.response}><div><Bot size={18} aria-hidden="true" /><strong>Место для ответа</strong></div><p>После подключения API здесь появится объяснение, связанное с расчётами выбранного SKU.</p><small>Сейчас рекомендацию можно изучить во вкладке «Локальный разбор».</small></div>
          <p className={styles.note}>Ключи и настройки подключения в этом макете не используются.</p>
          <button type="button" className={styles.primaryButton} onClick={() => setMode('local')}><ArrowLeft size={16} aria-hidden="true" /> Открыть локальный разбор</button>
          <details className={styles.technical}><summary><Code2 size={15} aria-hidden="true" /> Данные выбранного товара</summary><p>Сводка текущего расчёта. Отображается только в браузере.</p><pre>{JSON.stringify(context, null, 2)}</pre></details>
        </div>}
      </div>
    </div>}
  </section>;
}
