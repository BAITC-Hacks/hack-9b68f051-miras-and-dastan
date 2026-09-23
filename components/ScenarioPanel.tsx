'use client';
import { useState } from 'react';
import { ArrowRight, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { Recommendation, Scenario } from '../lib/types';
import { BASE_SCENARIO, integer, isBudgetExcluded, money, summarize } from '../lib/presentation';
import { Button, Field, Notice, PageHeader } from './ui';
import styles from './Workspace.module.css';

export function ScenarioPanel({ scenario, base, current, salesOnly, onApply, onOpen }: { scenario: Scenario; base: Recommendation[]; current: Recommendation[]; salesOnly: boolean; onApply: (value: Scenario) => void; onOpen: (sku: string) => void }) {
  const [values, setValues] = useState({ demand: String(scenario.demandMultiplier * 100), delay: String(scenario.delayDays), budget: String(scenario.budget), service: String(scenario.serviceLevel) });
  const [error, setError] = useState('');
  const baseline = summarize(base, salesOnly), active = summarize(current, salesOnly);
  const excluded = current.filter(isBudgetExcluded);
  const changed = current.filter(item => base.find(original => original.sku === item.sku)?.recommendedQuantity !== item.recommendedQuantity);
  const fieldsChanged = Number(values.demand) !== scenario.demandMultiplier * 100 || Number(values.delay) !== scenario.delayDays || Number(values.budget) !== scenario.budget || Number(values.service) !== scenario.serviceLevel;
  function apply(event: React.FormEvent) {
    event.preventDefault();
    if ([values.demand, values.delay, values.budget].some(value => !value.trim()) || !Number.isFinite(Number(values.demand)) || Number(values.demand) < 80 || Number(values.demand) > 150 || !Number.isInteger(Number(values.delay)) || Number(values.delay) < 0 || Number(values.delay) > 21 || !Number.isFinite(Number(values.budget)) || Number(values.budget) < 0) { setError('Проверьте параметры: спрос 80–150%, задержка 0–21 целых дней, бюджет — неотрицательное число.'); return; }
    setError(''); onApply({ demandMultiplier: Number(values.demand) / 100, delayDays: Number(values.delay), budget: Number(values.budget), serviceLevel: Number(values.service) });
  }
  function reset() { setValues({ demand: '100', delay: '0', budget: String(BASE_SCENARIO.budget), service: '0.95' }); setError(''); }
  return <>
    <PageHeader title="Сценарии закупки" description="Проверьте изменения спроса, сроков и бюджета на том же наборе данных." />
    {salesOnly && <Notice tone="warning">В импортированном файле есть только продажи. Сравнение закупочных затрат и риска недоступно без подтверждённых остатков и поставщиков.</Notice>}
    <form className={styles.panel} onSubmit={apply}><div className={styles.sectionHeading}><div><h2><SlidersHorizontal size={17} /> Условия расчёта</h2><p>Исходные продажи остаются без изменений</p></div><Button variant="ghost" onClick={reset}><RotateCcw size={15} /> Базовые параметры</Button></div>
      <div className={styles.formGrid}>
        <Field label="Спрос, % от исходного" hint="База: 100%"><input type="number" min="80" max="150" step="1" value={values.demand} onChange={event => setValues({ ...values, demand: event.target.value })} /><input aria-label="Изменение спроса" type="range" min="80" max="150" value={Number(values.demand) || 80} onChange={event => setValues({ ...values, demand: event.target.value })} /></Field>
        <Field label="Дополнительная задержка, дней" hint="База: 0 дней"><input type="number" min="0" max="21" step="1" value={values.delay} onChange={event => setValues({ ...values, delay: event.target.value })} /><input aria-label="Изменение задержки" type="range" min="0" max="21" value={Number(values.delay) || 0} onChange={event => setValues({ ...values, delay: event.target.value })} /></Field>
        <Field label="Бюджет закупки, ₸" hint="База: 1 500 000 ₸. Значение 0 — без ограничения бюджета."><input type="number" min="0" step="1000" value={values.budget} onChange={event => setValues({ ...values, budget: event.target.value })} /></Field>
        <Field label="Уровень сервиса" hint="Параметр страхового запаса, а не измеренная доля обслуживания"><select value={values.service} onChange={event => setValues({ ...values, service: event.target.value })}><option value="0.9">90%</option><option value="0.95">95%</option><option value="0.97">97%</option></select></Field>
      </div>{error && <Notice tone="error">{error}</Notice>}<footer className={styles.formFooter}><span>{fieldsChanged ? 'Есть неприменённые изменения' : 'Таблица и карточки используют эти параметры'}</span><Button variant="primary" type="submit">Применить сценарий <ArrowRight size={16} /></Button></footer>
    </form>
    <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Базовый / текущий сценарий</h2><p>Сравнение применённого расчёта. Одинаковые данные и формулы.</p></div></div><div className={styles.tableScroll}><table className={`${styles.table} ${styles.comparison}`}><thead><tr><th>Показатель</th><th className={styles.numeric}>Базовый</th><th className={styles.numeric}>Текущий</th><th className={styles.numeric}>Изменение</th></tr></thead><tbody>
      <tr><td>План допустимых закупок</td><td className={styles.numeric}>{salesOnly ? '—' : money(baseline.cost)}</td><td className={styles.numeric}>{salesOnly ? '—' : money(active.cost)}</td><td className={styles.numeric}>{salesOnly ? '—' : `${active.cost > baseline.cost ? '+' : ''}${money(active.cost - baseline.cost)}`}</td></tr>
      <tr><td>Товары с риском дефицита</td><td className={styles.numeric}>{salesOnly ? '—' : baseline.risk}</td><td className={styles.numeric}>{salesOnly ? '—' : active.risk}</td><td className={styles.numeric}>{salesOnly ? '—' : `${active.risk > baseline.risk ? '+' : ''}${active.risk - baseline.risk}`}</td></tr>
      <tr><td>Позиции вне бюджета</td><td className={styles.numeric}>{salesOnly ? '—' : baseline.budget}</td><td className={styles.numeric}>{salesOnly ? '—' : active.budget}</td><td className={styles.numeric}>{salesOnly ? '—' : `${active.budget > baseline.budget ? '+' : ''}${active.budget - baseline.budget}`}</td></tr>
    </tbody></table></div><p className={styles.helper}>Разница стоимости плана не является прибылью или доказанной экономией. Снижение затрат может сопровождаться дефицитом.</p></section>
    <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Изменились рекомендации · {changed.length}</h2><p>Количество к заказу в базовом и текущем расчёте</p></div></div>{changed.length ? <div className={styles.tableScroll}><table className={`${styles.table} ${styles.comparison}`}><thead><tr><th>Товар</th><th className={styles.numeric}>База, шт.</th><th className={styles.numeric}>Сейчас, шт.</th><th>Причина ограничения</th></tr></thead><tbody>{changed.map(item => <tr key={item.sku}><td><button className={styles.textLink} onClick={() => onOpen(item.sku)}>{item.productName}</button></td><td className={styles.numeric}>{integer(base.find(original => original.sku === item.sku)?.recommendedQuantity ?? 0)}</td><td className={styles.numeric}>{integer(item.recommendedQuantity)}</td><td>{isBudgetExcluded(item) ? 'Не вошло в бюджет' : 'Пересчёт параметров'}</td></tr>)}</tbody></table></div> : <p className={styles.helper}>Состав и количества совпадают с базовым сценарием.</p>}
    {excluded.length > 0 && <Notice tone="warning">Вне бюджета: {excluded.map(item => item.sku).join(', ')}. Для этих позиций итоговая рекомендация равна нулю; потребность не исчезла.</Notice>}</section>
  </>;
}
