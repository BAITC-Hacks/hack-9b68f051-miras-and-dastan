'use client';

import { useEffect, useId, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { createDemo } from '../data/demo/generate';
import { BacktestInputSchema, type BacktestInput, type BacktestResult, type BacktestMetrics } from './contracts';
import { compareStrategies, type StrategyPair } from './engine';
import { exportCsv } from './csv';
import styles from './BacktestPanel.module.css';

export interface BacktestPanelProps {
  initialInput?: BacktestInput;
  inputs?: readonly BacktestInput[];
  strategies?: StrategyPair;
  strategyNotice?: string;
  sourceLabel?: string;
  embedded?: boolean;
  hideProductPicker?: boolean;
  allowDemo?: boolean;
  onResults?: (results: readonly BacktestResult[]) => void;
}

const defaults: BacktestInput['settings'] = { initialStock: 45, leadTimeDays: 21, reviewPeriod: 1, moq: 5, packSize: 5, serviceLevel: '0.95' };
const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const moneyFormat = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
const format = (value: number) => Number.isFinite(value) ? numberFormat.format(value) : '—';
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const date = (value: string) => Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(`${value}T00:00:00Z`)) : value;
const money = (value: number, currency: string) => currency === '₸' || currency === 'KZT' ? moneyFormat.format(value) : `${format(value)} ${currency}`;
const metrics: [keyof BacktestMetrics, string][] = [
  ['servedDemand', 'Обслуженный спрос, ед.'], ['unmetDemand', 'Необслуженный спрос, ед.'],
  ['fillRate', 'Доля обслуженного спроса'], ['shortagePeriods', 'Недель с дефицитом'],
  ['averageEndingStock', 'Средний конечный запас, ед.'], ['maxStock', 'Максимальный запас до спроса, ед.'],
  ['orderCount', 'Количество заказов'], ['orderedQuantity', 'Заказано, ед.'],
  ['purchaseCost', 'Стоимость закупок'], ['averageInventoryCost', 'Стоимость среднего запаса'],
  ['endingStock', 'Остаток на конец, ед.'], ['inTransit', 'Поставки в пути на конец, ед.'],
];
const advancedFields = [
  ['leadTimeDays', 'Срок поставки, дней'], ['reviewPeriod', 'Пересмотр, недель'],
  ['moq', 'Минимальный заказ, ед.'], ['packSize', 'Упаковка, ед.'],
] as const;

export function BacktestPanel({ initialInput, inputs, strategies, strategyNotice, sourceLabel, embedded = false, hideProductPicker = false, allowDemo = true, onResults }: BacktestPanelProps) {
  const id = useId();
  const [catalog, setCatalog] = useState<ReturnType<typeof createDemo>>([]);
  const [input, setInput] = useState<BacktestInput | undefined>(initialInput ?? inputs?.[0]);
  const [results, setResults] = useState<readonly BacktestResult[]>();
  const [error, setError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || !results) return;
    const timer = window.setTimeout(() => {
      if (cursor >= results[0]!.steps.length - 1) setPlaying(false);
      else setCursor(cursor + 1);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [playing, results, cursor]);

  function change(next: BacktestInput) {
    setInput(next); setResults(undefined); setCursor(0); setPlaying(false); setError(''); setExportNotice('');
  }

  function select(item: ReturnType<typeof createDemo>[number]) {
    change({
      sku: item.sku, observations: item.observations, startIndex: item.kind === 'short' ? 2 : 20,
      endIndex: item.observations.length - 1,
      settings: { ...defaults, leadTimeDays: item.leadTimeDays, packSize: item.packSize },
      unitCost: item.unitCost, currency: '₸', source: 'sales',
    });
  }

  function run() {
    const parsed = BacktestInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(`${parsed.error.issues.map(issue => issue.message).join('; ')}. Проверьте период, числовые поля и непрерывность недель.`);
      return;
    }
    try {
      const nextResults = compareStrategies(parsed.data, strategies);
      setResults(nextResults); setCursor(nextResults[0].steps.length - 1); setPlaying(false); setError(''); setExportNotice('');
      onResults?.(nextResults);
    } catch (caught) {
      setError(`${caught instanceof Error ? caught.message : 'Не удалось выполнить расчёт'}. Проверьте входные данные и повторите сравнение.`);
    }
  }

  function download() {
    if (!results) return;
    try {
      const url = URL.createObjectURL(new Blob([exportCsv(results)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `stockpilot-${input?.sku}.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportNotice('CSV сформирован и передан браузеру для скачивания.'); setError('');
    } catch {
      setError('Не удалось создать CSV. Повторите экспорт или разрешите скачивание в браузере.');
    }
  }

  const baseline = results?.[0];
  const compared = results?.[1];
  const chart = baseline?.steps.slice(0, cursor + 1).map((step, index) => ({ date: step.date, baseline: step.endingStock, compared: compared!.steps[index]!.endingStock }));
  const strategyNames = strategies ? strategies.map(strategy => strategy.name) : ['Обычное среднее', 'StockPilot · демо'];
  const origin = catalog.length ? 'Независимое демо модуля · 6 сценариев' : sourceLabel ?? 'Данные, переданные приложением';
  const difference = baseline && compared ? (compared.metrics.fillRate - baseline.metrics.fillRate) * 100 : 0;
  const periodStart = input?.observations[input.startIndex]?.date;
  const periodEnd = input?.observations[input.endIndex]?.date;

  return <section className={`${styles.panel} ${embedded ? styles.embedded : ''}`} aria-label="Проверка закупок на истории">
    {!embedded && <header className={styles.header}>
      <div><span className={styles.eyebrow}>StockPilot AI</span><h1>Проверка на истории</h1><p>Сравните прогнозы на одних продажах и при одинаковых условиях закупки.</p></div>
      {allowDemo && <button type="button" className={styles.secondary} onClick={() => { const demo = createDemo(); setCatalog(demo); select(demo[0]!); }}>Открыть независимое демо</button>}
    </header>}
    {embedded && allowDemo && <div className={styles.demoAction}><button type="button" className={styles.secondary} onClick={() => { const demo = createDemo(); setCatalog(demo); select(demo[0]!); }}>Открыть независимое демо</button></div>}
    <div className={styles.notice}>
      {input && <strong className={styles.source}>{origin}</strong>}
      <p>{strategies ? strategyNotice ?? 'Подключена внешняя стратегия StockPilot. Правила пополнения одинаковы для обеих стратегий.' : 'Встроенная демонстрационная стратегия. Основной прогноз StockPilot не подключён.'}</p>
      <p>Это сравнение прогнозов при общей политике пополнения. Бюджет и выбор поставщика здесь не проверяются.</p>
    </div>

    {!input ? <div className={styles.empty}>
      <h2>Как отработали бы две стратегии?</h2>
      <p>{allowDemo ? 'Откройте шесть воспроизводимых сценариев: стабильный спрос, разовый всплеск и другие случаи.' : 'Передайте товар с непрерывной недельной историей, чтобы начать сравнение.'}</p>
      <p className={styles.hint}>Расчёт выполняется локально. История не отправляется текстовому AI.</p>
    </div> : <>
      <section className={styles.card} aria-labelledby={`${id}-conditions`}>
        <div className={styles.sectionTitle}><h2 id={`${id}-conditions`}>Условия эксперимента</h2><span>Недельная детализация</span></div>
        <div className={`${styles.fields} ${hideProductPicker ? styles.withoutProduct : ''}`}>
          {!hideProductPicker && <label>Товар / SKU<select value={input.sku} onChange={event => {
            const item = catalog.find(entry => entry.sku === event.target.value);
            if (item) select(item);
            else { const external = inputs?.find(entry => entry.sku === event.target.value); if (external) change(external); }
          }}>{catalog.length ? catalog.map(item => <option key={item.sku} value={item.sku}>{item.sku} — {item.label}</option>) : inputs?.length ? inputs.map(item => <option key={item.sku} value={item.sku}>{item.sku}</option>) : <option>{input.sku}</option>}</select></label>}
          <label>Начало проверки<select value={input.startIndex} onChange={event => change({ ...input, startIndex: Number(event.target.value) })}>{input.observations.map((observation, index) => <option key={observation.date} value={index}>{date(observation.date)}</option>)}</select></label>
          <label>Конец проверки<select value={input.endIndex} onChange={event => change({ ...input, endIndex: Number(event.target.value) })}>{input.observations.map((observation, index) => <option key={observation.date} value={index}>{date(observation.date)}</option>)}</select></label>
          <label>Начальный запас, ед.<input type="number" min="0" step="any" value={Number.isNaN(input.settings.initialStock) ? '' : input.settings.initialStock} onChange={event => change({ ...input, settings: { ...input.settings, initialStock: event.target.value === '' ? NaN : Number(event.target.value) } })} /></label>
        </div>
        <details className={styles.advanced}>
          <summary>Условия пополнения <span>Поставка {format(input.settings.leadTimeDays)} дн. · MOQ {format(input.settings.moq)} · упаковка {format(input.settings.packSize)}</span></summary>
          <div className={styles.advancedFields}>
            {advancedFields.map(([key, label]) => <label key={key}>{label}<input type="number" min={key === 'packSize' || key === 'reviewPeriod' ? 1 : 0} max={key === 'leadTimeDays' ? 3650 : key === 'reviewPeriod' ? 520 : undefined} step="1" value={Number.isNaN(input.settings[key]) ? '' : input.settings[key]} onChange={event => change({ ...input, settings: { ...input.settings, [key]: event.target.value === '' ? NaN : Number(event.target.value) } })} /></label>)}
            <label>Уровень сервиса<select value={input.settings.serviceLevel} onChange={event => change({ ...input, settings: { ...input.settings, serviceLevel: event.target.value as BacktestInput['settings']['serviceLevel'] } })}>{['0.5', '0.9', '0.95', '0.99'].map(value => <option key={value} value={value}>{Number(value) * 100}%</option>)}</select></label>
          </div>
          <p className={styles.hint}>Пересмотр каждые {format(input.settings.reviewPeriod)} нед. Уровень сервиса — параметр страхового запаса, а не обещание обслужить такой процент спроса.</p>
        </details>
        <div className={styles.experiment}>
          <span><b>Базовая:</b> {strategyNames[0]}</span><span><b>Сравниваемая:</b> {strategyNames[1]}</span>
          <span><b>Цена для расчёта:</b> {input.unitCost === undefined ? 'не задана' : `${money(input.unitCost, input.currency)} / ед.`}</span>
        </div>
        <div className={styles.runbar}>
          <p>До проверки: {input.startIndex} нед. истории. Начальный запас — заданное допущение, не текущий остаток.</p>
          <button type="button" onClick={run}>Запустить сравнение</button>
        </div>
      </section>
      {error && <p role="alert" className={styles.errorNotice}>{error}</p>}
      {exportNotice && <p role="status" className={styles.exportNotice}>{exportNotice}</p>}

      {baseline && compared ? <>
        <section className={styles.card} aria-labelledby={`${id}-chart`}>
          <div className={styles.sectionTitle}><div><h2 id={`${id}-chart`}>История запасов</h2><p className={styles.hint}>{periodStart && date(periodStart)} — {periodEnd && date(periodEnd)} · конечный запас, ед.</p></div><button type="button" className={styles.secondary} onClick={download}>Экспорт CSV</button></div>
          <div className={styles.legend} aria-label="Обозначения стратегий"><span><i className={styles.baselineLine} />{baseline.strategy}</span><span><i className={styles.comparedLine} />{compared.strategy}</span></div>
          <div className={styles.chart} role="img" aria-label={`Конечный запас по неделям. Базовая стратегия: ${baseline.strategy}; сравниваемая: ${compared.strategy}. Значения доступны в таблице журнала ниже.`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ left: 0, right: 16, top: 16, bottom: 8 }} accessibilityLayer>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--divider, #E2E8F0)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--text-muted, #64748B)' }} tickLine={false} axisLine={{ stroke: 'var(--divider, #E2E8F0)' }} minTickGap={24} tickFormatter={value => `${String(value).slice(8)}.${String(value).slice(5, 7)}`} />
                <YAxis width={48} tick={{ fontSize: 12, fill: 'var(--text-muted, #64748B)' }} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={value => date(String(value))} formatter={(value, name) => [`${format(Number(value))} ед.`, name]} contentStyle={{ borderRadius: 8, border: '1px solid var(--divider, #E2E8F0)', fontSize: 12, color: 'var(--foreground, #0F172A)' }} />
                <Line name={baseline.strategy} dataKey="baseline" stroke="var(--text-muted, #64748B)" strokeDasharray="6 4" dot={chart?.length === 1} strokeWidth={2} isAnimationActive={false} />
                <Line name={compared.strategy} dataKey="compared" stroke="var(--primary, #2563EB)" dot={chart?.length === 1} strokeWidth={2.5} isAnimationActive={false} />
                {baseline.steps.slice(0, cursor + 1).filter((step, index) => step.unmet > 0 || compared.steps[index]!.unmet > 0).map(step => <ReferenceLine key={step.date} x={step.date} stroke="#B91C1C" strokeDasharray="2 5" />)}
                {[baseline, compared].flatMap((result, strategyIndex) => result.steps.slice(0, cursor + 1).flatMap(step => [
                  ...(step.ordered > 0 ? [<ReferenceDot key={`${strategyIndex}-${step.date}-order`} x={step.date} y={step.endingStock} r={5} fill="var(--surface, #FFFFFF)" stroke="#92400E" strokeWidth={2} />] : []),
                  ...(step.receipts > 0 ? [<ReferenceDot key={`${strategyIndex}-${step.date}-receipt`} x={step.date} y={step.endingStock} r={2.5} fill="#166534" stroke="#166534" />] : []),
                ]))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className={styles.hint}>Красный вертикальный пунктир — неделя с дефицитом. Янтарное кольцо — размещён заказ. Зелёная точка — поступление. Все события и значения доступны в журнале.</p>
          <div className={styles.playback}>
            <button type="button" className={styles.secondary} onClick={() => { setCursor(0); setPlaying(false); }}>В начало</button>
            <button type="button" className={styles.secondary} aria-pressed={playing} onClick={() => { if (cursor === baseline.steps.length - 1) setCursor(0); setPlaying(!playing); }}>{playing ? 'Пауза' : 'Проиграть'}</button>
            <button type="button" className={styles.secondary} disabled={cursor >= baseline.steps.length - 1} onClick={() => { setPlaying(false); setCursor(value => Math.min(value + 1, baseline.steps.length - 1)); }}>Следующая неделя</button>
            <label className={styles.playbackRange}>Неделя {cursor + 1} из {baseline.steps.length}<input aria-label="Неделя проигрывания" type="range" min="0" max={baseline.steps.length - 1} value={cursor} onChange={event => { setPlaying(false); setCursor(Number(event.target.value)); }} /></label>
          </div>
          <div className={styles.weekTitle}><h3>Неделя проигрывания</h3><span>{baseline.steps[cursor] && date(baseline.steps[cursor]!.date)}</span></div>
          <div className={styles.events}>
            {[baseline, compared].map((result, index) => {
              const step = result.steps[cursor]!;
              return <article key={index}><h3>{result.strategy}</h3><dl><div><dt>Спрос</dt><dd>{format(step.demand)} ед.</dd></div><div><dt>Обслужено</dt><dd>{format(step.served)} ед.</dd></div><div><dt>Остаток</dt><dd>{format(step.endingStock)} ед.</dd></div><div><dt>В пути</dt><dd>{format(step.inTransit)} ед.</dd></div></dl><div className={styles.badges}><span className={styles.badge}>↑ Заказ: {format(step.ordered)}</span><span className={styles.badge}>↓ Приход: {format(step.receipts)}</span><span className={step.unmet > 0 ? styles.shortage : styles.badge}>Дефицит: {format(step.unmet)}</span></div><p className={styles.hint}>{step.decision ? `Прогноз ${format(step.decision.forecast)} ед./нед. · скорректировано наблюдений: ${step.decision.adjustedCount}` : 'Неделя без пересмотра'}</p></article>;
            })}
          </div>
        </section>

        <section className={styles.card} aria-labelledby={`${id}-metrics`}>
          <div className={styles.sectionTitle}><div><h2 id={`${id}-metrics`}>Итоги за весь период</h2><p className={styles.hint}>Все {baseline.steps.length} нед. проверки. Эти показатели не меняются при проигрывании.</p></div></div>
          <div className={styles.kpis}>{[baseline, compared].map((result, index) => <div className={index === 1 ? styles.comparedKpi : ''} key={index}><span className={styles.strategyName}>{result.strategy}</span><strong>{format(result.metrics.fillRate * 100)}<small>% спроса обслужено</small></strong><p><span className={result.metrics.unmetDemand > 0 ? styles.error : ''}>{format(result.metrics.unmetDemand)} ед. не обслужено</span> · {format(result.metrics.averageEndingStock)} ед. среднего запаса</p></div>)}</div>
          <p className={styles.comparison}>{compared.strategy}: доля обслуживания {difference === 0 ? 'совпадает с базовой стратегией.' : `${difference > 0 ? 'выше' : 'ниже'} базовой на ${format(Math.abs(difference))} п. п.`} {difference < 0 && 'Сравниваемая стратегия обслужила меньшую долю спроса.'}</p>
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Сравнение фактических метрик за весь период"><table><caption className={styles.srOnly}>Фактические итоги обеих стратегий за весь выбранный период</caption><thead><tr><th scope="col">Показатель</th><th scope="col">{baseline.strategy}</th><th scope="col">{compared.strategy}</th></tr></thead><tbody>{metrics.map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{[baseline, compared].map((result, index) => { const value = result.metrics[key]; return <td key={index}>{value === undefined ? 'Цена не задана' : key === 'fillRate' ? `${format(value * 100)}%` : key === 'purchaseCost' || key === 'averageInventoryCost' ? money(value, result.currency) : format(value)}</td>; })}</tr>)}</tbody></table></div>
          <p className={styles.hint}>Стоимость закупок включает размещённые заказы, в том числе товары в пути. Разница в закупках не означает прибыль или гарантированную экономию.</p>
        </section>

        <details className={styles.card}>
          <summary>Полный журнал событий и данные графика</summary>
          <p className={styles.hint}>Все недели периода и обе стратегии. Количества указаны в единицах товара.</p>
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Все значения запаса и события по неделям"><table><caption className={styles.srOnly}>Табличная альтернатива графику запасов</caption><thead><tr><th scope="col">Неделя / стратегия</th><th scope="col">Спрос</th><th scope="col">Обслужено</th><th scope="col">Заказ ↑</th><th scope="col">Приход ↓</th><th scope="col">Дефицит</th><th scope="col">Остаток</th><th scope="col">В пути</th></tr></thead><tbody>{baseline.steps.flatMap((_, weekIndex) => [baseline, compared].map((result, strategyIndex) => { const step = result.steps[weekIndex]!; return <tr key={`${strategyIndex}-${weekIndex}`}><th scope="row">{date(step.date)}<span className={styles.rowStrategy}>{result.strategy}</span></th><td>{format(step.demand)}</td><td>{format(step.served)}</td><td>{format(step.ordered)}</td><td>{format(step.receipts)}</td><td className={step.unmet > 0 ? styles.error : ''}>{format(step.unmet)}</td><td>{format(step.endingStock)}</td><td>{format(step.inTransit)}</td></tr>; }))}</tbody></table></div>
        </details>
      </> : <div className={styles.waiting}><h3>Условия готовы к проверке</h3><p>Запустите сравнение, чтобы увидеть движение запаса, дефицит и закупки обеих стратегий.</p></div>}
    </>}

    <details className={styles.assumptions} open>
      <summary>Допущения и ограничения</summary>
      <ul>
        <li>{input?.source === 'demand' ? 'Используется предоставленная история спроса.' : 'Продажи используются как приближение спроса. Скрытый спрос во время исторического дефицита неизвестен.'}</li>
        <li>Необслуженный спрос теряется, задолженность не переносится. Обе стратегии стартуют с одинаковым заданным запасом и без открытых заказов.</li>
        <li>Порядок недели: поступления → прогноз по прошлым неделям → заказ → спрос → остаток. При нулевом сроке новый заказ приходит до спроса этой недели.</li>
        <li>Срок поставки округляется вверх до недель. Измеряются недели с дефицитом, точное число дней неизвестно.</li>
        <li>Уровень сервиса задаёт коэффициент страхового запаса, а не гарантирует фактическую долю обслуживания. Рост и сезонность не моделируются; сравниваемая стратегия может проиграть.</li>
        <li>Цена и условия поставки — допущения эксперимента, а не подтверждённые исторические условия. При отсутствии цены стоимости не рассчитываются.</li>
        <li>Исходные наблюдения сохранены. Не учитываются бюджет, выбор поставщиков, стоимость хранения, возвраты, скидки и неопределённость поставок.</li>
      </ul>
    </details>
  </section>;
}
