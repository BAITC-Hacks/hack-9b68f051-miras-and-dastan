"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2, Plus, Sparkles } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dataset, Recommendation } from "../lib/types";
import { dateLabel, decimal, integer, isBudgetExcluded, money, orderBlockReason, weeklyHistoryIssue } from "../lib/presentation";
import { quantityBreakdown, skuHistoryRows } from "../lib/sku-presentation";
import { Button, Drawer, Notice, StatusBadge } from "./ui";
import styles from "./SkuDrawer.module.css";

interface SkuDrawerProps {
  item: Recommendation;
  dataset: Dataset;
  revision: string;
  salesOnly: boolean;
  onClose: () => void;
  onSelect: (sku: string) => void;
  selected: boolean;
}

export function SkuDrawer(props: SkuDrawerProps) {
  return <Drawer title={props.item.productName} onClose={props.onClose}>
    <SkuDetails key={`${props.item.sku}:${props.revision}`} {...props} />
  </Drawer>;
}

function SkuDetails({ item, dataset, salesOnly, onSelect, selected }: SkuDrawerProps) {
  const chart = skuHistoryRows(dataset, item);
  const dates = new Map(chart.map(row => [row.id, row.date]));
  const breakdown = quantityBreakdown(item);
  const budgetExcluded = isBudgetExcluded(item);
  const weeklyIssue = weeklyHistoryIssue(dataset, item.sku);
  const inventoryKnown = !salesOnly && dataset.inventory.some(row => row.sku === item.sku);
  const supplierKnown = !salesOnly && item.selectedSupplier !== null;
  const purchasingKnown = inventoryKnown && supplierKnown && !weeklyIssue;
  const blocked = weeklyIssue ?? orderBlockReason(item, salesOnly)
    ?? (!inventoryKnown ? "Нет подтверждённых остатков. Добавьте их перед созданием черновика." : null);
  const packMismatch = item.recommendedQuantity > 0 && item.packSize > 0 && item.recommendedQuantity % item.packSize !== 0;
  const selectBlock = blocked ?? (packMismatch ? "Количество не кратно упаковке. Проверьте условия поставщика перед заказом." : null);
  const warnings = [...new Set([
    ...item.warnings.filter(warning => !warning.includes("аномали") && !warning.includes("бюджет")),
    ...(packMismatch && !salesOnly ? ["Расчётное количество не кратно упаковке. Требуется проверка условий поставщика."] : []),
  ])];

  return <div className={styles.content}>
    <h2 className={styles.productTitle}>{item.productName}</h2>
    <div className={styles.identity}>
      <p>{item.sku} <span aria-hidden="true">·</span> {item.category}</p>
      {salesOnly ? <span className={styles.neutralBadge}>Недостаточно данных для закупки</span> : <StatusBadge item={item} />}
    </div>

    <section className={styles.recommendation} aria-label="Рекомендация к заказу">
      <div><span className={styles.label}>Рекомендуемое количество</span><strong>{purchasingKnown ? integer(item.recommendedQuantity) : "—"} <small>шт.</small></strong></div>
      <div className={styles.cost}><span className={styles.label}>Стоимость</span><strong>{purchasingKnown ? money(item.estimatedCost) : "Не определена"}</strong></div>
      <div className={styles.selection}>
        <Button variant={selected ? "secondary" : "primary"} disabled={!selected && Boolean(selectBlock)} aria-pressed={selected} onClick={() => onSelect(item.sku)}>
          {selected ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          {selected ? "Убрать из выбранных" : "Выбрать для черновика"}
        </Button>
        {selectBlock && <p>{selectBlock}</p>}
      </div>
    </section>

    {salesOnly && <Notice tone="warning">Импорт содержит только продажи. Остатки, товар в пути, цена и условия поставки неизвестны. {weeklyIssue ? "Для недельного прогноза также нужно проверить структуру истории." : "Недельный прогноз доступен."} Закупочную рекомендацию нужно дополнить этими данными.</Notice>}
    {budgetExcluded && !salesOnly && <Notice tone="warning">Позиция не вошла в бюджет. Потребность есть: до бюджетного ограничения расчёт давал {integer(breakdown.beforeBudget ?? 0)} шт.; после ограничения — {integer(breakdown.final)} шт.</Notice>}

    <section className={styles.section} aria-labelledby="sku-sales-heading">
      <div className={styles.sectionHeader}><h3 id="sku-sales-heading">Продажи и регулярный спрос</h3><span>шт. за наблюдение</span></div>
      {chart.length ? <>
        <p className={styles.caption}>{dateLabel(chart[0].date)} — {dateLabel(chart[chart.length - 1].date)} · {integer(chart.length)} наблюдений</p>
        <div className={styles.legend} aria-label="Обозначения графика"><span><i className={styles.rawLine} />Исходные продажи</span><span><i className={styles.cleanLine} />Очищенная история</span></div>
        <div className={styles.chart} role="img" aria-label={`История продаж ${item.sku}. Аномальных наблюдений: ${item.outliers.length}. Все значения доступны в таблице под графиком.`}>
          <ResponsiveContainer width="100%" height={236}>
            <LineChart data={chart} margin={{ top: 32, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--divider, #E2E8F0)" />
              <XAxis dataKey="id" tickFormatter={id => dateLabel(dates.get(String(id)) ?? String(id))} minTickGap={28} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary, #475569)", fontSize: 12 }} />
              <YAxis width={42} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary, #475569)", fontSize: 12 }} />
              <Tooltip labelFormatter={id => dateLabel(dates.get(String(id)) ?? String(id))} formatter={(value, name) => [`${decimal(Number(value))} шт.`, name]} contentStyle={{ border: "1px solid var(--divider, #E2E8F0)", borderRadius: 8, fontSize: 12, color: "var(--foreground, #0F172A)" }} />
              <Line name="Исходные продажи" dataKey="raw" stroke="#64748B" strokeDasharray="5 3" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line name="Очищенная история" dataKey="clean" stroke="var(--primary, #2563EB)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              {chart.filter(row => row.anomaly).map(row => <ReferenceDot key={row.id} x={row.id} y={row.raw} r={5} fill="#92400E" stroke="#FFFFFF" strokeWidth={2} ifOverflow="extendDomain" label={{ value: `${decimal(row.raw)} шт.`, position: "top", fill: "#92400E", fontSize: 12 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {item.outliers.length > 0 && <div className={styles.anomalies}><AlertTriangle size={17} aria-hidden="true" /><div><strong>Аномальных наблюдений: {integer(item.outliers.length)}</strong><p>Они заменены в очищенной истории для расчёта регулярного спроса. Исходные продажи сохранены.</p><ul>{item.outliers.map((outlier, index) => <li key={`${outlier.date}-${index}`}>{dateLabel(outlier.date)}: {decimal(outlier.quantity)} шт. — {outlier.reason.toLowerCase()}.</li>)}</ul></div></div>}
        <details className={styles.details}><summary>Посмотреть значения графика</summary><div className={styles.tableScroll}><table><caption>История {item.sku}, шт. за наблюдение</caption><thead><tr><th scope="col">Дата</th><th scope="col">Исходные</th><th scope="col">Очищенные</th><th scope="col">Примечание</th></tr></thead><tbody>{chart.map(row => <tr key={row.id}><th scope="row">{dateLabel(row.date)}</th><td>{decimal(row.raw)}</td><td>{decimal(row.clean)}</td><td>{row.anomaly ? "Аномалия" : "—"}</td></tr>)}</tbody></table></div></details>
      </> : <Notice tone="warning">Нет наблюдений продаж. Добавьте историю этого товара, чтобы получить прогноз.</Notice>}
      {weeklyIssue ? <div className={styles.weeklyWarning}><Notice tone="warning">Недельный прогноз недоступен. {weeklyIssue}</Notice></div> : <div className={styles.forecast}><div><span className={styles.label}>Регулярный прогноз</span><strong>{decimal(item.forecastDemand)} <small>шт./нед.</small></strong></div><p>{item.forecastMethod}. Одно значение на недельный горизонт; будущие колебания не рассчитаны.</p></div>}
    </section>

    <section className={styles.section} aria-labelledby="sku-calculation-heading">
      <h3 id="sku-calculation-heading">Почему именно столько</h3>
      {purchasingKnown ? <>
        <ol className={styles.calculation}>
          <li><span className={styles.step}>1</span><div><strong>Целевой запас − позиция</strong><p>{integer(breakdown.target)} − {integer(breakdown.position)} <ArrowRight size={14} aria-hidden="true" /> <b>{integer(breakdown.raw)} шт.</b> исходной потребности</p><small>Отрицательная потребность принимается равной нулю.</small></div></li>
          <li><span className={styles.step}>2</span><div><strong>MOQ и упаковка</strong><p>Минимум {integer(item.minOrderQty)} шт. · упаковка {integer(item.packSize)} шт.</p><small>Результат расчётного движка до бюджета: <b>{integer(breakdown.beforeBudget ?? 0)} шт.</b></small></div></li>
          <li><span className={styles.step}>3</span><div><strong>Итог с учётом ограничений</strong><p><b>{integer(breakdown.final)} шт.</b> · {money(item.estimatedCost)}</p><small>{budgetExcluded ? "Бюджет обнулил заказ; потребность в товаре остаётся." : selectBlock ? selectBlock : breakdown.final === 0 ? "Позиции достаточно для рассчитанного целевого запаса." : "Позиция доступна для включения в черновик."}</small></div></li>
        </ol>
        <p className={styles.caption}>Цель включает спрос на срок поставки и 4 недели, а также страховой запас. Значения соответствуют текущему сценарию.</p>
      </> : <p className={styles.secondary}>{weeklyIssue ? "Сначала подготовьте непрерывную недельную историю." : `Очищенная история формирует регулярный прогноз ${decimal(item.forecastDemand)} шт./нед.`} Для цепочки «целевой запас → потребность → заказ» {inventoryKnown ? "проверьте поставщика, цену, срок, MOQ и упаковку" : "нужны подтверждённые остатки и условия поставки"}. Пока необходимые данные не подтверждены, итог закупки не определён.</p>}
    </section>

    <section className={styles.section} aria-labelledby="sku-conditions-heading">
      <h3 id="sku-conditions-heading">Остатки и условия</h3>
      <dl className={styles.metrics}>
        <Metric label="На складе" value={inventoryKnown ? `${integer(item.onHand)} шт.` : "Неизвестно"} />
        <Metric label="В резерве" value={inventoryKnown ? `${integer(item.reserved)} шт.` : "Неизвестно"} />
        <Metric label="Неисполненный спрос" value={inventoryKnown ? `${integer(item.backorders)} шт.` : "Неизвестно"} />
        <Metric label="В пути" value={!salesOnly ? `${integer(item.inTransit)} шт.` : "Неизвестно"} />
        <Metric label="Позиция запаса" value={inventoryKnown ? `${integer(item.stockPosition)} шт.` : "Неизвестно"} />
        <Metric label="Покрытие остатка" value={inventoryKnown && !weeklyIssue ? item.daysOfCover === 999 ? "Нет расхода по прогнозу" : `${integer(item.daysOfCover)} дн.` : "Не определено"} />
        <Metric label="Точка заказа" value={purchasingKnown ? `${integer(item.reorderPoint)} шт.` : "Не определена"} />
        <Metric label="Страховой запас" value={purchasingKnown ? `${integer(item.safetyStock)} шт.` : "Не определён"} />
        <Metric label="Поставщик" value={supplierKnown ? item.selectedSupplier!.supplierName : "Не указан"} />
        <Metric label="Цена единицы" value={supplierKnown ? money(item.selectedSupplier!.unitCost) : "Неизвестна"} />
        <Metric label="Срок с задержкой сценария" value={supplierKnown ? `${integer(item.leadTimeDays)} дн.` : "Неизвестен"} />
        <Metric label="MOQ / упаковка" value={supplierKnown ? `${integer(item.minOrderQty)} / ${integer(item.packSize)} шт.` : "Неизвестны"} />
      </dl>
      {inventoryKnown && <p className={styles.caption}>Позиция = на складе − резерв − неисполненный спрос + товар в пути.</p>}
      {purchasingKnown && item.estimatedStockoutDate && <p className={styles.caption}>Оценочная дата дефицита: {dateLabel(item.estimatedStockoutDate)}. Это не дата прибытия заказа.</p>}
    </section>

    <section className={styles.section} aria-labelledby="sku-quality-heading">
      <div className={styles.sectionHeader}><h3 id="sku-quality-heading">Основания и ограничения</h3><span className={styles.score}>{integer(item.confidenceScore)} / 100</span></div>
      <p className={styles.secondary}>Эвристическая оценка факторов, не измеренная точность прогноза. Балл учитывает длину истории, число выбросов и разброс спроса.</p>
      <ul className={styles.factors}><li>{integer(item.rawHistory.length)} наблюдений в истории{item.rawHistory.length < 12 ? " — история короткая" : ""}.</li><li>Аномальных наблюдений: {integer(item.outliers.length)}.</li><li>Разброс очищенного спроса: {decimal(item.demandStdDev)} шт. (стандартное отклонение).</li></ul>
      {warnings.length > 0 && <Notice tone="warning"><ul className={styles.warningList}>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></Notice>}
    </section>

    <AiExplanation item={item} disabled={!purchasingKnown} budgetExcluded={budgetExcluded} />
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function AiExplanation({ item, disabled, budgetExcluded }: { item: Recommendation; disabled: boolean; budgetExcluded: boolean }) {
  const [result, setResult] = useState<{ answer: string; mode: "demo" | "ai" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function explain() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setResult(null);
    const breakdown = quantityBreakdown(item);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Кратко объясни цепочку от регулярного спроса до итогового количества. Укажи ограничения. Если заказ обнулён бюджетом, не называй это отсутствием спроса.",
          context: { productName: item.productName, forecastDemand: item.forecastDemand, stockPosition: item.stockPosition, reorderPoint: item.reorderPoint, targetStock: item.targetStock, rawRecommendedQuantity: item.rawRecommendedQuantity, beforeBudget: breakdown.beforeBudget, recommendedQuantity: item.recommendedQuantity, minOrderQty: item.minOrderQty, packSize: item.packSize, outliers: item.outliers.length, supplier: item.selectedSupplier?.supplierName, cost: item.estimatedCost, budgetExcluded, warnings: item.warnings },
        }),
      });
      if (!response.ok) throw new Error("request-failed");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("answer" in data) || typeof data.answer !== "string" || !data.answer.trim() || !("mode" in data) || (data.mode !== "demo" && data.mode !== "ai")) throw new Error("invalid-response");
      const fallback = `Регулярный прогноз — ${decimal(item.forecastDemand)} шт./нед. Целевой запас ${integer(item.targetStock)} шт., позиция ${integer(item.stockPosition)} шт., исходная потребность ${integer(item.rawRecommendedQuantity)} шт. После MOQ и упаковки: ${integer(breakdown.beforeBudget ?? 0)} шт. ${budgetExcluded ? "Позиция не вошла в бюджет, поэтому итоговый заказ обнулён; потребность остаётся." : `Итоговая рекомендация: ${integer(item.recommendedQuantity)} шт.`}`;
      if (!controller.signal.aborted && request.current === controller) setResult({ answer: data.mode === "demo" ? fallback : data.answer, mode: data.mode });
    } catch {
      if (!controller.signal.aborted && request.current === controller) setError("Не удалось получить текстовое объяснение. Повторите запрос; расчёт и его разбор выше остаются доступны.");
    } finally {
      if (!controller.signal.aborted && request.current === controller) setLoading(false);
    }
  }

  return <section className={`${styles.section} ${styles.ai}`} aria-labelledby="sku-ai-heading">
    <h3 id="sku-ai-heading"><Sparkles size={16} aria-hidden="true" /> Дополнительное объяснение</h3>
    <p className={styles.secondary}>Текстовый помощник получает готовые результаты и не меняет расчёт. {disabled ? "Сначала дополните остатки и условия поставки." : "Запрос отправляется только по нажатию кнопки."}</p>
    <Button variant="secondary" disabled={loading || disabled} onClick={explain}>{loading && <Loader2 size={16} className={styles.spin} aria-hidden="true" />}{loading ? "Получаем объяснение…" : error ? "Повторить объяснение" : "Объяснить текстом"}</Button>
    <div aria-live="polite" aria-busy={loading}>
      {error && <Notice tone="error">{error}</Notice>}
      {result && <div className={styles.aiResult}><span className={styles.neutralBadge}>{result.mode === "demo" ? "Шаблонное объяснение · без AI" : "AI-объяснение"}</span><p>{result.answer}</p>{result.mode === "demo" && <small>AI недоступен или не настроен. Показан текст по результатам расчёта.</small>}</div>}
    </div>
  </section>;
}
