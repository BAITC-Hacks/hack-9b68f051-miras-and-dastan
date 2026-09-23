import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BacktestPanel } from '../src/BacktestPanel';
import { createDemo } from '../data/demo/generate';
import { naiveStrategy, robustStrategy } from '../src/strategies';
import type { BacktestInput } from '../src/contracts';

const item = createDemo()[0]!;
const input: BacktestInput = {
  sku: item.sku, observations: item.observations, startIndex: 20, endIndex: 35,
  settings: { initialStock: 45, leadTimeDays: 21, reviewPeriod: 1, moq: 5, packSize: 5, serviceLevel: '0.95' },
  currency: '₸', source: 'sales',
};

describe('BacktestPanel presentation boundaries', () => {
  it('keeps external provenance and injected strategy names distinct from the independent demo', () => {
    const html = renderToStaticMarkup(createElement(BacktestPanel, {
      initialInput: input, allowDemo: false, sourceLabel: 'Импортированный файл: weekly.csv',
      strategies: [{ name: 'База из хоста', run: naiveStrategy }, { name: 'Сравнение из хоста', run: robustStrategy }],
      strategyNotice: 'Стратегия передана приложением.',
    }));
    expect(html).toContain('Импортированный файл: weekly.csv');
    expect(html).toContain('База из хоста');
    expect(html).toContain('Сравнение из хоста');
    expect(html).not.toContain('Открыть независимое демо');
    expect(html).not.toContain('Встроенная демонстрационная стратегия');
    expect(html).toContain('Бюджет и выбор поставщика здесь не проверяются');
  });

  it('does not invent a price or calculate results before the user runs the experiment', () => {
    const html = renderToStaticMarkup(createElement(BacktestPanel, { initialInput: input, allowDemo: false }));
    expect(html).toContain('не задана');
    expect(html).toContain('Начальный запас — заданное допущение, не текущий остаток');
    expect(html).not.toContain('Итоги за весь период');
    expect(html).toContain('Основной прогноз StockPilot не подключён');
  });

  it('supports an embedded host picker without duplicate heading or form submission buttons', () => {
    const html = renderToStaticMarkup(createElement(BacktestPanel, { initialInput: input, embedded: true, hideProductPicker: true, allowDemo: false }));
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('Товар / SKU');
    expect(html).toContain('Начало проверки');
    expect(html).toContain('Конец проверки');
    expect(html.match(/<button\b/g)?.length).toBe(html.match(/<button type="button"/g)?.length);
  });

  it('uses the tenge symbol consistently for an explicitly supplied price', () => {
    const html = renderToStaticMarkup(createElement(BacktestPanel, { initialInput: { ...input, unitCost: 850 } }));
    expect(html).toContain('850');
    expect(html).toContain('₸ / ед.');
    expect(html).not.toContain('KZT');
  });
});
